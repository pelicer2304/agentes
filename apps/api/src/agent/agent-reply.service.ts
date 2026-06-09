import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { ConversationMessage } from './dto/agent-settings.dto';
import { classifyIntent } from './intent-classifier';
import { KnownFacts } from './fact-extractor.service';
import { ConversationContext, SaidRecord } from './conversation-types';

export interface QuickReplyResult {
  reply: string;
  stage: string;
  intent: string;
  handoffSignal: 'none' | 'suggested' | 'accepted' | 'completed';
  needsAsyncAnalysis: boolean;
  usedLocalRule: boolean;
  usedFallback: boolean;
  fallbackReason?: string;
  llmMs?: number;
  model?: string;
}

// Minimal JSON the LLM must return
interface LLMQuickResponse {
  reply: string;
  stage: string;
  intent: string;
}

/**
 * Configuração do NEGÓCIO injetada no prompt em runtime (vem do painel:
 * AgentSettings + PricingConfig + KnowledgeBase). É isto que torna o agente
 * configurável sem tocar em código: o que a empresa faz, o que NÃO prometer, o
 * preço e o conhecimento vivem aqui, não chumbados no prompt.
 */
export interface BusinessContext {
  /** O que a empresa faz / oferece (de AgentSettings.services). */
  whatWeDo: string | null;
  /** Base de conhecimento ativa, já formatada (de KnowledgeBase). */
  knowledge: string | null;
  /** Texto de preço pronto (de PricingConfig); null quando não configurado. */
  pricingText: string | null;
  /** Itens que o agente NUNCA pode prometer (de AgentSettings.doNotPromise). */
  doNotPromise: string[] | null;
  /** Tom de voz configurado (de AgentSettings.toneOfVoice). */
  toneOfVoice: string | null;
}

@Injectable()
export class AgentReplyService {
  private readonly logger = new Logger(AgentReplyService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly llmProvider: LLMProvider,
  ) {}

  async generateQuickReply(
    lastMessage: string,
    recentHistory: ConversationMessage[],
    facts: KnownFacts,
    agentName: string,
  ): Promise<QuickReplyResult> {
    // Step 1: Deterministic classification
    const classification = classifyIntent(lastMessage, {
      hasSegment: !!(facts.segment || facts.businessDescription),
      handoffOffered: facts.handoffOffered,
      handoffCompleted: facts.handoffCompleted,
    });

    // Step 2: Handle high-confidence local intents
    if (classification.confidence === 'high') {
      const local = this.handleLocal(classification.intent, facts, agentName);
      if (local) return local;
    }

    // Step 3: Call LLM with minimal prompt
    return this.callLLM(recentHistory, facts, agentName);
  }

  /**
   * ResponseComposer (LLM path). Refocused per the conversational-agent-quality
   * design: this method is the ONLY LLM entry point of the pipeline and it
   * assumes it is invoked exclusively for `direct_question` (non-price) and
   * `general` intents. All other intents are resolved deterministically by the
   * pipeline's composers (commands, edge inputs, price, preference, handoff,
   * greeting/ack/desistance) and never reach here.
   *
   * The prompt is built from the full `ConversationContext`:
   *   - known facts -> prohibited-questions block (never re-ask known facts), and
   *   - the `SaidRecord` -> explicit "do not re-offer demo/simulation/handoff/
   *     AI-explanation" instructions when the corresponding flags are set.
   * It requests answer-before-follow-up ordering (R1.4) and, for a direct
   * question, instructs the model to address the question's subject first and,
   * when it cannot fully answer, to acknowledge the specific subject and state
   * what is needed (R1.3).
   *
   * On empty/unparseable LLM output this returns a result whose `reply` is the
   * empty string (with `usedFallback: true`), so the pipeline substitutes the
   * contextual fallback from `buildContextualFallback` (R3.4). It never emits
   * the generic "difficulty processing" message itself.
   */
  async composeReply(
    recentHistory: ConversationMessage[],
    context: ConversationContext,
    agentName: string,
    isDirectQuestion: boolean,
    business?: BusinessContext,
  ): Promise<QuickReplyResult> {
    const prompt = this.buildContextualPrompt(
      context.facts,
      agentName,
      context.said,
      isDirectQuestion,
      business,
    );
    return this.runLLM(recentHistory, prompt);
  }

