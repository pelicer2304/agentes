import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { PromptBuilderService } from './prompt-builder.service';
import {
  ResponseParserService,
  ResponseParseError,
} from './response-parser.service';
import { AgentResponse } from './dto/agent-response.dto';
import {
  AgentSettingsInput,
  ConversationMessage,
  KnowledgeBaseItem,
} from './dto/agent-settings.dto';

const FALLBACK_HANDOFF_COMPLETED =
  'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.';

const FALLBACK_FRUSTRATED_LEAD =
  'Sem problema. Para te deixar uma referência: automação costuma fazer sentido quando o WhatsApp consome muito tempo, gera perda de venda ou exige muitas respostas repetidas. Se quiser retomar depois, posso te ajudar a organizar esse cenário.';

const FALLBACK_PRICE_NO_RANGE =
  'Consigo te dar uma referência de formato, mas não um valor fechado sem escopo. Projetos simples geralmente envolvem um fluxo inicial de atendimento; projetos com integrações e regras comerciais exigem proposta personalizada. A equipe consegue te passar uma estimativa rápida com base no seu caso.';

/**
 * Lead facts used to generate contextual fallback when LLM fails.
 */
export interface LeadFacts {
  segment?: string | null;
  mainPain?: string | null;
  whatsappUsage?: string | null;
  estimatedVolume?: string | null;
  previousScore?: number;
  previousStatus?: string;
  previousTemperature?: string | null;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LLMProvider,
    private readonly promptBuilder: PromptBuilderService,
    private readonly responseParser: ResponseParserService,
  ) {}

  /**
   * Processes a message through the LLM and returns a structured AgentResponse.
   * On failure, generates a contextual fallback preserving lead state.
   */
  async processMessage(
    conversationHistory: ConversationMessage[],
    agentSettings: AgentSettingsInput,
    knowledgeBase: KnowledgeBaseItem[],
    context?: { conversationId?: string; leadId?: string; leadFacts?: LeadFacts },
  ): Promise<AgentResponse> {
    const logCtx = context?.conversationId || 'unknown';

    const request = this.promptBuilder.buildPrompt(
      agentSettings,
      knowledgeBase,
      conversationHistory,
    );

    // First attempt
    try {
      const response = await this.llmProvider.complete(request);
      this.logger.debug(`[${logCtx}] LLM OK: ${response.content.length} chars, model=${response.model}`);
      const parsed = this.responseParser.parse(response.content);
      this.logger.debug(`[${logCtx}] Parsed: stage=${parsed.stage}, score=${parsed.leadScore}, handoff=${parsed.shouldHandoff}`);
      return parsed;
    } catch (error) {
      this.logger.error(`[${logCtx}] First attempt failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    // Retry once
    try {
      this.logger.warn(`[${logCtx}] Retrying...`);
      const response = await this.llmProvider.complete(request);
      this.logger.debug(`[${logCtx}] Retry OK: ${response.content.length} chars`);
      const parsed = this.responseParser.parse(response.content);
      return parsed;
    } catch (error) {
      this.logger.error(`[${logCtx}] Retry failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    // Generate contextual fallback preserving lead state
    this.logger.error(`[${logCtx}] Both attempts failed. Generating contextual fallback.`);
    return this.buildContextualFallback(context?.leadFacts);
  }

  /**
   * Builds a contextual fallback that preserves lead state and asks a useful next question.
   * NOT the generic "dificuldades técnicas" message.
   */
  private buildContextualFallback(leadFacts?: LeadFacts): AgentResponse {
    let reply: string;
    let nextQuestion: string | null = null;

    if (leadFacts?.mainPain && leadFacts?.segment) {
      reply = `Pelo que você descreveu sobre ${leadFacts.segment}, a automação pode ajudar com ${leadFacts.mainPain}.`;
      nextQuestion = 'Hoje o maior gargalo está no volume, na demora ou na organização?';
    } else if (leadFacts?.segment) {
      reply = `Para o segmento de ${leadFacts.segment}, existem algumas possibilidades de automação.`;
      nextQuestion = 'Qual é o principal desafio que vocês enfrentam no atendimento pelo WhatsApp?';
    } else if (leadFacts?.whatsappUsage) {
      reply = 'Com base no que você descreveu sobre o uso do WhatsApp, podemos avaliar o que faz sentido automatizar.';
      nextQuestion = 'Vocês recebem mais dúvidas, pedidos, orçamentos ou suporte?';
    } else {
      reply = 'Para entender melhor como posso ajudar, preciso de mais contexto sobre sua operação.';
      nextQuestion = 'Qual é o seu negócio e como o WhatsApp participa do atendimento?';
    }

    if (nextQuestion) {
      reply += ` ${nextQuestion}`;
    }

    return {
      reply,
      stage: 'descoberta',
      detectedSegment: leadFacts?.segment || null,
      businessDescription: null,
      detectedIntent: 'outro',
      whatsappUsage: leadFacts?.whatsappUsage || null,
      mainPain: leadFacts?.mainPain || null,
      secondaryPains: [],
      desiredOutcome: null,
      estimatedVolume: (leadFacts?.estimatedVolume as any) || 'desconhecido',
      urgency: 'desconhecida',
      decisionRole: 'desconhecido',
      budgetSignal: 'desconhecido',
      objections: [],
      recommendedService: null,
      leadScore: leadFacts?.previousScore ?? 0,
      scoreReasons: [],
      temperature: (leadFacts?.previousTemperature as any) || 'frio',
      status: (leadFacts?.previousStatus as any) || 'qualificando',
      shouldHandoff: false,
      handoffReason: null,
      commercialSummary: null,
      nextBestQuestion: nextQuestion,
    };
  }

  /**
   * Builds a typed fallback response for specific scenarios.
   */
  buildFallbackResponse(
    type: 'technical' | 'frustrated' | 'price' | 'handoff_completed',
  ): AgentResponse {
    let reply: string;
    switch (type) {
      case 'frustrated':
        reply = FALLBACK_FRUSTRATED_LEAD;
        break;
      case 'price':
        reply = FALLBACK_PRICE_NO_RANGE;
        break;
      case 'handoff_completed':
        reply = FALLBACK_HANDOFF_COMPLETED;
        break;
      case 'technical':
      default:
        reply = 'Para entender melhor como posso ajudar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.';
        break;
    }

    return {
      reply,
      stage: 'abertura',
      detectedSegment: null,
      businessDescription: null,
      detectedIntent: 'outro',
      whatsappUsage: null,
      mainPain: null,
      secondaryPains: [],
      desiredOutcome: null,
      estimatedVolume: 'desconhecido',
      urgency: 'desconhecida',
      decisionRole: 'desconhecido',
      budgetSignal: 'desconhecido',
      objections: [],
      recommendedService: null,
      leadScore: 0,
      scoreReasons: [],
      temperature: 'frio',
      status: 'novo',
      shouldHandoff: false,
      handoffReason: null,
      commercialSummary: null,
      nextBestQuestion: null,
    };
  }
}
