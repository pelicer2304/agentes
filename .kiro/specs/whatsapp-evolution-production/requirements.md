# Requirements Document

## Introduction

This feature integrates the existing DecodificaIA conversational agent (currently working only in the internal web Playground) with real WhatsApp traffic through the Evolution API, and prepares the application for production deployment on EasyPanel.

The work is **strictly a production integration effort**. The existing agent engine is frozen and MUST NOT be refactored. Specifically, the following components keep their current behavior unchanged: the DecodificaIA agent, `AgentReplyService`, `AgentAnalysisService`, `ResponseGuardService`, `ConversationService.handleInboundMessage` (the engine entrypoint), `FactExtractorService`, the score calculator, the main prompts, and the qualification/handoff flow. The Playground must keep working for internal testing.

The scope adds: a WhatsApp channel via Evolution API behind a channel abstraction, an operational dashboard (instance connection, real conversations inbox, bot pause/resume, human takeover, manual sending, logs), production security controls, authentication, configurable pricing, health and admin endpoints, and Docker/EasyPanel deployment artifacts.

Out of scope: SaaS multi-client platform, billing, marketing campaigns, mass sending, rewriting the agent, and changing conversational behavior beyond what real WhatsApp delivery requires.

## Glossary

- **Evolution_API**: External WhatsApp gateway service that connects to a WhatsApp number, delivers outbound messages, and emits inbound webhooks.
- **System**: The DecodificaIA backend application (NestJS API) plus dashboard, excluding the frozen agent engine.
- **Agent_Engine**: The frozen DecodificaIA conversational engine, entered through `ConversationService.handleInboundMessage`. The engine is channel-independent and MUST NOT be modified by this feature.
- **Channel_Adapter**: The `ChannelAdapter` interface abstracting message transport, with two implementations: `Playground_Adapter` and `Evolution_Adapter`.
- **Playground_Adapter**: The `PlaygroundChannelAdapter` implementation used by the internal web testing channel.
- **Evolution_Adapter**: The `EvolutionChannelAdapter` implementation that sends and normalizes WhatsApp messages via Evolution_API.
- **Evolution_Service**: The `EvolutionService` that performs HTTP calls to Evolution_API (send message, instance status, QR code, connect, restart, set webhook, logout).
- **Webhook_Controller**: The `EvolutionWebhookController` exposing `POST /webhooks/evolution`.
- **Webhook_Normalizer**: The `evolution-normalizer` component that converts a raw Evolution_API payload into an `Inbound_Message`.
- **Inbound_Message**: The normalized internal representation of a received message: `{ channel: "whatsapp", instance, externalMessageId, from, to, contactName, content, messageType: "text", timestamp, rawPayload }`.
- **Lead**: A prospective customer record identified in production by WhatsApp phone number.
- **Conversation**: A `Conversation` record scoped by lead, channel, and instance.
- **Message**: A `Message` record storing inbound, outbound, and manual team messages.
- **Webhook_Log**: A `webhook_logs` table row recording each received webhook event.
- **Bot_Event**: A `bot_events` table row recording operational events in the message lifecycle.
- **Dashboard**: The production web operational interface with the menu: Playground, WhatsApp, Conversas, Leads, Bot, Configurações, Logs.
- **Inbox**: The Dashboard screen listing real WhatsApp conversations.
- **Handoff**: The point at which a lead is escalated to the human team; once accepted, the bot stops driving the sale.
- **Bot_Paused**: The conversation state (`conversation.botPaused = true`) in which inbound messages are saved but no automatic reply is generated.
- **Team_Member**: An authenticated Dashboard user with role `admin` or `atendente`.
- **Admin**: An authenticated Team_Member with role `admin`, authorized to access Evolution administration endpoints.
- **Pricing_Config**: The configurable pricing settings: `pricingRangeEnabled`, `pricingStartingAt`, `pricingText`.
- **Fast_Reply_Budget**: The target maximum reply time of 8 seconds for a production WhatsApp reply.
- **Absolute_Timeout**: The hard maximum reply time of 12 seconds for a production WhatsApp reply.
- **Contextual_Fallback**: A short, non-technical reply produced when the Agent_Engine fails or exceeds the timeout.
- **Idempotency_Key**: The combination of `externalMessageId` and `instanceName` used to detect duplicate webhook deliveries.