  /**
   * Builds a non-empty, fact-derived contextual fallback used when the LLM
   * returns empty/unparseable output (R3.1, R3.4). It references the available
   * facts when any exist and is NEVER the generic "difficulty processing"
   * message ("Estou com dificuldade..."/"dificuldades técnicas").
   */
  buildContextualFallback(facts: KnownFacts): string {
    // Rede de segurança (só quando o LLM falha). Pergunta pra entender melhor,
    // NUNCA afirma o que o negócio é nem o que a IA faz — evita o "chute de
    // segmento" (ex.: tratar "ferramenta de etiquetas" como fábrica).
    if (facts.segment && facts.mainPain) {
      return `Sobre ${facts.segment}, me conta um pouco mais: onde isso mais aperta no dia a dia de vocês?`;
    }
    if (facts.segment) {
      return `Entendi, ${facts.segment}. Como funciona o atendimento de vocês no WhatsApp hoje — o que mais consome tempo?`;
    }
    if (facts.mainPain) {
      return `Entendi o ponto. Me conta rapidinho o que vocês fazem, pra eu te situar melhor.`;
    }
    if (facts.whatsappUsage) {
      return 'E o que mais aperta hoje: o volume, a demora pra responder ou acompanhar quem já chamou?';
    }
    return 'Me conta rapidinho: o que vocês fazem e como usam o WhatsApp no dia a dia?';
  }

  private handleLocal(
    intent: string,
    facts: KnownFacts,
    agentName: string,
  ): QuickReplyResult | null {
    switch (intent) {
      case 'handoff_completed_ack':
        return this.local(
          'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.',
          'handoff_humano', 'outro', 'completed',
        );

      case 'handoff_accept':
        return this.local(
          'Vou encaminhar para a equipe da Decodifica com um resumo do seu cenário. Assim alguém consegue avaliar o melhor caminho e te retornar com mais precisão.',
          'handoff_humano', 'outro', 'accepted',
        );

      case 'desistance':
        return this.local(
          'Sem problema. Se o WhatsApp estiver gerando perda de venda ou exigindo respostas repetidas, vale uma análise depois. Estou por aqui se precisar.',
          facts.segment ? 'tratamento_objecao' : 'descoberta', 'outro', 'none',
        );

      case 'greeting_no_context':
        // If this is after the initial greeting (messageCount > 1), use shorter version
        if (facts.messageCount > 1) {
          return this.local(
            'Olá. Me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
            'abertura', 'curiosidade', 'none',
          );
        }
        return this.local(
          `Olá. Sou o ${agentName}, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.`,
          'abertura', 'curiosidade', 'none',
        );

      case 'greeting_with_context':
        return this.local(
          'Oi. Pode continuar, estou aqui.',
          facts.mainPain ? 'mapeamento_de_dores' : 'descoberta', 'curiosidade', 'none',
        );

      case 'price_question':
        // If asked price more than once, be direct — no more diagnosis
        if (facts.priceAskedCount > 1) {
          return this.local(
            'Sem uma faixa configurada aqui, não consigo te passar um valor fechado. O que posso fazer é encaminhar para a equipe te dar uma estimativa direta com base no seu caso, sem mais perguntas. Quer que eu encaminhe?',
            'conversao', 'orcamento', 'suggested',
          );
        }
        return this.local(
          'O valor depende do escopo — volume, integrações e fluxos envolvidos. A equipe consegue te passar uma proposta mais precisa com base no que você já me contou. Quer que eu encaminhe?',
          'conversao', 'orcamento', 'suggested',
        );

      case 'frustration':
        return this.local(
          'Entendi. Vou encaminhar seu caso para a equipe te passar uma proposta direta, sem mais perguntas.',
          'handoff_humano', 'outro', 'accepted',
        );

      default:
        return null;
    }
  }

  private local(
    reply: string,
    stage: string,
    intent: string,
    handoff: 'none' | 'suggested' | 'accepted' | 'completed',
  ): QuickReplyResult {
    return {
      reply, stage, intent,
      handoffSignal: handoff,
      needsAsyncAnalysis: handoff === 'accepted',
      usedLocalRule: true, usedFallback: false, llmMs: 0,
    };
  }

