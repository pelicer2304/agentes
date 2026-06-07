# Implementation Plan: ResponseGuardService

## Overview

Implement a deterministic post-processing guard service that applies prioritized text transformation rules to agent replies before persistence. The service replaces the existing `sanitizeReply` private method in `ConversationService` with a dedicated `ResponseGuardService` in the agent module.

## Tasks

- [x] 1. Create GuardInput/GuardOutput interfaces and service skeleton
  - [x] 1.1 Create `apps/api/src/agent/response-guard.service.ts` with GuardInput/GuardOutput interfaces, GuardRule interface, and empty `guard()` method returning unchanged input
    - Define `GuardInput` interface with all fields: reply, userMessage, segment, mainPain, volume, handoffOffered, handoffAccepted, handoffCompleted, priceAskedCount, pricingRangeEnabled, startingPrice, conversationHistory
    - Define `GuardOutput` interface with: reply, changed, guardReason
    - Define internal `GuardRule` interface with: name, priority, type ('full-replace' | 'partial-transform' | 'metadata-only'), applies(), apply()
    - Implement `@Injectable()` class with `guard(input: GuardInput): GuardOutput` that returns `{ reply: input.reply, changed: false, guardReason: null }`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.7_

- [x] 2. Implement Rule 2 — Handoff completed (highest priority)
  - [x] 2.1 Add handoff-completed rule as a full-replace rule with priority 1
    - When `handoffCompleted` is true AND user message matches acceptance phrases ("sim", "pode", "pode encaminhar", "sim pode encaminhar", "tá bom manda", "ta bom manda", "quero proposta", "manda", "ok", "quero sim")
    - Replace entire reply with: "Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário."
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ]* 2.2 Write property test for handoff completed rule
    - **Property 2: Handoff completed always produces fixed response**
    - **Validates: Requirements 2.1, 2.3**

- [x] 3. Implement Rule 4 — Frustrated price (priority 2)
  - [x] 3.1 Add frustrated-price rule as a full-replace rule with priority 2
    - Detect frustration-about-price patterns in user message: "só me diz quanto custa", "não tenho tempo", "não quero contar minha vida", "me dá uma faixa", "quero saber o preço mesmo", "me passa logo", "direto ao ponto"
    - When matched, replace reply with Safe_Price_Response based on `pricingRangeEnabled`
    - If `pricingRangeEnabled` is false: "Sem uma faixa configurada aqui, não consigo te passar um valor fechado. O que posso fazer é encaminhar para a equipe te dar uma estimativa direta com base no seu caso, sem mais perguntas."
    - If `pricingRangeEnabled` is true: reference `startingPrice` from input
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 3.2 Write property test for frustrated price rule
    - **Property 4: Frustrated price always overrides reply**
    - **Validates: Requirements 4.1, 4.3**

- [x] 4. Implement Rule 1 — Isolated handoff with segment templates (priority 3)
  - [x] 4.1 Add isolated-handoff rule as a full-replace rule with priority 3
    - Define SEGMENT_TEMPLATES map with keys: clinica, etiqueta, restaurante, academia, contabil, fallback
    - Detect isolated handoff: reply < 60 chars AND contains handoff question pattern ("encaminhar?", "encaminhe?", "seguir?", "interessa?") AND lacks contextual preamble
    - When detected, replace with segment-appropriate template using `includes()` matching on lowercased segment with aliases (clínica→clinica, fábrica→etiqueta, fitness→academia, escritório→contabil)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 4.2 Write property test for isolated handoff replacement
    - **Property 1: Isolated handoff always replaced with contextual response**
    - **Validates: Requirements 1.1, 1.7, 1.8**

- [x] 5. Implement Rule 3 — Price response fix (priority 4)
  - [x] 5.1 Add price-response-fix rule as a full-replace rule with priority 4
    - Detect price keyword in user message: "preço", "preco", "valor", "custa", "custo", "orçamento", "orcamento", "faixa"
    - Detect price-blocking phrase in reply: "Não trabalho com valores", "Não trabalho com faixas", "não posso informar", "não consigo informar", "prefiro que a equipe"
    - When both conditions match, replace reply with Safe_Price_Response (same logic as Rule 4)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 5.2 Write property test for price-blocking replacement
    - **Property 3: Price-blocking reply replaced with safe response**
    - **Validates: Requirements 3.1, 3.4**

- [x] 6. Implement Rule 5 — Broken phrases and exclamation removal (priority 5)
  - [x] 6.1 Add broken-phrases rule as a partial-transform rule with priority 5
    - Replace "Sua pressa, mas" → "Entendo sua pressa, mas"
    - Replace "Sua pressa." (standalone) → "Entendo sua pressa."
    - Replace "falta de organizam" → "falta de organização"
    - Replace "Não trabalho com valores." → Safe_Price_Response
    - Replace "Não trabalho com faixas de preço." → Safe_Price_Response
    - Replace all exclamation marks `!` with `.`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 6.2 Write property test for exclamation removal
    - **Property 5: No exclamation marks survive**
    - **Validates: Requirements 5.6**

- [x] 7. Implement Rule 6 — IA explanation deduplication (priority 6)
  - [x] 7.1 Add IA-explanation rule as a partial-transform rule with priority 6
    - Detect IA explanation by partial match on "A IA responde com base em regras, base de conhecimento e limites definidos"
    - Check `conversationHistory` for a previous assistant message containing that substring
    - If already present in history: replace with "A ideia é automatizar o que é repetitivo e encaminhar para humano quando o atendimento exigir mais cuidado."
    - If not present in history: keep unchanged
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 7.2 Write property test for IA explanation deduplication
    - **Property 6: IA explanation appears at most once per conversation**
    - **Validates: Requirements 6.1, 6.2**

