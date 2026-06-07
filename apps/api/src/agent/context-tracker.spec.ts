import fc from 'fast-check';

import { ContextTrackerService } from './context-tracker';
import { FactExtractorService } from './fact-extractor.service';
import { KnownFacts } from './conversation-types';

/**
 * Property-based tests for ContextTracker known-fact suppression
 * (`ContextTrackerService.isKnownAndUnambiguous`).
 *
 * Per the design (Requirement 3.2), the ContextTracker is the source of the
 * "prohibited questions" set: once a fact field is established and unambiguous,
 * the agent must never ask about it again. `isKnownAndUnambiguous` answers
 * against the most recently `build`-cached context:
 *   - string fields: established iff non-empty after normalize AND not an
 *     ambiguity marker ("nao sei", "sei la", "talvez", "n sei", "sei nao", "?")
 *   - string[] fields: established iff at least one entry
 *   - numbers / booleans / null: never a re-askable fact (always false)
 *
 * The generators below build leads (with an empty history, so only the lead
 * fields drive the extracted facts) that establish specific fields, and assert
 * `isKnownAndUnambiguous` reflects exactly which fields are known/unambiguous.
 *
 * Feature: conversational-agent-quality
 */

// A fresh tracker per evaluation keeps the cached context isolated.
function newTracker(): ContextTrackerService {
  return new ContextTrackerService(new FactExtractorService());
}

const NEUTRAL_CONVERSATION = { stage: 'descoberta', handoffRequired: false };
const EMPTY_HISTORY: { role: 'user' | 'assistant' | 'system'; content: string }[] =
  [];

// Values that clearly establish a field (non-empty, not ambiguity markers).
const KNOWN_VALUES = [
  'clínica odontológica',
  'restaurante',
  'dono',
  'gestor',
  '50 mensagens por dia',
  'uso o whatsapp para vender',
  'perco muito tempo respondendo',
];

// Values that are present but too ambiguous to count (normalize -> marker).
const AMBIGUOUS_VALUES = [
  'nao sei',
  'não sei',
  'Sei lá',
  'sei la',
  'talvez',
  'TALVEZ',
  'n sei',
  'sei nao',
  '?',
];

// Present-but-empty values (normalize -> length 0) or falsy -> unestablished.
const EMPTY_VALUES = ['', '   ', '\t', '\n', '   \n  '];

interface FieldCase {
  value: string | null;
  expected: boolean;
}

const knownArb = fc
  .constantFrom(...KNOWN_VALUES)
  .map((value): FieldCase => ({ value, expected: true }));
const ambiguousArb = fc
  .constantFrom(...AMBIGUOUS_VALUES)
  .map((value): FieldCase => ({ value, expected: false }));
const emptyArb = fc
  .constantFrom(...EMPTY_VALUES)
  .map((value): FieldCase => ({ value, expected: false }));
const nullArb = fc.constant<FieldCase>({ value: null, expected: false });

// Any of the four categories for a single string-backed field.
const fieldCaseArb = fc.oneof(knownArb, ambiguousArb, emptyArb, nullArb);