  private async callLLM(
    recentHistory: ConversationMessage[],
    facts: KnownFacts,
    agentName: string,
  ): Promise<QuickReplyResult> {
    const prompt = this.buildContextualPrompt(facts, agentName);
    return this.runLLM(recentHistory, prompt);
  }

  /**
   * Shared LLM execution core used by both the legacy `generateQuickReply`
   * path and the refocused `composeReply` ResponseComposer. Calls the provider
   * with the prebuilt prompt and the recent history, parses the minimal JSON,
   * and — on empty/unparseable output or provider error — returns a result
   * whose `reply` is empty so the pipeline substitutes the contextual fallback.
   */
  private async runLLM(
    recentHistory: ConversationMessage[],
    prompt: string,
  ): Promise<QuickReplyResult> {
    // O Qwen ainda devolve JSON vazio/truncado de vez em quando. Uma única
    // retentativa derruba a taxa de fallback de ~20% para a casa de 1 dígito
    // sem custo perceptível — só retenta quando a primeira tentativa falhou.
    const first = await this.attemptLLM(recentHistory, prompt);
    if (first.reply && first.reply.trim() !== '') return first;
    // Pequeno respiro antes de retentar: a falha costuma ser transiente
    // (concorrência com a análise assíncrona, instabilidade do provedor), e o
    // backoff aumenta bastante a chance de a 2ª tentativa dar certo.
    await new Promise((r) => setTimeout(r, 500));
    const second = await this.attemptLLM(recentHistory, prompt);
    return second.reply && second.reply.trim() !== '' ? second : first;
  }

  private async attemptLLM(
    recentHistory: ConversationMessage[],
    prompt: string,
  ): Promise<QuickReplyResult> {
    const startTime = Date.now();

    try {
      const response = await this.llmProvider.complete({
        messages: [
          { role: 'system', content: prompt },
          ...recentHistory.slice(-6).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        temperature: 0.6,
        // Teto alto de tokens: o Qwen às vezes gasta orçamento "raciocinando"
        // antes do JSON e, com teto baixo, devolvia o JSON truncado/vazio
        // (caindo no fallback ~30% das vezes). Isto é só um TETO — as respostas
        // normais param sozinhas em ~200 tokens, então não muda custo/tamanho;
        // só dá folga para os casos que precisam fechar o JSON.
        maxTokens: 800,
        responseFormat: 'json',
      });

      const llmMs = Date.now() - startTime;
      const parsed = this.parseMinimalResponse(response.content);

      // Empty/unparseable output -> return empty reply so the pipeline
      // substitutes the contextual fallback (R3.4). Never emit a generic
      // "difficulty processing" message here.
      if (!parsed.reply || parsed.reply.trim() === '') {
        this.logger.warn('LLM returned empty/unparseable reply, deferring to contextual fallback');
        return {
          reply: '',
          stage: parsed.stage || 'descoberta',
          intent: parsed.intent || 'outro',
          handoffSignal: 'none',
          needsAsyncAnalysis: false,
          usedLocalRule: false,
          usedFallback: true,
          fallbackReason: 'empty_or_unparseable',
          llmMs,
          model: response.model,
        };
      }

      return {
        reply: parsed.reply,
        stage: parsed.stage || 'descoberta',
        intent: parsed.intent || 'vendas',
        handoffSignal: 'none',
        needsAsyncAnalysis: true,
        usedLocalRule: false,
        usedFallback: false,
        llmMs,
        model: response.model,
      };
    } catch (error) {
      const llmMs = Date.now() - startTime;
      this.logger.error(`LLM failed in ${llmMs}ms: ${error instanceof Error ? error.message : 'Unknown'}`);

      return {
        reply: '', // Empty -> pipeline substitutes the contextual fallback
        stage: 'descoberta',
        intent: 'outro',
        handoffSignal: 'none',
        needsAsyncAnalysis: false,
        usedLocalRule: false,
        usedFallback: true,
        fallbackReason: error instanceof Error ? error.message : 'LLM error',
        llmMs,
      };
    }
  }

  private parseMinimalResponse(content: string): LLMQuickResponse {
    let cleaned = content.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();

    // Isola o primeiro objeto JSON caso o modelo emita texto ao redor dele.
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const candidate = objMatch ? objMatch[0] : cleaned;

    try {
      const parsed = JSON.parse(candidate);
      return {
        reply: parsed.reply || '',
        stage: parsed.stage || 'descoberta',
        intent: parsed.intent || 'vendas',
      };
    } catch {
      // Rede de segurança: se o JSON veio truncado DEPOIS do campo reply
      // (ex.: `{"reply":"texto","stage":"desc`), recupera o reply por regex em
      // vez de descartar uma resposta válida e cair no fallback.
      const replyMatch = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (replyMatch && replyMatch[1].trim()) {
        const reply = replyMatch[1]
          .replace(/\\"/g, '"')
          .replace(/\\n/g, ' ')
          .trim();
        const stage = cleaned.match(/"stage"\s*:\s*"([^"]*)"/)?.[1];
        const intent = cleaned.match(/"intent"\s*:\s*"([^"]*)"/)?.[1];
        return {
          reply,
          stage: stage || 'descoberta',
          intent: intent || 'vendas',
        };
      }
      this.logger.warn('Failed to parse LLM JSON response');
      return { reply: '', stage: 'descoberta', intent: 'outro' };
    }
  }

