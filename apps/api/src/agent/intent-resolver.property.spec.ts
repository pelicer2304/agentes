import fc from 'fast-check';
import { resolveIntent } from './intent-resolver';
import { IntentCategory, IntentContext, HandoffState } from './conversation-types';

/**
 * Property-based tests for the IntentResolver (`resolveIntent`).
 *
 * Recreated in a SEPARATE file from the example-based regression suite
 * (`intent-resolver.spec.ts`) to avoid any parallel-write collision.
 *
 * Feature: conversational-agent-quality
 * Requirements: 1.1, 1.2, 2.1
 */

// The 14 mutually-exclusive intent categories (conversation-types.ts).
const VALID_CATEGORIES: ReadonlyArray<IntentCategory> = [
  'command',
  'edge_input',
  'over_length',
  'price_question',
  'direct_question',
  'preference_continue',
  'preference_human',
  'handoff_accept',
  'handoff_completed_ack',
  'desistance',
  'frustration',
  'greeting',
  'acknowledgment',
  'general',
];

const HANDOFF_STATES: ReadonlyArray<HandoffState> = [
  'none',
  'suggested',
  'accepted',
  'completed',
];

// Arbitrary IntentContext: hasFacts boolean × the 4 handoff states.
const intentContextArb: fc.Arbitrary<IntentContext> = fc.record({
  hasFacts: fc.boolean(),
  handoffState: fc.constantFrom(...HANDOFF_STATES),
});

describe('IntentResolver — property-based', () => {
  // Feature: conversational-agent-quality, Property 1: Intent resolution is total and deterministic
  it('returns one of the 14 valid categories and is deterministic for any string and context', () => {
    fc.assert(
      fc.property(fc.string(), intentContextArb, (rawMessage, ctx) => {
        const first = resolveIntent(rawMessage, ctx);
        const second = resolveIntent(rawMessage, ctx);

        // (a) Totality: the resolved category is always one of the 14 valid values.
        expect(VALID_CATEGORIES).toContain(first.category);

        // (b) Determinism: identical input + context yields the identical result.
        expect(second).toEqual(first);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 2: Price phrasings resolve to the price intent
  it('resolves any price keyword combined with an interrogative/desire marker to price_question', () => {
    const PRICE_KEYWORDS = [
      'preço',
      'preco',
      'valor',
      'valores',
      'custa',
      'custo',
      'orçamento',
      'orcamento',
      'quanto',
      'investimento',
    ];

    // Interrogative / desire markers. None of these, when joined to a price
    // keyword with a space, can form a frustration phrase (those all begin with
    // "só") or a stated-preference phrase (those require "alguém"/"transferido"/
    // "atendente"/etc.), so price detection is guaranteed to win.
    const PRICE_MARKERS = [
      'quanto',
      'qual',
      'queria saber',
      'quero saber',
      'me passa',
      'me diz',
      'tem ideia',
      '?',
    ];

    // Re-case each character of a string randomly so detection must be
    // case-insensitive.
    const randomCasing = (s: string): fc.Arbitrary<string> =>
      fc
        .array(fc.boolean(), { minLength: s.length, maxLength: s.length })
        .map((flags) =>
          s
            .split('')
            .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
            .join(''),
        );

    const priceInput = fc
      .record({
        keyword: fc.constantFrom(...PRICE_KEYWORDS),
        marker: fc.constantFrom(...PRICE_MARKERS),
        markerFirst: fc.boolean(),
        ctx: intentContextArb,
      })
      .chain(({ keyword, marker, markerFirst, ctx }) => {
        // Join with a space so BOTH substrings are present, randomizing order.
        const joined = markerFirst ? `${marker} ${keyword}` : `${keyword} ${marker}`;
        return randomCasing(joined).map((message) => ({ message, ctx }));
      });

    fc.assert(
      fc.property(priceInput, ({ message, ctx }) => {
        const r = resolveIntent(message, ctx);

        // Regardless of hasFacts or handoffState, a price phrasing is a price
        // question (Requirement 2.1) and a direct question (Requirement 1.1).
        expect(r.category).toBe('price_question');
        expect(r.priceIntent).toBe(true);
        expect(r.isDirectQuestion).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
