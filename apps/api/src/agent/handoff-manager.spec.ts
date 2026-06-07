import fc from 'fast-check';

import { HandoffManagerService } from './handoff-manager';
import {
  HandoffState,
  IntentCategory,
  StatedPreference,
} from './conversation-types';

/**
 * Property-based tests for the HandoffManager state machine
 * (`HandoffManagerService.resolve`).
 *
 * These cover the transition precedence documented in the design's
 * "HandoffManager" section:
 *   1. preference === 'continue'                       -> 'none'
 *   2. userAbandoned                                   -> 'none'
 *   3. preference === 'human' | intent preference_human-> 'accepted'
 *   4. intent handoff_accept AND current 'suggested'   -> 'accepted'
 *   5. unsolicited gate (hasSegment && hasAtLeastOnePain) for none->suggested
 *   6. otherwise monotonic max(current, derived)
 *
 * Feature: conversational-agent-quality
 */

const ALL_STATES: ReadonlyArray<HandoffState> = [
  'none',
  'suggested',
  'accepted',
  'completed',
];

const ALL_PREFERENCES: ReadonlyArray<StatedPreference> = [
  'continue',
  'human',
  'none',
];

const ALL_INTENTS: ReadonlyArray<IntentCategory> = [
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

// Total ordering of the handoff lifecycle (mirrors the production HANDOFF_ORDER).
const HANDOFF_ORDER: Record<HandoffState, number> = {
  none: 0,
  suggested: 1,
  accepted: 2,
  completed: 3,
};

const stateArb = fc.constantFrom<HandoffState>(...ALL_STATES);
const preferenceArb = fc.constantFrom<StatedPreference>(...ALL_PREFERENCES);
const intentArb = fc.constantFrom<IntentCategory>(...ALL_INTENTS);

describe('HandoffManagerService.resolve', () => {
  const service = new HandoffManagerService();

  // Feature: conversational-agent-quality, Property 16: The most recent stated preference determines handoff state
  it('maps preference "continue" to next "none" regardless of prior state', () => {
    const continueInput = fc.record({
      current: stateArb,
      intent: intentArb,
      hasSegment: fc.boolean(),
      hasAtLeastOnePain: fc.boolean(),
      userAbandoned: fc.boolean(),
    });

    fc.assert(
      fc.property(continueInput, (base) => {
        const decision = service.resolve({
          ...base,
          preference: 'continue',
        });
        // continue beats every other signal, including a "human" intent and
        // userAbandoned: the most recent preference wins.
        expect(decision.next).toBe('none');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 16: The most recent stated preference determines handoff state
  it('maps a human/proposal request to next "accepted" regardless of prior state', () => {
    // The human case: either preference === 'human' OR intent === 'preference_human'.
    // continue beats human, so preference is never 'continue' here; and
    // userAbandoned is false so it does not override (abandon -> 'none').
    const humanInput = fc.oneof(
      // Branch A: explicit "human" preference, any intent.
      fc.record({
        current: stateArb,
        preference: fc.constant<StatedPreference>('human'),
        intent: intentArb,
        hasSegment: fc.boolean(),
        hasAtLeastOnePain: fc.boolean(),
        userAbandoned: fc.constant(false),
      }),
      // Branch B: preference_human intent, preference not 'continue'.
      fc.record({
        current: stateArb,
        preference: fc.constantFrom<StatedPreference>('none', 'human'),
        intent: fc.constant<IntentCategory>('preference_human'),
        hasSegment: fc.boolean(),
        hasAtLeastOnePain: fc.boolean(),
        userAbandoned: fc.constant(false),
      }),
    );

    fc.assert(
      fc.property(humanInput, (input) => {
        const decision = service.resolve(input);
        expect(decision.next).toBe('accepted');
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 17: While the user prefers to continue, no handoff is offered
  it('never offers or initiates a handoff while preference is "continue"', () => {
    const continueInput = fc.record({
      current: stateArb,
      intent: intentArb,
      hasSegment: fc.boolean(),
      hasAtLeastOnePain: fc.boolean(),
      userAbandoned: fc.boolean(),
    });

    fc.assert(
      fc.property(continueInput, (base) => {
        const decision = service.resolve({
          ...base,
          preference: 'continue',
        });
        // Next state is 'none' (no offer, no initiation) and there is no
        // handoff confirmation reply.
        expect(decision.next).toBe('none');
        expect(decision.reply).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 18: Accepting a pending offer confirms handoff
  it('confirms the handoff when a pending offer ("suggested") is accepted', () => {
    // current 'suggested', intent 'handoff_accept', preference 'none',
    // userAbandoned false.
    const acceptInput = fc.record({
      current: fc.constant<HandoffState>('suggested'),
      preference: fc.constant<StatedPreference>('none'),
      intent: fc.constant<IntentCategory>('handoff_accept'),
      hasSegment: fc.boolean(),
      hasAtLeastOnePain: fc.boolean(),
      userAbandoned: fc.constant(false),
    });

    fc.assert(
      fc.property(acceptInput, (input) => {
        const decision = service.resolve(input);
        expect(decision.next).toBe('accepted');
        // A confirmation reply is present when transitioning into 'accepted'.
        expect(typeof decision.reply).toBe('string');
        expect((decision.reply ?? '').length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 19: No unsolicited handoff without segment and a pain
  it('does not introduce an unsolicited "suggested" state without a segment and a pain', () => {
    // Lacks a segment OR lacks at least one pain; not an explicit
    // human/proposal request or handoff_accept; preference !== 'human'.
    const noOfferInput = fc
      .record({
        current: stateArb,
        preference: fc.constantFrom<StatedPreference>('continue', 'none'),
        intent: intentArb.filter(
          (i) => i !== 'preference_human' && i !== 'handoff_accept',
        ),
        hasSegment: fc.boolean(),
        hasAtLeastOnePain: fc.boolean(),
        userAbandoned: fc.boolean(),
      })
      // Constrain to "lacks segment OR lacks a pain".
      .filter((input) => !(input.hasSegment && input.hasAtLeastOnePain));

    fc.assert(
      fc.property(noOfferInput, (input) => {
        const decision = service.resolve(input);
        // The manager must never *introduce* a suggestion: if the result is
        // 'suggested', the conversation was already 'suggested' beforehand.
        if (decision.next === 'suggested') {
          expect(input.current).toBe('suggested');
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 20: Handoff state is monotonic once accepted
  it('keeps the state at "accepted" or higher once accepted/completed (no continue, no abandon)', () => {
    const monotonicInput = fc.record({
      current: fc.constantFrom<HandoffState>('accepted', 'completed'),
      preference: fc.constantFrom<StatedPreference>('human', 'none'),
      intent: intentArb,
      hasSegment: fc.boolean(),
      hasAtLeastOnePain: fc.boolean(),
      userAbandoned: fc.constant(false),
    });

    fc.assert(
      fc.property(monotonicInput, (input) => {
        const decision = service.resolve(input);
        // 'accepted' or higher: accepted or completed.
        expect(HANDOFF_ORDER[decision.next]).toBeGreaterThanOrEqual(
          HANDOFF_ORDER.accepted,
        );
      }),
      { numRuns: 100 },
    );
  });
});
