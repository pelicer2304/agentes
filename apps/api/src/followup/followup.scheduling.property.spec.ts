import fc from 'fast-check';
import {
  computeInactivityAnchor,
  nextRunForLevel,
  nextPendingLevel,
  DEFAULT_LEVEL_OFFSETS_HOURS,
  type LevelOffsetsHours,
} from './followup-scheduling';
import {
  FOLLOW_UP_LEVELS,
  MAX_FOLLOW_UP_LEVEL,
  type FollowUpLevel,
} from './followup.constants';

/**
 * Property-based tests for the pure scheduling logic of lead follow-up
 * (`followup-scheduling.ts`).
 *
 * Kept in a dedicated property file, separate from any example-based suite,
 * following the style of `agent/intent-resolver.property.spec.ts`.
 *
 * Feature: lead-followup
 * Properties: 3, 4, 5
 * Requirements: 1.1, 1.2, 1.3, 1.4, 7.1, 7.2, 7.4
 */

const MS_PER_HOUR = 60 * 60 * 1000;

// Reasonable date range generator: avoids overflow on +offset arithmetic.
const dateArb: fc.Arbitrary<Date> = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
});

describe('followup-scheduling — property-based', () => {
  // Feature: lead-followup, Property 3: Inactivity_Anchor é a última interação relevante
  describe('Property 3: computeInactivityAnchor', () => {
    it('returns exactly lastOutboundAt when there is no inbound strictly after the last outbound', () => {
      // **Validates: Requirements 1.1**
      // Generate lastOutboundAt and an inbound that is either null or <= outbound,
      // i.e. NO inbound strictly after the last outbound.
      const arb = dateArb.chain((lastOutboundAt) => {
        const earlierOrEqualInbound = fc
          .integer({ min: 0, max: 10 * 365 * 24 * MS_PER_HOUR })
          .map((delta) => new Date(lastOutboundAt.getTime() - delta));

        return fc
          .oneof(fc.constant(null), earlierOrEqualInbound)
          .map((lastInboundAt) => ({ lastOutboundAt, lastInboundAt }));
      });

      fc.assert(
        fc.property(arb, ({ lastOutboundAt, lastInboundAt }) => {
          const anchor = computeInactivityAnchor(lastOutboundAt, lastInboundAt);

          expect(anchor).not.toBeNull();
          // Exactly equal to lastOutboundAt (same instant).
          expect(anchor!.getTime()).toBe(lastOutboundAt.getTime());
        }),
        { numRuns: 200 },
      );
    });

    it('returns null when there is an inbound strictly after the last outbound', () => {
      // **Validates: Requirements 1.1**
      const arb = dateArb.chain((lastOutboundAt) => {
        const laterInbound = fc
          .integer({ min: 1, max: 10 * 365 * 24 * MS_PER_HOUR })
          .map((delta) => new Date(lastOutboundAt.getTime() + delta));

        return laterInbound.map((lastInboundAt) => ({
          lastOutboundAt,
          lastInboundAt,
        }));
      });

      fc.assert(
        fc.property(arb, ({ lastOutboundAt, lastInboundAt }) => {
          const anchor = computeInactivityAnchor(lastOutboundAt, lastInboundAt);
          expect(anchor).toBeNull();
        }),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 4: Cada nível é agendado no offset correto a partir do anchor
  describe('Property 4: nextRunForLevel', () => {
    const levelArb = fc.constantFrom<FollowUpLevel>(...FOLLOW_UP_LEVELS);

    it('schedules each level at anchor + default offset (1h, 24h, 48h)', () => {
      // **Validates: Requirements 1.2, 1.3, 1.4**
      fc.assert(
        fc.property(dateArb, levelArb, (anchor, level) => {
          const expectedOffsetHours = DEFAULT_LEVEL_OFFSETS_HOURS[level - 1];
          const expected = anchor.getTime() + expectedOffsetHours * MS_PER_HOUR;

          const run = nextRunForLevel(anchor, level);

          expect(run.getTime()).toBe(expected);
        }),
        { numRuns: 200 },
      );

      // Pin the documented defaults explicitly.
      expect(DEFAULT_LEVEL_OFFSETS_HOURS[0]).toBe(1);
      expect(DEFAULT_LEVEL_OFFSETS_HOURS[1]).toBe(24);
      expect(DEFAULT_LEVEL_OFFSETS_HOURS[2]).toBe(48);
    });

    it('schedules each level at anchor + offset for arbitrary injected offsets', () => {
      // **Validates: Requirements 1.2, 1.3, 1.4**
      const customOffsetsArb: fc.Arbitrary<LevelOffsetsHours> = fc.tuple(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
      );

      fc.assert(
        fc.property(dateArb, levelArb, customOffsetsArb, (anchor, level, offsets) => {
          const expected = anchor.getTime() + offsets[level - 1] * MS_PER_HOUR;

          const run = nextRunForLevel(anchor, level, offsets);

          expect(run.getTime()).toBe(expected);
        }),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 5: Monotonicidade e idempotência dos níveis (1 → 2 → 3, nunca repetir)
  describe('Property 5: nextPendingLevel', () => {
    it('returns maxSentLevel + 1 for maxSentLevel in {0,1,2} and null for >= 3', () => {
      // **Validates: Requirements 1.3, 1.4, 7.1, 7.2, 7.4**
      fc.assert(
        fc.property(fc.integer({ min: -5, max: 10 }), (maxSentLevel) => {
          const next = nextPendingLevel(maxSentLevel);

          if (maxSentLevel >= 0 && maxSentLevel < MAX_FOLLOW_UP_LEVEL) {
            // {0,1,2} -> {1,2,3}
            expect(next).toBe(maxSentLevel + 1);
          } else if (maxSentLevel >= MAX_FOLLOW_UP_LEVEL) {
            // >= 3 -> null (cycle exhausted)
            expect(next).toBeNull();
          }
        }),
        { numRuns: 200 },
      );

      // Explicit boundary assertions for {0,1,2} and the >= 3 terminal case.
      expect(nextPendingLevel(0)).toBe(1);
      expect(nextPendingLevel(1)).toBe(2);
      expect(nextPendingLevel(2)).toBe(3);
      expect(nextPendingLevel(3)).toBeNull();
      expect(nextPendingLevel(4)).toBeNull();
    });

    it('produces a strictly increasing 0 -> 1 -> 2 -> 3 sequence that never repeats and then terminates', () => {
      // **Validates: Requirements 7.1, 7.2, 7.4**
      // Drive the cycle from any starting point and confirm monotonicity,
      // no repetition, and a null terminal state once the levels are exhausted.
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 3 }), (start) => {
          const sent: number[] = [];
          let maxSentLevel = start;

          // Walk the cycle until exhausted.
          let next = nextPendingLevel(maxSentLevel);
          while (next !== null) {
            // Each selected level is strictly greater than the previous sent.
            expect(next).toBe(maxSentLevel + 1);
            expect(next).toBeGreaterThan(maxSentLevel);

            sent.push(next);
            maxSentLevel = next; // mark as sent (monotonic, never decreases)
            next = nextPendingLevel(maxSentLevel);
          }

          // Terminal state: exhausted, returns null.
          expect(nextPendingLevel(maxSentLevel)).toBeNull();
          expect(maxSentLevel).toBe(MAX_FOLLOW_UP_LEVEL);

          // Strictly increasing, no repeats.
          for (let i = 1; i < sent.length; i++) {
            expect(sent[i]).toBeGreaterThan(sent[i - 1]);
          }
          expect(new Set(sent).size).toBe(sent.length);
        }),
        { numRuns: 100 },
      );
    });
  });
});
