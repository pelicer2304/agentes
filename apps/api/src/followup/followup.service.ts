import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import { ReengagementMessageComposer } from './reengagement-message.composer';
import { FollowUpSender } from './followup-sender.service';
import { FollowUpEventRecorder } from './followup-event.recorder';
import { FOLLOW_UP_EVENT_TYPES, type FollowUpLevel } from './followup.constants';
import {
  computeInactivityAnchor,
  nextPendingLevel,
  nextRunForLevel,
  type LevelOffsetsHours,
} from './followup-scheduling';
import type { ConversationSnapshot } from './followup.types';

/** Nome de agente usado quando nenhuma `AgentSettings` está configurada. */
const DEFAULT_AGENT_NAME = 'Assistente Decodifica';

/** Estados do ciclo de follow-up (espelham a coluna `cycle_state`). */
const CYCLE_STATE = {
  ACTIVE: 'active',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
} as const;

/** Número máximo de tentativas de persistência do agendamento (R1.8). */
const MAX_SCHEDULE_ATTEMPTS = 3;

/** Minutos em um dia, para o cálculo da próxima janela de envio. */
const MINUTES_PER_DAY = 24 * 60;

/** Fuso de referência da janela de envio (coerente com o FollowUpSender). */
const SEND_WINDOW_TIME_ZONE = 'America/Sao_Paulo';

/**
 * Orquestra o ciclo completo de follow-up automático de leads (design.md —
 * seção "FollowUpService"). Coordena os componentes puros e de borda já
 * existentes, mantendo o estado do ciclo durável em `follow_up_schedules` para
 * garantir idempotência e sobrevivência a reinícios (R7).
 *
 * Princípios aplicados aqui:
 *  - **Reavaliação no instante do disparo**: a elegibilidade é sempre
 *    recalculada lendo o snapshot ATUAL de Conversation+Lead no momento exato
 *    do disparo, nunca com dados pré-carregados (R2.3).
 *  - **Marcação atômica e idempotente**: cada nível é marcado como enviado via
 *    `updateMany` condicional (`WHERE max_sent_level < :level`), o que impede
 *    disparos repetidos do mesmo nível (R7.1, R7.2).
 *  - **Degradação graciosa**: o registro de eventos nunca interrompe o
 *    processamento (o `FollowUpEventRecorder` já trata retry e log — R8.4/R8.5).
 *
 * Suposições documentadas:
 *  - O relógio é injetado como `now: Date` nos métodos que dependem de tempo,
 *    para tornar a lógica determinística e testável.
 *  - O `FollowUpSchedulerService` é responsável por reivindicar o lock (lease
 *    de 60s) antes de chamar `processDue` e por liberá-lo ao final; por isso
 *    `processDue` é idempotente e não manipula `lockedUntil`.
 *  - O nome do agente para a composição vem da `AgentSettings` mais recente,
 *    com fallback determinístico ({@link DEFAULT_AGENT_NAME}).
 */
