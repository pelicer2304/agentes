# Implementation Plan: WhatsApp Evolution Production Integration

## Overview

This plan wires the **frozen** DecodificaIA engine to real WhatsApp traffic via the Evolution API and prepares the app for EasyPanel deployment. It builds from the data layer up: schema/config foundations first, then the channel abstraction and Evolution transport, then the inbound orchestration that wraps the engine, then handoff side-effects, auth, dashboard back-end, security, logging, frontend, and deployment.

The engine (`ConversationService.handleInboundMessage`, `AgentReplyService`, `AgentAnalysisService`, `ResponseGuardService`, `FactExtractorService`, `score-calculator`, prompts) is NOT modified. The single permitted edit is wiring `Pricing_Config` into the already-existing `GuardInput.pricingRangeEnabled` / `GuardInput.startingPrice` fields (Task 6.2).

Language/stack: TypeScript — NestJS (`apps/api`), React + Vite + Tailwind (`apps/web`). Property-based tests use `fast-check` at minimum 100 iterations, one test per design property, each tagged `// Feature: whatsapp-evolution-production, Property {number}: ...`.

## Tasks

- [x] 1. Prisma schema extensions and additive migration
  - [x] 1.1 Extend the Prisma schema with WhatsApp production models and fields
    - Add to `Conversation`: `instanceName`, `externalChatId`, `botPaused` (default false), `assignedTo`, `handoffOffered`, `handoffAccepted`, `handoffCompleted` (defaults false), `lastInboundAt`, `lastOutboundAt`, `assignee` relation, `botEvents` relation, and `@@index([channel, instanceName, status])`
    - Add to `Message`: `externalMessageId`, `externalChatId`, `instanceName`, `messageType`, `rawPayload`, `deliveryStatus`, plus `@@index([externalMessageId, instanceName])`
    - Add new models `WebhookLog` (`webhook_logs`), `BotEvent` (`bot_events`), `User` (`users`), `PricingConfig` (`pricing_config`) exactly as specified in the design Data Models
    - All added columns on existing models are nullable or defaulted to preserve Playground data
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 1.2 Create the additive `add_whatsapp_production` migration with the partial unique idempotency index
    - Generate the migration with ALTER TABLE (additive only) for `conversations` and `messages`, and CREATE TABLE for `webhook_logs`, `bot_events`, `users`, `pricing_config`
    - Append raw SQL: `CREATE UNIQUE INDEX uq_message_idempotency ON messages (external_message_id, instance_name) WHERE external_message_id IS NOT NULL AND instance_name IS NOT NULL;`
    - Confirm no column is dropped or retyped so existing Playground rows remain valid
    - _Requirements: 7.1, 19.6_

  - [x] 1.3 Seed Pricing_Config defaults and an initial admin User
    - Extend `prisma/seed.ts` to upsert a single `pricing_config` row with `pricingRangeEnabled=true`, `pricingStartingAt=2500`, `pricingText` per Requirement 17.2
    - Upsert one initial `admin` `User` with a bcrypt-hashed password
    - _Requirements: 17.2, 20.3_

  - [ ]* 1.4 Write integration test for additive migration preserving Playground data
    - Apply the migration against a seeded Playground dataset and assert existing leads/conversations/messages remain readable and that the idempotency index allows multiple NULL/NULL Playground rows
    - _Requirements: 19.6_

