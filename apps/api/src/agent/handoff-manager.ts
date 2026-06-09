/**
 * HandoffManager — owns the Handoff_State machine (Requirements 7 and 10).
 *
 * The state machine is monotonic non-decreasing (`none` < `suggested` <
 * `accepted` < `completed`) once a handoff has been accepted, but the most
 * recent Stated_Preference always wins, which lets the user step back to
 * `none` by asking to continue talking with the agent (reconciles R7.4 with
 * R10.6).
 *
 * `resolve` is a pure function: it derives the next Handoff_State and an
 * optional confirmation reply (in conversational Portuguese) from the decision
 * input alone, with no I/O and no LLM call. `completed` is never produced here;
 * it is set by the pipeline after an `accepted` handoff has been confirmed and
 * persisted.
 *
 * Transition precedence (top to bottom — the first matching rule wins):
 *   1. preference === 'continue'              -> `none`   (overrides monotonicity, R7.1/R7.2/R7.4)
 *   2. userAbandoned (desistance)             -> `none`   (the only other exit from accepted/completed, R10.6)
 *   3. preference === 'human' OR intent       -> `accepted` regardless of qualification (R10.1, R7.3)
 *      === 'preference_human'
 *   4. intent === 'handoff_accept' AND        -> `accepted` (R10.3)
 *      current === 'suggested'
 *   5. unsolicited offer gate: only move      -> `suggested`
 *      `none` -> `suggested` when
 *      hasSegment && hasAtLeastOnePain (R10.2)
 *   6. otherwise monotonic non-decreasing     -> max(current, derived) (R10.6)
 *
 * A confirmation reply is emitted whenever the transition lands on `accepted`
 * from a state that was not already `accepted` (R10.3).
 *
 * Feature: conversational-agent-quality
 */
import { Injectable } from '@nestjs/common';

import {
  HandoffDecision,
  HandoffDecisionInput,
  HandoffState,
} from './conversation-types';

/**
 * Total ordering of the handoff lifecycle, used to enforce monotonicity.
 */
const HANDOFF_ORDER: Record<HandoffState, number> = {
  none: 0,
  suggested: 1,
  accepted: 2,
  completed: 3,
};

/**
 * The confirmation reply emitted when the conversation transitions into the
 * `accepted` handoff state. Conversational Portuguese, single question, no
 * internal labels (R10.3, R8).
 */
const HANDOFF_CONFIRMATION_REPLY =
  'Perfeito, vou te encaminhar pro nosso time agora com o seu caso. ' +
  'Em breve alguém te chama por aqui pra seguir com você daqui.';

/**
 * Returns the higher of two handoff states according to the lifecycle order.
 */
function maxState(a: HandoffState, b: HandoffState): HandoffState {
  return HANDOFF_ORDER[a] >= HANDOFF_ORDER[b] ? a : b;
}

@Injectable()
export class HandoffManagerService {
  /**
   * Resolves the next Handoff_State (and an optional confirmation reply) from
   * the decision input. Pure and deterministic: the same input always yields
   * the same decision.
   */
  resolve(input: HandoffDecisionInput): HandoffDecision {
    const { current, preference, intent } = input;

    // 1. Most recent preference to continue wins and overrides monotonicity.
    if (preference === 'continue') {
      return { next: 'none' };
    }

    // 2. Abandonment is the only other way out of accepted/completed.
    if (input.userAbandoned) {
      return { next: 'none' };
    }

    // 3. Explicit human/proposal request -> accepted, regardless of
    //    qualification progress.
    if (preference === 'human' || intent === 'preference_human') {
      return this.toAccepted(current);
    }

    // 4. Accepting a pending offer confirms the handoff.
    if (intent === 'handoff_accept' && current === 'suggested') {
      return this.toAccepted(current);
    }

    // 4b. Depois de OFERECER o encaminhamento (estado 'suggested'), a próxima
    //     resposta substantiva do cliente é a lista de problemas que pedimos —
    //     confirma o handoff e leva o cenário pro time. Cobre tanto descrição
    //     ('general') quanto frases que o resolver marca como 'direct_question'
    //     (ex.: "quero um agente que..."). Preço segue com intent próprio.
    if (
      (intent === 'general' || intent === 'direct_question') &&
      current === 'suggested'
    ) {
      return this.toAccepted(current);
    }

    // 5. Unsolicited offer gate: only suggest a handoff once the lead is
    //    qualified. When the caller supplies `qualificationReadyForOffer` we
    //    use it (segment + deepened pain + volume); otherwise we fall back to
    //    the legacy "segment + at least one pain" condition.
    const readyForOffer =
      input.qualificationReadyForOffer ??
      (input.hasSegment && input.hasAtLeastOnePain);
    let derived: HandoffState = current;
    if (current === 'none' && readyForOffer) {
      derived = 'suggested';
    }

    // 6. Otherwise stay monotonic non-decreasing.
    return { next: maxState(current, derived) };
  }

  /**
   * Builds an `accepted` transition, attaching the confirmation reply only
   * when the state was not already `accepted` (i.e. a genuine transition into
   * the accepted state).
   */
  private toAccepted(current: HandoffState): HandoffDecision {
    if (current === 'accepted') {
      return { next: 'accepted' };
    }
    return { next: 'accepted', reply: HANDOFF_CONFIRMATION_REPLY };
  }
}