  private buildContextualPrompt(
    facts: KnownFacts,
    agentName: string,
    said?: SaidRecord,
    isDirectQuestion = false,
    business?: BusinessContext,
  ): string {
    const knownLines: string[] = [];
    if (facts.segment) knownLines.push(`Negócio: ${facts.segment}`);
    if (facts.businessDescription) knownLines.push(`Descrição: ${facts.businessDescription}`);
    if (facts.whatsappUsage) knownLines.push(`WhatsApp: ${facts.whatsappUsage}`);
    if (facts.mainPain) knownLines.push(`Dor principal: ${facts.mainPain}`);
    if (facts.knownPains.length > 1) knownLines.push(`Dores mapeadas: ${facts.knownPains.join(', ')}`);
    if (facts.volume) knownLines.push(`Volume: ${facts.volume}`);
    if (facts.systems) knownLines.push(`Sistema: ${facts.systems}`);
    if (facts.decisionRole && facts.decisionRole !== 'desconhecido') knownLines.push(`Papel: ${facts.decisionRole}`);

    const prohibitedQuestions = this.buildProhibitedQuestions(facts);

    const factsBlock = knownLines.length > 0
      ? `FATOS JÁ COLETADOS (NUNCA perguntar de novo):\n${knownLines.join('\n')}\n\nQUESTÕES PROIBIDAS: ${prohibitedQuestions}\n\nSe o fato já está acima, NÃO pergunte sobre ele. Faça uma pergunta DIFERENTE ou ofereça encaminhamento.`
      : 'Nenhum fato coletado ainda.';

    const questionCount = Math.floor(facts.messageCount / 2);

    // Discovery state. A pre-sales agent must UNDERSTAND the pain deeply before
    // ever offering a handoff: segment + main pain + the pain's impact (a
    // secondary pain or explicit impact counts) + volume. Only then is the lead
    // "qualified" enough to suggest routing to the team.
    const hasSegment = !!(facts.segment || facts.businessDescription);
    const hasPain = !!facts.mainPain || facts.knownPains.length > 0;
    const painDeepened = facts.knownPains.length >= 2 || facts.secondaryPainsAsked;
    const hasVolume = !!facts.volume;
    const qualified = hasSegment && hasPain && painDeepened && hasVolume;

    // Funil de descoberta: a cada passo, REAGIR ao que a pessoa disse e fazer
    // no máximo UMA pergunta. Só fala em equipe quando já entendeu onde o
    // atendimento trava — nunca cedo, nunca com resumo formal.
    let nextActionNote = '';
    if (qualified && questionCount >= 4) {
      nextActionNote =
        '\nMOMENTO: já dá pra entender onde o atendimento trava. Faça uma transição leve e natural pra equipe, do jeito que uma pessoa falaria — ex: "Boa, agora deu pra entender melhor onde tá travando. Acho que vale alguém da equipe olhar esse fluxo com você. Quer?". NÃO faça resumo dos dados dele.';
    } else if (!hasSegment) {
      nextActionNote =
        '\nMOMENTO: você ainda não sabe o que a pessoa faz. Descubra o negócio dela de forma leve, numa pergunta curta.';
    } else if (!hasPain) {
      nextActionNote =
        '\nMOMENTO: você sabe o negócio, mas não o que incomoda. Descubra onde o atendimento aperta hoje. Ainda NÃO fale em equipe.';
    } else if (!painDeepened) {
      nextActionNote =
        `\nMOMENTO: a pessoa contou uma dificuldade. Reaja com naturalidade e cave um pouco mais pra entender o que mais trava. Ainda NÃO fale em equipe.\nIdeia de pergunta: ${this.buildSecondaryPainQuestion(facts)}`;
    } else if (!hasVolume) {
      nextActionNote =
        '\nMOMENTO: já entendeu a dor. Pergunte de forma natural o tamanho da coisa (quantos contatos/mensagens por dia). Ainda NÃO fale em equipe.';
    } else {
      nextActionNote =
        '\nMOMENTO: continue entendendo o impacto (com que frequência acontece, o que isso custa no dia a dia). Só fale em equipe quando o quadro estiver claro.';
    }

    // Pergunta direta tem prioridade sobre o funil: responda primeiro, sempre
    // com base no que você SABE do negócio (blocos abaixo), nunca inventando.
    const directQuestionDirective =
      '\nO CLIENTE PERGUNTOU ALGO. Responda curto e direto ANTES de tudo, com base no que está em SOBRE A EMPRESA / BASE DE CONHECIMENTO. Se a resposta não estiver lá, diga com honestidade que a equipe detalha — não invente. Sem discurso de vendas. Só depois, se couber, UMA pergunta curta. Nunca ignore a pergunta pra seguir roteiro.';

    const guidance = isDirectQuestion ? directQuestionDirective : nextActionNote;

    // Bloco "não repetir o que já foi oferecido" (demo/handoff/explicação de IA).
    const doNotReofferNote = this.buildDoNotReofferNote(said);

    return `Você é ${agentName}, o primeiro atendimento da Decodifica no WhatsApp. Você fala como uma pessoa de verdade: experiente, gente boa e direta. Nunca um roteiro de robô.

SEU PAPEL: entender o negócio da pessoa e onde o atendimento dela trava, com naturalidade, e — quando fizer sentido — conectar com alguém da equipe.

REGRA Nº 1 — RESPONDA O QUE ELE DISSE: se o cliente fez uma pergunta ou levantou uma objeção ("vai substituir meus atendentes?", "tem teste grátis?", "tá caro", "e a IA erra?", "já tenho um chatbot"), RESPONDA isso de forma direta e honesta ANTES de fazer qualquer pergunta sua. NUNCA devolva uma pergunta sem antes responder a dele. Você é como um bom atendente no WhatsApp: ouve, responde, e só então continua.

REGRA Nº 2 — ENTENDA, NÃO VENDA: agora seu trabalho é ENTENDER o cenário, não vender. NÃO fique explicando o que a IA faz, NÃO ofereça "quer saber mais?", "diagnóstico" ou "reunião" por conta própria — quem conecta com a equipe é o sistema, na hora certa. Siga o MOMENTO: reaja ao que ele disse e faça UMA pergunta curta pra entender melhor (o negócio, depois a dor, depois o volume).

${this.buildBusinessBlock(business)}

${factsBlock}
${guidance}${doNotReofferNote}

COMO VOCÊ FALA:
- Curto. No máximo 2 frases curtas (~160 caracteres). Como se estivesse digitando no WhatsApp.
- Reaja no tom certo do que a pessoa disse: se ela só falou o que faz, reaja leve e siga ("Boa", "Bacana"); se contou uma DIFICULDADE, mostre que entende o aperto ("Imagino", "Pesado mesmo"). A reação tem que combinar — não diga que "aperta" se ela ainda nem contou um problema.
- VARIE sempre. Nunca comece duas mensagens seguidas do mesmo jeito (olhe o que já disse). Repetir abertura soa robô.
- Uma pergunta por vez. Às vezes nem precisa perguntar — um comentário que mantém o papo já basta.
- Primeiro entenda o problema. Só fale do que a IA resolve DEPOIS de saber onde trava. Não fique vendendo.

ENTENDA ANTES DE AFIRMAR (o mais importante):
- NUNCA deduza o negócio do cliente a partir de uma palavra solta. "Ferramenta de etiquetas" pode ser um SOFTWARE, não uma fábrica. "Estúdio" pode ser foto, tatuagem ou pilates. Se não está claro, PERGUNTE.
- NUNCA descreva o que a IA vai fazer no negócio dele ("a IA puxa material, medida...") sem ter entendido o negócio. Não chute funcionalidade.
- Só conecte o que a IA resolve depois de entender de verdade o que a pessoa faz e onde dói.

O QUE NUNCA FAZER:
- Não repita nem resuma o que o cliente disse ("Pelo que você me explicou...", "Você vende carros, recebe 100 mensagens...", "Diante desse cenário...", "Seu principal problema é...").
- Não abra com agrado de vendedor: "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Legal", "Ok", "Claro".
- Não pergunte o que você já sabe (veja os fatos). Não invente dado que o cliente não falou.
- Preço: use só o que está em PREÇO acima; nunca invente outro valor. Sem preço configurado, diga que depende do escopo e ofereça a equipe.
- Se pedirem algo da lista NUNCA PROMETA (ex.: teste grátis), diga CLARO que não trabalha com isso e ofereça o caminho real — não desvie nem enrole. Integração: a equipe avalia o caminho técnico, sem garantir de cara.
- Não use rótulos internos nem texto com barras (|). Sem emoji, sem exclamação, sem texto longo.
- Não ofereça a equipe cedo. Só quando já entendeu onde trava — de forma natural, sem resumo.

Responda em JSON:
{"reply":"sua mensagem","stage":"abertura|descoberta|mapeamento_de_dores|diagnostico_operacional|explicacao_solucao|conversao|handoff_humano","intent":"vendas|suporte|agendamento|duvidas|orcamento|integracao|curiosidade|outro"}`;
  }

