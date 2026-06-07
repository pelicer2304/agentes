import { KnownFacts } from './fact-extractor.service';

/**
 * Pure deterministic score calculator. NO LLM involved.
 * Calculates lead score based on known facts extracted from conversation.
 */
export function calculateScore(facts: KnownFacts): { score: number; temperature: string; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (facts.segment) { score += 20; reasons.push('segmento informado'); }
  if (facts.mainPain || facts.knownPains.length > 0) { score += 20; reasons.push('dor identificada'); }
  if (facts.volume) { score += 15; reasons.push('volume informado'); }
  if (facts.whatsappUsage) { score += 15; reasons.push('uso do WhatsApp explicado'); }
  if (facts.systems) { score += 15; reasons.push('sistema identificado'); }
  if (facts.decisionRole && facts.decisionRole !== 'desconhecido') { score += 20; reasons.push('decisor identificado'); }
  if (facts.priceAskedCount > 0) { score += 30; reasons.push('pediu preço'); }
  if (facts.handoffAccepted) { score = Math.max(score, 80); reasons.push('pediu encaminhamento'); }

  // Handoff override
  if (facts.handoffAccepted || facts.handoffCompleted) {
    score = Math.max(score, 80);
  }

  // Cap at 100
  score = Math.min(score, 100);

  const temperature = score >= 70 ? 'quente' : score >= 40 ? 'morno' : 'frio';
  return { score, temperature, reasons };
}
