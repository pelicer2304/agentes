import fc from 'fast-check';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import {
  ConversationSnapshot,
  EligibilityResult,
} from './followup.types';

/**
 * Property-based tests for the FollowUpEligibilityService (`evaluate`).
 *
 * A lógica de elegibilidade é uma função pura, total e determinística
 * (R2.1, R4.1). Estes testes geram `ConversationSnapshot` cobrindo todas as
 * flags de handoff e os status de lead/conversa para validar a Property 1 do
 * design (.kiro/specs/lead-followup/design.md).
 *
 * Feature: lead-followup
 * Requirements: 2.1, 4.1
 */

// Status de lead relevantes para a regra de elegibilidade.
const LEAD_STATUSES: ReadonlyArray<string> = [
  'novo',
  'qualificando',
  'chamar_humano',
  'perdido',
];

// Stages variados, incluindo o terminal de handoff.
const STAGES: ReadonlyArray<string> = [
  'abertura',
  'descoberta',
  'conversao',
  'handoff_humano',
];

const CONVERSATION_STATUSES: ReadonlyArray<string> = ['active', 'inactive'];

// assignedTo cobre os três casos relevantes: nulo, string vazia e um uuid.
const assignedToArb: fc.Arbitrary<string | null> = fc.oneof(
  fc.constant(null),
  fc.constant(''),
  fc.uuid(),
);

// Gera um ConversationSnapshot cobrindo todas as flags e status.
const snapshotArb: fc.Arbitrary<ConversationSnapshot> = fc.record({
  leadStatus: fc.constantFrom(...LEAD_STATUSES),
  stage: fc.constantFrom(...STAGES),
  conversationStatus: fc.constantFrom(...CONVERSATION_STATUSES),
  botPaused: fc.boolean(),
  assignedTo: assignedToArb,
  handoffAccepted: fc.boolean(),
  handoffCompleted: fc.boolean(),
  handoffRequired: fc.boolean(),
});

// Modelo de referência independente da implementação: alguma condição de
// handoff verdadeira torna não elegível com precedência sobre `perdido`.
const isHandoffCause = (s: ConversationSnapshot): boolean =>
  s.leadStatus === 'chamar_humano' ||
  s.handoffAccepted ||
  s.handoffCompleted ||
  s.stage === 'handoff_humano' ||
  s.botPaused ||
  (s.assignedTo !== null && s.assignedTo !== '');

const isLostCause = (s: ConversationSnapshot): boolean =>
  s.leadStatus === 'perdido';

describe('FollowUpEligibilityService — property-based', () => {
  const service = new FollowUpEligibilityService();

  // Feature: lead-followup, Property 1: Elegibilidade é total e correta
  it('eligible=false sse alguma condição de não-elegibilidade é verdadeira, com reason correto e determinismo', () => {
    fc.assert(
      fc.property(snapshotArb, (snapshot) => {
        const result: EligibilityResult = service.evaluate(snapshot);

        const handoff = isHandoffCause(snapshot);
        const lost = isLostCause(snapshot);
        const anyIneligibility = handoff || lost;

        // (a) Totalidade + correção do booleano: eligible=false SSE
        // alguma condição de não-elegibilidade for verdadeira.
        expect(result.eligible).toBe(!anyIneligibility);

        // (b) reason correto: null quando elegível; 'handoff_humano' quando
        // há causa de handoff (precedência); 'lead_perdido' apenas quando a
        // ÚNICA causa é o status perdido.
        if (!anyIneligibility) {
          expect(result.reason).toBeNull();
        } else if (handoff) {
          expect(result.reason).toBe('handoff_humano');
        } else {
          expect(result.reason).toBe('lead_perdido');
        }

        // (c) Determinismo: a mesma entrada produz exatamente o mesmo resultado.
        expect(service.evaluate(snapshot)).toEqual(result);
      }),
      { numRuns: 200 },
    );
  });
});
