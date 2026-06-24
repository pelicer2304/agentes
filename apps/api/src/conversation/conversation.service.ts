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
import { FollowUpService } from '../followup/followup.service';
import { EngagementClassifierService } from '../followup/engagement-classifier.service';
import { EngagementClassification } from '../followup/followup.types';
import { AppConfigService } from '../config/config.service';
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

// Mensagem de OFERTA do encaminhamento (quando o lead acabou de qualificar):
// pede a lista completa de problemas antes de passar pro time, pra eles já
// chegarem com a melhor estratégia.
const REPLY_HANDOFF_OFFER_LIST =
  'Acho que já consigo te conectar com o nosso time. Antes de te encaminhar, ' +
  'me lista aqui, por favor, todos os pontos que você quer resolver — assim a ' +
  'gente já monta a melhor estratégia pro seu caso.';

const REPLY_HANDOFF_COMPLETED_ACK =
  'Prontinho, seu atendimento já foi encaminhado para a equipe da Decodifica. Se surgir qualquer dúvida nova, é só me chamar por aqui.';

const REPLY_DESISTANCE =
  'Tranquilo, sem pressa. Se mais pra frente o WhatsApp começar a apertar, é só me chamar.';

const REPLY_FRUSTRATION =
  'Entendi. Vou te encaminhar direto pro time resolver isso com você, sem mais pergunta.';

// Número do time de PLANOS do decodificador de etiquetas (ZPL -> PDF), que é um
// produto diferente do agente de IA. Trocar aqui se mudar.
const LABEL_DECODER_PHONE = '+55 11 93318-3820';
const REPLY_REDIRECT_LABELS =
  `Ah, saquei! O decodificador de etiquetas (ZPL pra PDF) é com outro time da Decodifica — aqui é o agente de IA de atendimento. Pra fazer ou renovar sua assinatura, chama nesse número: ${LABEL_DECODER_PHONE}, que eles te resolvem rapidinho.`;
// Quando é AMBÍGUO (fala de conta/senha/plano, mas sem dizer que é etiqueta), o
// agente pergunta — já adiantando o número, pra não travar a pessoa.
const REPLY_MAYBE_LABELS =
  `Deixa eu te direcionar certo: você tá falando do nosso decodificador de etiquetas (ZPL pra PDF)? Se for, o time de planos te atende no ${LABEL_DECODER_PHONE}. Se for outra coisa, me conta o que você precisa que eu te ajudo por aqui.`;

const REPLY_ACKNOWLEDGMENT = 'Tô por aqui se precisar.';

// ─── Engagement (R10–R13): desfechos determinísticos de desengajamento ──────
// Respostas canônicas do turno quando o lead pede para PARAR (opt_out) ou para
// ser contatado MAIS TARDE (nao_agora). Nenhuma delas escala para humano.

const REPLY_OPT_OUT_CONFIRM =
  'Tudo bem, não te envio mais mensagens. Se mudar de ideia, é só me chamar.';