## Requirements

### Requirement 1: Preserve the Frozen Agent Engine and Playground

**User Story:** As the product owner, I want the existing agent engine and Playground to remain unchanged, so that proven conversational behavior is not regressed by the production integration.

#### Acceptance Criteria

1. THE System SHALL route both Playground and WhatsApp inbound messages through the existing `ConversationService.handleInboundMessage` entrypoint without modifying its conversational logic.
2. THE System SHALL keep the Playground HTTP endpoints under `playground/conversations` functional for internal testing.
3. WHERE a message originates from WhatsApp, THE Agent_Engine SHALL produce replies using the same engine code path as Playground messages.
4. THE Agent_Engine SHALL remain unaware of the originating channel, receiving only the data already accepted by its current entrypoint signature.
5. THE System SHALL NOT alter the public behavior of `AgentReplyService`, `AgentAnalysisService`, `ResponseGuardService`, `FactExtractorService`, the score calculator, or the main prompts.

### Requirement 2: Channel Abstraction

**User Story:** As a developer, I want a finalized channel abstraction, so that the agent stays channel-independent and new channels can be added without touching the engine.

#### Acceptance Criteria

1. THE System SHALL define a `Channel_Adapter` interface exposing `sendMessage(params: SendMessageParams)` returning a promise and `normalizeInbound(payload: unknown)` returning a promise of an `Inbound_Message`.
2. THE System SHALL provide a `Playground_Adapter` implementation of the `Channel_Adapter` interface.
3. THE System SHALL provide an `Evolution_Adapter` implementation of the `Channel_Adapter` interface.
4. WHEN the `Evolution_Adapter` normalizes an inbound WhatsApp payload, THE Evolution_Adapter SHALL return an `Inbound_Message` with `channel` equal to `"whatsapp"`.
5. WHERE existing channel code uses the prior adapter method names, THE System SHALL update the abstraction so that the Playground continues to function after the change.

### Requirement 3: Evolution Module Structure

**User Story:** As a developer, I want the Evolution integration organized in a dedicated module, so that the WhatsApp transport code is isolated and maintainable.

#### Acceptance Criteria

1. THE System SHALL provide an Evolution module located at `apps/api/src/modules/channels/evolution`.
2. THE Evolution module SHALL contain the files `evolution.module.ts`, `evolution.service.ts`, `evolution-webhook.controller.ts`, `evolution-channel.adapter.ts`, `evolution.types.ts`, and `evolution-normalizer.ts`.
3. THE Evolution module SHALL register the `Evolution_Service`, `Webhook_Controller`, and `Evolution_Adapter` with the NestJS dependency injection container.

### Requirement 4: Environment Configuration

**User Story:** As an operator, I want all integration settings provided through environment variables, so that the System can be configured per environment without code changes.

#### Acceptance Criteria

