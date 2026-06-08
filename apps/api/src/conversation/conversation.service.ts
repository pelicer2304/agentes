import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentReplyService, BusinessContext } from '../agent/agent-reply.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { AgentAnalysisService } from '../agent/agent-analysis.service';
import { ContextTrackerService } from '../agent/context-tracker';
import { HandoffManagerService } from '../agent/handoff-manager';
import { ResponseGuardService, GuardInput } from '../agent/response-guard.service';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { resolveCommand, availableCommandsReply } from '../agent/command-handler';
import { classifyEdgeInput, edgeReply } from '../agent/edge-input';
import { resolveIntent } from '../agent/intent-resolver';
import { detectPreference } from '../agent/preference-detector';
import { composePriceAnswer } from '../agent/price-answer';
import {
  calculateScore,
  clampNonDecreasing,
  clampScore,
  temperatureFor,
} from '../agent/score-calculator';
import {
  ConversationContext,
  IntentCategory,
} from '../agent/conversation-types';
import {
  AgentSettingsInput,
  ConversationMessage,
} from '../agent/dto/agent-settings.dto';

const DEFAULT_INITIAL_MESSAGE =
  'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.';

const DEFAULT_AGENT_NAME = 'DecodificaIA';

// ─── Deterministic canned replies (bypass the LLM) ──────────────────────────
// Sourced from the legacy local-rule strings so observable behavior for these
// intents is preserved while the routing moves into the linear pipeline.

const REPLY_PREFERENCE_CONTINUE =
  'Fechado, seguimos por aqui. O que você quer resolver primeiro?';

const REPLY_HANDOFF_ACCEPT =
  'Boa, vou te encaminhar pro time da Decodifica seguir daqui com você. Em breve te chamam por aqui.';

const REPLY_HANDOFF_COMPLETED_ACK =
  'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.';

const REPLY_DESISTANCE =
  'Tranquilo, sem pressa. Se mais pra frente o WhatsApp começar a apertar, é só me chamar.';

const REPLY_FRUSTRATION =
  'Entendi. Vou te encaminhar direto pro time resolver isso com você, sem mais pergunta.';

