import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../modules/channels/evolution/evolution.service';

/**
 * Bot_Event lifecycle types emitted from inbox/bot-control actions
 * (Requirements 12.3, 12.4, 13.2, 13.3).
 */
export type InboxBotEventType =
  | 'bot_paused'
  | 'bot_resumed'
  | 'human_message_sent'
  | 'evolution_error';

/**
 * Shape of a single conversation entry in the Inbox list (Requirement 16.1).
 */
export interface InboxListItem {
  conversationId: string;
  leadId: string;
  /** Lead display name, or phone when the name is unset. */
  name: string;
  phone: string;
  lastMessage: {
    content: string;
    direction: string;
    role: string;
    createdAt: Date;
  } | null;
  status: string;
  temperature: string | null;
  leadScore: number | null;
  channel: string;
  /** Bot active/paused state (Requirement 16.1). */
  botPaused: boolean;
  handoff: {
    handoffOffered: boolean;
    handoffAccepted: boolean;
    handoffCompleted: boolean;
  };
  /** Most recent activity timestamp used for ordering and display. */
  lastMessageAt: Date;
}

/**
 * Lead side panel shown in the conversation detail (Requirement 16.3).
 */
export interface LeadPanel {
  id: string;
  name: string;
  phone: string;
  status: string;
  temperature: string | null;
  leadScore: number | null;
  segment: string | null;
  pains: {
    mainPain: string | null;
    secondaryPains: unknown;
  };
  commercialSummary: string | null;
  nextStep: string | null;
}

/**
 * Full conversation detail: chat history + lead side panel + metadata
 * (Requirements 16.2, 16.3).
 */
export interface ConversationDetail {
  conversationId: string;
  channel: string;
  status: string;
  stage: string;
  instanceName: string | null;
  botPaused: boolean;
  assignedTo: string | null;
  handoff: {
    handoffOffered: boolean;
    handoffAccepted: boolean;
    handoffCompleted: boolean;
  };
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  messages: Array<{
    id: string;
    role: string;
    direction: string;
    content: string;
    messageType: string | null;
    createdAt: Date;
  }>;
  lead: LeadPanel;
  /** Metadata describing the actions available on this conversation. */
  actions: {
    canTakeover: boolean;
    canPause: boolean;
    canResume: boolean;
    canMarkConverted: boolean;
    canMarkLost: boolean;
    canSendManual: boolean;
  };
}

/**
 * Read-side service backing the Conversations Inbox.
 *
 * This service only handles listing and detail retrieval (Task 10.1).
 * Mutating actions (takeover, pause/resume, convert/lost, manual send)
 * are implemented in tasks 10.2/10.3; this class is intentionally
 * structured so those methods can be added alongside these read methods.
 */