1. WHEN the System starts, THE System SHALL read the configuration values `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME`, `EVOLUTION_WEBHOOK_SECRET`, `PUBLIC_API_URL`, `BOT_AUTO_REPLY_ENABLED`, `BOT_PAUSE_ON_HANDOFF`, `ADMIN_WHATSAPP_NUMBERS`, `PRICING_RANGE_ENABLED`, `PRICING_STARTING_AT`, `PRICING_TEXT`, `LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `MODEL_NAME`, and `LLM_MODEL_FALLBACK` from environment variables before accepting any inbound request.
2. THE System SHALL default `BOT_AUTO_REPLY_ENABLED` to `true`, `BOT_PAUSE_ON_HANDOFF` to `true`, `PRICING_RANGE_ENABLED` to `true`, `PRICING_STARTING_AT` to `2500`, and `LLM_PROVIDER` to `openrouter` when the corresponding variable is absent or an empty string.
3. IF a configuration value designated as required for startup is missing or invalid, THEN THE System SHALL halt startup upon detecting the first such variable, without accepting any inbound request, and report an error indicating that variable's name.
4. THE System SHALL accept exactly `openrouter` or `openai` as valid `LLM_PROVIDER` values, and IF `LLM_PROVIDER` holds any other value, THEN THE System SHALL halt startup and report an error indicating the invalid `LLM_PROVIDER` value.
5. IF any of `BOT_AUTO_REPLY_ENABLED`, `BOT_PAUSE_ON_HANDOFF`, or `PRICING_RANGE_ENABLED` is set to a value other than `true` or `false`, THEN THE System SHALL halt startup and report an error indicating the offending variable's name.
6. IF `PRICING_STARTING_AT` is set to a value that is not a number within the range `0` to `999999999.99` inclusive, THEN THE System SHALL halt startup and report an error indicating that `PRICING_STARTING_AT` is invalid.

### Requirement 5: Webhook Reception and Authentication

**User Story:** As an operator, I want the webhook endpoint to authenticate and accept Evolution_API events, so that only legitimate WhatsApp events are processed.

#### Acceptance Criteria

1. THE Webhook_Controller SHALL expose an endpoint at `POST /webhooks/evolution`.
2. WHERE `EVOLUTION_WEBHOOK_SECRET` is configured, IF an inbound webhook request presents no secret or a secret that is not an exact match of the configured value, THEN THE Webhook_Controller SHALL reject the request with HTTP status 401 and SHALL NOT process the payload under any circumstance.
3. WHERE `EVOLUTION_WEBHOOK_SECRET` is not configured, THE Webhook_Controller SHALL skip secret validation and accept the request for processing.
4. WHERE `EVOLUTION_WEBHOOK_SECRET` is configured, WHEN an inbound webhook request presents a secret that is an exact match of the configured value, THE Webhook_Controller SHALL accept the request for processing.
5. WHEN the Webhook_Controller completes all processing of an accepted event within 10 seconds, THE Webhook_Controller SHALL respond with HTTP status 200.
6. IF an accepted webhook request body is empty, not valid JSON, or missing the fields required to identify an event, THEN THE Webhook_Controller SHALL respond with HTTP status 400 and SHALL NOT process the payload.
7. IF an unhandled error occurs while processing an accepted event, THEN THE Webhook_Controller SHALL respond with HTTP status 500 indicating a processing failure.

### Requirement 6: Inbound Payload Normalization and Filtering

**User Story:** As an operator, I want only useful inbound text messages from individual chats to be processed, so that the bot does not react to noise, groups, or its own messages.

#### Acceptance Criteria

1. WHEN the Webhook_Normalizer receives a raw Evolution_API payload representing a text message, THE Webhook_Normalizer SHALL produce an `Inbound_Message` containing `channel`, `instance`, `externalMessageId`, `from`, `to`, `contactName`, `content`, `messageType` equal to `"text"`, `timestamp`, and `rawPayload`.
2. IF a raw Evolution_API payload is missing any of `externalMessageId`, `from`, or `content`, THEN THE Webhook_Normalizer SHALL NOT produce an `Inbound_Message`, THE System SHALL record a Webhook_Log indicating the payload was rejected as malformed, and SHALL NOT generate a reply.
3. IF an inbound event has `fromMe` equal to `true`, THEN THE System SHALL record a Webhook_Log and SHALL NOT generate a reply.
4. IF an inbound event originates from a WhatsApp group, THEN THE System SHALL record a Webhook_Log and SHALL NOT generate a reply.
5. IF an inbound event has a message type other than `text`, `audio`, `image`, or `document`, THEN THE System SHALL record a Webhook_Log and SHALL NOT generate a reply.
6. IF an inbound message has type `audio`, `image`, or `document`, THEN THE System SHALL treat the message type as unsupported, save the inbound Message, and SHALL respond with exactly one outbound text message indicating that only text messages are currently supported.
7. WHEN accepted inbound text content exceeds 4000 characters, THE System SHALL truncate the content to the first 4000 characters before passing the content to the Agent_Engine.
8. WHEN accepted inbound text content is 4000 characters or fewer, THE System SHALL pass the content unchanged to the Agent_Engine.

### Requirement 7: Idempotency

**User Story:** As an operator, I want duplicate webhook deliveries ignored, so that the same WhatsApp message is never processed or answered twice.

#### Acceptance Criteria

1. THE System SHALL persist `externalMessageId` and `instanceName` on each stored inbound Message.
2. IF a Message with the same `externalMessageId` and `instanceName` already exists, THEN THE System SHALL skip reprocessing, record the duplicate in a Webhook_Log, and respond with HTTP status 200.
3. WHEN no Message with the same Idempotency_Key exists, THE System SHALL process the inbound message exactly once.

### Requirement 8: Lead and Conversation Resolution

**User Story:** As a Team_Member, I want each WhatsApp sender mapped to a lead and an active conversation, so that history and qualification are tracked per contact.

#### Acceptance Criteria

1. WHEN an inbound WhatsApp message is processed and no Lead exists for the sender phone number, THE System SHALL create a Lead identified by that phone number.
2. WHEN an inbound WhatsApp message is processed and a Lead already exists for the sender phone number, THE System SHALL reuse the existing Lead.
3. WHEN an inbound WhatsApp message is processed and no active Conversation exists for the combination of Lead, WhatsApp channel, and instance, THE System SHALL create a Conversation with `channel` equal to `"whatsapp"` and the originating `instanceName`.
4. WHEN an active Conversation exists for the combination of Lead, WhatsApp channel, and instance, THE System SHALL reuse the existing Conversation.
5. WHERE a `contactName` is present in the `Inbound_Message` and the Lead name is unset, THE System SHALL store the `contactName` as the Lead name.
6. IF storing the `contactName` fails, THEN THE System SHALL continue processing the inbound message.

### Requirement 9: Inbound Processing and Reply Delivery

**User Story:** As a prospective customer, I want DecodificaIA to answer me on WhatsApp, so that I get the same guided diagnosis as in the Playground.

#### Acceptance Criteria

1. WHEN an eligible inbound WhatsApp text message is processed, THE System SHALL save the inbound Message before invoking the Agent_Engine.
2. WHEN an eligible inbound WhatsApp text message is processed and automatic reply is permitted, THE System SHALL pass the message to the Agent_Engine through its existing entrypoint.
3. WHEN the Agent_Engine returns a reply, THE System SHALL send the reply to the sender through the `Evolution_Service`.
4. WHEN the `Evolution_Service` confirms an outbound send, THE System SHALL save the outbound Message.
5. THE System SHALL record a Webhook_Log for each processed webhook event.
6. IF the `Evolution_Service` fails to send a reply, THEN THE System SHALL log the error, record an `evolution_error` Bot_Event, keep the saved Conversation and inbound Message, and respond to the webhook with HTTP status 200.

### Requirement 10: Bot Auto-Reply Rules in Production

**User Story:** As an operator, I want explicit rules controlling when the bot replies, so that automatic responses are suppressed when configured or when a human is handling the conversation.

#### Acceptance Criteria

1. IF `BOT_AUTO_REPLY_ENABLED` is `false`, THEN THE System SHALL save the inbound Message and SHALL NOT generate an automatic reply.
2. IF the Conversation has `botPaused` equal to `true`, THEN THE System SHALL save the inbound Message and SHALL NOT generate an automatic reply.
3. WHERE `BOT_PAUSE_ON_HANDOFF` is `true`, WHEN a Lead reaches status `chamar_humano`, THE System SHALL set the Conversation `botPaused` to `true`.
4. IF the Conversation has `handoffCompleted` equal to `true`, THEN THE System SHALL NOT continue the diagnosis and SHALL, only when a reply is needed, send the confirmation message "Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário."

### Requirement 11: Handoff in Production

**User Story:** As the sales team, I want handoff to escalate the lead and stop the bot from driving the sale, so that we can take over qualified conversations.

#### Acceptance Criteria

1. WHEN a client accepts handoff, THE System SHALL set the Lead status to `chamar_humano`, set the Lead temperature to `quente`, set the Conversation `handoffAccepted` to `true`, and set the Conversation `handoffCompleted` to `true`.
2. WHERE `BOT_PAUSE_ON_HANDOFF` is `true`, WHEN a client accepts handoff, THE System SHALL set the Conversation `botPaused` to `true`.
3. WHEN a client accepts handoff, THE System SHALL create a `handoff_requested` Bot_Event and a `handoff_completed` Bot_Event.
4. WHEN a client accepts handoff, THE System SHALL display a handoff alert in the Dashboard.
5. WHERE `ADMIN_WHATSAPP_NUMBERS` is configured, WHEN a client accepts handoff, THE System SHALL send an internal summary message to the configured numbers containing telefone, segmento, uso do WhatsApp, dores, volume, sistema citado, resumo, and próximo passo.
6. WHEN the internal handoff summary content cannot be generated, THE System SHALL prevent any client communication of that summary.
7. THE System SHALL NOT send the internal handoff summary message to the client.

### Requirement 12: Human Takeover and Bot Control

**User Story:** As a Team_Member, I want to take over a conversation and control the bot, so that I can handle a lead manually when needed.

#### Acceptance Criteria

1. WHEN a Team_Member takes over a Conversation, THE System SHALL set `botPaused` to `true`, set `assignedTo` to the acting Team_Member, and set the Conversation status to `aguardando_humano` or `chamar_humano`.
2. WHEN a Team_Member resumes the bot for a Conversation, THE System SHALL set `botPaused` to `false`.
3. WHEN a Team_Member takes over a Conversation, THE System SHALL record a `bot_paused` Bot_Event.
4. WHEN a Team_Member resumes the bot for a Conversation, THE System SHALL record a `bot_resumed` Bot_Event.

### Requirement 13: Manual Message Sending

**User Story:** As a Team_Member, I want to send manual messages from the Dashboard, so that I can reply to the client directly on WhatsApp.

#### Acceptance Criteria

1. WHEN a Team_Member sends a manual message from a Conversation detail view, THE System SHALL deliver the message to the client through the `Evolution_Service`.
2. WHEN a manual message is delivered, THE System SHALL save an outbound Message attributed to the team and record a `human_message_sent` Bot_Event.
3. IF a manual message fails to deliver, THEN THE System SHALL report the failure to the Team_Member and record an `evolution_error` Bot_Event.

### Requirement 14: Evolution Service Operations

**User Story:** As an Admin, I want to operate the WhatsApp instance, so that I can connect, monitor, and recover the WhatsApp number.

#### Acceptance Criteria

1. THE Evolution_Service SHALL provide the operations `sendTextMessage(to, text)`, `getInstanceStatus()`, `connectInstance()`, `getQRCode()`, `restartInstance()`, `setWebhook()`, and `logoutInstance()`.
2. WHERE Evolution_API supports presence indication, THE Evolution_Service SHALL provide a `sendTypingOrPresence()` operation.
3. IF an `Evolution_Service` call to Evolution_API fails, THEN THE Evolution_Service SHALL return an error result that records the failure without exposing the `EVOLUTION_API_KEY`.

### Requirement 15: WhatsApp Operational Screen

**User Story:** As an Admin, I want a WhatsApp screen in the Dashboard, so that I can connect and monitor the instance.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a sidebar menu with the items Playground, WhatsApp, Conversas, Leads, Bot, Configurações, and Logs.
2. THE WhatsApp screen SHALL display the instance status, the instance name, and the connected number.
3. WHERE the instance requires pairing, THE WhatsApp screen SHALL display the QR code, and SHALL fail gracefully with a status message when the QR code cannot be retrieved.
4. WHILE the instance is connected, THE WhatsApp screen SHALL hide the QR code and display only connection status information.
5. THE WhatsApp screen SHALL provide controls to refresh status, connect or reconnect the instance, restart the instance, and configure the webhook.
6. THE WhatsApp screen SHALL display the last received event and the last Evolution_API error.

### Requirement 16: Conversations Inbox and Detail

**User Story:** As a Team_Member, I want an inbox of real WhatsApp conversations with full detail, so that I can monitor and manage live leads.

#### Acceptance Criteria

1. THE Inbox SHALL list WhatsApp conversations showing name or phone, last message, lead status, temperature, score, channel, bot active or paused state, handoff state, and last message date.
2. WHEN a Team_Member opens a Conversation, THE Dashboard SHALL display the full chat including client messages, DecodificaIA messages, and team manual messages.
3. THE Conversation detail SHALL display a lead side panel with identified pains, commercial summary, and next step.
4. THE Conversation detail SHALL provide the actions Assumir atendimento, Pausar bot, Retomar bot, Marcar como convertido, and Marcar como perdido, and a manual message field.
5. WHEN a new inbound or outbound Message is recorded for a listed Conversation, THE Inbox SHALL reflect the updated last message and date.
6. IF an Inbox update fails, THEN THE System SHALL still record the Message.

### Requirement 17: Configurable Pricing

**User Story:** As an Admin, I want to configure pricing in the panel, so that the bot communicates an accurate starting price.

#### Acceptance Criteria

1. THE System SHALL store Pricing_Config fields `pricingRangeEnabled`, `pricingStartingAt`, and `pricingText`.
2. THE System SHALL initialize Pricing_Config with `pricingRangeEnabled` equal to `true`, `pricingStartingAt` equal to `2500`, and `pricingText` equal to "Projetos simples começam a partir de R$ 2.500. Fluxos com integrações, regras comerciais e maior volume precisam de escopo."
3. WHERE `pricingRangeEnabled` is `true`, WHEN a client asks about price, THE System SHALL include the configured `pricingText` and `pricingStartingAt` value in the reply.
4. WHERE `pricingRangeEnabled` is `true`, WHEN a client insists on price after the first price reply, THE System SHALL provide the configured follow-up pricing response.
5. WHEN an Admin updates Pricing_Config in the panel, THE System SHALL persist the updated values and apply them to subsequent replies, including replies in conversations that are already active.

### Requirement 18: Security Controls

**User Story:** As an operator, I want production security controls, so that the integration is protected against abuse and data leakage.

#### Acceptance Criteria

1. THE System SHALL validate the webhook secret on the `POST /webhooks/evolution` endpoint when the secret is configured.
2. THE System SHALL keep the `EVOLUTION_API_KEY` server-side and SHALL NOT expose it to the frontend.
3. WHEN an inbound payload is received, THE System SHALL sanitize the payload before storage and processing.
4. THE System SHALL reject inbound text content exceeding the maximum allowed message size.
5. WHEN inbound messages arrive from a single phone number, THE System SHALL apply a per-phone rate limit.
6. WHEN the System logs an error, THE System SHALL exclude sensitive credentials from the log output.
7. THE System SHALL generate outbound WhatsApp messages only in response to inbound messages and SHALL NOT perform mass sending.

### Requirement 19: Database Schema Extensions

**User Story:** As a developer, I want the schema extended for WhatsApp operations, so that channel state, message provenance, and operational events are persisted.

#### Acceptance Criteria

1. THE System SHALL add to the Conversation model the fields `channel`, `instanceName`, `externalChatId`, `botPaused`, `assignedTo`, `handoffOffered`, `handoffAccepted`, `handoffCompleted`, `lastInboundAt`, and `lastOutboundAt`.
2. THE System SHALL add to the Message model the fields `externalMessageId`, `externalChatId`, `instanceName`, `messageType`, `rawPayload`, and `deliveryStatus`.
3. THE System SHALL create a `webhook_logs` table with the columns `id`, `provider`, `instanceName`, `eventType`, `externalMessageId`, `phone`, `payload`, `processed`, `error`, and `createdAt`.
4. THE System SHALL create a `bot_events` table with the columns `id`, `conversationId`, `leadId`, `type`, `payload`, and `createdAt`.
5. THE System SHALL support the `bot_events` type values `webhook_received`, `message_inbound_saved`, `message_outbound_sent`, `bot_paused`, `bot_resumed`, `handoff_requested`, `handoff_completed`, `human_message_sent`, and `evolution_error`.
6. THE System SHALL apply schema changes through Prisma migrations that preserve existing Playground data.

### Requirement 20: Authentication and Authorization

**User Story:** As an operator, I want production login with roles, so that only authorized staff access the Dashboard and admin endpoints.

#### Acceptance Criteria

1. THE System SHALL provide email and password login that issues a JWT on successful authentication.
2. IF a request to a protected Dashboard route or admin endpoint lacks a valid JWT, THEN THE System SHALL reject the request with HTTP status 401.
3. THE System SHALL support the roles `admin` and `atendente`.
4. IF a Team_Member with role `atendente` requests an Admin-only endpoint, THEN THE System SHALL reject the request with HTTP status 403.
5. THE System SHALL restrict the Evolution administration endpoints to Admin users.

### Requirement 21: Health and Admin Endpoints

**User Story:** As an operator, I want health and administration endpoints, so that I can verify and test the deployment.

#### Acceptance Criteria

1. THE System SHALL expose `GET /health` returning a body with `status`, `database`, `evolutionConfigured`, and `llmConfigured`.
2. WHEN the database connection check succeeds, THE `GET /health` response SHALL report `database` as healthy.
3. IF the database connection check fails, THEN THE `GET /health` response SHALL report `database` as unhealthy.
4. THE System SHALL expose the Admin-only endpoints `GET /channels/evolution/status`, `POST /channels/evolution/set-webhook`, and `POST /channels/evolution/send-test-message`.

### Requirement 22: Logging and Monitoring

**User Story:** As an operator, I want per-message and error logs surfaced in the Dashboard, so that I can monitor production health.

#### Acceptance Criteria

1. WHEN a WhatsApp message is processed, THE System SHALL log `conversationId`, `leadId`, `channel`, `phone`, `instanceName`, `usedLocalRule`, `usedLLM`, `usedFallback`, `responseMs`, `llmMs`, `evolutionSendMs`, and `error`.
2. THE Logs screen SHALL display the last received messages, the last Evolution_API errors, ignored duplicate messages, responses exceeding 10 seconds, and send failures.
3. WHEN a webhook event is received, THE System SHALL record a `webhook_received` Bot_Event.
4. WHEN an inbound Message is saved, THE System SHALL record a `message_inbound_saved` Bot_Event.
5. WHEN an outbound Message is sent, THE System SHALL record a `message_outbound_sent` Bot_Event.

### Requirement 23: Reply Timeout and Fallback

**User Story:** As a prospective customer, I want a timely reply on WhatsApp, so that I am never left waiting for an excessive time.

#### Acceptance Criteria

1. THE System SHALL target a Fast_Reply_Budget of at most 8 seconds for a production WhatsApp reply.
2. IF generating a reply exceeds the Absolute_Timeout of 12 seconds, THEN THE System SHALL send a Contextual_Fallback instead of waiting longer.
3. IF the Agent_Engine reply generation fails, THEN THE System SHALL send a short Contextual_Fallback, save the error, and SHALL NOT expose technical error details to the client.
4. WHEN a Contextual_Fallback is used because of failure or timeout, THE System SHALL send the message "Estou com dificuldade para analisar tudo agora, mas já registrei seu cenário. A equipe da Decodifica pode te ajudar a partir daqui." or an equivalent short contextual message.

### Requirement 24: Deployment on EasyPanel

**User Story:** As an operator, I want Docker and EasyPanel deployment artifacts, so that the System runs reliably in production.

#### Acceptance Criteria

1. THE System SHALL provide a Dockerfile for the api and a Dockerfile for the web frontend.
2. THE System SHALL provide a docker-compose definition for the api, web, and postgres services, with redis as an optional service.
3. THE System SHALL provide documented environment variables required for an EasyPanel deployment.
4. THE System SHALL define an API healthcheck and a database healthcheck for the deployment.
5. THE System SHALL support configuration of the API domain, the frontend domain, and the public webhook URL through `PUBLIC_API_URL` and related settings.