- [x] 8. Implement Rule 7 — Block premature handoff (priority 7)
  - [x] 8.1 Add block-premature-handoff rule as a metadata-only rule with priority 7
    - When reply contains a handoff offer (question phrasing) AND `handoffAccepted` is false
    - Do NOT modify the reply text
    - Ensure guard output does not enable state escalation to "chamar_humano"
    - _Requirements: 7.1, 7.2_

  - [ ]* 8.2 Write property test for premature handoff blocking
    - **Property 7: No state escalation without explicit acceptance**
    - **Validates: Requirements 7.1, 7.2**

- [x] 9. Implement rule priority engine
  - [x] 9.1 Wire all rules into the `guard()` method with priority ordering
    - Create rules array ordered by priority: Rule2 > Rule4 > Rule1 > Rule3 > Rule5 > Rule6 > Rule7
    - Implement conflict resolution: once a full-replace fires, skip subsequent full-replace rules
    - Always apply partial-transform rules (exclamation removal, broken phrases) to the result
    - Set `changed` and `guardReason` in output based on which rules fired
    - _Requirements: 9.1, 9.2, 9.3, 8.2, 8.3, 8.4_

  - [ ]* 9.2 Write property test for rule priority determinism
    - **Property 9: Rule priority determinism**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [ ]* 9.3 Write property test for output contract invariant
    - **Property 8: Output contract invariant**
    - **Validates: Requirements 8.2, 8.3, 8.4**

- [x] 10. Checkpoint — Verify all rules work in isolation and together
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Integrate into ConversationService
  - [x] 11.1 Register ResponseGuardService in AgentModule and wire into ConversationService
    - Add `ResponseGuardService` to `providers` and `exports` in `apps/api/src/agent/agent.module.ts`
    - Inject `ResponseGuardService` into `ConversationService` constructor
    - Replace the `sanitizeReply` call (step 9e) with `this.responseGuard.guard(...)` call
    - Build `GuardInput` from available context: reply from `finalReply`, userMessage from `content`, segment from `facts.segment`, mainPain from `facts.mainPain`, volume from `facts.volume`, handoff flags from `facts`, priceAskedCount from `facts.priceAskedCount`, pricingRangeEnabled from settings, conversationHistory from `history`
    - Use `guardOutput.reply` as the new `finalReply`
    - Log `guardOutput.guardReason` when changed
    - Remove the `private sanitizeReply()` method from ConversationService
    - _Requirements: 8.5, 8.6, 8.7_

- [ ] 12. Unit tests for all rules
  - [ ]* 12.1 Write unit tests for Rule 2 (handoff completed) covering each acceptance phrase
    - Test each acceptance phrase variant triggers the fixed response
    - Test non-acceptance phrases with handoffCompleted=true do NOT trigger
    - _Requirements: 2.1, 2.2_

  - [ ]* 12.2 Write unit tests for Rule 4 (frustrated price) covering each frustration pattern
    - Test each frustration phrase triggers Safe_Price_Response
    - Test pricingRangeEnabled=true vs false output differences
    - _Requirements: 4.1, 4.2_

  - [ ]* 12.3 Write unit tests for Rule 1 (isolated handoff) covering each segment template
    - Test each segment produces the correct template (clinica, etiqueta, restaurante, academia, contabil, fallback)
    - Test segment aliases (clínica → clinica template, fábrica → etiqueta template, etc.)
    - Test replies ≥ 60 chars are NOT treated as isolated handoff
    - _Requirements: 1.1–1.8_

  - [ ]* 12.4 Write unit tests for Rule 3 (price response fix) covering detection and replacement
    - Test price keyword + blocking phrase triggers replacement
    - Test price keyword alone (no blocking phrase) does NOT trigger
    - _Requirements: 3.1, 3.4_

  - [ ]* 12.5 Write unit tests for Rule 5 (broken phrases) covering each correction
    - Test each specific broken phrase replacement
    - Test exclamation mark removal
    - _Requirements: 5.1–5.6_

  - [ ]* 12.6 Write unit tests for Rule 6 (IA explanation) covering first vs duplicate
    - Test first occurrence is preserved
    - Test duplicate is replaced with short alternative
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 12.7 Write unit tests for Rule 7 (block premature handoff)
    - Test handoff offer with handoffAccepted=false does not escalate
    - _Requirements: 7.1, 7.2_

  - [ ]* 12.8 Write integration test verifying ConversationService calls guard correctly
    - Mock ResponseGuardService and verify it's called after reply generation and before message save
    - _Requirements: 8.5_

- [x] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using `fast-check`
- Unit tests validate specific examples and edge cases using Jest
- The service is pure/deterministic — no mocks needed for unit testing the guard logic itself
- Only ConversationService integration requires mocking (task 12.8)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1", "7.1", "8.1"] },
    { "id": 2, "tasks": ["2.2", "3.2", "4.2", "5.2", "6.2", "7.2", "8.2", "9.1"] },
    { "id": 3, "tasks": ["9.2", "9.3"] },
    { "id": 4, "tasks": ["11.1"] },
    { "id": 5, "tasks": ["12.1", "12.2", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8"] }
  ]
}
```
