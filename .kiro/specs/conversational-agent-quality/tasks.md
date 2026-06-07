# Implementation Plan: Conversational Agent Quality

## Overview

This plan rebuilds the conversational decision and response logic in `apps/api/src/agent/` and `apps/api/src/conversation/` as a single linear, deterministic pipeline. The work is bottom-up: pure functions first (intent resolution, preference detection, command parsing, edge classification, price composition, the handoff state machine, guard transforms, and scoring), each validated by property-based tests with fast-check; then the integration layer (ContextTracker, the consolidated ResponseGuard, and the rewritten ConversationService pipeline); then wiring into `agent.module`; and finally a build + test-suite verification.

The implementation language is **TypeScript** (the existing api workspace stack: NestJS + Jest). Property-based tests use **fast-check** with a minimum of 100 iterations per property and a tag comment in the form `// Feature: conversational-agent-quality, Property {n}: {text}`.

## Tasks

- [x] 1. Set up shared agent types and the fast-check test dependency
  - Create `apps/api/src/agent/conversation-types.ts` defining the in-memory contracts shared across the pipeline: `IntentCategory`, `ResolvedIntent`, `IntentContext`, `StatedPreference`, `CommandName`, `CommandResolution`, `EdgeKind`, `HandoffState`, `SaidRecord`, `ConversationContext`, `HandoffDecisionInput`, `HandoffDecision`, `PriceAnswerInput`, `GuardInput`, `GuardOutput`
  - Re-export `KnownFacts` from `fact-extractor.service.ts` so the new types compose with the existing fact shape
  - Add `fast-check` as a devDependency in `apps/api/package.json` and confirm it resolves under the existing Jest config
  - _Requirements: 1.1, 4.1, 5.1, 7.1, 10.1_

- [x] 2. Intent resolution (evolve `intent-classifier.ts` into IntentResolver)
  - [x] 2.1 Implement `resolveIntent` in `apps/api/src/agent/intent-resolver.ts`
    - Migrate and broaden the logic from `intent-classifier.ts` into a pure `resolveIntent(rawMessage, ctx)` that returns exactly one `IntentCategory` for every input
    - Broaden price detection to a price keyword (`preço`, `preco`, `valor`, `valores`, `custa`, `custo`, `orçamento`, `quanto`, `investimento`) combined with an interrogative/desire marker, independent of whether a segment is known
    - Fix resolution order so frustration phrases are checked before price, ambiguous text falls through to `general`, and the mapping is fixed and documented in code
    - Surface `preference_continue` / `preference_human` categories sourced from the PreferenceDetector
    - _Requirements: 1.1, 1.2, 2.1, 7.4_
  - [x]* 2.2 Write property test for intent totality and determinism
    - **Property 1: Intent resolution is total and deterministic**
    - **Validates: Requirements 1.1, 1.2**
  - [x]* 2.3 Write property test for price phrasing resolution
    - **Property 2: Price phrasings resolve to the price intent**
    - **Validates: Requirements 1.1, 2.1**
  - [x]* 2.4 Update and extend `intent-classifier.spec.ts` regression cases
    - Migrate existing assertions to the new resolver API and add cases for natural price phrasings (e.g. "queria saber valores") and frustration-vs-price precedence
    - _Requirements: 1.1, 1.2, 2.1_

- [x] 3. PreferenceDetector
  - [x] 3.1 Implement `detectPreference` in `apps/api/src/agent/preference-detector.ts`
    - Pure `detectPreference(rawMessage): StatedPreference` returning `continue`, `human`, or `none`
    - Recognize continue phrasings ("quero continuar falando com você", "não quero ser transferido", "não precisa passar pra ninguém") and human phrasings ("quero falar com atendente", "me passa pra alguém agora", "quero uma proposta")
    - _Requirements: 7.1, 7.3, 7.4_
  - [x]* 3.2 Write unit tests for preference detection
    - Cover continue, human, and none phrasings plus ambiguous text that must return `none`
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 4. CommandHandler
  - [x] 4.1 Implement command resolution in `apps/api/src/agent/command-handler.ts`
    - Pure `resolveCommand(rawMessage): CommandResolution` mapping `/clear`, `/reset`, `/help` to actions and confirmation replies that name the action performed, tolerant of casing and surrounding whitespace
    - Undefined `/token` returns `isCommand: true, name: null` with the available-commands listing via `availableCommandsReply()`
    - _Requirements: 4.1, 4.2, 4.4_
  - [x]* 4.2 Write property test for defined-command resolution
    - **Property 9: Defined commands execute, confirm, and bypass the LLM** (resolution + confirmation portion; LLM-bypass asserted in pipeline task 11.3)
    - **Validates: Requirements 4.1, 4.2**
  - [x]* 4.3 Write property test for undefined slash tokens
    - **Property 10: Undefined slash tokens list available commands**
    - **Validates: Requirements 4.4**

