import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentReplyService } from '../agent/agent-reply.service';
import { AgentAnalysisService } from '../agent/agent-analysis.service';
import { FactExtractorService, KnownFacts } from '../agent/fact-extractor.service';
import { ResponseGuardService, GuardInput } from '../agent/response-guard.service';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { calculateScore } from '../agent/score-calculator';
import {
  AgentSettingsInput,
  ConversationMessage,
} from '../agent/dto/agent-settings.dto';

const DEFAULT_INITIAL_MESSAGE =
  'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.';

const DEFAULT_AGENT_NAME = 'DecodificaIA';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentReply: AgentReplyService,
    private readonly agentAnalysis: AgentAnalysisService,
    private readonly factExtractor: FactExtractorService,
    private readonly responseGuard: ResponseGuardService,
    private readonly pricingConfig: PricingConfigService,
  ) {}

  /**
   * Creates a new conversation with a new Lead and initial greeting message.
   * If there's an existing active conversation, it will be closed first.
   */
  async createConversation() {
    // Close any existing active playground conversations
    await this.prisma.conversation.updateMany({
      where: { channel: 'playground', status: 'active' },
      data: { status: 'inactive', stage: 'handoff_humano' },
    });

    // Load agent settings from DB (or use defaults)
    const settings = await this.getAgentSettings();

    // Create Lead + Conversation + initial greeting in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          name: 'Playground Lead',
          phone: 'playground',
          status: 'novo',
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          leadId: lead.id,
          channel: 'playground',
          stage: 'abertura',
          status: 'active',
          handoffRequired: false,
        },
      });

      const greetingMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          direction: 'outbound',
          content: settings.initialMessage,
        },
      });

      return {
        conversation: {
          ...conversation,
          lead,
          messages: [greetingMessage],
        },
      };
    });

    return result.conversation;
  }

  /**
   * Handles an inbound user message with LINEAR flow:
   * facts → score → intent → reply → validate → save
   */
  async handleInboundMessage(conversationId: string, content: string) {
    // 1. Validate
    if (!content || content.length < 1 || content.length > 4000) {
      throw new BadRequestException(
        'Message content must be between 1 and 4000 characters',
      );
    }

    // 2. Verify conversation exists
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    // 3. Save user message
    const userMessage = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        direction: 'inbound',
        content,
      },
    });

    // 4. Load history
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    const history: ConversationMessage[] = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    const totalStart = Date.now();

    // 5. Extract facts (FactExtractorService - synchronous, no LLM)
    const leadData = conversation.lead || {} as any;
    const facts = this.factExtractor.extract(
      {
        ...leadData,
        secondaryPains: Array.isArray(leadData.secondaryPains) ? leadData.secondaryPains as string[] : null,
      },
      { stage: conversation.stage, handoffRequired: conversation.handoffRequired },
      history,
    );

    // 6. Calculate score deterministically (ScoreCalculator - pure function)
    const scoreResult = calculateScore(facts);

    // 7. Get agent settings for name
    const settings = await this.getAgentSettings();

    // 8. Generate reply (IntentClassifier + LLM if needed)
    const quickResult = await this.agentReply.generateQuickReply(
      content,
      history,
      facts,
      settings.agentName,
    );

    // 9. CRITICAL: Validate reply is not empty
    let finalReply = quickResult.reply;
    if (!finalReply || finalReply.trim() === '' || finalReply === 'Sem resposta') {
      finalReply = this.generateFallback(facts);
      this.logger.warn(`[${conversationId}] Empty reply detected, using fallback`);
    }

    // 9b. CRITICAL: Detect handoff in LLM reply text
    // But ONLY for AFFIRMATIVE statements, NOT questions like "Posso encaminhar?"
    let handoffSignal = quickResult.handoffSignal;
    const replyLower = finalReply.toLowerCase();
    const userMsgLower = content.toLowerCase().trim();

    // STRONG accept phrases — trigger with segment OR handoffOffered
    const strongAcceptPhrases = [
      'sim, pode encaminhar', 'pode encaminhar', 'pode encaminhar sim',
      'quero proposta', 'quero uma proposta',
      'tá bom, manda', 'ta bom, manda', 'pode mandar',
    ];
    // WEAK accept phrases — only trigger if handoff was explicitly offered
    const weakAcceptPhrases = [
      'sim, quero', 'sim, pode', 'quero sim', 'pode seguir',
    ];

    // These are QUESTIONS (invitations) — do NOT trigger handoff
    const handoffQuestionPhrases = [
      'posso encaminhar', 'quer que eu encaminhe', 'quer que encaminhe',
      'deseja o contato', 'deseja o encaminhamento', 'quer seguir',
      'quer que eu faça isso', 'quer que eu prossiga',
    ];
    const isHandoffQuestion = handoffQuestionPhrases.some((p) => replyLower.includes(p));

    // These are AFFIRMATIVE handoff confirmations
    const handoffAffirmPhrases = [
      'vou encaminhar', 'encaminhando para a equipe',
      'vou conectar você', 'vou conectar voce',
      'equipe entrará em contato', 'equipe vai entrar em contato',
      'entrarão em contato', 'entrarao em contato',
      'encaminhar seu caso', 'encaminhar seu contato',
      'conectar com nossa equipe', 'conectar você com nossa equipe',
      'estou encaminhando', 'já encaminhei', 'encaminhando você',
      'eles entrarão em contato', 'entrarão em contato',
      'em breve entram em contato', 'em breve eles',
    ];

    if (handoffSignal === 'none' && !isHandoffQuestion && handoffAffirmPhrases.some((p) => replyLower.includes(p))) {
      // Only treat LLM affirm as handoff if user message ALSO contained an acceptance
      // Otherwise the LLM is just being proactive — mark as offered, not accepted
      const userAlsoAccepted = [...strongAcceptPhrases, ...weakAcceptPhrases].some(
        (p) => userMsgLower === p || userMsgLower.includes(p),
      ) || (userMsgLower === 'manda' && facts.handoffOffered);

      if (userAlsoAccepted) {
        handoffSignal = 'accepted';
        this.logger.debug(`[${conversationId}] Handoff detected: LLM affirm + user accept`);
      } else {
        // LLM offered handoff proactively — do NOT lock to chamar_humano
        handoffSignal = 'suggested';
        this.logger.debug(`[${conversationId}] LLM affirm without user accept — marking as suggested only`);
      }
    }

    // 9b2. Detect handoff from user accept phrase (only if context exists)
    if (handoffSignal === 'none' && strongAcceptPhrases.some((p) => userMsgLower === p || userMsgLower.includes(p))) {
      if (facts.segment || facts.handoffOffered) {
        handoffSignal = 'accepted';
        this.logger.debug(`[${conversationId}] Handoff detected from user strong accept phrase`);
      }
    }
    if (handoffSignal === 'none' && weakAcceptPhrases.some((p) => userMsgLower === p || userMsgLower.includes(p))) {
      if (facts.handoffOffered) {
        handoffSignal = 'accepted';
        this.logger.debug(`[${conversationId}] Handoff detected from user weak accept phrase (handoff was offered)`);
      }
    }
    if (handoffSignal === 'none' && userMsgLower === 'manda' && facts.handoffOffered) {
      handoffSignal = 'accepted';
    }

    // 9c. Detect desistance
    const desistancePhrases = ['deixa pra lá', 'esquece', 'vou procurar outro', 'não quero mais', 'não preciso'];
    const isDesistance = desistancePhrases.some((p) => content.toLowerCase().includes(p));

    // 9d. CRITICAL: Apply ResponseGuard (replaces sanitizeReply + corrupted text check)
    const pricing = await this.pricingConfig.get();
    const guardInput: GuardInput = {
      reply: finalReply,
      userMessage: content,
      segment: facts.segment,
      mainPain: facts.mainPain,
      volume: facts.volume,
      handoffOffered: facts.handoffOffered,
      handoffAccepted: facts.handoffAccepted,
      handoffCompleted: facts.handoffCompleted,
      priceAskedCount: facts.priceAskedCount,
      pricingRangeEnabled: pricing.pricingRangeEnabled,
      startingPrice: pricing.pricingStartingAtText,
      conversationHistory: history
        .filter((msg): msg is ConversationMessage & { role: 'user' | 'assistant' } =>
          msg.role === 'user' || msg.role === 'assistant',
        ),
    };
    const guardOutput = this.responseGuard.guard(guardInput);
    finalReply = guardOutput.reply;

    if (guardOutput.changed) {
      this.logger.debug(`[${conversationId}] Guard applied: ${guardOutput.guardReason}`);
    }

    // If guard reason includes handoff_offered_not_accepted, do NOT treat as accepted
    if (guardOutput.guardReason?.includes('handoff_offered_not_accepted') && handoffSignal === 'accepted') {
      handoffSignal = 'suggested';
      this.logger.debug(`[${conversationId}] Guard downgraded handoff from accepted to suggested (offer only)`);
    }

    // 9e. If guard resulted in empty reply, use fallback
    if (!finalReply || finalReply.trim() === '') {
      finalReply = this.generateFallback(facts);
      this.logger.warn(`[${conversationId}] Reply empty after guard, using fallback`);
    }

    const totalMs = Date.now() - totalStart;
    this.logger.log(
      `[${conversationId}] Reply in ${totalMs}ms | local=${quickResult.usedLocalRule} | fallback=${quickResult.usedFallback} | score=${scoreResult.score} | temp=${scoreResult.temperature} | llm=${quickResult.llmMs}ms | model=${quickResult.model || 'local'}`,
    );

    // 10. Save assistant message
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        direction: 'outbound',
        content: finalReply,
      },
    });

    // 11. Determine final state (DETERMINISTIC)
    const isHandoff = handoffSignal === 'accepted' || handoffSignal === 'completed';
    const previousStatus = conversation.lead?.status || 'novo';
    const previousScore = conversation.lead?.leadScore || 0;
    const previousHandoff = conversation.handoffRequired || previousStatus === 'chamar_humano';

    let finalScore: number;
    let finalTemperature: string;
    let finalStatus: string;
    let finalHandoff: boolean;

    if (isDesistance) {
      // Desistance is the ONLY case where handoff can go back to false
      finalStatus = 'perdido';
      finalTemperature = 'frio';
      finalScore = Math.min(scoreResult.score, 100);
      finalHandoff = false;
    } else if (isHandoff || previousHandoff) {
      // MONOTONICITY RULE: Once handoff=true, it stays true forever (unless desistance)
      finalStatus = 'chamar_humano';
      finalTemperature = 'quente';
      finalScore = Math.min(Math.max(scoreResult.score, previousScore, 80), 100);
      finalHandoff = true;
    } else {
      finalStatus = 'qualificando';
      const computedScore = Math.min(Math.max(scoreResult.score, previousScore), 100);
      finalScore = computedScore;
      finalTemperature = finalScore >= 70 ? 'quente' : finalScore >= 40 ? 'morno' : 'frio';
      finalHandoff = false;
    }

    // 12. Update lead with score + facts
    try {
      const leadUpdate: Record<string, unknown> = {
        leadScore: finalScore,
        temperature: finalTemperature,
        status: finalStatus,
      };
      if (facts.segment && !leadData.segment) leadUpdate.segment = facts.segment;
      if (facts.mainPain && !leadData.mainPain) leadUpdate.mainPain = facts.mainPain;
      if (facts.whatsappUsage && !leadData.whatsappUsage) leadUpdate.whatsappUsage = facts.whatsappUsage;
      if (facts.volume && !leadData.estimatedVolume) leadUpdate.estimatedVolume = facts.volume;
      if (facts.decisionRole && !leadData.decisionRole) leadUpdate.decisionRole = facts.decisionRole;

      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: leadUpdate,
      });
    } catch (err) {
      this.logger.error(`[${conversationId}] Failed to update lead: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 13. If handoff → update conversation status
    if (finalHandoff) {
      try {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { stage: 'handoff_humano', handoffRequired: true, status: 'active' },
        });
      } catch (err) {
        this.logger.error(`[${conversationId}] Failed to update conversation handoff: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // 14. Fire async analysis (don't await — runs in background)
    if (!quickResult.usedLocalRule) {
      this.agentAnalysis.runAsync(
        conversationId,
        conversation.leadId,
        history,
        quickResult.stage,
      ).catch((err) => {
        this.logger.error(`[${conversationId}] Async analysis error: ${err.message}`);
      });
    }

    // 15. Return response
    const qualification = {
      stage: quickResult.stage as any,
      detectedSegment: facts.segment,
      detectedIntent: quickResult.intent as any,
      mainPain: facts.mainPain,
      recommendedService: conversation.lead?.recommendedService ?? null,
      leadScore: finalScore,
      temperature: finalTemperature as any,
      status: finalStatus as any,
      shouldHandoff: finalHandoff,
      handoffReason: finalHandoff ? 'Cliente aceitou encaminhamento' : null,
      commercialSummary: null,
      nextBestQuestion: null,
      scoreReasons: scoreResult.reasons,
      objections: [] as string[],
      urgency: 'desconhecida' as const,
      estimatedVolume: 'desconhecido' as const,
      decisionRole: 'desconhecido' as const,
      budgetSignal: 'desconhecido' as const,
    };

    return { message: assistantMessage, qualification };
  }

  /**
   * Generates a contextual fallback when reply is empty.
   * NEVER returns empty string.
   */
  private generateFallback(facts: KnownFacts): string {
    if (facts.segment && facts.mainPain) {
      return `Pelo que você descreveu sobre ${facts.segment}, faz sentido avaliar como automatizar essa parte. Posso encaminhar para a equipe da Decodifica te passar um caminho mais preciso. Quer que eu encaminhe?`;
    }
    if (facts.segment && facts.volume) {
      return `Com esse volume, existem várias formas de automatizar o atendimento. Posso encaminhar para a equipe avaliar o melhor caminho para ${facts.segment}. Interessa?`;
    }
    if (facts.segment) {
      return `Para ${facts.segment}, existem várias possibilidades de automação. Como é o volume de mensagens no WhatsApp hoje?`;
    }
    return 'Para eu te ajudar melhor, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.';
  }

  /**
   * Gets a conversation by ID with messages and latest analysis.
   */
  async getConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        lead: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
        agentAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    return {
      ...conversation,
      latestAnalysis: conversation.agentAnalyses[0] || null,
    };
  }

  /**
   * Resets the current conversation and creates a new one.
   */
  async resetConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    // Mark current conversation as inactive with handoff_humano stage
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { stage: 'handoff_humano', status: 'inactive' },
    });

    // Create a new conversation
    return this.createConversation();
  }

  /**
   * Clears a conversation's messages and resets it to initial state (same lead).
   */
  async clearConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    const settings = await this.getAgentSettings();

    // Delete all messages and analyses for this conversation
    await this.prisma.$transaction(async (tx) => {
      await tx.agentAnalysis.deleteMany({ where: { conversationId } });
      await tx.message.deleteMany({ where: { conversationId } });

      // Reset conversation state
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          stage: 'abertura',
          status: 'active',
          lastIntent: null,
          handoffRequired: false,
          handoffReason: null,
        },
      });

      // Reset lead qualification data
      await tx.lead.update({
        where: { id: conversation.leadId },
        data: {
          status: 'novo',
          leadScore: null,
          temperature: null,
          segment: null,
          mainPain: null,
          recommendedService: null,
          objections: Prisma.JsonNull,
          summary: null,
          nextStep: null,
          businessDescription: null,
          whatsappUsage: null,
          desiredOutcome: null,
          estimatedVolume: null,
          urgency: null,
          decisionRole: null,
          budgetSignal: null,
          secondaryPains: Prisma.JsonNull,
        },
      });

      // Create new greeting message
      await tx.message.create({
        data: {
          conversationId,
          role: 'assistant',
          direction: 'outbound',
          content: settings.initialMessage,
        },
      });
    });

    // Return the refreshed conversation
    return this.getConversation(conversationId);
  }

  /**
   * Clears all active playground conversations and starts a fresh one.
   */
  async clearAllAndRestart() {
    // Close all active playground conversations
    await this.prisma.conversation.updateMany({
      where: { channel: 'playground', status: 'active' },
      data: { status: 'inactive', stage: 'handoff_humano' },
    });

    // Create a fresh conversation
    return this.createConversation();
  }

  /**
   * Loads agent settings from DB or returns defaults.
   */
  private async getAgentSettings(): Promise<AgentSettingsInput> {
    const settings = await this.prisma.agentSettings.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    if (settings) {
      return {
        agentName: settings.agentName,
        initialMessage: settings.initialMessage,
        toneOfVoice: settings.toneOfVoice,
        services: settings.services as string[] | null,
        doNotPromise: settings.doNotPromise as string[] | null,
        handoffCriteria: settings.handoffCriteria as string[] | null,
      };
    }

    return {
      agentName: DEFAULT_AGENT_NAME,
      initialMessage: DEFAULT_INITIAL_MESSAGE,
      toneOfVoice: null,
      services: null,
      doNotPromise: null,
      handoffCriteria: null,
    };
  }
}
