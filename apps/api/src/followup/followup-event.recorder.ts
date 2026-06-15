import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { CancelReason, FollowUpEventType } from './followup.types';

/**
 * Número de tentativas ADICIONAIS de persistência após a falha da primeira
 * tentativa (R8.4): "repetir a tentativa de registro até 3 vezes adicionais".
 */
const MAX_ADDITIONAL_ATTEMPTS = 3;

/** Motivos válidos associados a um Follow_Up_Event (cancelamento ou erro). */
export type FollowUpEventReason =
  | CancelReason
  | 'evolution_error'
  | 'schedule_failed'
  | 'reevaluation_failed';

/** Entrada para registrar um Follow_Up_Event. */
export interface FollowUpEventInput {
  type: FollowUpEventType;
  conversationId: string;
  leadId: string;
  level?: 1 | 2 | 3;
  reason?: FollowUpEventReason;
  occurredAt: Date;
}

/**
 * Grava os Follow_Up_Event na tabela `bot_events` (observabilidade — R8).
 *
 * Tenta persistir o evento e, em caso de falha, repete a gravação até 3 vezes
 * adicionais (R8.4). Esgotadas as tentativas, registra o erro em log com o
 * `conversationId` e o tipo do evento e PROSSEGUE sem lançar exceção (R8.5):
 * a observabilidade nunca deve interromper o processamento do ciclo de
 * follow-up — degradação graciosa.
 */
@Injectable()
export class FollowUpEventRecorder {
  private readonly logger = new Logger(FollowUpEventRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra um Follow_Up_Event em `bot_events`. O payload inclui `level`
   * (quando houver), `reason` (quando houver) e o instante de ocorrência em
   * ISO-8601 com precisão de milissegundos (R8.1–R8.3).
   *
   * Nunca lança: em falha persistente, loga e retorna normalmente (R8.5).
   */
  async record(event: FollowUpEventInput): Promise<void> {
    const payload: Record<string, unknown> = {
      occurredAt: event.occurredAt.toISOString(),
    };
    if (event.level !== undefined) {
      payload.level = event.level;
    }
    if (event.reason !== undefined) {
      payload.reason = event.reason;
    }

    const data: Prisma.BotEventUncheckedCreateInput = {
      type: event.type,
      conversationId: event.conversationId,
      leadId: event.leadId,
      payload: payload as Prisma.InputJsonValue,
    };

    let lastError: unknown;
    // 1 tentativa inicial + MAX_ADDITIONAL_ATTEMPTS tentativas adicionais (R8.4).
    for (let attempt = 0; attempt <= MAX_ADDITIONAL_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.botEvent.create({ data });
        return;
      } catch (error) {
        lastError = error;
      }
    }

    // Esgotadas as tentativas: loga e prossegue sem interromper (R8.5).
    this.logger.error(
      `Failed to record Follow_Up_Event after ${MAX_ADDITIONAL_ATTEMPTS + 1} attempts ` +
        `(conversationId=${event.conversationId}, type=${event.type})`,
      lastError instanceof Error ? lastError.stack : String(lastError),
    );
  }
}
