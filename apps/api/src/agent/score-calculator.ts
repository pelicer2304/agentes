import { KnownFacts } from './fact-extractor.service';

/** Inclusive lower bound for any lead score. */
export const MIN_SCORE = 0;
/** Inclusive upper bound for any lead score. */
export const MAX_SCORE = 100;
/** Score at or above which the lead temperature is `quente`. */
export const QUENTE_THRESHOLD = 70;
/** Score at or above which the lead temperature is `morno` (below QUENTE_THRESHOLD). */
export const MORNO_THRESHOLD = 40;

export type Temperature = 'quente' | 'morno' | 'frio';

/**
 * Clamps an arbitrary number to an integer within the supported score range [0, 100].
 * Non-finite values fall back to the minimum score.
 */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return MIN_SCORE;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(value)));
}

/**
 * Maps a (bounded) score to its lead temperature.
 * Mapping: `quente` >= 70, `morno` 40-69, `frio` < 40.
 */
export function temperatureFor(score: number): Temperature {
  if (score >= QUENTE_THRESHOLD) return 'quente';
  if (score >= MORNO_THRESHOLD) return 'morno';
  return 'frio';
}

/**
 * Enforces the non-decreasing score rule used at pipeline state resolution.
 * Returns the greater of the previously persisted score and the newly computed
 * score, bounded to an integer in [0, 100]. This is the single helper the
 * pipeline should use to clamp a persisted score to `max(previous, computed)`.
 */
export function clampNonDecreasing(previous: number, computed: number): number {
  const prev = clampScore(previous);
  const next = clampScore(computed);
  return Math.max(prev, next);
}

/**
 * Pure deterministic score calculator. NO LLM involved.
 * Calculates lead score based on known facts extracted from conversation.
 *
 * The returned score is always an integer in [0, 100] determined solely by the
 * facts, and the temperature is consistent with the score (quente >= 70,
 * morno 40-69, frio < 40).
 */
export function calculateScore(facts: KnownFacts): { score: number; temperature: Temperature; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (facts.segment) { score += 20; reasons.push('segmento informado'); }
  if (facts.mainPain || facts.knownPains.length > 0) { score += 20; reasons.push('dor identificada'); }
  if (facts.volume) { score += 15; reasons.push('volume informado'); }
  if (facts.whatsappUsage) { score += 15; reasons.push('uso do WhatsApp explicado'); }
  if (facts.systems) { score += 15; reasons.push('sistema identificado'); }
  if (facts.decisionRole && facts.decisionRole !== 'desconhecido') { score += 20; reasons.push('decisor identificado'); }
  // Perguntar preço sinaliza interesse, mas não é qualificação forte por si só
  // (um curioso também pergunta). Peso moderado para não inflar o lead de frio
  // direto para morno só por uma pergunta de valor.
  if (facts.priceAskedCount > 0) { score += 15; reasons.push('perguntou preço'); }
  if (facts.handoffAccepted) { score = Math.max(score, 80); reasons.push('pediu encaminhamento'); }

  // Handoff override
  if (facts.handoffAccepted || facts.handoffCompleted) {
    score = Math.max(score, 80);
  }

  // Bound to an integer in [0, 100]
  score = clampScore(score);

  const temperature = temperatureFor(score);
  return { score, temperature, reasons };
}