describe('ContextTrackerService.isKnownAndUnambiguous', () => {
  // Feature: conversational-agent-quality, Property 7: Known unambiguous facts are never asked again
  it('reports a string fact as known iff it is established and unambiguous', () => {
    fc.assert(
      fc.property(
        fieldCaseArb, // segment
        fieldCaseArb, // businessDescription
        fieldCaseArb, // whatsappUsage
        fieldCaseArb, // estimatedVolume -> facts.volume
        fieldCaseArb, // decisionRole
        fieldCaseArb, // mainPain
        (seg, biz, wpp, vol, role, pain) => {
          const tracker = newTracker();
          tracker.build(
            {
              segment: seg.value,
              businessDescription: biz.value,
              whatsappUsage: wpp.value,
              estimatedVolume: vol.value,
              decisionRole: role.value,
              mainPain: pain.value,
              secondaryPains: [],
              status: 'novo',
            },
            NEUTRAL_CONVERSATION,
            EMPTY_HISTORY,
          );

          // Each field reflects exactly its own establishment + ambiguity.
          expect(tracker.isKnownAndUnambiguous('segment')).toBe(seg.expected);
          expect(tracker.isKnownAndUnambiguous('businessDescription')).toBe(
            biz.expected,
          );
          expect(tracker.isKnownAndUnambiguous('whatsappUsage')).toBe(
            wpp.expected,
          );
          expect(tracker.isKnownAndUnambiguous('volume')).toBe(vol.expected);
          expect(tracker.isKnownAndUnambiguous('decisionRole')).toBe(
            role.expected,
          );
          expect(tracker.isKnownAndUnambiguous('mainPain')).toBe(pain.expected);

          // A field never set via the lead (no history match) stays unknown.
          expect(tracker.isKnownAndUnambiguous('systems')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 7: Known unambiguous facts are never asked again
  it('reports the knownPains list as known iff at least one pain is established', () => {
    const secondaryArb = fc.array(
      fc.constantFrom('demora para responder', 'perda de clientes', 'sobrecarga'),
      { maxLength: 4 },
    );

    fc.assert(
      fc.property(secondaryArb, fc.boolean(), (secondaryPains, hasMainPain) => {
        const tracker = newTracker();
        tracker.build(
          {
            mainPain: hasMainPain ? 'perco muito tempo respondendo' : null,
            secondaryPains,
            status: 'novo',
          },
          NEUTRAL_CONVERSATION,
          EMPTY_HISTORY,
        );

        // knownPains is populated from mainPain and/or secondaryPains; with an
        // empty history there is no other source.
        const expected = hasMainPain || secondaryPains.length > 0;
        expect(tracker.isKnownAndUnambiguous('knownPains')).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 7: Known unambiguous facts are never asked again
  it('never treats numeric or boolean fact fields as re-askable facts', () => {
    // These fields are counters/flags, not user-supplied facts: regardless of
    // how the conversation establishes them, they are never "asked again".
    const numericAndBooleanFields: (keyof KnownFacts)[] = [
      'priceAskedCount',
      'handoffOffered',
      'handoffAccepted',
      'handoffCompleted',
      'painMappingAsked',
      'secondaryPainsAsked',
      'volumeAsked',
      'messageCount',
    ];

    fc.assert(
      fc.property(
        fc.boolean(), // handoffRequired -> handoffOffered
        fc.boolean(), // accepted (status) -> handoffAccepted
        fc.boolean(), // completed (stage) -> handoffCompleted
        (handoffRequired, accepted, completed) => {
          const tracker = newTracker();
          tracker.build(
            { status: accepted ? 'chamar_humano' : 'novo' },
            {
              stage: completed ? 'handoff_humano' : 'descoberta',
              handoffRequired,
            },
            // History exercises the asked-flag and price-count detection so the
            // numeric/boolean facts can be truthy, yet still never re-askable.
            [
              { role: 'user', content: 'quanto custa? qual o preço?' },
              { role: 'assistant', content: 'Quantas mensagens recebem por dia?' },
              {
                role: 'assistant',
                content: 'E além desse ponto, há outras dificuldades?',
              },
            ],
          );

          for (const field of numericAndBooleanFields) {
            expect(tracker.isKnownAndUnambiguous(field)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 7: Known unambiguous facts are never asked again
  it('returns false for every field before any context is built', () => {
    const allFields: (keyof KnownFacts)[] = [
      'segment',
      'businessDescription',
      'whatsappUsage',
      'volume',
      'systems',
      'decisionRole',
      'knownPains',
      'mainPain',
      'priceAskedCount',
      'handoffOffered',
      'handoffAccepted',
      'handoffCompleted',
      'painMappingAsked',
      'secondaryPainsAsked',
      'volumeAsked',
      'messageCount',
    ];

    fc.assert(
      fc.property(fc.constantFrom(...allFields), (field) => {
        // No build() call -> no cached context -> nothing is known.
        const tracker = newTracker();
        expect(tracker.isKnownAndUnambiguous(field)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
