/**
 * Shared in-memory contracts for the conversational-agent-quality pipeline.
 *
 * These types carry no persistence; they are recomputed per turn from the
 * lead, conversation, and history. They are the single source of truth for the
 * shapes exchanged between the pure pipeline stages (intent resolution,
 * preference detection, command parsing, edge classification, price
 * composition, the handoff state machine, and the response guard) and the
 * orchestrating ConversationService.
 *
 * Feature: conversational-agent-quality
 */
import { KnownFacts } from './fact-extractor.service';

// Re-export the existing fact shape so the new types compose with it.
export { KnownFacts } from './fact-extractor.service';

/**
 * The set of mutually-exclusive intent categories assigned to every inbound
 * message by the IntentResolver. Exactly one category is assigned per message.
 */
export type IntentCategory =
  | 'command' //               begins with '/'
  | 'edge_input' //            empty/whitespace/emoji-only/single-punct
  | 'over_length' //           exceeds MAX_MESSAGE_LENGTH
  | 'price_question' //        Direct_Question about cost/price/value/budget
  | 'direct_question' //       non-price explicit request for information
  | 'preference_continue' //   wants to keep talking with the agent
  | 'preference_human' //      wants a human / proposal now
  | 'handoff_accept' //        accepts a pending handoff offer
  | 'handoff_completed_ack' // simple ack after handoff completed
  | 'desistance' //            gives up / no interest
  | 'frustration' //           irritated, wants to skip questions
  | 'greeting' //              simple greeting
  | 'acknowledgment' //        ok/obrigado/valeu (non-terminal)
  | 'general'; //              anything else -> LLM

/**
 * The result of resolving a single inbound message to one intent category.
 */
export interface ResolvedIntent {
  category: IntentCategory;
  isDirectQuestion: boolean; // true for price_question and direct_question
  priceIntent: boolean; //     convenience flag for price_question
  matchedText?: string; //     debugging / traceability
}

/**
 * The contextual signals the IntentResolver consults while assigning an intent.
 */
export interface IntentContext {
  hasFacts: boolean;
  handoffState: HandoffState;
}

/**
 * An explicit user statement about how the conversation should proceed.
 */
export type StatedPreference = 'continue' | 'human' | 'none';

/**
 * The defined typed commands the agent understands.
 */
export type CommandName = 'clear' | 'reset' | 'help';

/**
 * The result of parsing a possible typed command from an inbound message.
 */
export interface CommandResolution {
  isCommand: boolean; //            raw trimmed text begins with '/'
  name: CommandName | null; //      null => undefined command
  confirmationReply: string; //     confirmation or available-commands listing
  action: 'clear' | 'reset' | 'none';
}

/**
 * The classification of a non-conversational edge input.
 */
export type EdgeKind =
  | 'empty' //       empty after trim
  | 'whitespace' //  whitespace only
  | 'emoji_only' //  only emoji / pictographs
  | 'punctuation' // single punctuation mark or symbol run
  | 'over_length' // exceeds MAX_MESSAGE_LENGTH
  | 'none';

/**
 * The handoff lifecycle state derived from the conversation columns.
 */
export type HandoffState = 'none' | 'suggested' | 'accepted' | 'completed';

/**
 * A durable record of what the agent has already said or offered, used to
 * suppress repetition and re-offers.
 */
export interface SaidRecord {
  offeredDemo: boolean; //         demonstration/simulation already offered
  offeredHandoff: boolean; //      handoff already offered
  explainedAiBehavior: boolean; // AI-behavior explanation already given
  askedVolume: boolean;
  askedSecondaryPains: boolean;
  priorAssistantReplies: string[]; // normalized prior replies for repetition checks
}

/**
 * The single source of truth, per turn, for what is known and what has been
 * said: established facts + handoff state + the said-record.
 */
export interface ConversationContext {
  facts: KnownFacts; //      reused from FactExtractorService
  handoffState: HandoffState;
  said: SaidRecord;
}

/**
 * The inputs the HandoffManager state machine consults to resolve the next
 * handoff state.
 */
export interface HandoffDecisionInput {
  current: HandoffState;
  preference: StatedPreference; // from PreferenceDetector
  intent: IntentCategory;
  hasSegment: boolean;
  hasAtLeastOnePain: boolean;
  userAbandoned: boolean; //      desistance
  /**
   * Whether the lead is qualified enough for an UNSOLICITED handoff offer
   * (segment + deepened pain + volume). When provided, it gates the
   * `none -> suggested` transition (R10.2). When omitted, the manager falls
   * back to the legacy `hasSegment && hasAtLeastOnePain` condition so existing
   * callers/tests keep their behavior.
   */
  qualificationReadyForOffer?: boolean;
}

/**
 * The resolved handoff transition, with an optional confirmation reply when
 * transitioning to accepted/completed.
 */
export interface HandoffDecision {
  next: HandoffState;
  reply?: string; // confirmation when transitioning to accepted/completed
}

/**
 * The inputs the PriceAnswerComposer consults to deterministically answer a
 * price question.
 */
export interface PriceAnswerInput {
  pricingRangeEnabled: boolean;
  startingPriceText: string | null; // PricingConfigView.pricingStartingAtText / pricingText
  handoffState: HandoffState;
}

/**
 * The input to the consolidated ResponseGuard post-processing stage.
 */
export interface GuardInput {
  reply: string;
  userMessage: string;
  intent: IntentCategory;
  context: ConversationContext; // facts + handoffState + said
  pricing: { pricingRangeEnabled: boolean; startingPriceText: string | null };
}

/**
 * The output of the consolidated ResponseGuard post-processing stage.
 */
export interface GuardOutput {
  reply: string;
  changed: boolean;
  guardReason: string | null;
}