- [x] 5. EdgeInputHandler
  - [x] 5.1 Implement edge classification in `apps/api/src/agent/edge-input.ts`
    - Export `MAX_MESSAGE_LENGTH = 4000`, pure `classifyEdgeInput(rawMessage): EdgeKind` (empty, whitespace, emoji_only, punctuation, over_length, none) and `edgeReply(kind): string`
    - Every non-`none` reply invites the user to restate in words and contains no "difficulty processing" phrasing; `over_length` states the supported limit
    - _Requirements: 5.1, 5.3, 5.4_
  - [x]* 5.2 Write property test for edge replies
    - **Property 11: Edge inputs invite a restatement and never report processing trouble**
    - **Validates: Requirements 5.1, 5.4**
  - [x]* 5.3 Write property test for over-length classification and reply
    - **Property 13: Over-length messages are rejected with the limit stated** (classification + reply portion; LLM-bypass asserted in pipeline task 11.3)
    - **Validates: Requirements 5.3**

- [x] 6. PriceAnswerComposer
  - [x] 6.1 Implement `composePriceAnswer` in `apps/api/src/agent/price-answer.ts`
    - Pure `composePriceAnswer(input: PriceAnswerInput): string` that always acknowledges price intent
    - When range enabled with non-empty starting-price text: include the configured text and exclude any AI-behavior explanation and any refusal-to-discuss-price phrasing
    - When range disabled: state the final value depends on scope and offer to route the lead to the team
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x]* 6.2 Write property test for price acknowledgement and no refusal
    - **Property 3: Price answers acknowledge price and never refuse**
    - **Validates: Requirements 2.1, 2.4, 2.5, 1.2**
  - [x]* 6.3 Write property test for enabled price range sharing
    - **Property 4: Enabled price range is always shared**
    - **Validates: Requirements 2.2**
  - [x]* 6.4 Write property test for disabled price range routing
    - **Property 5: Disabled price range explains scope and offers routing**
    - **Validates: Requirements 2.3, 1.3**

- [x] 7. HandoffManager state machine
  - [x] 7.1 Implement `HandoffManagerService.resolve` in `apps/api/src/agent/handoff-manager.ts`
    - Implement the transition precedence: continue→`none`, abandon→`none`, human/proposal→`accepted`, accept pending→`accepted`, unsolicited offer gate (`hasSegment && hasAtLeastOnePain`) for `none→suggested`, otherwise monotonic `max(current, derived)`
    - Emit confirmation `reply` when transitioning to `accepted`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 10.1, 10.2, 10.3, 10.6_
  - [x]* 7.2 Write property test for stated-preference precedence
    - **Property 16: The most recent stated preference determines handoff state**
    - **Validates: Requirements 7.1, 7.3, 7.4, 10.1**
  - [x]* 7.3 Write property test for continue-preference suppressing handoff
    - **Property 17: While the user prefers to continue, no handoff is offered**
    - **Validates: Requirements 7.2, 3.3**
  - [x]* 7.4 Write property test for accepting a pending offer
    - **Property 18: Accepting a pending offer confirms handoff**
    - **Validates: Requirements 10.3**
  - [x]* 7.5 Write property test for the unsolicited-offer gate
    - **Property 19: No unsolicited handoff without segment and a pain**
    - **Validates: Requirements 10.2**
  - [x]* 7.6 Write property test for monotonicity once accepted
    - **Property 20: Handoff state is monotonic once accepted**
    - **Validates: Requirements 10.6**

