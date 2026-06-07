import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { ConversationMessage } from './dto/agent-settings.dto';
import { classifyIntent } from './intent-classifier';
import { KnownFacts } from './fact-extractor.service';

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
    const prompt = this.buildMinimalPrompt(facts, agentName);
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
        reply: '', // Will be caught by empty validation in ConversationService
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

  private buildMinimalPrompt(facts: KnownFacts, agentName: string): string {
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

    // Determine what the agent should do next
    let nextActionNote = '';
    if (questionCount >= 5) {
      nextActionNote = '\nATENÇÃO: Já fez 5+ perguntas. NÃO faça mais perguntas. Ofereça encaminhar para a equipe contextualizando o motivo.';
    } else if (facts.mainPain && !facts.secondaryPainsAsked && facts.knownPains.length < 2) {
      nextActionNote = `\nPRÓXIMO PASSO: Pergunte sobre dores secundárias UMA VEZ, contextualizada ao nicho:\n${this.buildSecondaryPainQuestion(facts)}`;
    } else if (facts.mainPain && facts.volume && facts.knownPains.length >= 1 && questionCount >= 3) {
      nextActionNote = '\nPRÓXIMO PASSO: Já tem dor + volume. Ofereça encaminhamento CONTEXTUALIZADO: resuma o cenário do cliente e pergunte se quer que encaminhe. NUNCA responda apenas "Posso encaminhar?" isolado.';
    }

    return `Você é ${agentName}, pré-vendedor da Decodifica. Solução = atendimento humanizado com IA para WhatsApp.

${factsBlock}
${nextActionNote}

REGRAS ABSOLUTAS:
- Max 250 chars na resposta
- 1 pergunta por resposta (ou nenhuma se já coletou dados suficientes)
- Sem emoji
- NÃO comece com "Entendo", "Perfeito", "Ótimo", "Show", "Certo", "Legal", "Ok", "Compreendo", "Claro"
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
