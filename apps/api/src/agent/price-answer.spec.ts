import fc from 'fast-check';
import { composePriceAnswer } from './price-answer';
import { HandoffState, PriceAnswerInput } from './conversation-types';

/**
 * Property-based tests for the PriceAnswerComposer (`composePriceAnswer`).
 *
 * Covers tasks 6.2, 6.3, and 6.4:
 *  - Property 3: Price answers acknowledge price and never refuse.
 *  - Property 4: Enabled price range is always shared.
 *  - Property 5: Disabled price range explains scope and offers routing.
 *
 * Feature: conversational-agent-quality
 * Requirements: 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5
 */

const HANDOFF_STATES: ReadonlyArray<HandoffState> = [
  'none',
  'suggested',
  'accepted',
  'completed',
];

// Realistic, configured starting-price texts an operator might enter.
const realisticPriceArb: fc.Arbitrary<string> = fc.constantFrom(
  'Nossos projetos começam a partir de R$ 5.000.',
  'A partir de R$ 2.500 por mês.',
  'Investimento inicial de R$ 10 mil.',
  'Planos começam em R$ 997/mês.',
  'O ticket inicial é de R$ 1.200.',
  'A partir de R$ 350 por usuário.',
);

// Whitespace-only strings (must be treated as "no usable text").
const whitespaceArb: fc.Arbitrary<string> = fc.constantFrom(
  ' ',
  '   ',
  '\t',
  '\n',
  '  \t\n ',
);

// startingPriceText arbitrary: null, '', whitespace, realistic, and arbitrary
// strings — the full input space the composer must tolerate.
const startingPriceTextArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  whitespaceArb,
  realisticPriceArb,
  fc.string(),
);

// Full PriceAnswerInput arbitrary across every combination of the three fields.
const priceAnswerInputArb: fc.Arbitrary<PriceAnswerInput> = fc.record({
  pricingRangeEnabled: fc.boolean(),
  startingPriceText: startingPriceTextArb,
  handoffState: fc.constantFrom(...HANDOFF_STATES),
});

// Phrases that would constitute a refusal to discuss price — must never appear.
const REFUSAL_PHRASES = [
  'não posso falar sobre',
  'nao posso falar sobre',
  'não posso informar',
  'nao posso informar',
  'não posso passar',
  'nao posso passar',
  'não falo de',
  'nao falo de',
  'não trabalho com isso',
  'nao trabalho com isso',
  'não discuto',
  'nao discuto',
  'infelizmente não posso',
  'infelizmente nao posso',
];

// Canned AI-behavior explanation phrasing — must never appear.
const AI_BEHAVIOR_PHRASES = [
  'a ia responde com base em regras',
  'responde com base em regras',
  'sou uma inteligência artificial',
  'sou uma inteligencia artificial',
];

// Tokens proving the reply acknowledges the price intent.
const PRICE_ACK_TOKENS = ['preço', 'preco', 'valor', 'orçamento', 'orcamento'];

describe('PriceAnswerComposer — property-based', () => {
  // Feature: conversational-agent-quality, Property 3: Price answers acknowledge price and never refuse
  it('always acknowledges the price intent and never refuses or explains AI behavior', () => {
    fc.assert(
      fc.property(priceAnswerInputArb, (input) => {
        const reply = composePriceAnswer(input);
        const lower = reply.toLowerCase();

        // (R2.1, R1.2) Acknowledges the price intent.
        expect(PRICE_ACK_TOKENS.some((t) => lower.includes(t))).toBe(true);

        // (R2.5) Contains no refusal-to-discuss-price phrasing.
        for (const phrase of REFUSAL_PHRASES) {
          expect(lower).not.toContain(phrase);
        }

        // (R2.4) Contains no AI-behavior explanation phrasing.
        for (const phrase of AI_BEHAVIOR_PHRASES) {
          expect(lower).not.toContain(phrase);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 4: Enabled price range is always shared
  it('includes the configured starting-price text when the range is enabled and the text is non-empty', () => {
    const enabledWithTextArb: fc.Arbitrary<PriceAnswerInput> = fc.record({
      pricingRangeEnabled: fc.constant(true),
      startingPriceText: fc.oneof(
        realisticPriceArb,
        fc.string().filter((s) => s.trim().length > 0),
      ),
      handoffState: fc.constantFrom(...HANDOFF_STATES),
    });

    fc.assert(
      fc.property(enabledWithTextArb, (input) => {
        const reply = composePriceAnswer(input);
        const configured = (input.startingPriceText ?? '').trim();

        // (R2.2) The configured starting-price text is shared verbatim.
        expect(reply).toContain(configured);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 5: Disabled price range explains scope and offers routing
  it('states the value depends on scope and offers to route to the team when no usable price is configured', () => {
    const scopeRoutingArb: fc.Arbitrary<PriceAnswerInput> = fc.oneof(
      // Range disabled — any starting-price text.
      fc.record({
        pricingRangeEnabled: fc.constant(false),
        startingPriceText: startingPriceTextArb,
        handoffState: fc.constantFrom(...HANDOFF_STATES),
      }),
      // Range enabled but no usable text (null / empty / whitespace).
      fc.record({
        pricingRangeEnabled: fc.constant(true),
        startingPriceText: fc.oneof(
          fc.constant<string | null>(null),
          fc.constant(''),
          whitespaceArb,
        ),
        handoffState: fc.constantFrom(...HANDOFF_STATES),
      }),
    );

    fc.assert(
      fc.property(scopeRoutingArb, (input) => {
        const reply = composePriceAnswer(input);
        const lower = reply.toLowerCase();

        // (R2.1) Still acknowledges the price intent.
        expect(PRICE_ACK_TOKENS.some((t) => lower.includes(t))).toBe(true);

        // (R2.3) States the final value depends on scope.
        expect(lower).toContain('escopo');

        // (R1.3, R2.3) Offers to route the lead to the team.
        expect(lower).toContain('encaminhar');
        expect(lower).toContain('time');
      }),
      { numRuns: 100 },
    );
  });
});