- [x] 8. LeadQualifier scoring (preserve `score-calculator.ts`)
  - [x] 8.1 Confirm and adjust `calculateScore` and temperature mapping in `apps/api/src/agent/score-calculator.ts`
    - Ensure `calculateScore(facts)` returns an integer in [0, 100] determined solely by facts and the temperature mapping is `quente` ≥ 70, `morno` 40–69, `frio` < 40
    - Expose a helper for the pipeline to enforce the non-decreasing rule at state resolution (clamp persisted score to `max(previous, computed)`)
    - _Requirements: 9.1, 9.2, 9.3_
  - [x]* 8.2 Write property test for deterministic, bounded, temperature-consistent score
    - **Property 22: Lead score is deterministic, bounded, and temperature-consistent**
    - **Validates: Requirements 9.1, 9.2**
  - [x]* 8.3 Write property test for non-decreasing score
    - **Property 23: Lead score never decreases on an active conversation**
    - **Validates: Requirements 9.3**

- [x] 9. Checkpoint - pure functions complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. ContextTracker and consolidated ResponseGuard
  - [x] 10.1 Implement `ContextTrackerService` in `apps/api/src/agent/context-tracker.ts`
    - Wrap `FactExtractorService` to `build(lead, conversation, history): ConversationContext` producing `facts` + `handoffState` (mapped from `handoffOffered`/`handoffAccepted`/`handoffCompleted`/stage) + `SaidRecord` (offered demo/handoff, AI-behavior explained, asked flags, normalized prior assistant replies)
    - Implement `isKnownAndUnambiguous(field)` and `isRepetition(candidateReply)` (normalize lowercase, strip punctuation, collapse whitespace; compare to prior replies and offer-signatures)
    - _Requirements: 3.2, 5.2, 6.1, 9.4_
  - [x]* 10.2 Write property test for known-fact suppression
    - **Property 7: Known unambiguous facts are never asked again** (ContextTracker prohibited-set + guard flag portion)
    - **Validates: Requirements 3.2**
  - [x] 10.3 Consolidate tone/sanitization rules and repetition guard into `response-guard.service.ts`
    - Migrate `applySanitization`, `applyToneCleanup`, and broken-fragment repair from `normalize-output.service.ts` into `ResponseGuardService`; preserve mutually-exclusive `full-replace` rule semantics and per-rule try/catch
    - Add the repetition guard (replace a repeated reply with the pending answer or a different next step; never re-offer demo/simulation in the `SaidRecord` unless requested)
    - Add single-question shaping (keep first `?`, drop the rest) and answer-before-follow-up ordering; strip internal field values/state labels/system identifiers; replace `!` with `.`
    - Update the guard to the `GuardInput`/`GuardOutput` contract and remove the now-dead `NormalizeOutputService` from active use
    - _Requirements: 1.4, 3.4, 6.1, 6.2, 6.3, 6.4, 8.1, 8.2, 8.3, 8.4_
  - [x]* 10.4 Write property test for answer-before-follow-up ordering
    - **Property 6: Answer precedes follow-up question**
    - **Validates: Requirements 1.4**
  - [x]* 10.5 Write property test for non-repetition
    - **Property 14: Replies are not repetitions**
    - **Validates: Requirements 6.1, 6.2**
  - [x]* 10.6 Write property test for at-most-once unsolicited demonstration
    - **Property 15: A demonstration is offered at most once unsolicited**
    - **Validates: Requirements 6.3, 6.4**
  - [x]* 10.7 Write property test for single-question shaping
    - **Property 24: Replies contain at most one question**
    - **Validates: Requirements 8.2**
  - [x]* 10.8 Write property test for internal-label exclusion
    - **Property 25: Replies exclude internal labels and identifiers**
    - **Validates: Requirements 8.3**
  - [x]* 10.9 Write property test for broken-fragment repair
    - **Property 26: Broken fragments are repaired**
    - **Validates: Requirements 8.4**

