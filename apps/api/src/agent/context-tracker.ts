/**
 * ContextTracker — the single source of truth, per turn, for what is known and
 * what has already been said (Requirements 3, 5, 6, 9).
 *
 * It wraps the existing `FactExtractorService` (which derives `KnownFacts`
 * without calling the LLM) and augments those facts with:
 *   - the derived `HandoffState` (mapped from the conversation columns and
 *     stage onto the lifecycle enum), and
 *   - a `SaidRecord` describing what the agent has already offered/explained,
 *     including the normalized prior assistant replies used for repetition
 *     control.
 *
 * `build` recomputes the `ConversationContext` for the current turn and caches
 * it so the two query helpers (`isKnownAndUnambiguous` and `isRepetition`) can
 * answer against the most recently built context without re-extracting.
 *
 * Feature: conversational-agent-quality
 */
import { Injectable } from '@nestjs/common';

import {
  ConversationContext,
  HandoffState,
  KnownFacts,
  SaidRecord,
} from './conversation-types';
import { FactExtractorService } from './fact-extractor.service';

/**
 * The argument shapes accepted by `build` are kept identical to those accepted
 * by `FactExtractorService.extract`, so the tracker is a drop-in wrapper.
 */
type ExtractParams = Parameters<FactExtractorService['extract']>;
type LeadInput = ExtractParams[0];
type ConversationInput = ExtractParams[1];
type HistoryInput = ExtractParams[2];

/**
 * Phrases that signal the agent offered a demonstration/simulation. Matched
 * (case- and diacritic-insensitively) against assistant messages and against
 * candidate replies for offer-signature repetition checks.
 */
const DEMO_SIGNATURE_KEYWORDS = [
  'simular',
  'simulacao', // "simulação" after diacritic stripping
  'demonstracao', // "demonstração" after diacritic stripping
  'ver na pratica', // "ver na prática" after diacritic stripping
];

/**
 * Phrases that signal the agent offered a handoff to the team. The
 * fact-extractor's own handoff-offered detection is reused via
 * `facts.handoffOffered`; this list adds the generic "encaminhar" signature.
 */
const HANDOFF_SIGNATURE_KEYWORDS = ['encaminhar'];

/**
 * Canned AI-behavior explanation signature (R6 / R2.4).
 */
const AI_BEHAVIOR_SIGNATURE = 'a ia responde com base em regras';

/**
 * String values that, although present, are too ambiguous to count as an
 * established fact (so the agent may still ask about them).
 */
const AMBIGUOUS_VALUES = new Set([
  'nao sei',
  'sei la',
  'talvez',
  'n sei',
  'sei nao',
  '?',
]);

/**
 * Normalizes free text for repetition comparison: lowercases, strips diacritics
 * and punctuation/symbols, and collapses whitespace to single spaces.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation/symbols
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Returns true when the normalized text contains any of the given keywords.
 */
function containsAny(normalizedText: string, keywords: string[]): boolean {
  return keywords.some((kw) => normalizedText.includes(kw));
}

@Injectable()
export class ContextTrackerService {
  /**
   * The most recently built context, cached so the query helpers can answer
   * without re-running extraction. `null` until `build` is first called.
   */
  private lastContext: ConversationContext | null = null;

  constructor(private readonly factExtractor: FactExtractorService) {}

  /**
   * Builds the per-turn `ConversationContext`: established facts + derived
   * handoff state + the said-record. Caches the result for the query helpers.
   */
  build(
    lead: LeadInput,
    conversation: ConversationInput,
    history: HistoryInput,
  ): ConversationContext {
    const facts = this.factExtractor.extract(lead, conversation, history);
    const handoffState = this.deriveHandoffState(facts, conversation.stage);
    const said = this.buildSaidRecord(facts, history);

    const context: ConversationContext = { facts, handoffState, said };
    this.lastContext = context;
    return context;
  }

  /**
   * Maps the handoff columns/stage onto the `HandoffState` lifecycle enum:
   *   completed if handoffCompleted (or stage 'handoff_humano'),
   *   else accepted if handoffAccepted,
   *   else suggested if handoffOffered,
   *   else none.
   */
  private deriveHandoffState(facts: KnownFacts, stage: string): HandoffState {
    if (facts.handoffCompleted || stage === 'handoff_humano') {
      return 'completed';
    }
    if (facts.handoffAccepted) {
      return 'accepted';
    }
    if (facts.handoffOffered) {
      return 'suggested';
    }
    return 'none';
  }

  /**
   * Derives the said-record by scanning the assistant messages in history and
   * reusing the already-computed fact flags.
   */
  private buildSaidRecord(
    facts: KnownFacts,
    history: HistoryInput,
  ): SaidRecord {
    const assistantContents = history
      .filter((msg) => msg.role === 'assistant')
      .map((msg) => msg.content);

    const normalizedAssistant = assistantContents.map(normalize);

    const offeredDemo = normalizedAssistant.some((c) =>
      containsAny(c, DEMO_SIGNATURE_KEYWORDS),
    );
    const offeredHandoff =
      facts.handoffOffered ||
      normalizedAssistant.some((c) => containsAny(c, HANDOFF_SIGNATURE_KEYWORDS));
    const explainedAiBehavior = normalizedAssistant.some((c) =>
      c.includes(AI_BEHAVIOR_SIGNATURE),
    );

    return {
      offeredDemo,
      offeredHandoff,
      explainedAiBehavior,
      askedVolume: facts.volumeAsked,
      askedSecondaryPains: facts.secondaryPainsAsked,
      priorAssistantReplies: normalizedAssistant.filter((c) => c.length > 0),
    };
  }

  /**
   * Returns true when the given fact field is established and unambiguous, so
   * the agent must not ask about it again (R3.2).
   *
   * - string fields: non-empty after trim and not an ambiguity marker
   * - string[] fields: at least one entry
   * - everything else (numbers, booleans, null): not a re-askable fact
   */
  isKnownAndUnambiguous(field: keyof KnownFacts): boolean {
    if (!this.lastContext) return false;
    const value = this.lastContext.facts[field];

    if (value == null) return false;

    if (typeof value === 'string') {
      const normalized = normalize(value);
      if (normalized.length === 0) return false;
      return !AMBIGUOUS_VALUES.has(normalized);
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return false;
  }

  /**
   * Returns true when the candidate reply repeats something already said
   * (R6.1). A candidate is a repetition when its normalized form exactly
   * matches a prior assistant reply, or when it carries a demo/simulation or
   * handoff offer-signature that was already made (per the said-record).
   */
  isRepetition(candidateReply: string): boolean {
    if (!this.lastContext) return false;
    const normalized = normalize(candidateReply);
    if (normalized.length === 0) return false;

    const { said } = this.lastContext;

    if (said.priorAssistantReplies.includes(normalized)) {
      return true;
    }

    if (said.offeredDemo && containsAny(normalized, DEMO_SIGNATURE_KEYWORDS)) {
      return true;
    }

    if (
      said.offeredHandoff &&
      containsAny(normalized, HANDOFF_SIGNATURE_KEYWORDS)
    ) {
      return true;
    }

    return false;
  }
}