  /**
   * Monta o bloco de NEGÓCIO do prompt a partir da configuração do painel. É o
   * que substitui os textos e valores antes chumbados: o que a empresa faz, o
   * conhecimento, o preço e as não-promessas passam a vir daqui. Sem config,
   * usa um mínimo genérico para o agente não ficar mudo.
   */
  private buildBusinessBlock(business?: BusinessContext): string {
    const parts: string[] = [];

    parts.push(
      business?.whatWeDo
        ? `SOBRE A EMPRESA (use isto, não invente):\n${business.whatWeDo}`
        : 'SOBRE A EMPRESA: a Decodifica desenvolve um agente de IA sob medida pro negócio de cada cliente, que cuida do atendimento repetitivo no WhatsApp e passa pra uma pessoa quando o caso pede.',
    );

    if (business?.knowledge) {
      parts.push(
        `BASE DE CONHECIMENTO (responda com base nisto; se não estiver aqui, diga que a equipe detalha):\n${business.knowledge}`,
      );
    }
    if (business?.pricingText) {
      parts.push(
        `PREÇO (se perguntarem; nunca invente outro valor): ${business.pricingText}`,
      );
    }
    if (business?.doNotPromise && business.doNotPromise.length > 0) {
      parts.push(`NUNCA PROMETA: ${business.doNotPromise.join('; ')}.`);
    }
    if (business?.toneOfVoice) {
      parts.push(`TOM DE VOZ: ${business.toneOfVoice}`);
    }

    return parts.join('\n\n');
  }