@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: FollowUpEligibilityService,
    private readonly composer: ReengagementMessageComposer,
    private readonly sender: FollowUpSender,
    private readonly recorder: FollowUpEventRecorder,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Garante o agendamento do follow-up de uma Conversation e agenda o Nível 1
   * a partir do `Inactivity_Anchor` (R1.1, R1.2).
   *
   * Lê a Conversation (com o Lead), calcula o anchor via
   * {@link computeInactivityAnchor}. Quando o anchor é `null` (o lead já
   * respondeu após o último outbound do bot) NÃO agenda. Caso contrário, faz
   * upsert da linha em `follow_up_schedules` reiniciando o ciclo no Nível 1.
   */
  async ensureScheduled(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });

    if (!conversation || !conversation.lastOutboundAt) {
      // Sem outbound do bot não há inatividade a ancorar (R1.1).
      return;
    }

    const anchor = computeInactivityAnchor(
      conversation.lastOutboundAt,
      conversation.lastInboundAt,
    );

    if (anchor === null) {
      // Há inbound posterior ao último outbound: nada a agendar (R1.1).
      return;
    }

    const offsets = this.offsets();
    const nextRunAt = nextRunForLevel(anchor, 1, offsets);

    await this.prisma.followUpSchedule.upsert({
      where: { conversationId },
      create: {
        conversationId,
        leadId: conversation.leadId,
        cycleState: CYCLE_STATE.ACTIVE,
        inactivityAnchor: anchor,
        maxSentLevel: 0,
        pendingLevel: 1,
        nextRunAt,
        level3FiredAt: null,
        deferredAttempts: 0,
        lockedUntil: null,
        lastError: null,
      },
      update: {
        cycleState: CYCLE_STATE.ACTIVE,
        inactivityAnchor: anchor,
        maxSentLevel: 0,
        pendingLevel: 1,
        nextRunAt,
        level3FiredAt: null,
        deferredAttempts: 0,
        lockedUntil: null,
        lastError: null,
      },
    });
  }

  /**
   * Processa um schedule vencido já reivindicado pelo Scheduler (lease ativo).
   *
   * Fluxo (R1.5, R1.7, R1.8, R2.2–R2.6, R5.6, R7.1–R7.6, R9.2–R9.6):
   *  1. Reavalia a elegibilidade lendo o snapshot ATUAL no instante do disparo.
   *     Falha de leitura → suprime, mantém pendente, `followup_error`
   *     (`reevaluation_failed`).
   *  2. Não elegível → suprime, marca cancelado (`cycleState=cancelled`),
   *     `followup_cancelled` com o motivo correto.
   *  3. Elegível → compõe (fallback determinístico, sem timeout aqui) e envia.
   *     - `deferred` → incrementa `deferredAttempts`; ao atingir o máximo,
   *       `followup_error` e interrompe o nível; senão reagenda mantendo
   *       pendente sem marcar enviado.
   *     - `failed` → `followup_error` (`evolution_error`), mantém pendente.
   *     - `sent` → marca o nível enviado de forma atômica/idempotente, atualiza
   *       `lastOutboundAt`, `followup_sent`, e agenda o próximo nível ou prepara
   *       o encerramento (Nível 3).
   */
  async processDue(scheduleId: string, now: Date): Promise<void> {
    const schedule = await this.prisma.followUpSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (!schedule || schedule.cycleState !== CYCLE_STATE.ACTIVE) {
      return;
    }

    if (schedule.pendingLevel === null || schedule.pendingLevel === undefined) {
      // Nenhum nível pendente: nada a disparar.
      return;
    }

    const level = schedule.pendingLevel as FollowUpLevel;
    const { conversationId, leadId } = schedule;

    // 1. Reavaliação no instante do disparo lendo o snapshot ATUAL (R2.3).
    let conversation: Awaited<
      ReturnType<typeof this.loadConversationWithLead>
    >;
    try {
      conversation = await this.loadConversationWithLead(conversationId);
    } catch (err) {
      // R2.5 — indisponibilidade dos dados: suprime, mantém pendente.
      this.logger.error(
        `Falha ao reler snapshot da conversa ${conversationId} no disparo: ${this.errMsg(err)}`,
      );
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId,
        leadId,
        level,
        reason: 'reevaluation_failed',
        occurredAt: now,
      });
      return;
    }

    if (!conversation || !conversation.lead) {
      // Snapshot indisponível (conversa/lead ausente) — trata como R2.5.
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId,
        leadId,
        level,
        reason: 'reevaluation_failed',
        occurredAt: now,
      });
      return;
    }

    const lead = conversation.lead;
    const result = this.eligibility.evaluate(this.toSnapshot(conversation, lead));

    // 2. Não elegível: suprime envio, marca cancelado e registra (R2.2/2.4, R4.3).
    if (!result.eligible) {
      try {
        await this.prisma.followUpSchedule.update({
          where: { id: scheduleId },
          data: { pendingLevel: null, cycleState: CYCLE_STATE.CANCELLED },
        });
      } catch (err) {
        // R2.6 — falha ao persistir o cancelamento: preserva o nível pendente,
        // suprime o envio (já suprimido) e registra a falha sem interromper.
        this.logger.error(
          `Falha ao persistir o cancelamento por inelegibilidade (conversa ${conversationId}): ${this.errMsg(err)}`,
        );
        await this.recorder.record({
          type: FOLLOW_UP_EVENT_TYPES.ERROR,
          conversationId,
          leadId,
          level,
          occurredAt: now,
        });
        return;
      }
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.CANCELLED,
        conversationId,
        leadId,
        reason: result.reason ?? 'handoff_humano',
        occurredAt: now,
      });
      return;
    }

    // 3. Elegível: compõe a mensagem (determinística, sempre disponível — R5.6).
    const agentName = await this.resolveAgentName();
    const message = this.composer.compose({
      level,
      segment: lead.segment,
      mainPain: lead.mainPain,
      agentName,
    });

    // Envia respeitando janela e rate-limit (R9).
    const outcome = await this.sender.send({
      phone: lead.phone,
      instanceName: conversation.instanceName,
      conversationId,
      content: message.content,
      now,
    });

    if (outcome.status === 'deferred') {
      await this.handleDeferred(schedule, level, outcome.reason, now);
      return;
    }

    if (outcome.status === 'failed') {
      // R9.4 — falha do Evolution: não marca enviado, mantém pendente.
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId,
        leadId,
        level,
        reason: 'evolution_error',
        occurredAt: now,
      });
      await this.safeUpdate(scheduleId, { lastError: 'evolution_error' });
      return;
    }

    // outcome.status === 'sent'
    await this.handleSent(schedule, level, outcome.sentAt);
  }

  /**
   * Hook de inbound (R3): cancela os níveis pendentes de forma atômica e
   * idempotente e, se a conversa permanece elegível, redefine o
   * `Inactivity_Anchor` para `now` e reinicia o ciclo no Nível 1.
   *
   * No-op quando não há nível pendente (schedule inexistente, ciclo não ativo
   * ou `pendingLevel` nulo): sem evento e sem alteração (R3.4). Idempotente sob
   * reentrância: o cancelamento usa um `updateMany` com guarda por estado, de
   * modo que o segundo processamento concorrente do MESMO inbound não duplica o
   * `followup_cancelled` (R3.6).
   */
  async onInboundReceived(conversationId: string, now: Date): Promise<void> {
    const schedule = await this.prisma.followUpSchedule.findUnique({
      where: { conversationId },
    });

    if (
      !schedule ||
      schedule.cycleState !== CYCLE_STATE.ACTIVE ||
      schedule.pendingLevel === null ||
      schedule.pendingLevel === undefined
    ) {
      // R3.4 — sem nível pendente: no-op (sem evento, sem alteração).
      return;
    }

    const { leadId } = schedule;

    // Cancelamento atômico e idempotente (R3.1, R3.6). A guarda
    // `pendingLevel: { not: null }` garante que apenas a primeira execução
    // efetiva o cancelamento e, portanto, grava exatamente um evento.
    let cancelled: { count: number };
    try {
      cancelled = await this.prisma.followUpSchedule.updateMany({
        where: {
          conversationId,
          cycleState: CYCLE_STATE.ACTIVE,
          pendingLevel: { not: null },
        },
        data: { pendingLevel: null, cycleState: CYCLE_STATE.CANCELLED },
      });
    } catch (err) {
      // R3.5 — falha de persistência: preserva pendentes e registra erro.
      this.logger.error(
        `Falha ao cancelar follow-up por inbound (conversa ${conversationId}): ${this.errMsg(err)}`,
      );
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId,
        leadId,
        occurredAt: now,
      });
      return;
    }

    if (cancelled.count === 0) {
      // Outro processamento concorrente já cancelou: no-op idempotente (R3.6).
      return;
    }

    // R3.3 — exatamente um followup_cancelled com motivo resposta_do_lead.
    await this.recorder.record({
      type: FOLLOW_UP_EVENT_TYPES.CANCELLED,
      conversationId,
      leadId,
      reason: 'resposta_do_lead',
      occurredAt: now,
    });

    // R3.2 — se a conversa permanece elegível, reinicia no Nível 1 a partir de now.
    const conversation = await this.loadConversationWithLead(conversationId);
    if (!conversation || !conversation.lead) {
      return;
    }

    const result = this.eligibility.evaluate(
      this.toSnapshot(conversation, conversation.lead),
    );
    if (!result.eligible) {
      return;
    }

    const offsets = this.offsets();
    await this.prisma.followUpSchedule.update({
      where: { conversationId },
      data: {
        cycleState: CYCLE_STATE.ACTIVE,
        inactivityAnchor: now,
        maxSentLevel: 0,
        pendingLevel: 1,
        nextRunAt: nextRunForLevel(now, 1, offsets),
        level3FiredAt: null,
        deferredAttempts: 0,
        lockedUntil: null,
        lastError: null,
      },
    });
  }

  /**
   * Reage à mudança de status do Lead para `perdido` (R4.2–R4.4): cancela todos
   * os níveis pendentes, não envia nenhuma mensagem e registra um
   * `followup_cancelled` com `conversationId`, `leadId` e motivo `lead_perdido`.
   */
  async onLeadLost(conversationId: string, now: Date): Promise<void> {
    const schedule = await this.prisma.followUpSchedule.findUnique({
      where: { conversationId },
    });

    // Resolve o leadId a partir do schedule ou da própria Conversation.
    let leadId = schedule?.leadId ?? null;
    if (leadId === null) {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { leadId: true },
      });
      leadId = conversation?.leadId ?? null;
    }

    if (leadId === null) {
      // Sem lead identificável: nada a registrar.
      return;
    }

    if (schedule) {
      // Cancela todos os níveis pendentes sem enviar nada (R4.2/4.3).
      await this.prisma.followUpSchedule.update({
        where: { conversationId },
        data: { pendingLevel: null, cycleState: CYCLE_STATE.CANCELLED },
      });
    }

    await this.recorder.record({
      type: FOLLOW_UP_EVENT_TYPES.CANCELLED,
      conversationId,
      leadId,
      reason: 'lead_perdido',
      occurredAt: now,
    });
  }

  /**
   * Encerra o ciclo após a janela de resposta de 24h do Nível 3 sem inbound
   * posterior (R6.1–R6.5).
   *
   * Só encerra quando: o ciclo está ativo, o Nível 3 já foi disparado
   * (`level3FiredAt` definido), passou a janela de conclusão configurada e NÃO
   * houve inbound após o disparo do Nível 3. Caso contrário, não encerra por
   * `ciclo_concluido` (o `onInboundReceived` já terá tratado um inbound dentro
   * da janela — R6.4). Em falha ao registrar o encerramento, o estado
   * `completed` é preservado e o erro é logado pelo recorder (R6.5).
   */
  async completeIfExhausted(scheduleId: string, now: Date): Promise<void> {
    const schedule = await this.prisma.followUpSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (
      !schedule ||
      schedule.cycleState !== CYCLE_STATE.ACTIVE ||
      !schedule.level3FiredAt
    ) {
      return;
    }

    const windowMs = this.config.followUpCompletionWindowHours * 60 * 60 * 1000;
    const elapsed = now.getTime() - schedule.level3FiredAt.getTime();
    if (elapsed <= windowMs) {
      // Ainda dentro da janela de resposta: não encerra (R6.1/6.4).
      return;
    }

    // R6.4 — inbound posterior ao Nível 3 dentro da janela impede o encerramento.
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: schedule.conversationId },
      select: { lastInboundAt: true },
    });
    if (
      conversation?.lastInboundAt &&
      conversation.lastInboundAt.getTime() > schedule.level3FiredAt.getTime()
    ) {
      return;
    }

    // Encerra o ciclo por esgotamento dos níveis (R6.1).
    await this.prisma.followUpSchedule.update({
      where: { id: scheduleId },
      data: { cycleState: CYCLE_STATE.COMPLETED, pendingLevel: null },
    });

    // R6.2/R6.5 — registra o encerramento; o recorder degrada graciosamente.
    await this.recorder.record({
      type: FOLLOW_UP_EVENT_TYPES.COMPLETED,
      conversationId: schedule.conversationId,
      leadId: schedule.leadId,
      occurredAt: now,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Trata o resultado `deferred` do envio (R9.2, R9.3, R9.5): incrementa o
   * contador de tentativas adiadas e, ao atingir o máximo configurado,
   * interrompe o nível registrando o esgotamento; caso contrário, reagenda
   * mantendo o nível pendente sem marcá-lo como enviado.
   */
  private async handleDeferred(
    schedule: { id: string; conversationId: string; leadId: string; deferredAttempts: number },
    level: FollowUpLevel,
    reason: 'out_of_window' | 'rate_limited',
    now: Date,
  ): Promise<void> {
    const attempts = schedule.deferredAttempts + 1;

    // R9.5 — esgotou as tentativas adiadas: registra erro e interrompe o nível.
    if (attempts >= this.config.followUpMaxDeferrals) {
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId: schedule.conversationId,
        leadId: schedule.leadId,
        level,
        occurredAt: now,
      });
      await this.safeUpdate(schedule.id, {
        pendingLevel: null,
        deferredAttempts: attempts,
        lastError: `deferral_exhausted:${reason}`,
      });
      return;
    }

    // Reagenda: início da próxima janela (out_of_window) ou backoff (rate_limited).
    const nextRunAt =
      reason === 'out_of_window'
        ? this.nextSendWindowStart(now)
        : new Date(now.getTime() + this.backoffMs());

    await this.safeUpdate(schedule.id, {
      deferredAttempts: attempts,
      nextRunAt,
      lastError: `deferred:${reason}`,
    });
  }

  /**
   * Trata o resultado `sent` do envio (R7.1, R7.2, R9.6, R1.3/1.4, R6): marca o
   * nível como enviado de forma atômica e idempotente, atualiza o
   * `lastOutboundAt`, registra `followup_sent` e agenda o próximo nível ou
   * prepara o encerramento quando o Nível 3 é disparado.
   */
  private async handleSent(
    schedule: { id: string; conversationId: string; leadId: string; inactivityAnchor: Date },
    level: FollowUpLevel,
    sentAt: Date,
  ): Promise<void> {
    // R7.1/R7.2 — marcação atômica e idempotente do nível enviado.
    const marked = await this.prisma.followUpSchedule.updateMany({
      where: { id: schedule.id, maxSentLevel: { lt: level } },
      data: { maxSentLevel: level, deferredAttempts: 0, lastError: null },
    });

    if (marked.count === 0) {
      // Nível já registrado como enviado: suprime disparo repetido (R7.2).
      return;
    }

    // R9.6 — atualiza o lastOutboundAt da Conversation com o instante do envio.
    await this.safeUpdateConversationOutbound(schedule.conversationId, sentAt);

    // R8.1 — registra o evento de envio.
    await this.recorder.record({
      type: FOLLOW_UP_EVENT_TYPES.SENT,
      conversationId: schedule.conversationId,
      leadId: schedule.leadId,
      level,
      occurredAt: sentAt,
    });

    // Nível 3: prepara o encerramento por completeIfExhausted (R6.1).
    if (level >= 3) {
      await this.safeUpdate(schedule.id, {
        level3FiredAt: sentAt,
        pendingLevel: null,
      });
      return;
    }

    // Níveis 1 e 2: agenda o próximo nível a partir do anchor (R1.3, R1.4).
    const next = nextPendingLevel(level);
    if (next === null) {
      return;
    }

    const nextRunAt = nextRunForLevel(schedule.inactivityAnchor, next, this.offsets());
    const persisted = await this.persistScheduleNext(schedule.id, next, nextRunAt);

    if (!persisted) {
      // R1.8 — esgotadas as tentativas de agendamento: registra erro sem disparar.
      await this.recorder.record({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId: schedule.conversationId,
        leadId: schedule.leadId,
        level,
        reason: 'schedule_failed',
        occurredAt: sentAt,
      });
      // Evita re-disparo do nível já enviado deixando o ciclo sem pendência.
      await this.safeUpdate(schedule.id, { pendingLevel: null, lastError: 'schedule_failed' });
    }
  }

  /**
   * Persiste o agendamento do próximo nível com retry de até
   * {@link MAX_SCHEDULE_ATTEMPTS} tentativas (R1.8). Retorna `true` em sucesso.
   */
  private async persistScheduleNext(
    scheduleId: string,
    next: FollowUpLevel,
    nextRunAt: Date,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < MAX_SCHEDULE_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.followUpSchedule.update({
          where: { id: scheduleId },
          data: { pendingLevel: next, nextRunAt, deferredAttempts: 0 },
        });
        return true;
      } catch (err) {
        this.logger.warn(
          `Falha ao agendar o nível ${next} (schedule ${scheduleId}), tentativa ${attempt + 1}: ${this.errMsg(err)}`,
        );
      }
    }
    return false;
  }

  /** Lê a Conversation com o Lead associado (snapshot do instante do disparo). */
  private loadConversationWithLead(conversationId: string) {
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { lead: true },
    });
  }

  /** Constrói o {@link ConversationSnapshot} a partir dos dados atuais. */
  private toSnapshot(
    conversation: {
      stage: string;
      status: string;
      botPaused: boolean;
      assignedTo: string | null;
      handoffAccepted: boolean;
      handoffCompleted: boolean;
      handoffRequired: boolean;
    },
    lead: { status: string },
  ): ConversationSnapshot {
    return {
      leadStatus: lead.status,
      stage: conversation.stage,
      conversationStatus: conversation.status,
      botPaused: conversation.botPaused,
      assignedTo: conversation.assignedTo,
      handoffAccepted: conversation.handoffAccepted,
      handoffCompleted: conversation.handoffCompleted,
      handoffRequired: conversation.handoffRequired,
    };
  }

  /** Offsets (em horas) dos níveis a partir da configuração (R1.2–R1.4). */
  private offsets(): LevelOffsetsHours {
    return [
      this.config.followUpLevel1Hours,
      this.config.followUpLevel2Hours,
      this.config.followUpLevel3Hours,
    ];
  }

  /** Backoff mínimo (ms) ao reagendar por rate-limit, com piso de 60s (R9.3). */
  private backoffMs(): number {
    return Math.max(this.config.followUpRetryBackoffSeconds, 60) * 1000;
  }

  /**
   * Resolve o nome do agente para a composição, a partir da `AgentSettings`
   * mais recente, com fallback determinístico ({@link DEFAULT_AGENT_NAME}).
   */
  private async resolveAgentName(): Promise<string> {
    try {
      const settings = await this.prisma.agentSettings.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      const name = settings?.agentName?.trim();
      return name && name.length > 0 ? name : DEFAULT_AGENT_NAME;
    } catch {
      return DEFAULT_AGENT_NAME;
    }
  }

  /**
   * Calcula o instante da próxima abertura da janela de envio a partir de `now`
   * (R9.2), avaliada no fuso {@link SEND_WINDOW_TIME_ZONE}. Quando `now` está
   * antes da abertura de hoje, retorna a abertura de hoje; caso contrário, a de
   * amanhã. A diferença é computada em minutos locais, o que é robusto ao fuso
   * do servidor.
   */
  private nextSendWindowStart(now: Date): Date {
    const { startHour, startMinute } = this.config.followUpSendWindowParsed;
    const startMinutes = startHour * 60 + startMinute;
    const nowMinutes = this.minutesOfDayInZone(now);

    const deltaMinutes =
      nowMinutes < startMinutes
        ? startMinutes - nowMinutes
        : MINUTES_PER_DAY - nowMinutes + startMinutes;

    return new Date(now.getTime() + deltaMinutes * 60 * 1000);
  }

  /**
   * Converte um instante absoluto no número de minutos desde a meia-noite no
   * fuso {@link SEND_WINDOW_TIME_ZONE}.
   */
  private minutesOfDayInZone(now: Date): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: SEND_WINDOW_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    let hour = 0;
    let minute = 0;
    for (const part of formatter.formatToParts(now)) {
      if (part.type === 'hour') {
        hour = Number(part.value) % 24;
      } else if (part.type === 'minute') {
        minute = Number(part.value);
      }
    }

    return ((hour * 60 + minute) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  }

  /**
   * Atualiza o `lastOutboundAt` da Conversation sem propagar exceções: a falha
   * dessa atualização não deve interromper o ciclo já registrado como enviado.
   */
  private async safeUpdateConversationOutbound(
    conversationId: string,
    sentAt: Date,
  ): Promise<void> {
    try {
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastOutboundAt: sentAt },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao atualizar lastOutboundAt da conversa ${conversationId}: ${this.errMsg(err)}`,
      );
    }
  }

  /** Atualiza o schedule sem propagar exceções (atualizações de estado de borda). */
  private async safeUpdate(
    scheduleId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.followUpSchedule.update({
        where: { id: scheduleId },
        data: data as never,
      });
    } catch (err) {
      this.logger.error(
        `Falha ao atualizar o schedule ${scheduleId}: ${this.errMsg(err)}`,
      );
    }
  }

  /** Extrai uma mensagem legível de um erro desconhecido para log. */
  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
