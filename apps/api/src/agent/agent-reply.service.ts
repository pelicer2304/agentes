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
  ): Promise<QuickReplyResult> {
    const prompt = this.buildContextualPrompt(
      context.facts,
      agentName,
      context.said,
      isDirectQuestion,
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
    if (facts.segment && facts.mainPain) {
      return `Pelo que você descreveu sobre ${facts.segment}, faz sentido avaliar como automatizar essa parte. Posso encaminhar para a equipe da Decodifica te passar um caminho mais preciso. Quer que eu encaminhe?`;
    }
    if (facts.segment && facts.volume) {
      return `Com esse volume, existem várias formas de automatizar o atendimento. Posso encaminhar para a equipe avaliar o melhor caminho para ${facts.segment}. Interessa?`;
    }
    if (facts.segment) {
      return `Para ${facts.segment}, existem várias possibilidades de automação. Como é o volume de mensagens no WhatsApp hoje?`;
    }
    if (facts.mainPain) {
      return `Sobre o ponto que você levantou, dá para estruturar o atendimento no WhatsApp para resolver isso. Me conta qual é o seu negócio para eu te direcionar melhor.`;
    }
    if (facts.whatsappUsage) {
      return 'Com base em como vocês usam o WhatsApp, dá para avaliar o que faz sentido automatizar. Vocês recebem mais dúvidas, pedidos, orçamentos ou suporte?';
    }
    return 'Para eu te ajudar melhor, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.';
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
    const startTime = Date.now();

    try {
      const response = await this.llmProvider.complete({
        messages: [
          { role: 'system', content: prompt },
          ...recentHistory.slice(-6).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        ],
        temperature: 0.3,
        maxTokens: 200,
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

    try {
      const parsed = JSON.parse(cleaned);
      return {
        reply: parsed.reply || '',
        stage: parsed.stage || 'descoberta',
        intent: parsed.intent || 'vendas',
      };
    } catch {
      // If JSON parse fails, return empty reply (will trigger fallback)
      this.logger.warn('Failed to parse LLM JSON response');
      return { reply: '', stage: 'descoberta', intent: 'outro' };
    }
  }

  private buildContextualPrompt(
    facts: KnownFacts,
    agentName: string,
    said?: SaidRecord,
    isDirectQuestion = false,
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

    // Determine what the agent should do next — dig deeper before offering.
    let nextActionNote = '';
    if (qualified && questionCount >= 4) {
      nextActionNote =
        '\nPRÓXIMO PASSO: Você já entende o cenário (negócio, dor, impacto e volume). Resuma o cenário do cliente em 1 frase e ENTÃO ofereça encaminhar para a equipe. NUNCA ofereça "Posso encaminhar?" isolado.';
    } else if (!hasSegment) {
      nextActionNote = '\nPRÓXIMO PASSO: Descubra o segmento/negócio do cliente.';
    } else if (!hasPain) {
      nextActionNote =
        '\nPRÓXIMO PASSO: Descubra a PRINCIPAL dor/dificuldade do cliente no atendimento. Ainda NÃO ofereça encaminhamento.';
    } else if (!painDeepened) {
      nextActionNote =
        `\nPRÓXIMO PASSO: APROFUNDE a dor. Pergunte sobre o IMPACTO real dela no negócio (perda de venda, tempo perdido, clientes sem resposta, retrabalho) OU sobre uma dor secundária. NÃO ofereça encaminhamento ainda.\nSugestão contextual: ${this.buildSecondaryPainQuestion(facts)}`;
    } else if (!hasVolume) {
      nextActionNote =
        '\nPRÓXIMO PASSO: Já tem a dor e o impacto. Pergunte o volume (mensagens/pedidos por dia) para dimensionar. NÃO ofereça encaminhamento ainda.';
    } else {
      nextActionNote =
        '\nPRÓXIMO PASSO: Continue entendendo o impacto da dor (frequência, consequência, o que já tentaram). Só ofereça encaminhamento quando o cenário estiver claro. NÃO ofereça agora.';
    }

    // Answer-before-follow-up ordering (R1.4) and, for direct questions,
    // subject-first handling (R1.3). When the client asks a direct question,
    // answering it takes PRIORITY over the discovery funnel.
    const directQuestionDirective = isDirectQuestion
      ? '\nA MENSAGEM DO CLIENTE É UMA PERGUNTA. RESPONDA a pergunta dele de forma clara, concreta e direta ANTES de tudo. Se ele perguntar como funciona, explique de verdade (a IA atende no WhatsApp seguindo as regras do seu negócio, responde as dúvidas comuns na hora e, quando o caso é mais específico, passa para uma pessoa). Só DEPOIS de responder, se fizer sentido, faça no máximo UMA pergunta curta. NUNCA ignore a pergunta do cliente para seguir seu roteiro.'
      : '';

    // The discovery funnel only drives the conversation when the client is NOT
    // asking something — a direct question must be answered first.
    const guidance = isDirectQuestion ? directQuestionDirective : nextActionNote;

    // Do-not-re-offer block derived from the SaidRecord (R6.3 / R6.4 / R2.4).
    const doNotReofferNote = this.buildDoNotReofferNote(said);

    let orderingNote =
      '\nORDEM DA RESPOSTA: Primeiro responda/atenda à mensagem do cliente; só depois, se necessário, faça UMA pergunta de continuidade. A resposta SEMPRE vem antes da pergunta.';

    return `Você é ${agentName}, pré-vendedor da Decodifica. Solução = atendimento humanizado com IA para WhatsApp.

${factsBlock}
${guidance}${doNotReofferNote}${orderingNote}

REGRAS ABSOLUTAS:
- Max 250 chars na resposta
- 1 pergunta por resposta (ou nenhuma se já coletou dados suficientes)
- Sem emoji
- NÃO comece com "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Legal", "Ok", "Compreendo", "Claro"
- NÃO repita nem parafraseie o que o cliente acabou de dizer. NUNCA comece resumindo as palavras dele (ex: "Com vendas de etiquetas e problemas no atendimento, ...", "Sobre o seu negócio de ...", "Então você ..."). Vá DIRETO: responda ou faça a próxima pergunta, sem eco.
- NÃO pergunte o que já sabe (LEIA os fatos acima)
- Se volume JÁ FOI INFORMADO ou JÁ FOI PERGUNTADO, NÃO pergunte quantas mensagens/pedidos recebe
- Se dor JÁ FOI INFORMADA, NÃO pergunte "qual é o principal desafio"
- NUNCA mencione preço, valor, custo, faixa de preço ou qualquer número monetário
- NUNCA prometa teste gratuito, ativação imediata, integração garantida ou prazo
- NUNCA diga "sem erros", "zero erros", "revisa cada mensagem", "evita erro" ou promessas absolutas sobre IA
- Se cliente perguntar sobre IA errar: responda UMA VEZ "A IA responde com base em regras e limites definidos. Quando foge do esperado, encaminha para humano." Não repetir essa explicação.
- Se cliente perguntar integração: diga que a equipe precisa avaliar o caminho técnico
- NÃO ofereça encaminhamento se ainda não coletou dor principal + volume. Colete primeiro.
- NUNCA responda apenas "Posso encaminhar?" isolado. Sempre contextualize: resuma o cenário do cliente antes de perguntar se quer encaminhamento.
- Exemplo BOM: "Com esse volume e a equipe sobrecarregada, faz sentido a equipe avaliar. Quer que eu encaminhe?"
- Exemplo RUIM: "Posso encaminhar?"

JSON:
{"reply":"texto","stage":"abertura|descoberta|mapeamento_de_dores|diagnostico_operacional|explicacao_solucao|conversao|handoff_humano","intent":"vendas|suporte|agendamento|duvidas|orcamento|integracao|curiosidade|outro"}`;
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