  /**
   * Builds the "do not re-offer" instruction block from the SaidRecord so the
   * LLM does not repeat a demo/simulation offer, a handoff offer, or the
   * AI-behavior explanation that was already made (R6.3, R6.4, R2.4).
   */
  private buildDoNotReofferNote(said?: SaidRecord): string {
    if (!said) return '';
    const lines: string[] = [];
    if (said.offeredDemo) {
      lines.push('- NÃO ofereça novamente demonstração ou simulação (já foi oferecida). Só fale nisso se o cliente pedir.');
    }
    if (said.offeredHandoff) {
      lines.push('- NÃO ofereça novamente encaminhamento para a equipe (já foi oferecido), a menos que o cliente peça.');
    }
    if (said.explainedAiBehavior) {
      lines.push('- NÃO repita a explicação de como a IA funciona (já foi explicada).');
    }
    return lines.length > 0 ? `\nNÃO REPETIR (já dito antes):\n${lines.join('\n')}` : '';
  }

  private buildSecondaryPainQuestion(facts: KnownFacts): string {
    const segment = (facts.segment || '').toLowerCase();
    if (segment.includes('restaurante') || segment.includes('lanchonete') || segment.includes('pizzaria')) {
      return '"Além do volume no horário de pico, vocês também têm erro em pedido, demora para confirmar, dúvidas sobre cardápio ou perda de venda por falta de resposta?"';
    }
    if (segment.includes('loja') || segment.includes('moda') || segment.includes('roupa') || segment.includes('íntima') || segment.includes('intima')) {
      return '"Além da demora, vocês também têm dificuldade com tamanho, cor, estoque, entrega, troca ou clientes que somem antes de finalizar?"';
    }
    if (segment.includes('etiqueta') || segment.includes('fábrica') || segment.includes('fabrica')) {
      return '"Além das perguntas repetidas, vocês também sofrem com demora para responder orçamento, falta de padrão entre vendedores ou dificuldade para acompanhar propostas?"';
    }
    if (segment.includes('clínica') || segment.includes('clinica') || segment.includes('odonto') || segment.includes('médic') || segment.includes('medic')) {
      return '"Além da demora para agendar, vocês também têm dúvidas repetidas, remarcações, confirmação de consulta ou pacientes sem resposta fora do horário?"';
    }
    if (segment.includes('contabil') || segment.includes('escritório') || segment.includes('escritorio')) {
      return '"Além das perguntas repetidas, vocês também têm dificuldade com envio de documentos, prazos, organização das solicitações ou acompanhamento dos clientes?"';
    }
    if (segment.includes('academia') || segment.includes('fitness')) {
      return '"Além da demora, vocês também perdem alunos por falta de resposta, têm dúvidas sobre planos/horários ou dificuldade com remarcação?"';
    }
    if (segment.includes('pet') || segment.includes('veterinár') || segment.includes('veterinar')) {
      return '"Além da confirmação de horário, vocês também têm dúvidas sobre preços, vacinas, remarcações ou perda de clientes por demora?"';
    }
    if (segment.includes('imobiliár') || segment.includes('imobiliar') || segment.includes('corretor')) {
      return '"Além do volume de leads, vocês também perdem contatos por demora, têm dificuldade para filtrar perfil ou retrabalho respondendo as mesmas dúvidas?"';
    }
    if (segment.includes('carro') || segment.includes('veícul') || segment.includes('veicul') || segment.includes('automó') || segment.includes('automo') || segment.includes('concession') || segment.includes('oficina') || segment.includes('seminovo')) {
      return '"Além do pós-venda, vocês também têm dúvidas repetidas sobre revisão, agendamento, peças, financiamento ou clientes que somem depois da compra?"';
    }
    // Generic fallback
    return '"Além desse ponto, existe mais alguma dificuldade no WhatsApp hoje, como perguntas repetidas, perda de clientes, falta de organização ou atendimento fora do horário?"';
  }

  private buildProhibitedQuestions(facts: KnownFacts): string {
    const prohibited: string[] = [];
    if (facts.segment) prohibited.push('negócio/segmento (já informou)');
    if (facts.volume || facts.volumeAsked) prohibited.push('volume/mensagens por dia (já perguntou ou já sabe)');
    if (facts.whatsappUsage) prohibited.push('como usa WhatsApp (já informou)');
    if (facts.mainPain || facts.knownPains.length > 0) prohibited.push('principal desafio/dor (já informou)');
    if (facts.systems) prohibited.push('sistema usado (já informou)');
    if (facts.decisionRole) prohibited.push('quem decide (já informou)');
    if (facts.secondaryPainsAsked) prohibited.push('dores secundárias (já perguntou)');
    return prohibited.length > 0 ? prohibited.join(', ') : 'nenhuma restrição';
  }
}
