import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationService } from '../conversation/conversation.service';
import { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import { AppConfigService } from '../config/config.service';
import { RateLimiterService } from '../common/rate-limiter';
import {
  boundRawPayload,
  exceedsHardCap,
  sanitizeText,
} from '../common/payload-sanitizer';
import type { InboundMessage } from '../channel/channel-adapter.interface';
import {
  isNormalizationReject,
  normalizeInbound,
  type NormalizationReject,
} from '../modules/channels/evolution/evolution-normalizer';
import { EvolutionService } from '../modules/channels/evolution/evolution.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { resolveCommand } from '../agent/command-handler';
import type { CommandResolution } from '../agent/conversation-types';

/**
 * The maximum inbound text length passed to the Agent_Engine. Content longer
 * than this is truncated to the first {@link MAX_CONTENT_LENGTH} characters
 * before invocation (Requirements 6.7, 6.8).
 */
export const MAX_CONTENT_LENGTH = 4000;

/**
 * Absolute hard timeout for an engine reply. When the engine exceeds this, the
 * processor abandons waiting and uses the contextual fallback (Requirement 23.2).
 *
 * Margem folgada (era 12s): sob rate limit de uma conta OpenRouter sem crédito,
 * uma resposta pode enfileirar atrás da análise de fundo e passar de 12s,
 * disparando o fallback "estou com dificuldade" justo no turno que qualifica o
 * lead. Esperar um pouco mais é melhor que mandar o fallback. A causa raiz se
 * resolve com crédito no OpenRouter (rate limit maior) + o throttle da análise.
 */
export const ENGINE_TIMEOUT_MS = 22_000;

/** WhatsApp channel literal used throughout the WhatsApp flow. */
const WHATSAPP_CHANNEL = 'whatsapp';

/**
 * Fixed reply sent to a client whose conversation already completed handoff
 * (Requirement 10.4). Used by the gating path (refined in task 6.3).
 */
export const HANDOFF_COMPLETED_CONFIRMATION =
  'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.';

/**
 * Short, non-technical reply produced when the engine fails or times out
 * (Requirement 23.4). Refined/owned by task 6.3.
 */
export const CONTEXTUAL_FALLBACK =
  'Estou com dificuldade para analisar tudo agora, mas já registrei seu cenário. A equipe da Decodifica pode te ajudar a partir daqui.';

/**
 * Notice sent for unsupported media (audio/image/document) (Requirement 6.6).
 * Owned/refined by task 6.3.
 */
export const UNSUPPORTED_MEDIA_NOTICE =
  'No momento consigo atender apenas mensagens de texto. Pode me escrever sua mensagem?';

/**
 * The bot_events `type` values supported by the system (design Data Models,
 * Requirement 19.5).
 */
export type BotEventType =
  | 'webhook_received'
  | 'message_inbound_saved'
  | 'message_outbound_sent'
  | 'bot_paused'
  | 'bot_resumed'
  | 'handoff_requested'
  | 'handoff_completed'
  | 'human_message_sent'
  | 'evolution_error';

/**
 * The outcome of processing a single inbound webhook payload.
 *
 *  - `httpStatus` — the HTTP status the webhook controller should return. The
 *    processor never returns 401/500; those are decided by the controller
 *    (task 6.4). Body-level 400 validation is also the controller's concern;
 *    the processor treats a malformed normalizer reject as `ignored` (200).
 *  - `action` — a coarse classification of what happened, for logging/tests.
 */
export interface ProcessOutcome {
  httpStatus: 200 | 400;
  action: 'replied' | 'ignored' | 'duplicate' | 'gated' | 'unsupported' | 'error';
}

/** Why a conversation is gated from auto-reply (see {@link applyGating}). */
type GatingReason =
  | 'auto_reply_disabled'
  | 'bot_paused'
  | 'handoff_completed'
  | null;

/** Internal result of {@link resolveLeadAndConversation}. */
interface ResolvedContext {
  leadId: string;
  conversation: {
    id: string;
    botPaused: boolean;
    handoffCompleted: boolean;
  };
}

/**
 * A pending debounce buffer for one conversation. Holds the rapid successive
 * inbound messages (deduped by externalMessageId) until the quiet window
 * settles, plus the provenance of the last message (used to stamp the combined
 * inbound row and to address the outgoing reply).
 */
interface BufferedTurn {
  conversationId: string;
  leadId: string;
  phone: string;
  instanceName: string | null;
  items: Array<{ content: string; externalMessageId: string | null }>;
  lastInbound: InboundMessage;
  timer: NodeJS.Timeout | null;
  firstQueuedAt: number;
}

/** Internal result of {@link invokeEngineWithTimeout}. */
type EngineInvocation =
  | { status: 'ok'; reply: string; outboundMessageId: string; qualification: EngineQualification }
  | { status: 'silent'; qualification: EngineQualification }
  | { status: 'failed'; reason: EngineFailureReason };

/**
 * Why a bounded engine invocation did not yield a reply. Both reasons resolve
 * to the {@link CONTEXTUAL_FALLBACK} and are audited without leaking technical
 * details to the client (Req 23.2, 23.3).
 */
type EngineFailureReason = 'timeout' | 'error';

/** The qualification subset the orchestration layer reads from the engine. */
interface EngineQualification {
  shouldHandoff: boolean;
  status: string;
}

/**
 * Accumulated timing + decision flags for the single structured per-message log
 * line emitted by {@link InboundMessageProcessor.process} (Requirement 22.1).
 *
 * Fields are populated as the pipeline progresses; anything not known by the
 * time the log is emitted stays at its initial value (`null`/`false`).
 *
 * Note on engine-internal flags: the frozen Agent_Engine
 * (`ConversationService.handleInboundMessage`) currently returns only
 * `{ message, qualification }` and does NOT expose `usedLocalRule`, `usedLLM`,
 * or `llmMs`. Those remain `null` here (logged as "unknown") rather than
 * guessed. `usedFallback` IS known to the processor (it owns the contextual
 * fallback decision) and is set accordingly.
 */
interface MessageMetrics {
  conversationId: string | null;
  leadId: string | null;
  channel: typeof WHATSAPP_CHANNEL;
  phone: string | null;
  instanceName: string | null;
  /** Engine-internal; not exposed by the frozen engine → stays null. */
  usedLocalRule: boolean | null;
  /** Engine-internal; not exposed by the frozen engine → stays null. */
  usedLLM: boolean | null;
  /** True when the contextual fallback reply was used (timeout/engine error). */
  usedFallback: boolean;
  /** Total processing time (ms), filled when the log is emitted. */
  responseMs: number | null;
  /** Engine LLM latency (ms); not exposed by the frozen engine → stays null. */
  llmMs: number | null;
  /** Measured duration (ms) of the outbound Evolution send, when one occurred. */
  evolutionSendMs: number | null;
  /** Error message when processing failed, else null. */
  error: string | null;
}

/**
 * `InboundMessageProcessor` is the orchestration heart of the WhatsApp flow.
 *
 * It wraps the **frozen** Agent_Engine (`ConversationService.handleInboundMessage`)
 * with the production concerns required by WhatsApp: webhook logging, inbound
 * normalization + filtering, idempotency, lead/conversation resolution, bot
 * gating, a bounded engine invocation, reply delivery, outbound persistence, and
 * lifecycle Bot_Events.
 *
 * Pipeline (mirrors design "Webhook Processing Pipeline"):
 *   webhook_log + webhook_received → normalize → filter → idempotency →
 *   resolve lead/conversation → gating → invokeEngineWithTimeout → send reply →
 *   persist outbound + events → return ProcessOutcome.
 *
 * ## Seams left for later tasks
 * This task (6.1) implements the core pipeline. Lead/conversation resolution
 * is hardened by **task 6.2**, and gating / unsupported-media / timeout
 * fallback are refined by **task 6.3**. Handoff acceptance side-effects
 * (lead/conv status transitions, pause-on-handoff, handoff events) are
 * implemented by **task 8.1** in {@link applyHandoffSideEffects}; the internal
 * admin summary delivery + Dashboard alert are implemented by **task 8.2** in
 * {@link deliverHandoffSummary}.
 */
@Injectable()
export class InboundMessageProcessor {
  private readonly logger = new Logger(InboundMessageProcessor.name);

  /**
   * In-memory debounce buffers keyed by conversationId. When several inbound
   * messages arrive in quick succession, they are accumulated here and the
   * quiet-window timer is reset on each new message. When the window settles,
   * {@link flushDebouncedTurn} concatenates them into a single engine turn and
   * produces ONE reply — so the agent answers like a human who waited for the
   * client to finish typing. The reply is sent asynchronously (outside the
   * webhook request) from the timer callback.
   */
  private readonly debounceBuffers = new Map<string, BufferedTurn>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly channelRegistry: ChannelAdapterRegistry,
    private readonly config: AppConfigService,
    private readonly rateLimiter: RateLimiterService,
    private readonly evolution: EvolutionService,
    private readonly transcription: TranscriptionService,
  ) {}

  /**
   * Process a single raw Evolution webhook payload end-to-end.
   *
   * Never throws for expected conditions: rejects, duplicates, gating, and send
   * failures all resolve to a {@link ProcessOutcome} with `httpStatus: 200`.
   * Unhandled errors are allowed to propagate so the controller (task 6.4) can
   * map them to HTTP 500.
   *
   * @param payload - The raw, untrusted Evolution webhook payload.
   */
  async process(payload: unknown): Promise<ProcessOutcome> {
    const processStart = Date.now();

    // 1. Record the webhook + webhook_received lifecycle event (Req 9.5, 22.3).
    const webhookLogId = await this.recordWebhookLog(payload);
    await this.recordBotEvent('webhook_received', {
      conversationId: null,
      leadId: null,
      payload: { received: true },
    });

    // 2. Normalize + filter (Req 6.1–6.5). A reject never produces a reply.
    let normalized = normalizeInbound(payload);
    if (isNormalizationReject(normalized)) {
      return this.handleReject(webhookLogId, normalized);
    }

    const phone = normalized.from;
    const instanceName = normalized.instance;

    // 2a. Hard size cap (Req 18.4). Reject oversized inbound TEXT before any
    //     storage or engine invocation. This is distinct from the 4000-char
    //     engine truncation (which still happens below for accepted content).
    if (normalized.messageType === 'text' && exceedsHardCap(normalized.content)) {
      await this.finalizeWebhookLog(webhookLogId, {
        eventType: 'rejected:oversized',
        instanceName,
        externalMessageId: normalized.externalMessageId,
        phone,
        processed: true,
        error: `inbound text exceeds hard cap (${normalized.content.length} chars)`,
      });
      this.logger.debug(
        `Inbound rejected (oversized: ${normalized.content.length} chars)`,
      );
      return { httpStatus: 200, action: 'ignored' };
    }

    // 2b. Sanitize payload before persistence (Req 18.3). Strip control chars
    //     from the stored/processed content and bound the stored rawPayload so
    //     an abusive payload can neither smuggle control sequences nor bloat the
    //     database. Mutating `normalized` here means every downstream
    //     persistence path (saveInboundMessage / backfillInboundProvenance /
    //     persistOutbound) stores the sanitized values.
    normalized.content = sanitizeText(normalized.content);
    normalized.rawPayload = boundRawPayload(normalized.rawPayload);

    // 3. Idempotency check on (externalMessageId, instanceName) (Req 7.1–7.3).
    if (
      normalized.externalMessageId !== null &&
      (await this.isDuplicate(normalized.externalMessageId, instanceName))
    ) {
      await this.finalizeWebhookLog(webhookLogId, {
        eventType: 'duplicate',
        instanceName,
        externalMessageId: normalized.externalMessageId,
        phone,
        processed: true,
        error: 'duplicate idempotency key',
      });
      this.logger.debug(
        `Duplicate inbound ignored (externalMessageId=${normalized.externalMessageId})`,
      );
      return { httpStatus: 200, action: 'duplicate' };
    }

    // 3a. Per-phone rate limiting (Req 18.5). Excess inbound from a single phone
    //     is logged to webhook_logs and dropped WITHOUT engine invocation or
    //     lead/conversation resolution.
    if (!this.rateLimiter.tryConsume(phone)) {
      await this.finalizeWebhookLog(webhookLogId, {
        eventType: 'rate_limited',
        instanceName,
        externalMessageId: normalized.externalMessageId,
        phone,
        processed: true,
        error: 'per-phone rate limit exceeded',
      });
      this.logger.warn(`Inbound rate-limited (phone=${phone})`);
      return { httpStatus: 200, action: 'ignored' };
    }

    // Accumulate structured per-message metrics for the single log line emitted
    // on the text reply path (Req 22.1).
    const metrics: MessageMetrics = {
      conversationId: null,
      leadId: null,
      channel: WHATSAPP_CHANNEL,
      phone,
      instanceName,
      usedLocalRule: null,
      usedLLM: null,
      usedFallback: false,
      responseMs: null,
      llmMs: null,
      evolutionSendMs: null,
      error: null,
    };

    try {
      // 4. Resolve lead + conversation (SEAM: refined by task 6.2).
      const context = await this.resolveLeadAndConversation(normalized);
      metrics.conversationId = context.conversation.id;
      metrics.leadId = context.leadId;

      // 4b. Typed control commands (/clear, /reset, /help, unknown slash token)
      //     execute REGARDLESS of gating. They are control actions, not
      //     conversational replies, so a paused bot (or a completed-handoff
      //     conversation) must still honor them — otherwise a user could never
      //     reset/clear a conversation from WhatsApp once it was paused.
      if (normalized.messageType === 'text') {
        const command = resolveCommand(normalized.content);
        if (command.isCommand) {
          return this.handleControlCommand(webhookLogId, normalized, context, command);
        }
      }

      // 4b. Áudio: tenta TRANSCREVER (Groq Whisper) e seguir o fluxo como se
      //     fosse texto, pra o agente "ouvir" o cliente. Em qualquer falha
      //     (sem chave, download/transcrição falhou) segue como mídia não
      //     suportada — o cliente recebe o aviso de texto, nada quebra.
      if (normalized.messageType === 'audio') {
        if (!this.transcription.isEnabled) {
          this.logger.warn(
            'Audio recebido, mas transcricao DESABILITADA (GROQ_API_KEY ausente na env do servico api).',
          );
        } else {
          const transcript = await this.transcribeInboundAudio(normalized);
          if (transcript) {
            this.logger.log(
              `Audio transcrito (${transcript.length} chars), seguindo o fluxo como texto.`,
            );
            normalized = { ...normalized, content: transcript, messageType: 'text' };
          }
        }
      }

      // 5. Unsupported media (audio/image/document): save + single notice
      //    (Req 6.6).
      if (normalized.messageType !== 'text') {
        return this.handleUnsupportedMedia(
          webhookLogId,
          normalized,
          context,
        );
      }

      // 6. Gating (Req 10.1, 10.2, 10.4). Save inbound, never run the engine;
      //    only handoff_completed produces the fixed confirmation reply.
      const gating = this.applyGating(context);
      if (gating !== null) {
        return this.handleGated(webhookLogId, normalized, context, gating);
      }

      // 7. Truncate content to the first MAX_CONTENT_LENGTH chars (Req 6.7/6.8).
      const content = this.truncateContent(normalized.content);

      // 7b. Debounce window (humanized replies): when enabled, buffer this
      //     message and (re)start the quiet-window timer so rapid successive
      //     messages are concatenated into ONE engine turn. The reply is
      //     produced asynchronously when the window settles. The webhook
      //     returns immediately. Disabled (=0) preserves the per-message path.
      if (this.config.messageDebounceMs > 0) {
        return this.enqueueDebounced(webhookLogId, normalized, context, content);
      }

      // 8. Invoke the frozen engine with a hard timeout (Req 9.2, 23.2).
      const invocation = await this.invokeEngineWithTimeout(
        context.conversation.id,
        content,
      );

      // 9. Back-fill WhatsApp provenance onto the engine-created inbound row.
      await this.backfillInboundProvenance(context.conversation.id, normalized);
      await this.recordBotEvent('message_inbound_saved', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { externalMessageId: normalized.externalMessageId },
      });

      // Encerramento silencioso: o engine pediu para NÃO responder (um "ok/
      // beleza" repetido após o handoff). O inbound já foi salvo; finaliza sem
      // enviar nada — o bot não fica repetindo a despedida.
      if (invocation.status === 'silent') {
        await this.finalizeWebhookLog(webhookLogId, {
          eventType: 'silent_close',
          instanceName,
          externalMessageId: normalized.externalMessageId,
          phone,
          processed: true,
          error: null,
        });
        this.emitMessageLog(metrics, processStart);
        return { httpStatus: 200, action: 'ignored' };
      }

      // 10. Determine the reply text (engine reply or contextual fallback).
      let reply: string;
      let outboundMessageId: string | null = null;
      if (invocation.status === 'ok') {
        reply = invocation.reply;
        outboundMessageId = invocation.outboundMessageId;
      } else {
        // Timeout or engine error: use the short contextual fallback and never
        // expose technical details to the client (Req 23.2, 23.3, 23.4). The
        // failure is audited as an evolution_error Bot_Event; the fallback text
        // is persisted as an outbound Message by persistOutbound below (the
        // null outboundMessageId branch creates the row).
        reply = CONTEXTUAL_FALLBACK;
        metrics.usedFallback = true;
        metrics.error = `engine ${invocation.reason}`;
        await this.recordBotEvent('evolution_error', {
          conversationId: context.conversation.id,
          leadId: context.leadId,
          payload: { stage: 'engine_invocation', reason: invocation.reason },
        });
      }

      // 11. Send the reply through the WhatsApp channel adapter, measuring the
      //     outbound Evolution send latency (Req 22.1: evolutionSendMs).
      const sendStart = Date.now();
      const sent = await this.sendReply(phone, reply, instanceName, context.conversation.id);
      metrics.evolutionSendMs = Date.now() - sendStart;
      if (!sent) {
        // Evolution send failure → keep state, record event, still 200 (Req 9.6).
        metrics.error = metrics.error ?? 'evolution send failed';
        await this.recordBotEvent('evolution_error', {
          conversationId: context.conversation.id,
          leadId: context.leadId,
          payload: { phone, stage: 'send_reply' },
        });
        await this.finalizeWebhookLog(webhookLogId, {
          eventType: 'send_failed',
          instanceName,
          externalMessageId: normalized.externalMessageId,
          phone,
          processed: true,
          error: 'evolution send failed',
        });
        this.emitMessageLog(metrics, processStart);
        return { httpStatus: 200, action: 'error' };
      }

      // 12. Persist outbound provenance + delivery status (Req 9.4).
      await this.persistOutbound(outboundMessageId, normalized, reply, context);
      await this.recordBotEvent('message_outbound_sent', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { phone },
      });

      // 13. Handoff acceptance side-effects (task 8.1) + internal admin summary
      //     delivery / Dashboard alert (task 8.2).
      if (invocation.status === 'ok') {
        await this.applyHandoffSideEffects(context, invocation.qualification);
      }

      await this.finalizeWebhookLog(webhookLogId, {
        eventType: 'replied',
        instanceName,
        externalMessageId: normalized.externalMessageId,
        phone,
        processed: true,
        error: null,
      });
      this.emitMessageLog(metrics, processStart);
      return { httpStatus: 200, action: 'replied' };
    } catch (error) {
      // Treat unique-constraint races (Prisma P2002) on the idempotency index as
      // duplicates (design "Lead/Conversation Resolution"; Req 7).
      if (this.isUniqueConstraintRace(error)) {
        await this.finalizeWebhookLog(webhookLogId, {
          eventType: 'duplicate',
          instanceName,
          externalMessageId: normalized.externalMessageId,
          phone,
          processed: true,
          error: 'unique constraint race treated as duplicate',
        });
        this.logger.debug('Unique-constraint race treated as duplicate');
        return { httpStatus: 200, action: 'duplicate' };
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Filtering / idempotency
  // -------------------------------------------------------------------------

  /**
   * Handle a normalizer rejection: record the webhook outcome and produce no
   * reply (Req 6.2–6.5). Malformed bodies are still 200 here; controller-level
   * body validation returns 400 (task 6.4).
   */
  private async handleReject(
    webhookLogId: string,
    reject: NormalizationReject,
  ): Promise<ProcessOutcome> {
    await this.finalizeWebhookLog(webhookLogId, {
      eventType: `rejected:${reject.reason}`,
      instanceName: null,
      externalMessageId: null,
      phone: null,
      processed: true,
      error: reject.detail,
    });
    this.logger.debug(`Inbound rejected (${reject.reason}): ${reject.detail}`);
    return { httpStatus: 200, action: 'ignored' };
  }

  /**
   * Returns true when a Message already exists for the given idempotency key.
   */
  private async isDuplicate(
    externalMessageId: string,
    instanceName: string | null,
  ): Promise<boolean> {
    const existing = await this.prisma.message.findFirst({
      where: { externalMessageId, instanceName },
      select: { id: true },
    });
    return existing !== null;
  }

  // -------------------------------------------------------------------------
  // Lead / conversation resolution (task 6.2)
  // -------------------------------------------------------------------------

  /**
   * Refined by **task 6.2**.
   *
   * Create-or-reuse the Lead (by sender phone, Req 8.1/8.2) and the active
   * WhatsApp Conversation (by `(leadId, channel='whatsapp', instanceName,
   * status='active')`, Req 8.3/8.4), then set the Lead name from `contactName`
   * **only when unset** (Req 8.5), swallowing any storage failure so processing
   * continues (Req 8.6).
   *
   * Both create-or-reuse steps are race-safe where reasonable: a concurrent
   * webhook for the same sender may create the Lead/Conversation between our
   * lookup and our insert. We catch the unique-constraint race (Prisma P2002)
   * and re-read the now-existing row so two near-simultaneous first messages
   * still converge on a single Lead and a single active Conversation.
   */
  private async resolveLeadAndConversation(
    inbound: InboundMessage,
  ): Promise<ResolvedContext> {
    const lead = await this.resolveLead(inbound);

    // Set the Lead name from contactName when unset (Req 8.5). Failures are
    // swallowed so processing always continues (Req 8.6).
    await this.assignContactNameIfUnset(lead, inbound);

    const conversation = await this.resolveActiveConversation(lead.id, inbound);

    return {
      leadId: lead.id,
      conversation: {
        id: conversation.id,
        botPaused: conversation.botPaused,
        handoffCompleted: conversation.handoffCompleted,
      },
    };
  }

  /**
   * Create-or-reuse a Lead keyed by sender phone (Req 8.1, 8.2).
   *
   * Reuses an existing Lead when one is found. Otherwise it creates one, and if
   * a concurrent request wins the race (P2002), it re-reads the existing Lead so
   * callers always receive a single canonical Lead for the phone number.
   */
  private async resolveLead(
    inbound: InboundMessage,
  ): Promise<{ id: string; name: string | null }> {
    const phone = inbound.from;

    const existing = await this.prisma.lead.findFirst({
      where: { phone },
      select: { id: true, name: true },
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.lead.create({
        data: {
          name: inbound.contactName ?? phone,
          phone,
          status: 'novo',
        },
        select: { id: true, name: true },
      });
    } catch (err) {
      // A concurrent webhook may have created the Lead first; re-read it.
      if (this.isUniqueConstraintRace(err)) {
        const raced = await this.prisma.lead.findFirst({
          where: { phone },
          select: { id: true, name: true },
        });
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /**
   * Store `contactName` as the Lead name only when the current name is unset
   * (Req 8.5). Any failure is logged and swallowed so the inbound message keeps
   * being processed (Req 8.6).
   */
  private async assignContactNameIfUnset(
    lead: { id: string; name: string | null },
    inbound: InboundMessage,
  ): Promise<void> {
    const contactName = inbound.contactName?.trim();
    if (!contactName || !this.isLeadNameUnset(lead.name, inbound.from)) {
      return;
    }

    try {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { name: contactName },
      });
      lead.name = contactName;
    } catch (err) {
      // Req 8.6: storing the contactName must never abort processing.
      this.logger.warn(
        `Failed to set lead name from contactName: ${this.errMsg(err)}`,
      );
    }
  }

  /**
   * Create-or-reuse the active WhatsApp Conversation for a Lead, scoped by
   * `(leadId, channel='whatsapp', instanceName, status='active')` (Req 8.3,
   * 8.4).
   *
   * Reuses the existing active Conversation when present. Otherwise it creates
   * one, and on a concurrent-create race (P2002) re-reads the active
   * Conversation so a single active WhatsApp Conversation is maintained per
   * `(lead, instance)`.
   */
  private async resolveActiveConversation(
    leadId: string,
    inbound: InboundMessage,
  ): Promise<{ id: string; botPaused: boolean; handoffCompleted: boolean }> {
    const where = {
      leadId,
      channel: WHATSAPP_CHANNEL,
      instanceName: inbound.instance,
      status: 'active',
    };
    const select = { id: true, botPaused: true, handoffCompleted: true };

    const existing = await this.prisma.conversation.findFirst({
      where,
      select,
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.conversation.create({
        data: {
          leadId,
          channel: WHATSAPP_CHANNEL,
          instanceName: inbound.instance,
          externalChatId: inbound.from,
          stage: 'abertura',
          status: 'active',
          handoffRequired: false,
        },
        select,
      });
    } catch (err) {
      if (this.isUniqueConstraintRace(err)) {
        const raced = await this.prisma.conversation.findFirst({
          where,
          select,
        });
        if (raced) {
          return raced;
        }
      }
      throw err;
    }
  }

  /** True when the lead's name is unset or is just the phone placeholder. */
  private isLeadNameUnset(name: string | null, phone: string): boolean {
    if (!name) {
      return true;
    }
    const trimmed = name.trim();
    return trimmed.length === 0 || trimmed === phone;
  }

  // -------------------------------------------------------------------------
  // Gating, unsupported media, timeout fallback (task 6.3)
  // -------------------------------------------------------------------------

  /**
   * Decide whether auto-reply is gated. Gating blocks engine invocation while
   * still saving the inbound message (Req 10.1, 10.2, 10.4). Returns the gating
   * reason, or `null` when the bot is allowed to reply.
   *
   * Order is intentional: a globally disabled bot (`auto_reply_disabled`) takes
   * precedence over a per-conversation pause, which takes precedence over a
   * completed handoff. Only `handoff_completed` produces a reply (the fixed
   * confirmation); see {@link handleGated}.
   */
  private applyGating(context: ResolvedContext): GatingReason {
    if (!this.config.botAutoReplyEnabled) {
      return 'auto_reply_disabled';
    }
    if (context.conversation.botPaused) {
      return 'bot_paused';
    }
    // Handoff concluído NÃO silencia mais o bot: ele segue respondendo dúvidas
    // do cliente até um humano ASSUMIR de fato (o /assumir do inbox seta
    // botPaused). Antes, qualquer mensagem após o encaminhamento recebia só a
    // confirmação fixa, deixando o cliente preso.
    return null;
  }

  /**
   * Handle a gated conversation: save the inbound message itself (the engine is
   * never invoked) and suppress the automatic diagnosis reply.
   *
   * Reply behaviour by reason (Req 10.1, 10.2, 10.4):
   *   - `auto_reply_disabled` / `bot_paused` → save inbound, send NOTHING.
   *   - `handoff_completed` → save inbound and, because a reply is needed, send
   *     ONLY the fixed {@link HANDOFF_COMPLETED_CONFIRMATION} (no diagnosis is
   *     continued), recording a `message_outbound_sent` Bot_Event on success.
   */
  private async handleGated(
    webhookLogId: string,
    inbound: InboundMessage,
    context: ResolvedContext,
    reason: Exclude<GatingReason, null>,
  ): Promise<ProcessOutcome> {
    await this.saveInboundMessage(context.conversation.id, inbound);
    await this.recordBotEvent('message_inbound_saved', {
      conversationId: context.conversation.id,
      leadId: context.leadId,
      payload: { gated: reason },
    });

    // Only handoff-completed conversations get a reply, and it is exactly the
    // fixed confirmation message (Req 10.4). The other gating reasons stay
    // silent (Req 10.1, 10.2).
    if (reason === 'handoff_completed') {
      await this.sendGatedConfirmation(inbound, context);
    }

    await this.finalizeWebhookLog(webhookLogId, {
      eventType: `gated:${reason}`,
      instanceName: inbound.instance,
      externalMessageId: inbound.externalMessageId,
      phone: inbound.from,
      processed: true,
      error: null,
    });
    this.logger.debug(`Inbound gated (${reason})`);
    return { httpStatus: 200, action: 'gated' };
  }

  /**
   * Send the single fixed handoff-completed confirmation and persist it as an
   * outbound Message (Req 10.4). A send failure is recorded as an
   * `evolution_error` Bot_Event and otherwise tolerated — the conversation and
   * inbound Message are kept and the webhook still returns 200 (Req 9.6).
   */
  private async sendGatedConfirmation(
    inbound: InboundMessage,
    context: ResolvedContext,
  ): Promise<void> {
    const sent = await this.sendReply(
      inbound.from,
      HANDOFF_COMPLETED_CONFIRMATION,
      inbound.instance,
      context.conversation.id,
    );
    if (sent) {
      await this.persistOutbound(
        null,
        inbound,
        HANDOFF_COMPLETED_CONFIRMATION,
        context,
      );
      await this.recordBotEvent('message_outbound_sent', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { handoffCompletedConfirmation: true },
      });
    } else {
      await this.recordBotEvent('evolution_error', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { phone: inbound.from, stage: 'handoff_completed_confirmation' },
      });
    }
  }

  /**
   * Handle a typed control command (`/clear`, `/reset`, `/help`, or an unknown
   * slash token) received over WhatsApp.
   *
   * Control commands bypass bot gating on purpose (Inbound gating is for
   * conversational auto-replies, not control actions): a paused or
   * handoff-completed conversation must still be resettable from WhatsApp.
   *
   *  - `/clear` and `/reset` → wipe the conversation messages/analyses and reset
   *    the lead to its initial state via the frozen engine's
   *    {@link ConversationService.clearConversation}, then send ONLY the fresh
   *    greeting (already persisted by `clearConversation`). Both map to
   *    `clearConversation` so the SAME WhatsApp conversation is reused —
   *    `createConversation`/`resetConversation` would create a playground
   *    conversation, which is wrong for the WhatsApp channel.
   *  - `/help` / unknown slash token → reply with the available-commands listing
   *    without changing any state (inbound + outbound are persisted normally).
   *
   * The engine is never invoked for a command, so no `agentAnalysis.runAsync`
   * fires here. A send failure is tolerated (the state change still stands) and
   * the webhook still returns 200 (Req 9.6).
   */
  private async handleControlCommand(
    webhookLogId: string,
    inbound: InboundMessage,
    context: ResolvedContext,
    command: CommandResolution,
  ): Promise<ProcessOutcome> {
    let reply: string;
    let eventType: string;

    if (command.action === 'clear' || command.action === 'reset') {
      // Drop any pending debounced messages for this conversation: it is about
      // to be wiped, so buffered (not-yet-processed) messages are discarded.
      this.cancelDebounce(context.conversation.id);
      // Full wipe + lead reset. `clearConversation` deletes prior messages and
      // analyses, resets the lead/conversation, and creates the fresh greeting
      // (persisted), returning the refreshed conversation.
      const cleared = (await this.conversationService.clearConversation(
        context.conversation.id,
      )) as { messages?: Array<{ content: string }> };
      const messages = cleared.messages ?? [];
      reply =
        messages[messages.length - 1]?.content ?? command.confirmationReply;
      eventType = `command:${command.action}`;

      // The greeting is already persisted by clearConversation; only deliver it.
      const sent = await this.sendReply(
        inbound.from,
        reply,
        inbound.instance,
        context.conversation.id,
      );
      await this.recordBotEvent(sent ? 'message_outbound_sent' : 'evolution_error', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { command: command.action, ...(sent ? {} : { stage: 'command_reply' }) },
      });
    } else {
      // `/help` or an unknown slash token: list the available commands, no state
      // change. Persist the inbound + outbound like a normal turn.
      reply = command.confirmationReply;
      eventType = command.name ? `command:${command.name}` : 'command:unknown';

      await this.saveInboundMessage(context.conversation.id, inbound);
      const sent = await this.sendReply(
        inbound.from,
        reply,
        inbound.instance,
        context.conversation.id,
      );
      if (sent) {
        await this.persistOutbound(null, inbound, reply, context);
        await this.recordBotEvent('message_outbound_sent', {
          conversationId: context.conversation.id,
          leadId: context.leadId,
          payload: { command: eventType },
        });
      } else {
        await this.recordBotEvent('evolution_error', {
          conversationId: context.conversation.id,
          leadId: context.leadId,
          payload: { phone: inbound.from, stage: 'command_reply' },
        });
      }
    }

    await this.finalizeWebhookLog(webhookLogId, {
      eventType,
      instanceName: inbound.instance,
      externalMessageId: inbound.externalMessageId,
      phone: inbound.from,
      processed: true,
      error: null,
    });
    this.logger.debug(`Inbound control command handled (${eventType})`);
    return { httpStatus: 200, action: 'replied' };
  }

  /**
   * Baixa o áudio da Evolution e transcreve via Groq Whisper. Retorna o texto
   * transcrito, ou `null` quando não há áudio recuperável / a transcrição falha
   * (o chamador então trata como mídia não suportada). Totalmente tolerante a
   * erro — nunca lança.
   */
  private async transcribeInboundAudio(
    inbound: InboundMessage,
  ): Promise<string | null> {
    try {
      const data = (
        inbound.rawPayload as
          | {
              data?: {
                key?: { id?: string; remoteJid?: string; fromMe?: boolean };
                message?: { audioMessage?: { mimetype?: string } };
              };
            }
          | undefined
      )?.data;
      const key = data?.key;
      const message = data?.message;
      if (!key?.id) {
        this.logger.warn('Audio: sem message key no payload — abortando transcricao.');
        return null;
      }

      // O endpoint da Evolution descriptografa o .enc; passamos a mensagem
      // INTEIRA (key + message), não só a key, pra cobrir os casos em que o
      // store não tem a midia em cache.
      const media = await this.evolution.getMediaBase64({ key, message });
      if (!media.ok) {
        this.logger.warn(`Audio: download da midia falhou — ${media.error}`);
        return null;
      }
      if (!media.data.base64) {
        this.logger.warn('Audio: download retornou base64 vazio.');
        return null;
      }

      const mimetype =
        media.data.mimetype ||
        data?.message?.audioMessage?.mimetype ||
        'audio/ogg';
      const text = await this.transcription.transcribe(
        media.data.base64,
        mimetype,
      );
      if (!text) {
        this.logger.warn('Audio: transcricao do Groq voltou vazia.');
        return null;
      }
      return text;
    } catch (err) {
      this.logger.warn(
        `Audio transcription pipeline error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Save the inbound media message and send exactly one notice that only text
   * is supported (Req 6.6). The engine is never invoked for media. The notice
   * is sent once and, on success, persisted as an outbound Message and recorded
   * as a `message_outbound_sent` Bot_Event; a send failure is recorded as an
   * `evolution_error` Bot_Event and otherwise tolerated (Req 9.6).
   */
  private async handleUnsupportedMedia(
    webhookLogId: string,
    inbound: InboundMessage,
    context: ResolvedContext,
  ): Promise<ProcessOutcome> {
    await this.saveInboundMessage(context.conversation.id, inbound);
    await this.recordBotEvent('message_inbound_saved', {
      conversationId: context.conversation.id,
      leadId: context.leadId,
      payload: { messageType: inbound.messageType },
    });

    // Exactly one outbound notice (Req 6.6). Sent here and nowhere else on this
    // path, so there is no double-send.
    const sent = await this.sendReply(
      inbound.from,
      UNSUPPORTED_MEDIA_NOTICE,
      inbound.instance,
      context.conversation.id,
    );
    if (sent) {
      await this.persistOutbound(null, inbound, UNSUPPORTED_MEDIA_NOTICE, context);
      await this.recordBotEvent('message_outbound_sent', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { unsupportedMediaNotice: true },
      });
    } else {
      await this.recordBotEvent('evolution_error', {
        conversationId: context.conversation.id,
        leadId: context.leadId,
        payload: { phone: inbound.from, stage: 'unsupported_media_notice' },
      });
    }

    await this.finalizeWebhookLog(webhookLogId, {
      eventType: `unsupported:${inbound.messageType}`,
      instanceName: inbound.instance,
      externalMessageId: inbound.externalMessageId,
      phone: inbound.from,
      processed: true,
      error: null,
    });
    return { httpStatus: 200, action: 'unsupported' };
  }

  // -------------------------------------------------------------------------
  // Message debounce + typing indicator (humanized replies)
  // -------------------------------------------------------------------------

  /**
   * Buffer an inbound text message for the conversation and (re)start the quiet
   * window. Successive messages within {@link AppConfigService.messageDebounceMs}
   * are concatenated into a single turn (deduped by externalMessageId). A
   * "digitando..." presence is sent immediately so the client sees the agent is
   * reading. The webhook returns right away; the reply is produced later by
   * {@link flushDebouncedTurn}.
   */
  private async enqueueDebounced(
    webhookLogId: string,
    inbound: InboundMessage,
    context: ResolvedContext,
    content: string,
  ): Promise<ProcessOutcome> {
    const conversationId = context.conversation.id;
    const debounceMs = this.config.messageDebounceMs;
    const existing = this.debounceBuffers.get(conversationId);

    if (existing) {
      const isDup =
        inbound.externalMessageId !== null &&
        existing.items.some(
          (item) => item.externalMessageId === inbound.externalMessageId,
        );
      if (!isDup) {
        existing.items.push({
          content,
          externalMessageId: inbound.externalMessageId,
        });
      }
      existing.lastInbound = inbound;
      if (existing.timer) {
        clearTimeout(existing.timer);
      }
      existing.timer = setTimeout(() => {
        void this.flushDebouncedTurn(conversationId);
      }, debounceMs);
    } else {
      const buffer: BufferedTurn = {
        conversationId,
        leadId: context.leadId,
        phone: inbound.from,
        instanceName: inbound.instance,
        items: [{ content, externalMessageId: inbound.externalMessageId }],
        lastInbound: inbound,
        timer: null,
        firstQueuedAt: Date.now(),
      };
      buffer.timer = setTimeout(() => {
        void this.flushDebouncedTurn(conversationId);
      }, debounceMs);
      this.debounceBuffers.set(conversationId, buffer);
    }

    // Show "digitando..." immediately (fire-and-forget).
    void this.sendTypingIndicator(inbound.from);

    await this.finalizeWebhookLog(webhookLogId, {
      eventType: 'buffered',
      instanceName: inbound.instance,
      externalMessageId: inbound.externalMessageId,
      phone: inbound.from,
      processed: true,
      error: null,
    });
    const count = this.debounceBuffers.get(conversationId)?.items.length ?? 1;
    this.logger.debug(
      `Inbound buffered for debounce (conv=${conversationId}, items=${count})`,
    );
    return { httpStatus: 200, action: 'replied' };
  }

  /**
   * Cancel any pending debounce buffer for a conversation (e.g. on /clear or
   * /reset, which wipe the conversation — buffered messages must be dropped).
   */
  private cancelDebounce(conversationId: string): void {
    const buffer = this.debounceBuffers.get(conversationId);
    if (buffer) {
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      this.debounceBuffers.delete(conversationId);
    }
  }

  /**
   * Flush a settled debounce buffer: concatenate the buffered messages into one
   * turn, invoke the engine once, simulate typing, and deliver a single reply.
   * Runs from a timer callback (outside the webhook request); all errors are
   * caught so a flush failure never crashes the process.
   *
   * Re-gates at flush time: if the conversation became paused or
   * handoff-completed during the window, the combined inbound is persisted but
   * no automatic reply is sent (mirrors {@link applyGating}).
   */
  private async flushDebouncedTurn(conversationId: string): Promise<void> {
    const buffer = this.debounceBuffers.get(conversationId);
    if (!buffer) {
      return;
    }
    this.debounceBuffers.delete(conversationId);

    try {
      const combined = this.truncateContent(
        buffer.items
          .map((item) => item.content)
          .join('\n')
          .trim(),
      );
      if (!combined) {
        return;
      }

      // Re-gate: the conversation may have been paused / handed off mid-window.
      const current = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { botPaused: true, handoffCompleted: true },
      });
      if (!this.config.botAutoReplyEnabled || current?.botPaused) {
        await this.saveCombinedInbound(buffer, combined);
        this.logger.debug(
          `Debounced turn dropped (gated) for conversation ${conversationId}`,
        );
        return;
      }

      // Invoke the frozen engine ONCE with the combined content.
      const invocation = await this.invokeEngineWithTimeout(conversationId, combined);

      // Stamp WhatsApp provenance onto the engine-created (combined) inbound row.
      await this.backfillInboundProvenance(conversationId, buffer.lastInbound);
      await this.recordBotEvent('message_inbound_saved', {
        conversationId,
        leadId: buffer.leadId,
        payload: {
          buffered: buffer.items.length,
          externalMessageId: buffer.lastInbound.externalMessageId,
        },
      });

      // Encerramento silencioso (ack repetido pós-handoff): o inbound já foi
      // salvo/carimbado acima; finaliza sem enviar nada.
      if (invocation.status === 'silent') {
        return;
      }

      let reply: string;
      let outboundMessageId: string | null = null;
      let qualification: EngineQualification | null = null;
      if (invocation.status === 'ok') {
        reply = invocation.reply;
        outboundMessageId = invocation.outboundMessageId;
        qualification = invocation.qualification;
      } else {
        reply = CONTEXTUAL_FALLBACK;
        await this.recordBotEvent('evolution_error', {
          conversationId,
          leadId: buffer.leadId,
          payload: { stage: 'engine_invocation', reason: invocation.reason },
        });
      }

      // Human-like typing: deliver with a delay so WhatsApp shows "digitando..."
      // for that duration before the message lands (handled natively by the
      // channel via the delay parameter).
      const typingMs = this.computeTypingDelay(reply);
      const sent = await this.sendReply(
        buffer.phone,
        reply,
        buffer.instanceName,
        conversationId,
        typingMs,
      );
      if (!sent) {
        await this.recordBotEvent('evolution_error', {
          conversationId,
          leadId: buffer.leadId,
          payload: { phone: buffer.phone, stage: 'send_reply' },
        });
        return;
      }

      const flushContext: ResolvedContext = {
        leadId: buffer.leadId,
        conversation: {
          id: conversationId,
          botPaused: current?.botPaused ?? false,
          handoffCompleted: current?.handoffCompleted ?? false,
        },
      };
      await this.persistOutbound(outboundMessageId, buffer.lastInbound, reply, flushContext);
      await this.recordBotEvent('message_outbound_sent', {
        conversationId,
        leadId: buffer.leadId,
        payload: { phone: buffer.phone },
      });

      if (qualification) {
        await this.applyHandoffSideEffects(flushContext, qualification);
      }
    } catch (err) {
      this.logger.error(
        `Debounced flush failed for ${conversationId}: ${this.errMsg(err)}`,
      );
    }
  }

  /**
   * Persist the combined buffered content as a single inbound Message when a
   * debounced turn is dropped by gating (so the conversation history is not
   * lost even though no reply is produced).
   */
  private async saveCombinedInbound(
    buffer: BufferedTurn,
    combined: string,
  ): Promise<void> {
    try {
      await this.prisma.message.create({
        data: {
          conversationId: buffer.conversationId,
          role: 'user',
          direction: 'inbound',
          content: combined,
          externalMessageId: buffer.lastInbound.externalMessageId,
          externalChatId: buffer.lastInbound.from,
          instanceName: buffer.lastInbound.instance,
          messageType: buffer.lastInbound.messageType,
          rawPayload: this.toJson(buffer.lastInbound.rawPayload),
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist combined inbound: ${this.errMsg(err)}`);
    }
  }

  /**
   * Send a single "digitando..." (composing) presence to the recipient, where
   * Evolution_API supports it. Best-effort: failures are swallowed.
   */
  private async sendTypingIndicator(to: string): Promise<void> {
    if (!this.config.typingIndicatorEnabled) {
      return;
    }
    try {
      await this.evolution.sendTypingOrPresence(to, this.config.messageDebounceMs);
    } catch (err) {
      this.logger.debug(`Typing presence failed: ${this.errMsg(err)}`);
    }
  }

  /**
   * Compute the human-like typing delay (ms) for a reply, proportional to its
   * length and clamped to [typingMinMs, typingMaxMs]. Returns 0 when the typing
   * indicator is disabled.
   */
  private computeTypingDelay(reply: string): number {
    if (!this.config.typingIndicatorEnabled) {
      return 0;
    }
    return Math.min(
      this.config.typingMaxMs,
      Math.max(this.config.typingMinMs, reply.length * this.config.typingMsPerChar),
    );
  }

  /**
   * Invoke the frozen engine, racing it against {@link ENGINE_TIMEOUT_MS}.
   * Both a timeout and a thrown engine error resolve to `{ status: 'failed' }`
   * (carrying the {@link EngineFailureReason}) so the caller can use the
   * contextual fallback (Req 23.2, 23.3).
   *
   * The Fast_Reply_Budget of 8 seconds (Req 23.1) is a soft *target* for the
   * overall reply latency, not a second hard cutoff — the only hard deadline
   * enforced here is the {@link ENGINE_TIMEOUT_MS} Absolute_Timeout.
   */
  private async invokeEngineWithTimeout(
    conversationId: string,
    content: string,
  ): Promise<EngineInvocation> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<EngineInvocation>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'failed', reason: 'timeout' }),
        ENGINE_TIMEOUT_MS,
      );
    });

    const run = (async (): Promise<EngineInvocation> => {
      try {
        const result = await this.conversationService.handleInboundMessage(
          conversationId,
          content,
        );
        const qualification = {
          shouldHandoff: Boolean(result.qualification?.shouldHandoff),
          status: String(result.qualification?.status ?? ''),
        };
        // Encerramento silencioso: engine não produziu mensagem (não repete a
        // despedida pós-handoff). Sinaliza para o chamador não enviar nada.
        if (!result.message) {
          return { status: 'silent', qualification };
        }
        return {
          status: 'ok',
          reply: result.message.content,
          outboundMessageId: result.message.id,
          qualification,
        };
      } catch (err) {
        this.logger.error(
          `Engine invocation failed for ${conversationId}: ${this.errMsg(err)}`,
        );
        return { status: 'failed', reason: 'error' };
      }
    })();

    try {
      return await Promise.race([run, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Handoff side-effects (task 8.1)
  // -------------------------------------------------------------------------

  /** Terminal Lead status the engine assigns on handoff acceptance. */
  private static readonly HANDOFF_LEAD_STATUS = 'chamar_humano';

  /**
   * Apply production side-effects when the engine reports handoff acceptance
   * (Req 10.3, 11.1, 11.2, 11.3).
   *
   * Acceptance is recognised when the engine qualification has
   * `shouldHandoff === true` OR its `status` is `chamar_humano`. On acceptance:
   *
   *   - Lead → `status = chamar_humano`, `temperature = quente` (Req 11.1).
   *   - Conversation → `handoffAccepted = true`, `handoffCompleted = true`
   *     (Req 11.1), plus `botPaused = true` when `BOT_PAUSE_ON_HANDOFF`
   *     (Req 10.3, 11.2).
   *   - Emit a `handoff_requested` and a `handoff_completed` Bot_Event
   *     (Req 11.3).
   *   - Deliver the internal admin summary to `ADMIN_WHATSAPP_NUMBERS` and
   *     surface the Dashboard handoff alert (Req 11.4–11.7, task 8.2). See
   *     {@link deliverHandoffSummary}.
   *
   * ## Engine monotonicity
   * The frozen engine already drives the Lead/Conversation toward these
   * terminal handoff values; this method only ensures the production-owned
   * side-effects land. Because `chamar_humano`/`quente`/`handoffCompleted` are
   * terminal acceptance states, writing them is idempotent and never downgrades
   * an already-escalated record.
   *
   * ## Re-emit guard
   * A conversation that was ALREADY `handoffCompleted` at resolution time has
   * had these side-effects applied on a prior message, so this method returns
   * early to avoid duplicate `handoff_requested`/`handoff_completed` events on
   * subsequent inbound messages. (In practice such a conversation is gated
   * before the engine runs, so this is a belt-and-suspenders guard.)
   */
  private async applyHandoffSideEffects(
    context: ResolvedContext,
    qualification: EngineQualification,
  ): Promise<void> {
    if (!this.isHandoffAccepted(qualification)) {
      return;
    }

    // Re-emit guard: side-effects + events fire exactly once per conversation.
    if (context.conversation.handoffCompleted) {
      return;
    }

    const { leadId } = context;
    const conversationId = context.conversation.id;

    // Lead escalation (Req 11.1). Setting the terminal acceptance values is
    // monotonic — it never downgrades an already-escalated Lead.
    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: InboundMessageProcessor.HANDOFF_LEAD_STATUS,
        temperature: 'quente',
      },
    });

    // Conversation handoff completion (Req 11.1) + pause-on-handoff
    // (Req 10.3, 11.2).
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        handoffAccepted: true,
        handoffCompleted: true,
        // NÃO pausamos o bot no handoff: ele segue ajudando o cliente com novas
        // dúvidas até um humano assumir pelo inbox (/assumir → botPaused).
      },
    });

    // Keep the in-memory context consistent so any later read in this request
    // sees the completed handoff (and the re-emit guard holds).
    context.conversation.handoffCompleted = true;

    // Lifecycle events (Req 11.3).
    await this.recordBotEvent('handoff_requested', {
      conversationId,
      leadId,
      payload: { status: qualification.status, shouldHandoff: qualification.shouldHandoff },
    });

    // Internal admin summary delivery (Req 11.5–11.7) — task 8.2.
    //
    // Build the internal summary from the Lead (+ latest AgentAnalysis) and send
    // exactly one message per configured ADMIN_WHATSAPP_NUMBERS entry via
    // EvolutionService.sendTextMessage. The admin numbers are operators, never
    // the client, so this summary is delivered ONLY to admins (Req 11.7). When
    // the summary cannot be generated (missing essential data or a thrown
    // error), ALL client/admin communication of the summary is suppressed
    // (Req 11.6) — we send nothing partial and simply continue. The whole
    // delivery is wrapped so that a notification failure never breaks the
    // inbound flow.
    const summarySentTo = await this.deliverHandoffSummary(leadId);

    // Lifecycle + Dashboard handoff alert (Req 11.3, 11.4).
    //
    // There is no separate alerts table; the Dashboard renders the handoff
    // alert from this `handoff_completed` Bot_Event. The payload therefore
    // carries `dashboardAlert: true` plus `summarySentTo` (how many admin
    // numbers received the internal summary) so the Logs/Inbox screens can
    // surface the alert without any additional schema.
    await this.recordBotEvent('handoff_completed', {
      conversationId,
      leadId,
      payload: {
        botPaused: this.config.botPauseOnHandoff,
        dashboardAlert: true,
        summarySentTo,
      },
    });
  }

  /**
   * Build the internal handoff summary from the Lead (+ latest AgentAnalysis)
   * and deliver it to every configured `ADMIN_WHATSAPP_NUMBERS` entry via
   * {@link EvolutionService.sendTextMessage} (Req 11.4–11.7, task 8.2).
   *
   * Returns the number of admin numbers the summary was successfully sent to.
   *
   * Suppression contract (Req 11.6, 11.7):
   *  - The summary is delivered ONLY to the configured admin operators, never to
   *    the client — there is no client send path here.
   *  - If the summary content cannot be generated (essential data missing or any
   *    error while loading/building it), NOTHING is sent (no partial summary) and
   *    `0` is returned.
   *  - The entire operation is guarded so a notification failure never aborts the
   *    inbound flow; per-number send failures are recorded as `evolution_error`
   *    Bot_Events and otherwise tolerated.
   */
  private async deliverHandoffSummary(leadId: string): Promise<number> {
    const adminNumbers = this.config.adminWhatsappNumbers;
    if (adminNumbers.length === 0) {
      // No configured recipients → nothing to deliver (Req 11.5 is gated on a
      // configured list).
      return 0;
    }

    let summaryText: string | null;
    try {
      summaryText = await this.buildHandoffSummary(leadId);
    } catch (err) {
      // Req 11.6: if the summary cannot be generated, suppress ALL summary
      // communication. Log and continue without sending anything.
      this.logger.warn(
        `Handoff summary generation failed; suppressing delivery: ${this.errMsg(err)}`,
      );
      return 0;
    }

    if (summaryText === null) {
      // Essential data missing → suppress delivery (Req 11.6).
      this.logger.warn(
        `Handoff summary unavailable (missing essential data); suppressing delivery for lead ${leadId}`,
      );
      return 0;
    }

    let sentCount = 0;
    for (const adminNumber of adminNumbers) {
      try {
        const result = await this.evolution.sendTextMessage(adminNumber, summaryText);
        if (result.ok) {
          sentCount += 1;
        } else {
          await this.recordBotEvent('evolution_error', {
            conversationId: null,
            leadId,
            payload: { stage: 'admin_handoff_summary', error: result.error },
          });
        }
      } catch (err) {
        // A delivery failure to admins must never break the inbound flow.
        this.logger.error(
          `Failed to send handoff summary to admin: ${this.errMsg(err)}`,
        );
        await this.recordBotEvent('evolution_error', {
          conversationId: null,
          leadId,
          payload: { stage: 'admin_handoff_summary' },
        });
      }
    }

    return sentCount;
  }

  /**
   * Build the internal handoff summary text from the Lead and its latest
   * AgentAnalysis (Req 11.5).
   *
   * The summary includes: telefone, segmento, uso do WhatsApp, dores (main +
   * secondary), volume, sistema citado (omitted when not captured), resumo, and
   * próximo passo. `resumo`/`próximo passo` fall back to the latest analysis
   * (`commercialSummary`/`nextBestQuestion`) when the Lead fields are unset.
   *
   * Returns `null` when essential data is missing (no Lead, or neither a resumo
   * nor a próximo passo can be produced), signalling the caller to suppress all
   * delivery (Req 11.6).
   */
  private async buildHandoffSummary(leadId: string): Promise<string | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        phone: true,
        segment: true,
        whatsappUsage: true,
        mainPain: true,
        secondaryPains: true,
        estimatedVolume: true,
        summary: true,
        nextStep: true,
      },
    });

    if (!lead) {
      // No Lead → cannot build a summary (Req 11.6).
      return null;
    }

    const analysis = await this.prisma.agentAnalysis.findFirst({
      where: { leadId },
      orderBy: { createdAt: 'desc' },
      select: { commercialSummary: true, nextBestQuestion: true },
    });

    const resumo = this.firstNonEmpty(lead.summary, analysis?.commercialSummary);
    const proximoPasso = this.firstNonEmpty(lead.nextStep, analysis?.nextBestQuestion);

    // Essential data: without any resumo or próximo passo the summary would be
    // empty of decision content → suppress (Req 11.6).
    if (resumo === null && proximoPasso === null) {
      return null;
    }

    const dores = this.formatPains(lead.mainPain, lead.secondaryPains);

    const lines: string[] = [
      'Novo handoff DecodificaIA',
      `Telefone: ${lead.phone}`,
      `Segmento: ${this.orNaoInformado(lead.segment)}`,
      `Uso do WhatsApp: ${this.orNaoInformado(lead.whatsappUsage)}`,
      `Dores: ${this.orNaoInformado(dores)}`,
      `Volume: ${this.orNaoInformado(lead.estimatedVolume)}`,
    ];

    // "Sistema citado" is omitted when not captured (no dedicated Lead field
    // exists in the schema; included only WHERE present, per task 8.2).
    const sistemaCitado = this.extractSistemaCitado(lead);
    if (sistemaCitado !== null) {
      lines.push(`Sistema citado: ${sistemaCitado}`);
    }

    lines.push(`Resumo: ${this.orNaoInformado(resumo)}`);
    lines.push(`Próximo passo: ${this.orNaoInformado(proximoPasso)}`);

    return lines.join('\n');
  }

  /**
   * "Sistema citado" — the CRM/ERP/tool the lead mentioned. The frozen schema
   * has no dedicated column for this, so it is omitted (returns `null`) unless a
   * future field is added. Kept as a single seam so the summary builder stays
   * declarative.
   */
  private extractSistemaCitado(_lead: unknown): string | null {
    return null;
  }

  /** Format the combined pains string (main + secondary), or null when none. */
  private formatPains(
    mainPain: string | null,
    secondaryPains: Prisma.JsonValue | null | undefined,
  ): string | null {
    const parts: string[] = [];
    const main = mainPain?.trim();
    if (main) {
      parts.push(main);
    }
    if (Array.isArray(secondaryPains)) {
      for (const pain of secondaryPains) {
        if (typeof pain === 'string' && pain.trim().length > 0) {
          parts.push(pain.trim());
        }
      }
    }
    return parts.length > 0 ? parts.join('; ') : null;
  }

  /** Return the first non-empty trimmed string among the candidates, else null. */
  private firstNonEmpty(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      const trimmed = value?.trim();
      if (trimmed) {
        return trimmed;
      }
    }
    return null;
  }

  /** Render a nullable summary field, defaulting to "não informado". */
  private orNaoInformado(value: string | null): string {
    return value ?? 'não informado';
  }

  /**
   * True when the engine qualification indicates the client accepted handoff:
   * either an explicit `shouldHandoff` flag or a terminal `chamar_humano`
   * status (Req 11.1).
   */
  private isHandoffAccepted(qualification: EngineQualification): boolean {
    return (
      qualification.shouldHandoff ||
      qualification.status === InboundMessageProcessor.HANDOFF_LEAD_STATUS
    );
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  /**
   * Truncate content to the first {@link MAX_CONTENT_LENGTH} characters
   * (Req 6.7); shorter content passes through unchanged (Req 6.8).
   */
  private truncateContent(content: string): string {
    return content.length > MAX_CONTENT_LENGTH
      ? content.slice(0, MAX_CONTENT_LENGTH)
      : content;
  }

  /**
   * Back-fill WhatsApp provenance onto the inbound Message the frozen engine
   * just created (the engine saves it without WhatsApp fields). Targets the
   * most recent inbound row for the conversation that lacks an
   * `externalMessageId`.
   */
  private async backfillInboundProvenance(
    conversationId: string,
    inbound: InboundMessage,
  ): Promise<void> {
    const engineInbound = await this.prisma.message.findFirst({
      where: {
        conversationId,
        direction: 'inbound',
        externalMessageId: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!engineInbound) {
      // Engine did not create an inbound row (unexpected); save one ourselves.
      await this.saveInboundMessage(conversationId, inbound);
      return;
    }

    await this.prisma.message.update({
      where: { id: engineInbound.id },
      data: {
        externalMessageId: inbound.externalMessageId,
        externalChatId: inbound.from,
        instanceName: inbound.instance,
        messageType: inbound.messageType,
        rawPayload: this.toJson(inbound.rawPayload),
      },
    });
  }

  /**
   * Persist outbound provenance + `deliveryStatus` onto the engine-created
   * outbound Message (Req 9.4). When no engine outbound id is available (e.g.
   * the contextual fallback path), create the outbound Message directly.
   */
  private async persistOutbound(
    outboundMessageId: string | null,
    inbound: InboundMessage,
    reply: string,
    context: ResolvedContext,
  ): Promise<void> {
    if (outboundMessageId) {
      await this.prisma.message.update({
        where: { id: outboundMessageId },
        data: {
          externalChatId: inbound.from,
          instanceName: inbound.instance,
          messageType: 'text',
          deliveryStatus: 'sent',
        },
      });
      return;
    }

    await this.prisma.message.create({
      data: {
        conversationId: context.conversation.id,
        role: 'assistant',
        direction: 'outbound',
        content: reply,
        externalChatId: inbound.from,
        instanceName: inbound.instance,
        messageType: 'text',
        deliveryStatus: 'sent',
      },
    });
  }

  /**
   * Save an inbound Message with WhatsApp provenance. Used by the gating,
   * unsupported-media, and fallback paths where the engine is NOT invoked, so
   * the inbound must be persisted by the processor itself (Req 9.1, 10.1, 10.2).
   */
  private async saveInboundMessage(
    conversationId: string,
    inbound: InboundMessage,
  ): Promise<void> {
    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'user',
        direction: 'inbound',
        content: this.truncateContent(inbound.content),
        externalMessageId: inbound.externalMessageId,
        externalChatId: inbound.from,
        instanceName: inbound.instance,
        messageType: inbound.messageType,
        rawPayload: this.toJson(inbound.rawPayload),
      },
    });
  }

  /**
   * Send a reply through the WhatsApp channel adapter. Returns `true` on
   * success, `false` when the adapter (Evolution_Service) reports a send
   * failure — the caller keeps state and still returns 200 (Req 9.6).
   */
  private async sendReply(
    to: string,
    content: string,
    instanceName: string | null,
    conversationId: string,
    delayMs?: number,
  ): Promise<boolean> {
    try {
      await this.channelRegistry.get(WHATSAPP_CHANNEL).sendMessage({
        to,
        content,
        instanceName: instanceName ?? undefined,
        conversationId,
        delayMs,
      });
      return true;
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp reply: ${this.errMsg(err)}`);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Webhook log / bot event helpers
  // -------------------------------------------------------------------------

  /**
   * Create the initial WebhookLog row for this event (processed=false). Updated
   * to its terminal state via {@link finalizeWebhookLog} (Req 9.5).
   */
  private async recordWebhookLog(payload: unknown): Promise<string> {
    const log = await this.prisma.webhookLog.create({
      data: {
        provider: 'evolution',
        payload: this.toJson(payload),
        processed: false,
      },
      select: { id: true },
    });
    return log.id;
  }

  /**
   * Update a WebhookLog row to its terminal classification.
   */
  private async finalizeWebhookLog(
    id: string,
    update: {
      eventType: string;
      instanceName: string | null;
      externalMessageId: string | null;
      phone: string | null;
      processed: boolean;
      error: string | null;
    },
  ): Promise<void> {
    await this.prisma.webhookLog.update({
      where: { id },
      data: {
        eventType: update.eventType,
        instanceName: update.instanceName,
        externalMessageId: update.externalMessageId,
        phone: update.phone,
        processed: update.processed,
        error: update.error,
      },
    });
  }

  /**
   * Record a Bot_Event lifecycle row (Req 22.3–22.5, 19.4/19.5).
   */
  private async recordBotEvent(
    type: BotEventType,
    args: {
      conversationId: string | null;
      leadId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.prisma.botEvent.create({
      data: {
        type,
        conversationId: args.conversationId,
        leadId: args.leadId,
        payload: this.toJson(args.payload),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Structured logging (task 13.1)
  // -------------------------------------------------------------------------

  /**
   * Emit exactly one structured log line per processed WhatsApp message
   * (Requirement 22.1).
   *
   * Fills `responseMs` from `processStart` (total processing time) and logs the
   * full {@link MessageMetrics} as a single JSON object so log aggregators can
   * parse per-message timings/flags. `phone` is included (it is not a secret);
   * if any free-text fields are ever added here, route them through
   * {@link LogScrubberService} first.
   *
   * Engine-internal flags (`usedLocalRule`, `usedLLM`, `llmMs`) are not exposed
   * by the frozen engine and are logged as `null` rather than guessed.
   */
  private emitMessageLog(metrics: MessageMetrics, processStart: number): void {
    metrics.responseMs = Date.now() - processStart;
    this.logger.log(JSON.stringify({ event: 'whatsapp_message', ...metrics }));
  }

  // -------------------------------------------------------------------------
  // Misc helpers
  // -------------------------------------------------------------------------

  /** True when an error is a Prisma unique-constraint violation (P2002). */
  private isUniqueConstraintRace(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  /** Coerce an arbitrary value into a Prisma-safe JSON input value. */
  private toJson(value: unknown): Prisma.InputJsonValue {
    return (value ?? {}) as Prisma.InputJsonValue;
  }

  /** Extract a string message from an unknown thrown value. */
  private errMsg(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
