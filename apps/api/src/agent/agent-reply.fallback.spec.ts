import fc from 'fast-check';

import { AgentReplyService } from './agent-reply.service';
import { KnownFacts } from './fact-extractor.service';

/**
 * Property-based tests for the contextual fallback derivation
 * (`AgentReplyService.buildContextualFallback`).
 *
 * Feature: conversational-agent-quality
 *
 * buildContextualFallback is purely fact-derived and never touches the LLM,
 * so the service is constructed with a stub provider that is never invoked.
 */

const stubProvider = {
  complete: async () => ({ content: '', model: 'stub' }),
} as any;

const service = new AgentReplyService(stubProvider);

/**
 * Fact-text generator: realistic, human-readable values that never contain
 * the substring "dificuldade". Excluding it keeps the property focused on the
 * agent's own templating (it must never emit the generic "difficulty
 * processing" message) rather than on user-derived text echoed back.
 */
const factTextArb = fc.oneof(
  fc.constantFrom(
    'clínica',
    'loja de roupas',
    'restaurante',
    'academia',
    'pet shop',
    'e-commerce',
    'demora para responder',
    'perde muita venda no WhatsApp',
    '50 mensagens por dia',
    'atendo pelo WhatsApp o dia todo',
  ),
  fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((s) => s.trim().length > 0 && !s.toLowerCase().includes('dificuldade')),
);

// Nullable fact-text: null, empty string (a falsy value the branches skip), or real text.
const nullableFactArb = fc.oneof(fc.constant(null), fc.constant(''), factTextArb);

const decisionRoleArb = fc.option(
  fc.constantFrom('dono', 'gestor', 'desconhecido', 'gerente'),
  { nil: null },
);

/**
 * Generator for the full KnownFacts shape. The fields buildContextualFallback
 * branches on (segment, mainPain, volume, whatsappUsage) use the nullable
 * fact-text generator; the remaining required fields are filled with arbitrary
 * valid values so every possible KnownFacts is exercised.
 */
const knownFactsArb: fc.Arbitrary<KnownFacts> = fc.record({
  segment: nullableFactArb,
  businessDescription: nullableFactArb,
  whatsappUsage: nullableFactArb,
  volume: nullableFactArb,
  systems: nullableFactArb,
  decisionRole: decisionRoleArb,
  knownPains: fc.array(factTextArb, { maxLength: 5 }),
  mainPain: nullableFactArb,
  priceAskedCount: fc.nat({ max: 10 }),
  handoffOffered: fc.boolean(),
  handoffAccepted: fc.boolean(),
  handoffCompleted: fc.boolean(),
  painMappingAsked: fc.boolean(),
  secondaryPainsAsked: fc.boolean(),
  volumeAsked: fc.boolean(),
  messageCount: fc.nat({ max: 50 }),
});

describe('AgentReplyService.buildContextualFallback', () => {
  // Feature: conversational-agent-quality, Property 8: Contextual fallback is non-empty and fact-derived
  it('returns a non-empty reply, references the segment when known, and is never the generic "difficulty processing" message', () => {
    fc.assert(
      fc.property(knownFactsArb, (facts) => {
        const reply = service.buildContextualFallback(facts);

        // Always a non-empty string (R3.1, R3.4).
        expect(typeof reply).toBe('string');
        expect(reply.trim().length).toBeGreaterThan(0);

        // Never the generic "difficulty processing" message (R3.4):
        // it must not contain "dificuldade"/"dificuldades técnicas".
        expect(reply.toLowerCase()).not.toContain('dificuldade');

        // Fact-derived: when a segment is known (non-empty string), the reply
        // references it. Every segment-bearing branch of the implementation
        // (segment+mainPain, segment+volume, segment-only) interpolates it.
        if (typeof facts.segment === 'string' && facts.segment.length > 0) {
          expect(reply).toContain(facts.segment);
        }
      }),
      { numRuns: 100 },
    );
  });
});