const REPLY_DEFERRAL_ACK =
  'Fechado! Te dou um toque mais pra frente então. Quando quiser, é só me chamar.';

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
    private readonly followUpService: FollowUpService,
    private readonly engagementClassifier: EngagementClassifierService,
    private readonly config: AppConfigService,
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

    // 5b. Roteamento de produto: quem quer ASSINAR/renovar/usar o decodificador
    //     de etiquetas (ZPL -> PDF) caiu no número errado — esse é outro produto
    //     da Decodifica. Manda chamar o time de planos no número certo, em vez de
    //     tentar qualificar como lead de atendimento. Só uma vez (não repete).
    const userTexts = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join(' \n ');
    const alreadyRedirected = messages.some(
      (m) => m.role === 'assistant' && m.content.includes(LABEL_DECODER_PHONE),
    );
    if (!alreadyRedirected && this.wantsLabelDecoderPlan(userTexts)) {
      return this.finishCannedTurn(
        conversationId,
        REPLY_REDIRECT_LABELS,
        conversation,
      );
    }
    // Ambíguo (conta/senha/renovar plano, mas sem dizer que é etiqueta): em vez
    // da resposta seca "não consigo ajudar", PERGUNTA se é o decodificador de
    // etiquetas e já adianta o número.
    if (!alreadyRedirected && this.looksLikeSubscriptionOrAccount(userTexts)) {
      return this.finishCannedTurn(
        conversationId,
        REPLY_MAYBE_LABELS,
        conversation,
      );
    }
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
    // Tratamentos de template que cortavam a conversa caem no LLM, que lê o
    // histórico e CONTINUA conduzindo:
    //  - "oi"/cumprimento DEPOIS da abertura (não repete a saudação);
    //  - "ok/beleza/valeu" NO MEIO da conversa (não solta "Tô por aqui" e
    //    encerra do nada). O "ok" pós-handoff já é handoff_completed_ack, à parte.
    let routedIntent: IntentCategory = intent;
    if (
      (intent === 'greeting' && facts.messageCount > 1) ||
      intent === 'acknowledgment'
    ) {
      routedIntent = 'general';
    }

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

    // 7b. Engagement classification (R10, R13) — resolved BEFORE response
    //     generation and BEFORE the handoff decision, so it has PRECEDENCE over
    //     the path that today escalates to a human. A polite deferral like
    //     "não, eu volto a te acionar quando eu quiser" must NOT be read as a
    //     human request/accept (the "quando" bug). The classifier only runs
    //     when a cheap, deterministic gate says it is worth it; otherwise the
    //     safe default `interesse_normal` is assumed WITHOUT an LLM call (R13.5).
    const engagement = await this.resolveEngagementIntent({
      conversationId,
      history,
      leadMessage: rawContent,
      handoffState,
      qualificationReadyForOffer,
    });

    // Early branch (R11.6, R12.3, R13.1, R13.2): a disengagement turn never
    // reaches the handoff path nor marks finalHandoff. It produces a
    // deterministic reply and delegates the scheduling side effect to the
    // FollowUpService, short-circuiting steps 8/9 entirely.
    // Opt-out é PERMANENTE (regra do negócio): um pedido explícito de parar
    // confirma e desliga o follow-up — e segue valendo mesmo se for repetido.
    if (engagement.classification.intent === 'opt_out') {
      return this.finishDisengagementTurn(
        conversationId,
        conversation,
        facts,
        engagement.classification,
      );
    }

    // Adiamento ("me chama segunda/daqui a pouco/semana que vem") só agenda
    // enquanto o cliente NÃO tiver feito opt-out. Depois do opt-out, NENHUMA
    // mensagem reativa o follow-up automaticamente — nem um adiamento, nem ruído
    // como a resposta automática de ausência do WhatsApp do cliente (que vinha
    // sendo lida como adiamento e ressuscitando o ciclo). O bot continua
    // respondendo normalmente; apenas não re-agenda nada.
    if (
      !engagement.optedOut &&
      engagement.classification.intent === 'nao_agora'
    ) {
      return this.finishDisengagementTurn(
        conversationId,
        conversation,
        facts,
        engagement.classification,
      );
    }
    // (interesse_normal não reativa mais o ciclo após opt-out — o antigo
    //  resumeFromOptOut automático foi removido de propósito.)

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

    switch (routedIntent) {
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

    // #3 — Ao OFERECER o encaminhamento (lead recém-qualificado: none -> suggested),
    // trocamos a pergunta livre do LLM por um pedido determinístico da lista
    // completa de problemas, pra o time já receber o cenário e montar a melhor
    // estratégia. Só no fluxo conversacional ('general'); perguntas diretas e
    // preço seguem sendo respondidas primeiro (a oferta vem no turno seguinte).
    if (intent === 'general' && handoffState === 'none' && nextHandoffState === 'suggested') {
      finalReply = REPLY_HANDOFF_OFFER_LIST;
      stage = 'conversao';
    }
    // Handoff CONFIRMADO neste turno (inclui a auto-escala após a lista — regra
    // 4b do HandoffManager): usa a confirmação determinística, não a do LLM.
    if (
      handoffDecision.reply &&
      nextHandoffState === 'accepted' &&
      handoffState !== 'accepted'
    ) {
      finalReply = handoffDecision.reply;
      stage = 'handoff_humano';
    }

    // Encerramento silencioso: depois de já ter confirmado o encaminhamento
    // ("já foi encaminhado..."), um novo "ok/beleza/valeu" NÃO repete a
    // despedida — o bot encerra em SILÊNCIO (não envia nada). Perguntas novas
    // seguem sendo respondidas normalmente (não caem aqui).
    const silentClose =
      routedIntent === 'handoff_completed_ack' &&
      history.some(
        (m) => m.role === 'assistant' && m.content.includes('já foi encaminhado'),
      );

    // 10. Response guard (R1.4, R2, R5.4, R6, R8): the single post-processor.
    if (!silentClose) {
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

    // 12. Persist assistant message (no encerramento silencioso não há mensagem:
    //     o engine devolve message=null e o inbound não envia nada).
    const assistantMessage = silentClose
      ? null
      : await this.prisma.message.create({
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

    // 13b. Follow-up hook (R4.2): quando o lead acabou de transitar para
    //      `perdido` (intent `desistance`), cancela o ciclo de follow-up. Só
    //      dispara na transição efetiva (status anterior != `perdido`), nunca a
    //      cada turno. Resiliente: uma falha do follow-up jamais quebra o fluxo
    //      da conversa (fire-and-forget com `.catch`).
    const previouslyLost = conversation.lead?.status === 'perdido';
    if (finalStatus === 'perdido' && !previouslyLost) {
      void this.followUpService
        .onLeadLost(conversationId, new Date())
        .catch((err) =>
          this.logger.error(
            `[${conversationId}] Follow-up onLeadLost hook failed: ${err instanceof Error ? err.message : 'Unknown'}`,
          ),
        );
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

    // 15. Fire async analysis for LLM-path turns only — debounced (nunca duas
    //     ao mesmo tempo na mesma conversa) E throttled. A análise é pesada
    //     (~15-25s de LLM) e, mesmo debounced, uma rodada sozinha pode atrasar
    //     o próximo turno além do ENGINE_TIMEOUT_MS (12s) e forçar o fallback de
    //     timeout. Como score/temperatura são recalculados deterministicamente a
    //     cada turno, basta refinar o CRM periodicamente: roda nos 2 primeiros
    //     turnos (baseline) e depois a cada 3.
    const userTurns = history.filter((m) => m.role === 'user').length;
    const shouldAnalyze = userTurns <= 2 || userTurns % 3 === 0;
    if (usedLLM && shouldAnalyze && !this.analysisInFlight.has(conversationId)) {
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
   * Resolves the Engagement_Intent for this turn (R10, R13).
   *
   * Runs a cheap, deterministic GATE first and only calls the LLM classifier
   * when it is worth it. The gate is NOT a classifier — it only decides whether
   * to spend an LLM call; the final class is always the LLM's (R10.3). The gate
   * fires when ANY of these hold:
   *   - there is a pending/active follow-up cycle for the conversation
   *     (`cycleState ∈ {active, opted_out}`) — where deferral/opt-out change
   *     the schedule;
   *   - the bot's previous turn was a handoff offer/list request
   *     (`handoffState === 'suggested'`) — where "quando/adiamento × aceite"
   *     confusion happens;
   *   - the lead is already qualified (`qualificationReadyForOffer`);
   *   - the message looks like a negation combined with a temporal
   *     reference/refusal (light lexical gate).
   *
   * Otherwise the safe class `interesse_normal` is returned WITHOUT an LLM call
   * (R13.5) — this never produces a disengagement signal, so it never escalates.
   * Any gate read failure or classifier error also degrades to the safe class.
   */
  private async resolveEngagementIntent(params: {
    conversationId: string;
    history: ConversationMessage[];
    leadMessage: string;
    handoffState: string;
    qualificationReadyForOffer: boolean;
  }): Promise<{ classification: EngagementClassification; optedOut: boolean }> {
    const {
      conversationId,
      history,
      leadMessage,
      handoffState,
      qualificationReadyForOffer,
    } = params;

    // Cheap gate input: the follow-up cycle state (read once, resiliently).
    let cycleState: string | null = null;
    try {
      const schedule = await this.prisma.followUpSchedule.findUnique({
        where: { conversationId },
        select: { cycleState: true },
      });
      cycleState = schedule?.cycleState ?? null;
    } catch (err) {
      // A gate read failure must never break the turn (R13.5): assume no cycle.
      cycleState = null;
    }

    const optedOut = cycleState === 'opted_out';
    const hasActiveOrOptedCycle =
      cycleState === 'active' || cycleState === 'opted_out';

    const shouldClassify =
      hasActiveOrOptedCycle ||
      handoffState === 'suggested' ||
      qualificationReadyForOffer ||
      this.looksLikeDeferralOrRefusal(leadMessage);

    if (!shouldClassify) {
      // Safe default class without an LLM call (R13.5): never escalates.
      return {
        classification: { intent: 'interesse_normal', confidence: 0, failSafe: true },
        optedOut,
      };
    }

    const lastBotMessage = this.lastAssistantMessage(history);
    try {
      const classification = await this.engagementClassifier.classify({
        lastBotMessage,
        leadMessage,
      });
      return { classification, optedOut };
    } catch (err) {
      // The classifier already fail-safes internally; stay defensive (R13.5).
      this.logger.warn(
        `[${conversationId}] Engagement classifier threw, assuming interesse_normal: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
      return {
        classification: { intent: 'interesse_normal', confidence: 0, failSafe: true },
        optedOut,
      };
    }
  }

  /** Last assistant (bot) message in the history — the question the lead replied to. */
  private lastAssistantMessage(history: ConversationMessage[]): string | null {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') {
        return history[i].content;
      }
    }
    return null;
  }

  /**
   * Cheap, deterministic GATE (not a classifier): true when the message has a
   * negation combined with a temporal reference or an explicit refusal. Used
   * only to decide whether to spend an LLM call; the actual class is always the
   * LLM's (R10.3). Designed to be permissive (catch borderline phrasings) while
   * remaining trivially cheap.
   */
  private looksLikeDeferralOrRefusal(message: string): boolean {
    const text = (message ?? '').toLowerCase();
    if (text.trim() === '') return false;

    const negation =
      /(\bn[ãa]o\b|\bnunca\b|\bsem\b|\bchega\b|\bpar[ae]\b|\bnem\b)/.test(text);
    const temporalOrRefusal =
      /(depois|mais tarde|amanh[ãa]|semana|m[êe]s|outro dia|outra hora|quando|agora n[ãa]o|me chama|te chamo|te aciono|volto|retorno|acionar|cancel|descadastr|sair da lista|para de me|parar de me|n[ãa]o quero|n[ãa]o me mand|n[ãa]o me envi)/.test(
        text,
      );

    return negation && temporalOrRefusal;
  }

  /**
   * Finalizes a DISENGAGEMENT turn (R11, R12, R13) without ever escalating to a
   * human. Produces the deterministic acknowledgment (deferral) or opt-out
   * confirmation, persists the assistant message, updates the lead WITHOUT
   * forcing `chamar_humano` (keeps the current status / `qualificando`), and
   * delegates the scheduling side effect (`scheduleDeferred`/`onOptOut`) to the
   * FollowUpService resiliently (a follow-up failure never breaks the turn).
   *
   * Stage stays neutral (the conversation's current stage); `finalHandoff` is
   * never set and the conversation handoff state is never updated.
   */
  private async finishDisengagementTurn(
    conversationId: string,
    conversation: { stage: string; leadId: string; lead?: any },
    facts: ConversationContext['facts'],
    engagement: EngagementClassification,
  ) {
    const leadData = (conversation.lead || {}) as any;
    const now = new Date();
    const stage = conversation.stage || 'descoberta';

    let finalReply: string;

    if (engagement.intent === 'opt_out') {
      finalReply = REPLY_OPT_OUT_CONFIRM;
      // AGUARDA a persistência do estado `opted_out` ANTES de retornar, para
      // que o hook de outbound (notifyFollowUpOutbound → ensureScheduled) do
      // InboundMessageProcessor, que roda em seguida, encontre o ciclo já em
      // opted_out e NÃO o ressuscite (correção do bug). O try/catch garante que
      // uma falha de follow-up nunca quebre a resposta determinística ao lead.
      try {
        await this.followUpService.onOptOut(conversationId, now);
      } catch (err) {
        this.logger.error(
          `[${conversationId}] Follow-up onOptOut hook failed: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      }
    } else {
      // nao_agora: resolve the deferral offset (inferred → default 5h).
      const offsetHours =
        engagement.deferral?.durationHours ??
        this.config.followUpDefaultDeferralHours;
      finalReply = this.buildDeferralReply(engagement.deferral?.durationHours);
      // AGUARDA a persistência do estado `deferred` ANTES de retornar, pelo
      // mesmo motivo do opt-out: evita a corrida com o ensureScheduled que roda
      // logo após o outbound e sobrescreveria o adiamento por um Nível 1 de 1h.
      try {
        await this.followUpService.scheduleDeferred(conversationId, offsetHours, now);
      } catch (err) {
        this.logger.error(
          `[${conversationId}] Follow-up scheduleDeferred hook failed: ${err instanceof Error ? err.message : 'Unknown'}`,
        );
      }
    }

    this.logger.log(
      `[${conversationId}] Disengagement turn | engagement=${engagement.intent} | failSafe=${engagement.failSafe} | NO handoff`,
    );

    // Persist the deterministic assistant reply.
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        direction: 'outbound',
        content: finalReply,
      },
    });

    // Persist newly established facts + a non-decreasing score. Status is kept
    // as-is (never `chamar_humano`; opt-out/deferral are not a lost lead): the
    // current status is preserved, defaulting to `qualificando` when unset.
    const previousScore = leadData.leadScore || 0;
    const baseScore = calculateScore(facts);
    const finalScore = clampNonDecreasing(previousScore, baseScore.score);
    const finalTemperature = temperatureFor(finalScore);
    const finalStatus =
      leadData.status === 'chamar_humano'
        ? leadData.status
        : leadData.status || 'qualificando';

    try {
      const leadUpdate: Record<string, unknown> = {
        leadScore: finalScore,
        temperature: finalTemperature,
        status: finalStatus,
      };
      if (facts.segment && !leadData.segment) leadUpdate.segment = facts.segment;
      if (facts.mainPain && !leadData.mainPain) leadUpdate.mainPain = facts.mainPain;
      if (facts.whatsappUsage && !leadData.whatsappUsage)
        leadUpdate.whatsappUsage = facts.whatsappUsage;
      if (facts.volume && !leadData.estimatedVolume)
        leadUpdate.estimatedVolume = facts.volume;
      if (facts.decisionRole && !leadData.decisionRole)
        leadUpdate.decisionRole = facts.decisionRole;

      await this.prisma.lead.update({
        where: { id: conversation.leadId },
        data: leadUpdate,
      });
    } catch (err) {
      this.logger.error(
        `[${conversationId}] Failed to update lead (disengagement): ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    const qualification = {
      stage: stage as any,
      detectedSegment: facts.segment,
      detectedIntent: 'outro' as any,
      mainPain: facts.mainPain,
      recommendedService: leadData.recommendedService ?? null,
      leadScore: finalScore,
      temperature: finalTemperature as any,
      status: finalStatus as any,
      shouldHandoff: false,
      handoffReason: null,
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
   * Deterministic deferral acknowledgment (R11.6). When the lead indicated a
   * timeframe, mention it naturally; otherwise use the generic acknowledgment.
   */
  private buildDeferralReply(durationHours?: number): string {
    if (typeof durationHours === 'number' && durationHours > 0) {
      const when = this.formatDeferralWindow(durationHours);
      if (when) {
        return `Fechado! Te dou um toque ${when} então. Quando quiser, é só me chamar.`;
      }
    }
    return REPLY_DEFERRAL_ACK;
  }

  /** Turns a deferral offset in hours into a natural Portuguese phrase. */
  private formatDeferralWindow(hours: number): string | null {
    if (!Number.isFinite(hours) || hours <= 0) return null;
    if (hours < 24) {
      const rounded = Math.max(1, Math.round(hours));
      return rounded === 1 ? 'daqui a pouco' : `daqui a ${rounded} horas`;
    }
    const days = Math.round(hours / 24);
    if (days <= 1) return 'amanhã';
    return `daqui a ${days} dias`;
  }

  /**
   * Detecta que a pessoa quer ASSINAR/renovar/usar o decodificador de etiquetas
   * (ZPL -> PDF) — produto distinto do agente de IA. Exige DOIS sinais juntos no
   * histórico: o domínio de etiqueta/ZPL E a intenção de assinar/converter. Isso
   * evita confundir com um lead que TEM um negócio de etiquetas e quer automação
   * de atendimento (esse menciona ZPL mas sem querer "assinar/converter").
   */
  private wantsLabelDecoderPlan(text: string): boolean {
    const t = text.toLowerCase();
    const labelDomain =
      /\bzpl\b/.test(t) ||
      /decodific\w*\s+(de\s+)?(etiqueta|zpl)/.test(t) ||
      /(etiqueta|zpl)[^.]{0,30}\bpdf\b/.test(t) ||
      /\bpdf\b[^.]{0,30}(zpl|etiqueta)/.test(t);
    const buyIntent =
      /\bassinar\b|\bassinatura\b|\brenovar\b|\bmensalidade\b/.test(t) ||
      /(preciso|quero|gostaria|fazer|como\s+fa[çc]o)\s+(de\s+)?(uma\s+)?(assinatura|plano|converter|decodificar)/.test(
        t,
      );
    return labelDomain && buyIntent;
  }

  /**
   * Sinais AMBÍGUOS de que a pessoa é cliente de um produto com conta/assinatura
   * (alterar senha, renovar plano, "minha conta/assinatura/login") SEM citar
   * etiqueta/ZPL. O agente de IA é sob medida (não tem login/senha/assinatura),
   * então isso normalmente é o decodificador — mas como não está explícito, o
   * agente PERGUNTA em vez de redirecionar direto.
   */
  private looksLikeSubscriptionOrAccount(text: string): boolean {
    const t = text.toLowerCase();
    return (
      // conta / senha / plano / assinatura
      /(alterar|trocar|mudar|recuperar|esqueci|redefinir)\s+(a\s+)?(minha\s+)?senha/.test(
        t,
      ) ||
      /renovar\s+(o\s+|a\s+)?(meu\s+|minha\s+)?(plano|assinatura|mensalidade)/.test(
        t,
      ) ||
      /\b(minha\s+assinatura|minha\s+conta|meu\s+login)\b/.test(t) ||
      /(plano|assinatura)\s+(venceu|expirou|vencid|expirad)/.test(t) ||
      // acesso / login / plataforma — o agente de IA não é uma plataforma com
      // login; quem fala de "não loga / não acessa / a plataforma" quase sempre
      // quer outro produto (ex.: o decodificador), então perguntamos.
      /\b(logar|logando|login)\b/.test(t) ||
      /n[ãa]o\s.{0,25}(entrar|acessar|logar|logando)\b/.test(t) ||
      (/\bplataforma\b/.test(t) &&
        /(n[ãa]o|problema|dificuldade|erro|logar|login|acessar|entrar|senha|conta)/.test(
          t,
        ))
    );
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
