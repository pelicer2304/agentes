import fc from 'fast-check';
import { KnownFacts } from './fact-extractor.service';
import {
  MIN_SCORE,
  MAX_SCORE,
  QUENTE_THRESHOLD,
  MORNO_THRESHOLD,
  calculateScore,
  clampNonDecreasing,
} from './score-calculator';

/**
 * Property-based tests for the LeadQualifier scoring (Requirement 9).
 *
 * Feature: conversational-agent-quality
 */

/**
 * Generator for KnownFacts covering every field used by calculateScore
 * (segment, mainPain, knownPains, volume, whatsappUsage, systems,
 * decisionRole, priceAskedCount, handoffAccepted, handoffCompleted) plus all
 * remaining required fields of the KnownFacts shape with arbitrary valid values.
 */
const nullableStringArb = fc.option(fc.string(), { nil: null });

const decisionRoleArb = fc.option(
  fc.constantFrom('dono', 'gestor', 'desconhecido', 'gerente'),
  { nil: null },
);

const knownFactsArb: fc.Arbitrary<KnownFacts> = fc.record({
  segment: nullableStringArb,
  businessDescription: nullableStringArb,
  whatsappUsage: nullableStringArb,
  volume: nullableStringArb,
  systems: nullableStringArb,
  decisionRole: decisionRoleArb,
  knownPains: fc.array(fc.string(), { maxLength: 5 }),
  mainPain: nullableStringArb,
  priceAskedCount: fc.nat({ max: 10 }),
  handoffOffered: fc.boolean(),
  handoffAccepted: fc.boolean(),
  handoffCompleted: fc.boolean(),
  painMappingAsked: fc.boolean(),
  secondaryPainsAsked: fc.boolean(),
  volumeAsked: fc.boolean(),
  messageCount: fc.nat({ max: 50 }),
});

describe('calculateScore', () => {
  // Feature: conversational-agent-quality, Property 22: Lead score is deterministic, bounded, and temperature-consistent
  it('produces an integer score in [0,100], determined solely by facts, with temperature consistent with the score', () => {
    fc.assert(
      fc.property(knownFactsArb, (facts) => {
        const first = calculateScore(facts);

        // Bounded integer in [0, 100].
        expect(Number.isInteger(first.score)).toBe(true);
        expect(first.score).toBeGreaterThanOrEqual(MIN_SCORE);
        expect(first.score).toBeLessThanOrEqual(MAX_SCORE);

        // Deterministic: same facts produce the same score and temperature.
        const second = calculateScore(facts);
        expect(second.score).toBe(first.score);
        expect(second.temperature).toBe(first.temperature);

        // Temperature is consistent with the score thresholds.
        if (first.score >= QUENTE_THRESHOLD) {
          expect(first.temperature).toBe('quente');
        } else if (first.score >= MORNO_THRESHOLD) {
          expect(first.temperature).toBe('morno');
        } else {
          expect(first.temperature).toBe('frio');
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('clampNonDecreasing', () => {
  // Feature: conversational-agent-quality, Property 23: Lead score never decreases on an active conversation
  it('returns max(previous, computed) bounded to [0,100] and never below the clamped previous score', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100 }),
        (previous, computed) => {
          const result = clampNonDecreasing(previous, computed);

          // Bounded integer in [0, 100].
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(MIN_SCORE);
          expect(result).toBeLessThanOrEqual(MAX_SCORE);

          // Never decreases relative to the previous score.
          expect(result).toBeGreaterThanOrEqual(previous);

          // Equals max(previous, computed) for in-range inputs.
          expect(result).toBe(Math.max(previous, computed));
        },
      ),
      { numRuns: 100 },
    );
  });
});