- [x] 11. ConversationService pipeline rewrite
  - [x] 11.1 Refocus `AgentReplyService` (ResponseComposer) for the LLM path
    - Restrict the LLM call to `direct_question` (non-price) and `general` intents; build the prompt from `ContextTracker` (known facts → prohibited questions, `SaidRecord` → do-not-re-offer), request answer-before-follow-up and direct-question subject-first handling
    - On empty/unparseable output, return empty so the pipeline can substitute the contextual fallback
    - _Requirements: 1.1, 1.3, 1.4, 3.1, 3.4_
  - [x] 11.2 Implement the contextual fallback derivation
    - Add a fact-derived fallback (in `AgentReplyService` or a small helper) that is non-empty, references available facts, and is never the generic "difficulty processing" message
    - _Requirements: 3.1, 3.4_
  - [x]* 11.3 Write property test for the contextual fallback
    - **Property 8: Contextual fallback is non-empty and fact-derived**
    - **Validates: Requirements 3.4, 3.1**
  - [x] 11.4 Rewrite `ConversationService.handleInboundMessage` as the linear pipeline
    - Order the stages: over-length rejection → command resolution → edge handling → context extraction → intent resolution → deterministic answers (price, preference, handoff accept/complete, greeting, ack, desistance) → LLM composition → contextual fallback → response guard → handoff state + score resolution → persist message/lead/conversation → fire async analysis → return `{ message, qualification }`
    - Ensure edge inputs return before any fact mutation/persistence beyond storing the raw inbound message; wire typed `/clear` and `/reset` to the existing `clearConversation`/reset code path; remove the `BadRequestException` over-length throw
    - Enforce the non-decreasing score clamp and persist newly established facts to the lead on every turn; preserve `AgentAnalysisService.runAsync` exactly
    - _Requirements: 1.4, 3.3, 4.1, 4.3, 5.2, 5.3, 9.1, 9.3, 9.4, 10.4, 10.5_
  - [x]* 11.5 Write property test for edge-input fact preservation
    - **Property 12: Edge inputs preserve established facts** (asserted over pipeline handling)
    - **Validates: Requirements 5.2**
  - [x]* 11.6 Write property test for completed-handoff shaping
    - **Property 21: Completed handoff shapes acknowledgments and questions**
    - **Validates: Requirements 10.4, 10.5**
  - [x]* 11.7 Write integration and mock-based tests for the pipeline
    - Mock the LLM provider and PrismaService; assert stage ordering (command → edge → price → preference → LLM) and that command/edge/price paths never invoke the LLM (completes Properties 9 and 13 bypass assertions)
    - Assert typed `/clear` and `/reset` trigger the same clear/reset persistence path as the HTTP endpoints, and that `lead.update` is called with newly established facts (R9.4)
    - _Requirements: 4.1, 4.3, 5.3, 9.4_

- [x] 12. Wire components into the module
  - [x] 12.1 Register providers in `apps/api/src/agent/agent.module.ts`
    - Add `ContextTrackerService`, `HandoffManagerService` and export the pure-function modules; remove `NormalizeOutputService` from active providers (or mark deprecated) now that its rules live in `ResponseGuardService`
    - Update `apps/api/src/agent/index.ts` exports and ensure `ConversationModule` receives the providers it depends on
    - _Requirements: 1.1, 3.2, 7.1, 10.1_
  - [x]* 12.2 Update `agent.module.spec.ts` and `conversation.service.spec.ts`
    - Update existing module/service specs to the restructured pipeline and provider graph
    - _Requirements: 1.1, 3.3, 9.1_

- [x] 13. Final checkpoint - build and full test suite
  - Run the api workspace build (`npm run build`) and the api Jest suite (single run, not watch mode); fix any type, lint, or test failures before completion
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but each property test directly validates a design correctness property and is recommended.
- Property-based tests use fast-check with `{ numRuns: 100 }` minimum and a `// Feature: conversational-agent-quality, Property {n}: {text}` tag comment.
- Properties 9 and 13 are split: the pure-function portion is tested at the component (tasks 4.2 / 5.3) and the LLM-bypass portion is asserted in the pipeline integration test (task 11.7).
- LLM-shaped behaviors (R1.1, R1.2, R1.3 general, R3.1, R6.4 general, R10.5 answer, R8.1 tone) are covered by example and mock-based tests rather than properties, per the design's Testing Strategy.
- No database migrations are required; all needed columns already exist.
- Each task references specific requirements for traceability; checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.2", "4.2", "4.3", "5.2", "5.3", "6.2", "6.3", "6.4", "7.2", "7.3", "7.4", "7.5", "7.6", "8.2", "8.3"] },
    { "id": 3, "tasks": ["10.1", "10.3"] },
    { "id": 4, "tasks": ["10.2", "10.4", "10.5", "10.6", "10.7", "10.8", "10.9", "11.1", "11.2"] },
    { "id": 5, "tasks": ["11.3", "11.4"] },
    { "id": 6, "tasks": ["11.5", "11.6", "11.7", "12.1"] },
    { "id": 7, "tasks": ["12.2"] }
  ]
}
```