const REPLY_ACKNOWLEDGMENT = 'Tô por aqui se precisar.';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  /**
   * Conversas com uma análise assíncrona já em andamento. A análise é pesada
   * (LLM de ~900 tokens, 15-25s) e, se disparada a cada turno, várias rodam em
   * paralelo e disputam o provedor com a RESPOSTA ao cliente — travando o turno
   * (latências de 20s+) e forçando fallback. Garantimos no máximo uma análise
   * por conversa de cada vez: enquanto uma roda, os turnos seguintes não
   * disparam outra.
   */
  private readonly analysisInFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentReply: AgentReplyService,
    private readonly agentAnalysis: AgentAnalysisService,
    private readonly contextTracker: ContextTrackerService,
    private readonly handoffManager: HandoffManagerService,
    private readonly responseGuard: ResponseGuardService,
    private readonly pricingConfig: PricingConfigService,
    private readonly knowledge: KnowledgeService,
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
   * Handles an inbound user message through the LINEAR, deterministic pipeline:
   *
   *   over-length rejection → command resolution → edge handling →
   *   context extraction → intent resolution → deterministic answers
   *   (price, preference, handoff accept/complete, greeting, ack, desistance) →
   *   LLM composition → contextual fallback → response guard →
   *   handoff state + score resolution → persist message/lead/conversation →
   *   fire async analysis → return { message, qualification }
   *
   * Commands, edge inputs, and over-length messages never reach the LLM and
   * never mutate facts/lead beyond storing the raw inbound message.
   */
  async handleInboundMessage(conversationId: string, content: string) {
    const rawContent = content ?? '';

    // 0. Verify conversation exists (needed for every downstream stage).
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    // 1. Persist the raw inbound message. This is the ONLY persistence allowed
    //    before an over-length/edge/command short-circuit (R5.2).
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        direction: 'inbound',
        content: rawContent,
      },
    });

    const settings = await this.getAgentSettings();
    const agentName = settings.agentName;

    // 2. Over-length rejection (R5.3): reply stating the limit, do not throw,
    //    do not reach the LLM, do not mutate facts/lead.
    const edgeKind = classifyEdgeInput(rawContent);
    if (edgeKind === 'over_length') {
      return this.finishCannedTurn(conversationId, edgeReply('over_length'), conversation);
    }

    // 3. Command resolution (R4): any message starting with '/' is handled here
    //    and never reaches the LLM. Defined commands run their side effect and
    //    confirm; undefined slash tokens list the available commands.
    const command = resolveCommand(rawContent);
    if (command.isCommand) {
      // `/clear` and `/reset` wipe everything (messages, analyses, and the
      // lead's qualification) and bring the conversation back to its initial
      // state. We return the fresh greeting as the turn — exactly like a
      // brand-new conversation — without appending a separate confirmation
      // message, so the history contains only the greeting.
      if (command.action === 'clear') {
        const cleared = await this.clearConversation(conversationId);
        return this.buildClearedTurn(cleared);
      }
      if (command.action === 'reset') {
        const fresh = await this.resetConversation(conversationId);
        return this.buildClearedTurn(fresh);
      }
      // Undefined slash token: list the available commands (no state change).
      return this.finishCannedTurn(
        conversationId,
        availableCommandsReply(),
        conversation,
      );
    }

    // 4. Edge-input handling (R5): empty/whitespace/emoji-only/punctuation are
    //    answered with a restate invitation and never mutate facts/lead.
    if (edgeKind !== 'none') {
      return this.finishCannedTurn(conversationId, edgeReply(edgeKind), conversation);
    }

    // 5. Load history for context extraction and composition.
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    const history: ConversationMessage[] = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    const totalStart = Date.now();

    // 6. Context extraction (R3, R9): the single source of truth for this turn.
    const leadData = (conversation.lead || {}) as any;
    const context: ConversationContext = this.contextTracker.build(
      {
        ...leadData,
        secondaryPains: Array.isArray(leadData.secondaryPains)
          ? (leadData.secondaryPains as string[])
          : null,
      },
      { stage: conversation.stage, handoffRequired: conversation.handoffRequired },
      history,
    );
    const facts = context.facts;
    const handoffState = context.handoffState;

    // 7. Intent resolution (R1, R2, R7): exactly one intent for this message.
    const hasFacts = !!(
      facts.segment ||
      facts.mainPain ||
      facts.whatsappUsage ||
      facts.volume ||
      facts.knownPains.length > 0
    );
    const resolved = resolveIntent(rawContent, { hasFacts, handoffState });
    const intent: IntentCategory = resolved.category;

    // 8. Resolve the handoff transition once (used both for the deterministic
    //    handoff replies and for the final state). Frustration is treated like
    //    an explicit human request so it routes to the team (legacy behavior).
    const preference = detectPreference(rawContent);
    const effectiveHandoffIntent: IntentCategory =
      intent === 'frustration' ? 'preference_human' : intent;
    // The lead is "ready for an unsolicited handoff offer" only once the pain
    // has been understood deeply: segment + a pain + the pain deepened (a
    // second pain mapped or the secondary-pains question already asked) +
    // volume. This keeps the agent from offering a transfer too early.
    const painDeepened =
      facts.knownPains.length >= 2 || facts.secondaryPainsAsked;
    const qualificationReadyForOffer =
      !!(facts.segment || facts.businessDescription) &&
      (!!facts.mainPain || facts.knownPains.length > 0) &&
      painDeepened &&
      !!facts.volume;
    const handoffDecision = this.handoffManager.resolve({
      current: handoffState,
      preference,
      intent: effectiveHandoffIntent,
      hasSegment: !!(facts.segment || facts.businessDescription),
      hasAtLeastOnePain: !!facts.mainPain || facts.knownPains.length > 0,
      userAbandoned: intent === 'desistance',
      qualificationReadyForOffer,
    });
    const nextHandoffState = handoffDecision.next;

    // 9. Deterministic answers bypass the LLM; only direct_question (non-price)
    //    and general reach the ResponseComposer.
    const pricing = await this.pricingConfig.get();
    let finalReply: string;
    let usedLLM = false;
    let stage = conversation.stage || 'descoberta';

    switch (intent) {
      case 'price_question':
        finalReply = composePriceAnswer({
          pricingRangeEnabled: pricing.pricingRangeEnabled,
          startingPriceText: pricing.pricingStartingAtText,
          handoffState,
        });
        stage = 'conversao';
        break;

      case 'preference_continue':
        finalReply = REPLY_PREFERENCE_CONTINUE;
        break;

      case 'preference_human':
        finalReply = handoffDecision.reply ?? REPLY_HANDOFF_ACCEPT;
        stage = 'handoff_humano';
        break;

      case 'handoff_accept':
        finalReply = handoffDecision.reply ?? REPLY_HANDOFF_ACCEPT;
        stage = 'handoff_humano';
        break;

      case 'frustration':
        finalReply = REPLY_FRUSTRATION;
        stage = 'handoff_humano';
        break;

      case 'handoff_completed_ack':
        finalReply = REPLY_HANDOFF_COMPLETED_ACK;
        stage = 'handoff_humano';
        break;

      case 'desistance':
        finalReply = REPLY_DESISTANCE;
        break;

      case 'greeting':
        finalReply =
          facts.messageCount > 1
            ? 'Olá. Me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.'
            : `Olá. Sou o ${agentName}, atendente inteligente da Decodifica. Vou te ajudar a entender quais partes do seu atendimento podem ser automatizadas com IA de forma humanizada. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.`;
        stage = 'abertura';
        break;

      case 'acknowledgment':
        finalReply = REPLY_ACKNOWLEDGMENT;
        break;

      case 'direct_question':
      case 'general':
      default: {
        // 9a. LLM composition (R1) — the only LLM entry point. Injeta a config
        //     do negócio (settings + pricing + base de conhecimento) no prompt,
        //     pra o agente raciocinar com o que a empresa configurou, sem chumbo.
        const business = await this.buildBusinessContext(settings, pricing);
        const llmResult = await this.agentReply.composeReply(
          history,
          context,
          agentName,
          resolved.isDirectQuestion,
          business,
        );
        usedLLM = true;
        stage = llmResult.stage || stage;
        finalReply = llmResult.reply;
        // 9b. Contextual fallback (R3.4) on empty/unparseable output.
        if (!finalReply || finalReply.trim() === '') {
          finalReply = this.agentReply.buildContextualFallback(facts);
          this.logger.warn(`[${conversationId}] Empty LLM reply, using contextual fallback`);
        }
        break;
      }
    }

    // 10. Response guard (R1.4, R2, R5.4, R6, R8): the single post-processor.
    const guardInput: GuardInput = {
      reply: finalReply,
      userMessage: rawContent,
      intent,
      context,
      pricing: {
        pricingRangeEnabled: pricing.pricingRangeEnabled,
        startingPriceText: pricing.pricingStartingAtText,
      },
    };
    const guardOutput = this.responseGuard.guard(guardInput);
    finalReply = guardOutput.reply;
    if (guardOutput.changed) {
      this.logger.debug(`[${conversationId}] Guard applied: ${guardOutput.guardReason}`);
    }
    if (!finalReply || finalReply.trim() === '') {
      finalReply = this.agentReply.buildContextualFallback(facts);
      this.logger.warn(`[${conversationId}] Reply empty after guard, using contextual fallback`);
    }

    // 11. Handoff state + score resolution (R7, R9, R10).
    const previousScore = conversation.lead?.leadScore || 0;
    const baseScore = calculateScore(facts);
    const isHandoff =
      nextHandoffState === 'accepted' || nextHandoffState === 'completed';

    let finalScore: number;
    let finalTemperature: string;
    let finalStatus: string;
    let finalHandoff: boolean;

    if (intent === 'desistance') {
      // Desistance sets status perdido and handoff false (abandoned: the
      // non-decreasing rule does not apply, R9.3).
      finalStatus = 'perdido';
      finalTemperature = 'frio';
      finalScore = clampScore(baseScore.score);
      finalHandoff = false;
    } else if (isHandoff) {
      finalStatus = 'chamar_humano';
      finalScore = clampNonDecreasing(previousScore, Math.max(baseScore.score, 80));
      finalTemperature = 'quente';
      finalHandoff = true;
    } else {
      // Includes preference_continue: a continue preference must NOT force a
      // handoff (R7.2). Score is non-decreasing on an active conversation.
      finalStatus = 'qualificando';
      finalScore = clampNonDecreasing(previousScore, baseScore.score);
      finalTemperature = temperatureFor(finalScore);
      finalHandoff = false;
    }

    const totalMs = Date.now() - totalStart;
    this.logger.log(
      `[${conversationId}] Reply in ${totalMs}ms | intent=${intent} | llm=${usedLLM} | handoff=${nextHandoffState} | score=${finalScore} | temp=${finalTemperature}`,
    );

    // 12. Persist assistant message.
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        direction: 'outbound',
        content: finalReply,
      },
    });

    // 13. Persist newly established facts + score to the lead every turn (R9.4).
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

    // 14. If handoff → update conversation state.
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

    // 15. Fire async analysis for LLM-path turns only — but NEVER concurrently
    //     for the same conversation (debounce), so it can't engasgar a próxima
    //     resposta ao cliente.
    if (usedLLM && !this.analysisInFlight.has(conversationId)) {
      this.analysisInFlight.add(conversationId);
      this.agentAnalysis
        .runAsync(conversationId, conversation.leadId, history, stage)
        .catch((err) => {
          this.logger.error(`[${conversationId}] Async analysis error: ${err.message}`);
        })
        .finally(() => this.analysisInFlight.delete(conversationId));
    }

    // 16. Return response.
    const qualification = {
      stage: stage as any,
      detectedSegment: facts.segment,
      detectedIntent: intent as any,
      mainPain: facts.mainPain,
      recommendedService: conversation.lead?.recommendedService ?? null,
      leadScore: finalScore,
      temperature: finalTemperature as any,
      status: finalStatus as any,
      shouldHandoff: finalHandoff,
      handoffReason: finalHandoff ? 'Cliente aceitou encaminhamento' : null,
      commercialSummary: null,
      nextBestQuestion: null,
      scoreReasons: baseScore.reasons,
      objections: [] as string[],
      urgency: 'desconhecida' as const,
      estimatedVolume: 'desconhecido' as const,
      decisionRole: 'desconhecido' as const,
      budgetSignal: 'desconhecido' as const,
    };

    return { message: assistantMessage, qualification };
  }

  /**
   * Persists a deterministic canned assistant reply (over-length, edge input,
   * or command confirmation) without any fact/lead mutation, and returns the
   * passthrough qualification derived from the current lead state. Used by the
   * short-circuit stages that must never reach the LLM (R4.3, R5.2, R5.3).
   */
  private async finishCannedTurn(
    conversationId: string,
    reply: string,
    conversation: { stage: string; handoffRequired: boolean; lead?: any },
  ) {
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        direction: 'outbound',
        content: reply,
      },
    });

    const lead = conversation.lead || {};
    const qualification = {
      stage: conversation.stage as any,
      detectedSegment: lead.segment ?? null,
      detectedIntent: 'outro' as any,
      mainPain: lead.mainPain ?? null,
      recommendedService: lead.recommendedService ?? null,
      leadScore: lead.leadScore ?? 0,
      temperature: (lead.temperature ?? 'frio') as any,
      status: (lead.status ?? 'novo') as any,
      shouldHandoff: conversation.handoffRequired ?? false,
      handoffReason: null,
      commercialSummary: null,
      nextBestQuestion: null,
      scoreReasons: [] as string[],
      objections: [] as string[],
      urgency: 'desconhecida' as const,
      estimatedVolume: 'desconhecido' as const,
      decisionRole: 'desconhecido' as const,
      budgetSignal: 'desconhecido' as const,
    };

    return { message: assistantMessage, qualification };
  }

  /**
   * Returns the turn produced by a `/clear` or `/reset` command after the
   * conversation has been fully wiped and the lead reset. The reply is the
   * fresh greeting (the only message in the cleared conversation) and the
   * qualification is the clean default state of a brand-new lead — so the
   * client sees exactly a "from the beginning" conversation. No confirmation
   * message is appended.
   */
  private buildClearedTurn(cleared: { messages?: Array<any> }) {
    const messages = cleared.messages ?? [];
    const greeting = messages[messages.length - 1] ?? null;

    const qualification = {
      stage: 'abertura' as any,
      detectedSegment: null,
      detectedIntent: 'outro' as any,
      mainPain: null,
      recommendedService: null,
      leadScore: 0,
      temperature: 'frio' as any,
      status: 'novo' as any,
      shouldHandoff: false,
      handoffReason: null,
      commercialSummary: null,
      nextBestQuestion: null,
      scoreReasons: [] as string[],
      objections: [] as string[],
      urgency: 'desconhecida' as const,
      estimatedVolume: 'desconhecido' as const,
      decisionRole: 'desconhecido' as const,
      budgetSignal: 'desconhecido' as const,
    };

    return { message: greeting, qualification };
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

      // Reset conversation state — a full restart "from the beginning". This
      // also clears the handoff/takeover flags and unpauses the bot, so a
      // `/clear` (or `/reset`) genuinely restarts the conversation: the bot
      // resumes auto-replying and is no longer stuck in a completed-handoff or
      // human-takeover state.
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          stage: 'abertura',
          status: 'active',
          lastIntent: null,
          handoffRequired: false,
          handoffReason: null,
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
          botPaused: false,
          assignedTo: null,
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
   * Monta o BusinessContext injetado no prompt do agente a partir da
   * configuração do painel (AgentSettings + PricingConfig + KnowledgeBase). É
   * isto que torna o agente configurável sem tocar em código: o que a empresa
   * faz, o conhecimento, o preço e as não-promessas passam a vir daqui.
   */
  private async buildBusinessContext(
    settings: AgentSettingsInput,
    pricing: { pricingRangeEnabled: boolean; pricingText: string },
  ): Promise<BusinessContext> {
    const services = settings.services ?? [];
    const whatWeDo =
      services.length > 0 ? services.map((s) => `- ${s}`).join('\n') : null;

    const grouped = await this.knowledge.findAll();
    const kbLines: string[] = [];
    for (const items of Object.values(grouped)) {
      for (const item of items) {
        if (item.active) kbLines.push(`- ${item.title}: ${item.content}`);
      }
    }
    const knowledge = kbLines.length > 0 ? kbLines.join('\n') : null;

    const pricingText =
      pricing.pricingRangeEnabled && pricing.pricingText
        ? pricing.pricingText
        : null;

    return {
      whatWeDo,
      knowledge,
      pricingText,
      doNotPromise: settings.doNotPromise ?? null,
      toneOfVoice: settings.toneOfVoice ?? null,
    };
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