- [x] 2. Configuration schema and service extensions (fail-fast)
  - [x] 2.1 Extend `config.schema.ts` (Joi) with all new environment variables
    - Add `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_WEBHOOK_SECRET`, `PUBLIC_API_URL`, `BOT_AUTO_REPLY_ENABLED`, `BOT_PAUSE_ON_HANDOFF`, `ADMIN_WHATSAPP_NUMBERS`, `PRICING_RANGE_ENABLED`, `PRICING_STARTING_AT`, `PRICING_TEXT`, `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `MODEL_NAME`, `LLM_MODEL_FALLBACK`, `JWT_SECRET` with validation rules and defaults from the design Config Schema Extensions
    - Ensure startup halts on the first invalid/missing required variable, reports its name, and exits non-zero before binding the HTTP port
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 2.2 Extend `AppConfigService` with typed getters for the new values
    - Add getters such as `evolutionApiUrl`, `evolutionApiKey`, `evolutionInstanceName`, `evolutionWebhookSecret`, `publicApiUrl`, `botAutoReplyEnabled`, `botPauseOnHandoff`, `adminWhatsappNumbers` (parsed to `string[]`), pricing getters, LLM getters, and `jwtSecret`
    - _Requirements: 4.1, 4.2_

  - [ ]* 2.3 Write property test for LLM_PROVIDER validation
    - **Property 29: LLM_PROVIDER validation**
    - **Validates: Requirements 4.4**

  - [ ]* 2.4 Write property test for boolean configuration validation
    - **Property 30: Boolean configuration validation**
    - **Validates: Requirements 4.5**

  - [ ]* 2.5 Write property test for PRICING_STARTING_AT range validation
    - **Property 31: PRICING_STARTING_AT range validation**
    - **Validates: Requirements 4.6**

  - [ ]* 2.6 Write unit tests for per-variable defaults and fail-fast naming
    - Test default application when a variable is absent or empty, and that the reported error names the offending required variable
    - _Requirements: 4.2, 4.3_

- [x] 3. Channel abstraction evolution
  - [x] 3.1 Evolve `channel-adapter.interface.ts` with the finalized contract
    - Define `ChannelName`, `SendMessageParams`, the richer `InboundMessage`, the `ChannelAdapter` interface (`channel`, `sendMessage(params)`, `normalizeInbound(payload)`), and `CHANNEL_ADAPTER_REGISTRY`
    - Retire the legacy `CHANNEL_ADAPTER` token usage
    - _Requirements: 2.1, 2.4_

  - [x] 3.2 Create `ChannelAdapterRegistry` to resolve adapters by channel
    - Map `ChannelName → ChannelAdapter`; expose `get(channel)` resolution
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Update `PlaygroundChannelAdapter` to the new method shapes
    - Implement `channel='playground'`, no-op `sendMessage(params)`, and `normalizeInbound` populating `channel:'playground'`, `from:senderIdentifier`, `content`, `messageType:'text'`, nulls for WhatsApp-only fields
    - Keep the Playground HTTP request/response flow unchanged
    - _Requirements: 2.2, 2.5, 1.2_

  - [x] 3.4 Update `ChannelModule` to provide the registry and retire the old Evolution stub
    - Register the registry and both adapters; delete the old `apps/api/src/channel/evolution-channel.adapter.ts` stub and its spec
    - _Requirements: 2.3, 2.5_

  - [ ]* 3.5 Write unit tests for the registry and Playground adapter shape
    - Assert registry resolves both channels and the Playground adapter normalizes to the new shape with `sendMessage` as no-op
    - _Requirements: 2.2, 2.5_

- [x] 4. Evolution module: types, normalizer, HTTP service, adapter
  - [x] 4.1 Create `evolution.types.ts` with payload and response types
    - Define raw Evolution payload types and `EvolutionResult<T>` discriminated union, `InstanceStatus`, `ConnectResult`
    - _Requirements: 3.2_

  - [x] 4.2 Implement `evolution-normalizer.ts` as a pure function
    - Extract `data.key.id`, `remoteJid`/`fromMe`, `pushName`, message content; decide `messageType`; reject when `externalMessageId`, `from`, or `content` missing; flag `fromMe`, group JIDs (`@g.us`), and types outside `{text,audio,image,document}`
    - Return `InboundMessage | NormalizationReject` deterministically
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 4.3 Write property test for inbound text normalization completeness
    - **Property 1: Inbound text normalization completeness**
    - **Validates: Requirements 2.4, 6.1**

  - [x] 4.4 Implement `EvolutionService` HTTP client with key-safe results
    - Implement `sendTextMessage`, `getInstanceStatus`, `connectInstance`, `getQRCode`, `restartInstance`, `setWebhook` (uses `PUBLIC_API_URL` + `/webhooks/evolution`), `logoutInstance`, `sendTypingOrPresence`
    - Send the `apikey` header server-side only; catch all errors and return `{ ok:false, error }` with the API key scrubbed to `***`
    - _Requirements: 14.1, 14.2, 14.3, 18.2_

  - [ ]* 4.5 Write property test for credential safety in outputs and logs
    - **Property 18: Credential safety in outputs and logs**
    - **Validates: Requirements 14.3, 18.2, 18.6**

  - [x] 4.6 Implement `EvolutionChannelAdapter` and `evolution.module.ts`
    - Adapter (`channel='whatsapp'`) delegates `sendMessage` to `EvolutionService.sendTextMessage` and `normalizeInbound` to the normalizer; module registers service, adapter, and (Task 6) webhook controller with DI and self-registers in the registry
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.3_

  - [ ]* 4.7 Write smoke test that the Evolution module resolves and exposes all operations
    - Assert the module compiles, all providers resolve, and `EvolutionService` exposes every required operation
    - _Requirements: 3.3, 14.1_

- [x] 5. Pricing configuration service and wiring seam
  - [x] 5.1 Implement `PricingConfigService`
    - `get()` returns the `pricing_config` row (creating defaults if absent); expose `pricingRangeEnabled`, `pricingStartingAt`, `pricingText`, and a formatted `pricingStartingAtText` (`R$ 2.500`); `update()` persists new values
    - _Requirements: 17.1, 17.2, 17.5_

  - [x] 5.2 Wire Pricing_Config into the frozen ConversationService GuardInput
    - Add a `PricingConfigService` constructor dependency and replace ONLY the two hardcoded literals when building `guardInput`: `pricingRangeEnabled: pricing.pricingRangeEnabled` and `startingPrice: pricing.pricingStartingAtText`
    - Change no other conversational logic
    - _Requirements: 17.3, 17.5_

  - [ ]* 5.3 Write property test for configured pricing reflected in price replies
    - **Property 24: Configured pricing is reflected in price replies**
    - **Validates: Requirements 17.3, 17.5**

  - [ ]* 5.4 Write unit test for pricing insistence follow-up response
    - Verify the follow-up pricing response on repeated price questions while `pricingRangeEnabled` is true
    - _Requirements: 17.4_

- [x] 6. Inbound orchestration and webhook controller
  - [x] 6.1 Implement `InboundMessageProcessor` core pipeline and `inbound.module.ts`
    - Implement `process(payload)`: record `webhook_log` + `webhook_received` event → normalize → filter (fromMe/group/unsupported/malformed) → idempotency check on `(externalMessageId, instanceName)` → resolve lead/conversation → gating → `invokeEngineWithTimeout` → send reply → persist outbound + events → return `ProcessOutcome`
    - Truncate content to first 4000 chars before invoking the engine; back-fill WhatsApp provenance onto the engine-created inbound Message; treat unique-constraint races as duplicates
    - _Requirements: 6.7, 6.8, 7.3, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 6.2 Implement lead/conversation resolution and contact-name assignment
    - Create-or-reuse Lead by sender phone; create-or-reuse active Conversation by `(leadId, channel='whatsapp', instanceName)`; set Lead name from `contactName` when unset, swallowing failures
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 6.3 Implement gating, unsupported-media handling, and timeout fallback
    - Gate when `BOT_AUTO_REPLY_ENABLED=false`, `botPaused=true`, or `handoffCompleted=true` (save inbound, no auto-reply; send fixed confirmation only when handoffCompleted reply needed); save+notice for audio/image/document; `invokeEngineWithTimeout` via `Promise.race` against 12s → contextual fallback on timeout/error without leaking technical details
    - _Requirements: 6.6, 10.1, 10.2, 10.4, 23.1, 23.2, 23.3, 23.4_

  - [x] 6.4 Implement `EvolutionWebhookController` (`POST /webhooks/evolution`)
    - Order: secret validation (401 mismatch/missing when configured; skip when unconfigured) → JSON/required-field validation (400) → delegate to processor; unhandled error → 500; Evolution send failures caught in processor → 200; controller not behind JWT guard
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 9.6_

  - [ ]* 6.5 Write property test for ineligible inbound never producing a reply
    - **Property 2: Ineligible inbound never produces a reply**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**

  - [ ]* 6.6 Write property test for unsupported media yielding exactly one notice
    - **Property 3: Unsupported media yields exactly one notice**
    - **Validates: Requirements 6.6**

  - [ ]* 6.7 Write property test for content truncation boundary
    - **Property 4: Content truncation boundary**
    - **Validates: Requirements 6.7, 6.8**

  - [ ]* 6.8 Write property test for idempotency of webhook processing
    - **Property 5: Idempotency of webhook processing**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 6.9 Write property test for lead and conversation resolution create-or-reuse
    - **Property 6: Lead and conversation resolution is create-or-reuse**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4**

  - [ ]* 6.10 Write property test for contact name assignment
    - **Property 7: Contact name assignment**
    - **Validates: Requirements 8.5**

  - [ ]* 6.11 Write property test for gated conversations saving inbound but never auto-replying
    - **Property 8: Gated conversations save inbound but never auto-reply**
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 6.12 Write property test for handoff-completed conversations replying only with the confirmation
    - **Property 9: Handoff-completed conversations reply only with the confirmation**
    - **Validates: Requirements 10.4**

  - [ ]* 6.13 Write property test for webhook resilience to send failure
    - **Property 16: Webhook resilience to send failure**
    - **Validates: Requirements 9.6**

  - [ ]* 6.14 Write property test for reply-delivery lifecycle and events
    - **Property 17: Reply-delivery lifecycle and events**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 22.3, 22.4, 22.5**

  - [ ]* 6.15 Write property test for malformed webhook bodies rejected with 400
    - **Property 19: Malformed webhook bodies are rejected with 400**
    - **Validates: Requirements 5.6**

  - [ ]* 6.16 Write property test for webhook secret enforcement
    - **Property 20: Webhook secret enforcement**
    - **Validates: Requirements 5.2, 18.1**

  - [ ]* 6.17 Write property test for reply timeout and contextual fallback
    - **Property 25: Reply timeout and contextual fallback**
    - **Validates: Requirements 23.2, 23.3, 23.4**

  - [ ]* 6.18 Write unit tests for secret branches, inbound-before-engine ordering, and 500 path
    - Cover configured/unconfigured/exact-match secret branches, inbound-saved-before-engine ordering via spies, and unhandled error → 500
    - _Requirements: 5.3, 5.4, 5.7, 9.1_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Handoff side-effects
  - [x] 8.1 Implement handoff acceptance side-effects in the processor
    - On engine-reported handoff acceptance: set Lead `chamar_humano`/`quente`, set Conversation `handoffAccepted`/`handoffCompleted=true`, set `botPaused=true` when `BOT_PAUSE_ON_HANDOFF`, emit `handoff_requested` and `handoff_completed` Bot_Events; rely on engine monotonicity (never downgrade status)
    - _Requirements: 10.3, 11.1, 11.2, 11.3_

  - [x] 8.2 Implement internal admin summary delivery and dashboard alert
    - Build the internal summary (telefone, segmento, uso do WhatsApp, dores, volume, sistema citado, resumo, próximo passo); send one message to each `ADMIN_WHATSAPP_NUMBERS` entry; never send the summary to the client; suppress all client communication of the summary when it cannot be generated; surface a dashboard handoff alert
    - _Requirements: 11.4, 11.5, 11.6, 11.7_

  - [ ]* 8.3 Write property test for handoff acceptance transition and monotonicity
    - **Property 10: Handoff acceptance transition and monotonicity**
    - **Validates: Requirements 10.3, 11.1, 11.2, 11.3**

  - [ ]* 8.4 Write property test for internal handoff summary never reaching the client
    - **Property 11: Internal handoff summary never reaches the client**
    - **Validates: Requirements 11.6, 11.7**

  - [ ]* 8.5 Write property test for internal handoff summary delivered to configured admins
    - **Property 12: Internal handoff summary delivered to configured admins**
    - **Validates: Requirements 11.5**

- [x] 9. Authentication and authorization
  - [x] 9.1 Implement AuthModule with JWT, bcrypt login, and roles
    - `POST /auth/login` validating email/password (bcrypt) and issuing a JWT; `jwt.strategy.ts`; support roles `admin`/`atendente`
    - _Requirements: 20.1, 20.3_

  - [x] 9.2 Implement `JwtAuthGuard`, `RolesGuard`, and `@Roles` decorator
    - 401 when JWT missing/invalid on protected routes; 403 when `atendente` calls an admin-only endpoint
    - _Requirements: 20.2, 20.4, 20.5_

  - [ ]* 9.3 Write property test for authentication and authorization enforcement
    - **Property 26: Authentication and authorization enforcement**
    - **Validates: Requirements 20.2, 20.4, 20.5**

  - [ ]* 9.4 Write unit test for login happy path issuing a JWT and granting protected access
    - _Requirements: 20.1_

- [x] 10. Inbox and bot-control back-end
  - [x] 10.1 Implement `InboxService`/`InboxController` listing and detail
    - List conversations with last message + lead state (name/phone, status, temperature, score, channel, bot active/paused, handoff state, last message date); conversation detail with full chat + lead side panel (pains, commercial summary, next step)
    - _Requirements: 16.1, 16.2, 16.3, 16.5, 16.6_

  - [x] 10.2 Implement takeover, pause/resume, and convert/lost actions
    - `assumir` → `botPaused=true`, `assignedTo`, status `aguardando_humano`/`chamar_humano`, `bot_paused` event; `retomar` → `botPaused=false`, `bot_resumed` event; mark converted/lost status updates
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 16.4_

  - [x] 10.3 Implement manual message sending
    - Deliver via `EvolutionService.sendTextMessage`; on success save outbound Message attributed to team + `human_message_sent` event; on failure report to Team_Member + `evolution_error` event
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 10.4 Write property test for takeover/resume round-trip with events
    - **Property 13: Takeover/resume round-trip with events**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

  - [ ]* 10.5 Write property test for manual message success path
    - **Property 14: Manual message success path**
    - **Validates: Requirements 13.1, 13.2**

  - [ ]* 10.6 Write property test for manual message failure path
    - **Property 15: Manual message failure path**
    - **Validates: Requirements 13.3**

  - [ ]* 10.7 Write property test for inbox last-message reflection
    - **Property 27: Inbox last-message reflection**
    - **Validates: Requirements 16.5**

  - [x] 10.8 Implement Bot settings endpoints (auto-reply + pricing)
    - Expose read/update of auto-reply toggle and Pricing_Config via `PricingConfigService.update()`, applying to subsequent replies including active conversations
    - _Requirements: 17.1, 17.5_

- [x] 11. Health and Evolution admin endpoints
  - [x] 11.1 Implement `HealthController` (`GET /health`)
    - Return `{ status, database, evolutionConfigured, llmConfigured }`; derive `database` from a `SELECT 1` probe; derive configured booleans from presence of required config without exposing secrets
    - _Requirements: 21.1, 21.2, 21.3_

  - [x] 11.2 Implement admin-only Evolution endpoints
    - `GET /channels/evolution/status`, `POST /channels/evolution/set-webhook`, `POST /channels/evolution/send-test-message`, all behind `JwtAuthGuard` + `@Roles('admin')`
    - _Requirements: 21.4, 20.5_

  - [ ]* 11.3 Write integration test for `GET /health` database healthy/unhealthy
    - _Requirements: 21.2, 21.3_

  - [ ]* 11.4 Write smoke test for route existence and admin endpoints
    - Assert `POST /webhooks/evolution` and the three admin endpoints are registered
    - _Requirements: 5.1, 21.4_

- [x] 12. Security controls
  - [x] 12.1 Implement payload sanitization and message size cap
    - Strip control characters and bound stored `rawPayload`/content before persistence; reject inbound text over the hard cap before storage (truncation to 4000 remains in the processor)
    - _Requirements: 18.3, 18.4_

  - [x] 12.2 Implement per-phone rate limiting
    - In-memory token-bucket keyed by phone (Redis when present); excess inbound logged to `webhook_logs` and dropped without engine invocation
    - _Requirements: 18.5_

  - [x] 12.3 Implement secret-safe log scrubber and enforce no mass send
    - Log scrubber replaces `EVOLUTION_API_KEY` and `JWT_SECRET` with `***`; ensure outbound is only produced in response to inbound or explicit manual send
    - _Requirements: 18.6, 18.7_

  - [ ]* 12.4 Write property test for payload sanitization before storage
    - **Property 21: Payload sanitization before storage**
    - **Validates: Requirements 18.3**

  - [ ]* 12.5 Write property test for per-phone rate limiting
    - **Property 22: Per-phone rate limiting**
    - **Validates: Requirements 18.5**

  - [ ]* 12.6 Write property test for outbound only in response to inbound
    - **Property 23: Outbound only in response to inbound**
    - **Validates: Requirements 18.7**

  - [ ]* 12.7 Write unit test for oversized-beyond-cap rejection
    - _Requirements: 18.4_

- [x] 13. Logging and monitoring
  - [x] 13.1 Implement structured per-message logging
    - Emit a structured log per processed WhatsApp message with `conversationId`, `leadId`, `channel`, `phone`, `instanceName`, `usedLocalRule`, `usedLLM`, `usedFallback`, `responseMs`, `llmMs`, `evolutionSendMs`, `error`
    - _Requirements: 22.1_

  - [x] 13.2 Wire Bot_Event lifecycle emission consistently
    - Ensure `webhook_received`, `message_inbound_saved`, `message_outbound_sent`, `evolution_error` events are recorded at their lifecycle points and exposed for the Logs screen query
    - _Requirements: 22.2, 22.3, 22.4, 22.5_

  - [ ]* 13.3 Write property test for per-message structured log completeness
    - **Property 28: Per-message structured log completeness**
    - **Validates: Requirements 22.1**

- [x] 14. Checkpoint - Ensure all back-end tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Frontend dashboard
  - [x] 15.1 Implement `api/client.ts` JWT interceptors and `AuthGuard`/`LoginPage`
    - Request interceptor attaches JWT; response interceptor redirects to `/login` on 401 and shows inline notice on 403; `LoginPage` + `useAuth` store JWT and set the Authorization header; wrap protected routes in `<AuthGuard>`
    - _Requirements: 20.1, 20.2_

  - [x] 15.2 Update `Sidebar.tsx` to the required menu order
    - Playground, WhatsApp, Conversas, Leads, Bot, Configurações, Logs
    - _Requirements: 15.1_

  - [x] 15.3 Implement the WhatsApp screen
    - Show instance status/name/connected number; show QR when pairing with graceful failure message; hide QR when connected; controls to refresh/connect/restart/set-webhook; show last event and last Evolution error
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6_
  
  - [x] 15.4 Implement the Inbox list and Conversation detail with polling
    - `InboxPage`/`useInbox` (5s poll) listing per Requirement 16.1; `ConversationDetailPage`/`useConversationDetail` (3s poll) showing full chat + lead panel + actions (Assumir, Pausar, Retomar, Marcar convertido/perdido, manual send field)
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [x] 15.5 Implement the Bot screen (pricing + auto-reply)
    - `BotPage`/`useBotSettings` for auto-reply toggle and Pricing_Config edit (`pricingRangeEnabled`, `pricingStartingAt`, `pricingText`)
    - _Requirements: 17.1, 17.5_

  - [x] 15.6 Implement the Logs screen
    - `LogsPage`/`useLogs` showing last received messages, last Evolution errors, ignored duplicates, responses over 10s, and send failures from `webhook_logs`/`bot_events`
    - _Requirements: 22.2_

  - [ ]* 15.7 Write component/snapshot tests for the new screens
    - Cover WhatsApp (incl. QR graceful-failure), Inbox, Conversation detail, Bot, Logs, Login, and Sidebar menu order
    - _Requirements: 15.1, 15.3, 16.1, 16.2, 16.3, 16.4, 22.2_

- [x] 16. Deployment artifacts
  - [x] 16.1 Author docker-compose and verify api/web Dockerfiles
    - Define `api` (runs migrations on start, depends_on postgres healthy), `web` (serves built React app), `postgres:16` (volume + `pg_isready` healthcheck), optional `redis`; ensure both Dockerfiles build
    - _Requirements: 24.1, 24.2, 24.4_

  - [x] 16.2 Configure API healthcheck and document EasyPanel env vars
    - Compose healthcheck curls `GET /health`; document all required env vars and that the webhook URL derives from `PUBLIC_API_URL` + `/webhooks/evolution`
    - _Requirements: 24.3, 24.4, 24.5_

  - [ ]* 16.3 Write smoke test for docker-compose validity and artifacts
    - Validate `docker-compose config`, assert api+db healthchecks are defined, and that env documentation is present
    - _Requirements: 24.2, 24.4_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each correctness property maps to exactly one property-based test (`fast-check`, ≥100 iterations, tagged `// Feature: whatsapp-evolution-production, Property {number}: ...`), with the frozen engine and Prisma mocked so input variation exercises orchestration logic.