@Injectable()
export class InboxService {
  private static readonly WHATSAPP_CHANNEL = 'whatsapp';

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * Lists WhatsApp conversations with last message and lead state,
   * ordered by most recent activity (Requirements 16.1, 16.5).
   */
  async list(): Promise<InboxListItem[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: { channel: InboxService.WHATSAPP_CHANNEL },
      include: {
        lead: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const items = conversations.map((conversation): InboxListItem => {
      const lastMessage = conversation.messages[0] ?? null;
      const lastMessageAt = this.resolveLastActivity(
        conversation.lastOutboundAt,
        conversation.lastInboundAt,
        lastMessage?.createdAt ?? null,
        conversation.updatedAt,
      );

      return {
        conversationId: conversation.id,
        leadId: conversation.leadId,
        name: conversation.lead?.name || conversation.lead?.phone || 'Desconhecido',
        phone: conversation.lead?.phone ?? '',
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              direction: lastMessage.direction,
              role: lastMessage.role,
              createdAt: lastMessage.createdAt,
            }
          : null,
        status: conversation.lead?.status ?? conversation.status,
        temperature: conversation.lead?.temperature ?? null,
        leadScore: conversation.lead?.leadScore ?? null,
        channel: conversation.channel,
        botPaused: conversation.botPaused,
        handoff: {
          handoffOffered: conversation.handoffOffered,
          handoffAccepted: conversation.handoffAccepted,
          handoffCompleted: conversation.handoffCompleted,
        },
        lastMessageAt,
      };
    });

    // Order by most recent activity (Requirement 16.1 ordering / 16.5).
    items.sort(
      (a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime(),
    );

    return items;
  }

  /**
   * Returns the full chat plus lead side panel for a conversation
   * (Requirements 16.2, 16.3, 16.6).
   */
  async getDetail(conversationId: string): Promise<ConversationDetail> {
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

    const lead = conversation.lead;
    const latestAnalysis = conversation.agentAnalyses[0] ?? null;

    const leadPanel: LeadPanel = {
      id: lead.id,
      name: lead.name || lead.phone,
      phone: lead.phone,
      status: lead.status,
      temperature: lead.temperature ?? null,
      leadScore: lead.leadScore ?? null,
      segment: lead.segment ?? null,
      pains: {
        mainPain: lead.mainPain ?? latestAnalysis?.mainPain ?? null,
        secondaryPains: lead.secondaryPains ?? null,
      },
      // Commercial summary: prefer the lead summary, fall back to the
      // latest analysis commercial summary (Requirement 16.3).
      commercialSummary:
        lead.summary ?? latestAnalysis?.commercialSummary ?? null,
      // Next step: prefer the lead next step, fall back to the analysis
      // next best question (Requirement 16.3).
      nextStep: lead.nextStep ?? latestAnalysis?.nextBestQuestion ?? null,
    };

    return {
      conversationId: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      stage: conversation.stage,
      instanceName: conversation.instanceName ?? null,
      botPaused: conversation.botPaused,
      assignedTo: conversation.assignedTo ?? null,
      handoff: {
        handoffOffered: conversation.handoffOffered,
        handoffAccepted: conversation.handoffAccepted,
        handoffCompleted: conversation.handoffCompleted,
      },
      lastInboundAt: conversation.lastInboundAt ?? null,
      lastOutboundAt: conversation.lastOutboundAt ?? null,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        direction: message.direction,
        content: message.content,
        messageType: message.messageType ?? null,
        createdAt: message.createdAt,
      })),
      lead: leadPanel,
      actions: {
        canTakeover: !conversation.botPaused,
        canPause: !conversation.botPaused,
        canResume: conversation.botPaused,
        canMarkConverted: true,
        canMarkLost: true,
        canSendManual: true,
      },
    };
  }

  /**
   * Team_Member takes over a Conversation (Requirements 12.1, 12.3, 16.4).
   *
   * Sets `botPaused=true`, assigns the acting Team_Member, and moves the
   * Conversation status to `aguardando_humano` (or `chamar_humano` when the
   * lead is already flagged for human handoff). Records a `bot_paused`
   * Bot_Event.
   */
  async takeover(
    conversationId: string,
    actingUserId: string,
  ): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(conversationId);

    // Preserve the human-handoff signal: if the lead is already flagged as
    // chamar_humano, keep that status rather than downgrading it.
    const status =
      conversation.lead?.status === 'chamar_humano'
        ? 'chamar_humano'
        : 'aguardando_humano';

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        botPaused: true,
        assignedTo: actingUserId,
        status,
      },
    });

    await this.recordBotEvent('bot_paused', {
      conversationId,
      leadId: conversation.leadId,
      payload: { action: 'takeover', actingUserId, status },
    });

    return this.getDetail(conversationId);
  }

  /**
   * Pause the bot for a Conversation (Requirement 12.1, 12.3).
   *
   * Sets `botPaused=true` and records a `bot_paused` Bot_Event. Unlike
   * {@link takeover}, this does not change assignment or status.
   */
  async pauseBot(
    conversationId: string,
    actingUserId: string,
  ): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(conversationId);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { botPaused: true },
    });

    await this.recordBotEvent('bot_paused', {
      conversationId,
      leadId: conversation.leadId,
      payload: { action: 'pause', actingUserId },
    });

    return this.getDetail(conversationId);
  }

  /**
   * Resume the bot for a Conversation (Requirements 12.2, 12.4).
   *
   * Sets `botPaused=false` and records a `bot_resumed` Bot_Event.
   */
  async resumeBot(
    conversationId: string,
    actingUserId: string,
  ): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(conversationId);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { botPaused: false },
    });

    await this.recordBotEvent('bot_resumed', {
      conversationId,
      leadId: conversation.leadId,
      payload: { action: 'resume', actingUserId },
    });

    return this.getDetail(conversationId);
  }

  /**
   * Mark the Conversation's lead as converted (Requirement 16.4).
   */
  async markConverted(
    conversationId: string,
    actingUserId: string,
  ): Promise<ConversationDetail> {
    return this.updateLeadOutcome(conversationId, actingUserId, 'convertido');
  }

  /**
   * Mark the Conversation's lead as lost (Requirement 16.4).
   */
  async markLost(
    conversationId: string,
    actingUserId: string,
  ): Promise<ConversationDetail> {
    return this.updateLeadOutcome(conversationId, actingUserId, 'perdido');
  }

  /**
   * Send a manual message authored by a Team_Member to the client through the
   * Evolution_Service (Requirements 13.1, 13.2, 13.3).
   *
   * On a successful send, persists an outbound Message attributed to the team
   * (`metadata.sentBy`/`metadata.manual`), advances `lastOutboundAt`, and
   * records a `human_message_sent` Bot_Event (Req 13.1, 13.2).
   *
   * On a send failure, records an `evolution_error` Bot_Event and reports the
   * failure to the Team_Member via a {@link BadGatewayException} carrying a
   * safe message; no outbound Message is persisted (Req 13.3).
   */
  async sendManualMessage(
    conversationId: string,
    actingUserId: string,
    content: string,
  ): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(conversationId);
    const phone = conversation.lead?.phone ?? '';
    const instanceName = conversation.instanceName ?? null;

    const result = await this.evolution.sendTextMessage(phone, content);

    if (!result.ok) {
      await this.recordBotEvent('evolution_error', {
        conversationId,
        leadId: conversation.leadId,
        payload: {
          action: 'manual_send',
          actingUserId,
          error: result.error,
        },
      });

      throw new BadGatewayException(
        'Não foi possível enviar a mensagem pelo WhatsApp. Tente novamente.',
      );
    }

    await this.prisma.message.create({
      data: {
        conversationId,
        role: 'assistant',
        direction: 'outbound',
        content,
        externalMessageId: result.data.externalMessageId || null,
        externalChatId: phone,
        instanceName,
        messageType: 'text',
        deliveryStatus: 'sent',
        metadata: { sentBy: actingUserId, manual: true } as Prisma.InputJsonValue,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { lastOutboundAt: new Date() },
    });

    await this.recordBotEvent('human_message_sent', {
      conversationId,
      leadId: conversation.leadId,
      payload: {
        actingUserId,
        externalMessageId: result.data.externalMessageId || null,
      },
    });

    return this.getDetail(conversationId);
  }

  /**
   * Shared implementation for convert/lost lead status updates.
   */
  private async updateLeadOutcome(
    conversationId: string,
    actingUserId: string,
    status: 'convertido' | 'perdido',
  ): Promise<ConversationDetail> {
    const conversation = await this.requireConversation(conversationId);

    await this.prisma.lead.update({
      where: { id: conversation.leadId },
      data: { status },
    });

    return this.getDetail(conversationId);
  }

  /**
   * Loads a conversation (with its lead) or throws {@link NotFoundException}.
   */
  private async requireConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation with id ${conversationId} not found`,
      );
    }

    return conversation;
  }

  /**
   * Record a Bot_Event lifecycle row, mirroring the inbound processor helper
   * (Requirements 12.3, 12.4).
   */
  private async recordBotEvent(
    type: InboxBotEventType,
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
        payload: (args.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Resolves the most recent activity timestamp for ordering, preferring
   * explicit channel activity timestamps over the last stored message.
   */
  private resolveLastActivity(
    lastOutboundAt: Date | null,
    lastInboundAt: Date | null,
    lastMessageAt: Date | null,
    fallback: Date,
  ): Date {
    const candidates = [
      lastOutboundAt,
      lastInboundAt,
      lastMessageAt,
    ].filter((value): value is Date => value instanceof Date);

    if (candidates.length === 0) {
      return fallback;
    }

    return candidates.reduce((latest, current) =>
      current.getTime() > latest.getTime() ? current : latest,
    );
  }
}
