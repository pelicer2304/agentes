/**
 * Lógica pura de agendamento do follow-up automático de leads.
 *
 * Este módulo concentra as funções determinísticas e sem efeitos colaterais
 * (sem I/O, sem dependência do NestJS) que sustentam o ciclo de follow-up:
 *
 *  - cálculo do `Inactivity_Anchor` (R1.1);
 *  - cálculo do `nextRunAt` de cada nível a partir do anchor (R1.2–R1.4);
 *  - seleção do próximo nível pendente (R7.4).
 *
 * Por serem puras, estas funções são facilmente verificáveis por testes
 * baseados em propriedade (ver design.md — Properties 3, 4 e 5).
 */

import {
  FOLLOW_UP_LEVELS,
  MAX_FOLLOW_UP_LEVEL,
  type FollowUpLevel,
} from './followup.constants';

/**
 * Offsets (em horas) de cada nível em relação ao `Inactivity_Anchor`.
 * Indexados por nível: posição 0 → Nível 1, posição 1 → Nível 2, etc.
 * Os defaults [1, 24, 48] alinham-se às configs `FOLLOWUP_LEVEL1_HOURS`,
 * `FOLLOWUP_LEVEL2_HOURS` e `FOLLOWUP_LEVEL3_HOURS` (R1.2–R1.4).
 */
export type LevelOffsetsHours = readonly number[];

/** Offsets padrão em horas: Nível 1 = 1h, Nível 2 = 24h, Nível 3 = 48h. */
export const DEFAULT_LEVEL_OFFSETS_HOURS: LevelOffsetsHours = [1, 24, 48];

/** Milissegundos em uma hora. */
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Calcula o `Inactivity_Anchor` de uma Conversation (R1.1).
 *
 * O anchor é o instante a partir do qual a inatividade é medida. Ele é igual
 * a `lastOutboundAt` quando NÃO há mensagem inbound posterior ao último
 * envio outbound do bot — ou seja, quando o bot fez o último envio e aguarda
 * resposta. Isso ocorre quando `lastInboundAt` é nulo OU é anterior/igual a
 * `lastOutboundAt`.
 *
 * Retorna `null` quando não há outbound aguardando resposta (o lead já
 * respondeu após o último envio do bot, logo não há inatividade a ancorar a
 * partir do outbound).
 *
 * @param lastOutboundAt instante do último envio outbound do bot.
 * @param lastInboundAt instante da última mensagem inbound do lead (ou null).
 * @returns o anchor (= `lastOutboundAt`) ou `null` quando há inbound posterior.
 */
export function computeInactivityAnchor(
  lastOutboundAt: Date,
  lastInboundAt: Date | null,
): Date | null {
  const hasLaterInbound =
    lastInboundAt !== null &&
    lastInboundAt.getTime() > lastOutboundAt.getTime();

  if (hasLaterInbound) {
    return null;
  }

  return new Date(lastOutboundAt.getTime());
}

/**
 * Calcula o instante de disparo (`nextRunAt`) de um nível a partir do anchor
 * (R1.2–R1.4): `nextRunAt = anchor + offset(level)`.
 *
 * Os offsets são injetáveis (em horas) para alinhar com a configuração
 * (`FOLLOWUP_LEVEL*_HOURS`); o default é [1, 24, 48].
 *
 * @param anchor o `Inactivity_Anchor`.
 * @param level o nível do follow-up (1, 2 ou 3).
 * @param offsetsHours offsets por nível em horas (default [1, 24, 48]).
 * @returns o instante agendado para o disparo do nível.
 */
export function nextRunForLevel(
  anchor: Date,
  level: FollowUpLevel,
  offsetsHours: LevelOffsetsHours = DEFAULT_LEVEL_OFFSETS_HOURS,
): Date {
  const offsetHours = offsetsHours[level - 1];

  if (offsetHours === undefined) {
    throw new RangeError(
      `Nenhum offset configurado para o nível ${level} (offsets: [${offsetsHours.join(', ')}])`,
    );
  }

  return new Date(anchor.getTime() + offsetHours * MS_PER_HOUR);
}

/**
 * Seleciona o próximo nível pendente de um ciclo (R7.4).
 *
 * O próximo nível é sempre `maxSentLevel + 1` (ordem crescente). Retorna
 * `null` quando todos os níveis já foram enviados, isto é, quando
 * `maxSentLevel >= MAX_FOLLOW_UP_LEVEL`.
 *
 * @param maxSentLevel maior nível já enviado (0 = nenhum).
 * @returns o próximo nível a disparar, ou `null` se o ciclo está esgotado.
 */
export function nextPendingLevel(maxSentLevel: number): FollowUpLevel | null {
  if (maxSentLevel >= MAX_FOLLOW_UP_LEVEL) {
    return null;
  }

  const candidate = maxSentLevel + 1;

  // Garante que o nível retornado é um FollowUpLevel válido (1..3),
  // mesmo para entradas negativas ou fracionárias inesperadas.
  if (!FOLLOW_UP_LEVELS.includes(candidate as FollowUpLevel)) {
    return null;
  }

  return candidate as FollowUpLevel;
}
