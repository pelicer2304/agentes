/**
 * Constantes do mecanismo de follow-up automático de leads.
 *
 * Os níveis temporais (1h, 24h, 48h) e o número máximo de níveis derivam
 * diretamente dos requisitos (R1, R6, R8). Os tipos de BotEvent abaixo são os
 * novos valores de `type` gravados na tabela `bot_events` (R8.1–R8.3).
 */

import type { FollowUpEventType } from './followup.types';

/** Níveis temporais do follow-up (R1: 1h, 24h, 48h). */
export const FOLLOW_UP_LEVELS = [1, 2, 3] as const;

/** Um nível válido de follow-up. */
export type FollowUpLevel = (typeof FOLLOW_UP_LEVELS)[number];

/** Número máximo de níveis de follow-up por ciclo (R6, R8.1). */
export const MAX_FOLLOW_UP_LEVEL = 3;

/** Novos tipos de BotEvent registrados pelo follow-up (R8.1–R8.3). */
export const FOLLOW_UP_EVENT_TYPES = {
  SENT: 'followup_sent',
  CANCELLED: 'followup_cancelled',
  COMPLETED: 'followup_completed',
  ERROR: 'followup_error',
} as const satisfies Record<string, FollowUpEventType>;