- Frontend UI rendering, Docker/IaC, and external-service-dependent work are covered by component/snapshot, smoke, and integration tests rather than property-based tests.
- The frozen engine is never modified except the single pricing wiring seam in Task 5.2.
- Checkpoints validate incrementally at back-end, and end-of-build boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "3.3", "4.1"] },
    { "id": 2, "tasks": ["1.4", "2.3", "2.4", "2.5", "2.6", "3.4", "3.5", "4.2", "4.4", "5.1"] },
    { "id": 3, "tasks": ["4.3", "4.5", "4.6", "5.2", "9.1"] },
    { "id": 4, "tasks": ["4.7", "5.3", "5.4", "6.1", "9.2"] },
    { "id": 5, "tasks": ["6.2", "6.3", "9.3", "9.4", "11.1"] },
    { "id": 6, "tasks": ["6.4", "10.1", "10.8", "11.2"] },
    { "id": 7, "tasks": ["8.1", "10.2", "10.3", "12.1", "12.2", "12.3", "13.1"] },
    { "id": 8, "tasks": ["8.2", "13.2", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13", "6.14", "6.15", "6.16", "6.17", "6.18"] },
    { "id": 9, "tasks": ["8.3", "8.4", "8.5", "10.4", "10.5", "10.6", "10.7", "11.3", "11.4", "12.4", "12.5", "12.6", "12.7", "13.3"] },
    { "id": 10, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6"] },
    { "id": 11, "tasks": ["15.7", "16.1", "16.2"] },
    { "id": 12, "tasks": ["16.3"] }
  ]
}
```
