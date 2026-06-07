# Requirements Document

## Introduction

Assistente Decodifica Playground is an MVP web application that simulates AI-powered WhatsApp conversations for the Decodifica team. The system enables testing of consultative agent responses, real-time lead qualification, and conversation management through a professional dashboard. The architecture is designed for future Evolution API integration to connect with real WhatsApp channels.

## Glossary

- **Playground**: The web-based chat simulation interface where the Decodifica team tests conversations with the AI agent
- **Assistente_Decodifica**: The AI-powered conversational agent that responds consultatively to potential clients
- **Lead**: A potential client being qualified through conversation in the system
- **Lead_Score**: A numeric value (0-100) representing how qualified a lead is based on conversation data
- **Temperature**: A classification of lead readiness: frio (0-39), morno (40-69), quente (70-100)
- **Handoff**: The process of routing a conversation from the AI agent to a human support representative
- **Conversation**: A complete interaction session between a user and the Assistente_Decodifica, linked to a Lead
- **Message**: A single communication unit within a Conversation, with role (user, assistant, system) and direction (inbound, outbound, internal)
- **Agent_Analysis**: The structured JSON output from the LLM containing qualification data, intent detection, and next actions
- **Knowledge_Base**: A collection of reference items the agent uses to inform responses about Decodifica services
- **Channel_Adapter**: An interface abstraction that allows swapping communication channels (playground, WhatsApp) without changing core logic
- **Stage**: The current phase of a conversation: abertura, descoberta, diagnostico, explicacao_solucao, tratamento_objecao, conversao, handoff_humano
- **Dashboard**: The administrative interface showing lead summaries, statistics, and conversation details
- **LLM_Provider**: The configurable AI model service (e.g., OpenAI) used to generate agent responses

## Requirements

### Requirement 1: Playground Conversation Initiation

**User Story:** As a Decodifica team member, I want to start a new simulated conversation in the Playground, so that I can test the AI agent's behavior with different client scenarios.

#### Acceptance Criteria

1. WHEN a user clicks the "new conversation" button, THE Playground SHALL create a new Conversation record in the database with channel set to "playground" and stage set to "abertura"
2. WHEN a new Conversation is created, THE Playground SHALL create a new Lead record with status "novo" and link it to the Conversation
3. WHEN a new Conversation is created, THE Assistente_Decodifica SHALL send the predefined initial greeting message: "Olá. Sou o Assistente Decodifica. Posso te ajudar a entender que tipo de automação faria sentido para o seu atendimento. Para começar, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje." and display it in the conversation interface
4. WHEN a user clicks the "reset conversation" button, THE Playground SHALL set the current Conversation stage to "handoff_humano", mark it as inactive, and start a new Conversation following criteria 1, 2, and 3
5. IF a user clicks the "new conversation" button while an active Conversation already exists, THEN THE Playground SHALL set the existing Conversation stage to "handoff_humano", mark it as inactive, and create the new Conversation following criteria 1, 2, and 3

### Requirement 2: Message Exchange in Playground

**User Story:** As a Decodifica team member, I want to send messages and receive AI responses in the Playground chat, so that I can simulate a real client interaction.

#### Acceptance Criteria

1. WHEN a user submits a message containing between 1 and 4000 characters in the chat input, THE Playground SHALL save the Message with role "user" and direction "inbound" to the database
2. IF a user submits an empty message or a message exceeding 4000 characters, THEN THE Playground SHALL prevent submission and display a validation error indicating the allowed length
3. WHEN a user message is saved, THE Playground SHALL send the full conversation history to the LLM_Provider for processing
4. WHEN the LLM_Provider returns a response, THE Playground SHALL save the assistant Message with role "assistant" and direction "outbound" to the database and display the content of the "reply" field from the LLM response in the chat interface within 10 seconds
5. IF the LLM_Provider fails to respond within 30 seconds or returns an error, THEN THE Playground SHALL display an error message indicating the failure and preserve the user's sent message in the conversation
6. THE Playground SHALL display messages in a chat layout with user messages aligned to the right and assistant messages aligned to the left, providing visual distinction between the two roles

### Requirement 3: Agent Response Quality

**User Story:** As a Decodifica team member, I want the Assistente Decodifica to respond consultatively and professionally, so that the simulated experience matches the desired client interaction quality.

#### Acceptance Criteria

1. THE Assistente_Decodifica SHALL respond using short sentences, active voice, and language free of jargon unless the client introduces domain-specific terms first
2. THE Assistente_Decodifica SHALL ask exactly one question per response to advance the conversation toward the next stage of the conversation flow
3. THE Assistente_Decodifica SHALL keep each response to a maximum of 300 characters, excluding the closing question
4. THE Assistente_Decodifica SHALL NOT use emojis, and SHALL NOT use the same filler word or expression (such as "Show", "Legal demais", "Perfeito", "Ok", "Entendi") more than once across any 5 consecutive responses
5. THE Assistente_Decodifica SHALL follow the conversation flow in this order: understand the client's business, then understand current WhatsApp usage, then identify pain points, then explain relevant solutions, then qualify the lead, then route to a human attendant
6. THE Assistente_Decodifica SHALL base all claims about Decodifica services, pricing approach, and implementation details on content present in the Knowledge_Base, without fabricating capabilities or figures not contained therein
7. WHEN the client asks about pricing, THE Assistente_Decodifica SHALL explain that the final value depends on the automation flow complexity, required integrations, message volume, and personalization level, and that Decodifica performs a quick diagnosis before quoting
8. THE Assistente_Decodifica SHALL adapt examples and use cases to the client's stated niche (e.g., clinic, store, restaurant, real estate) based on information the client has provided during the conversation, without following pre-defined niche-specific scripts

### Requirement 4: LLM Structured Response

**User Story:** As a developer, I want the LLM to return structured JSON responses, so that the system can reliably extract qualification data and update lead information.

#### Acceptance Criteria

1. WHEN the LLM_Provider processes a message, THE Assistente_Decodifica SHALL return a valid JSON object containing all of the following fields: reply (non-empty string, maximum 1000 characters), stage (enum: abertura, descoberta, diagnostico, explicacao_solucao, tratamento_objecao, conversao, handoff_humano), detectedSegment (string or null), businessDescription (string or null), detectedIntent (enum: vendas, suporte, agendamento, duvidas, orcamento, integracao, curiosidade, outro), whatsappUsage (string or null), mainPain (string or null), secondaryPains (array of strings, maximum 10 items), desiredOutcome (string or null), estimatedVolume (enum: baixo, medio, alto, desconhecido), urgency (enum: baixa, media, alta, desconhecida), decisionRole (enum: dono, gestor, funcionario, desconhecido), budgetSignal (enum: baixo, medio, alto, desconhecido), objections (array of strings, maximum 10 items), recommendedService (string or null), leadScore (integer from 0 to 100), scoreReasons (array of strings, maximum 10 items), temperature (enum: frio, morno, quente), status (enum: novo, qualificando, frio, morno, quente, chamar_humano, convertido, perdido), shouldHandoff (boolean), handoffReason (string or null), commercialSummary (string or null, maximum 2000 characters), and nextBestQuestion (string or null)
2. WHEN the Assistente_Decodifica receives the JSON response, THE Assistente_Decodifica SHALL display only the reply field to the user and persist all other fields to the database for the qualification panel
3. IF the LLM_Provider returns a response that is not parseable as JSON or contains enum fields with values outside their allowed sets, THEN THE Assistente_Decodifica SHALL retry the request once within 10 seconds and log the error
4. IF the LLM_Provider fails after retry, THEN THE Assistente_Decodifica SHALL return a fallback message to the user indicating temporary unavailability without exposing technical details, and log the failure
5. IF shouldHandoff is true, THEN THE Assistente_Decodifica SHALL require handoffReason to be a non-empty string

### Requirement 5: Real-Time Lead Qualification

**User Story:** As a Decodifica team member, I want to see lead qualification data update in real-time as the conversation progresses, so that I can evaluate the agent's qualification accuracy.

#### Acceptance Criteria

1. WHEN the LLM_Provider returns a structured response, THE Playground SHALL update the qualification side panel within 2 seconds of receiving the response, displaying the latest score, status, temperature, segment, intent, pain, recommended service, urgency, volume, handoff information, commercial summary, next question, and objections without requiring a page reload
2. WHEN the LLM_Provider returns a structured response, THE Playground SHALL save an Agent_Analysis record to the database with all fields defined in the Agent_Analysis schema: detectedSegment, detectedIntent, mainPain, recommendedService, score, temperature, status, shouldHandoff, handoffReason, commercialSummary, nextBestQuestion, and rawJson
3. WHEN the LLM_Provider returns a structured response, THE Playground SHALL update the Lead record with the latest qualification data including score, temperature, status, segment, main pain, recommended service, and objections
4. IF the LLM_Provider returns null or empty values for one or more qualification fields, THEN THE Playground SHALL retain the previously displayed values for those fields in the side panel and in the Lead record
5. IF the Agent_Analysis record or Lead record fails to save to the database, THEN THE Playground SHALL still display the qualification data in the side panel and show an error indication that the data was not persisted

### Requirement 6: Lead Scoring

**User Story:** As a Decodifica team member, I want leads to be scored automatically based on conversation data, so that I can prioritize follow-up actions.

#### Acceptance Criteria

1. WHEN the Assistente_Decodifica identifies the client's business (the client mentions their company name, industry sector, or type of activity), THE Lead_Score SHALL increase by 15 points
2. WHEN the client explains their WhatsApp usage (describes at least one current use case or states they do not use WhatsApp for business), THE Lead_Score SHALL increase by 15 points
3. WHEN the Assistente_Decodifica identifies a pain point (the client describes a specific problem, frustration, or inefficiency related to their communication or operations), THE Lead_Score SHALL increase by 20 points
4. WHEN the client reveals volume, recurrence, or operational impact (mentions numeric quantities, frequency of occurrence, or measurable business consequences), THE Lead_Score SHALL increase by 15 points
5. WHEN the client expresses urgency or intent to solve (uses time-bound language, states desire to change, or requests a solution), THE Lead_Score SHALL increase by 10 points
6. WHEN the client is identified as owner, manager, or decision-maker (self-declares their role or confirms decision-making authority), THE Lead_Score SHALL increase by 10 points
7. WHEN the client accepts a diagnosis or human support (explicitly agrees to receive a proposed diagnosis, schedule a call, or speak with a human representative), THE Lead_Score SHALL increase by 15 points
8. WHEN a new conversation starts, THE Lead_Score SHALL be initialized at 0 points
9. WHILE the Lead_Score is between 0 and 39 (inclusive), THE Lead SHALL have temperature classified as "frio"
10. WHILE the Lead_Score is between 40 and 69 (inclusive), THE Lead SHALL have temperature classified as "morno"
11. WHILE the Lead_Score is between 70 and 100 (inclusive), THE Lead SHALL have temperature classified as "quente"
12. THE Lead_Score SHALL only count each scoring criterion (criteria 1-7) once per conversation, and each score increase SHALL be accompanied by an entry in the scoreReasons array explaining which criterion was met
13. IF the calculated Lead_Score exceeds 100, THEN THE system SHALL cap the Lead_Score at 100

### Requirement 7: Handoff to Human Support

**User Story:** As a Decodifica team member, I want the system to identify when a lead should be routed to human support, so that high-intent leads receive personal attention.

#### Acceptance Criteria

1. WHEN the Lead_Score reaches 70 or above, THE Assistente_Decodifica SHALL set shouldHandoff to true
2. WHEN the client sends a message expressing a desire to speak with a human (e.g., "quero falar com alguém", "atendente humano", or equivalent phrasing), THE Assistente_Decodifica SHALL set shouldHandoff to true
3. WHEN the client sends a message containing a direct request or question about proposal, price, implementation, or meeting (not merely a passing reference), THE Assistente_Decodifica SHALL set shouldHandoff to true
4. WHEN the client expresses affirmative intent to move forward with services (e.g., "quero contratar", "vamos em frente", "quero prosseguir"), THE Assistente_Decodifica SHALL set shouldHandoff to true
5. WHEN the client asks a question that the Assistente_Decodifica cannot answer from its configured knowledge base, THE Assistente_Decodifica SHALL set shouldHandoff to true
6. WHEN shouldHandoff is set to true, THE Assistente_Decodifica SHALL provide a handoffReason as a non-empty string between 10 and 500 characters that identifies which trigger condition caused the handoff
7. WHEN shouldHandoff is set to true, THE Playground SHALL display a distinct badge or label element in the qualification panel on the right column indicating that human support is recommended
8. WHEN a handoff trigger condition is met, THE Assistente_Decodifica SHALL send the handoff confirmation message ("Acho que já tenho contexto suficiente para alguém da Decodifica avaliar seu caso com mais precisão. Posso encaminhar seu atendimento com um resumo do que você precisa?") and wait for the client's response before changing status to "chamar_humano" and conversation stage to "handoff_humano"
9. IF the client declines the handoff after receiving the confirmation message, THEN THE Assistente_Decodifica SHALL keep shouldHandoff as false, maintain the current conversation stage, and continue the conversation normally
10. WHEN the client accepts the handoff confirmation, THE Assistente_Decodifica SHALL set the status to "chamar_humano", set shouldHandoff to true, and transition the conversation stage to "handoff_humano"

### Requirement 8: Dashboard Summary

**User Story:** As a Decodifica team member, I want to see a summary dashboard of all leads, so that I can monitor overall qualification performance and pipeline status.

#### Acceptance Criteria

1. THE Dashboard SHALL display summary cards showing: total leads count, hot leads count, warm leads count, cold leads count, and leads awaiting human support count
2. THE Dashboard SHALL display a paginated table listing leads with columns: name/phone, segment, main pain, score, status, temperature, last message preview (truncated to 50 characters with ellipsis if longer), and date (in DD/MM/YYYY HH:mm format), sorted by most recent date first, showing up to 20 leads per page
3. WHEN a user clicks the "view detail" button on a lead row, THE Dashboard SHALL navigate to the Lead Detail screen for that lead
4. IF no leads exist in the system, THEN THE Dashboard SHALL display all summary card counts as zero and show an empty-state message in the table area indicating no leads are available
5. WHEN a new lead is created or a lead status changes, THE Dashboard SHALL reflect the updated counts and table data upon page reload or within 30 seconds if auto-refresh is enabled

### Requirement 9: Lead Detail View

**User Story:** As a Decodifica team member, I want to view complete lead details and conversation history, so that I can review qualification accuracy and prepare for human follow-up.

#### Acceptance Criteria

1. THE Lead_Detail_Screen SHALL display all lead data fields including name, phone, email, company name, segment, and business description, showing a placeholder label (e.g., "Not informed") for any field that is null or empty
2. THE Lead_Detail_Screen SHALL display the full conversation history with all messages in chronological order, with visual distinction between user messages and assistant messages by role
3. THE Lead_Detail_Screen SHALL display the qualification data from the most recent Agent_Analysis including: commercial summary, score with reasons, temperature, main pain, recommended service, objections, and next step
4. WHEN a user clicks "mark as call human", THE Lead_Detail_Screen SHALL update the lead status to "chamar_humano" via PATCH /leads/:id/status and display a visible confirmation that the status was updated
5. WHEN a user clicks "mark as converted", THE Lead_Detail_Screen SHALL update the lead status to "convertido" via PATCH /leads/:id/status and display a visible confirmation that the status was updated
6. WHEN a user clicks "mark as lost", THE Lead_Detail_Screen SHALL update the lead status to "perdido" via PATCH /leads/:id/status and display a visible confirmation that the status was updated
7. IF a status update request fails, THEN THE Lead_Detail_Screen SHALL display an error message indicating the status could not be updated and SHALL keep the previous status unchanged

### Requirement 10: Knowledge Base Management

**User Story:** As a Decodifica team member, I want to manage the knowledge base that informs agent responses, so that I can keep the agent's information accurate and up-to-date.

#### Acceptance Criteria

1. THE Agent_Settings_Screen SHALL display a list of all Knowledge_Base items (both active and inactive) grouped by category, showing each item's title, category, active status, and updatedAt timestamp
2. WHEN a user submits a new Knowledge_Base item with a category (max 50 characters), title (max 100 characters), and content (max 5000 characters), THE Agent_Settings_Screen SHALL save the item to the database with active set to true and createdAt and updatedAt set to the current timestamp
3. WHEN a user edits an existing Knowledge_Base item's category, title, or content, THE Agent_Settings_Screen SHALL update the modified fields and set updatedAt to the current timestamp
4. THE Knowledge_Base SHALL be seeded with 12 initial active items covering the categories: "empresa", "servicos", "automacao", "implantacao", "objecoes", and "conversao"
5. WHEN a user toggles the active status of a Knowledge_Base item, THE Agent_Settings_Screen SHALL update the item's active field and updatedAt timestamp in the database
6. IF a user attempts to create or edit a Knowledge_Base item with an empty category, title, or content field, THEN THE Agent_Settings_Screen SHALL prevent the save and display a validation error indicating which fields are required

### Requirement 11: Agent Settings Configuration

**User Story:** As a Decodifica team member, I want to configure agent behavior settings, so that I can fine-tune the assistant's personality and rules without code changes.

#### Acceptance Criteria

1. THE Agent_Settings_Screen SHALL allow editing the following fields: agent name (maximum 100 characters), initial message (maximum 500 characters), tone of voice description (maximum 300 characters), list of services offered (maximum 20 items, each up to 200 characters), rules of what not to promise (maximum 20 items, each up to 200 characters), and handoff criteria (maximum 10 items, each up to 200 characters)
2. WHEN a user opens the Agent_Settings_Screen, THE Agent_Settings_Screen SHALL display the currently saved values for all agent setting fields
3. WHEN a user saves agent settings with all required fields filled, THE Agent_Settings_Screen SHALL persist the configuration, display a success confirmation, and apply the new settings only to conversations started after the save
4. IF a user attempts to save agent settings with the agent name or initial message field empty, THEN THE Agent_Settings_Screen SHALL display a validation error indicating which required fields are missing and SHALL NOT persist the changes
5. IF the system fails to persist agent settings, THEN THE Agent_Settings_Screen SHALL display an error message indicating the save failed and SHALL retain the user's entered values in the form
6. WHEN the Assistente_Decodifica constructs a prompt for the LLM_Provider, THE Assistente_Decodifica SHALL include the saved agent name, tone of voice description, list of services offered, rules of what not to promise, and handoff criteria in the prompt context

### Requirement 12: Data Persistence

**User Story:** As a developer, I want all conversation and lead data persisted in PostgreSQL, so that the system maintains a complete history for analysis and future use.

#### Acceptance Criteria

1. THE System SHALL persist Lead records with all fields: id (UUID, required), name (string, max 200 characters, required), phone (string, max 20 characters, required), email (string, max 254 characters, optional), companyName (string, max 200 characters, optional), segment (string, max 100 characters, optional), businessDescription (string, max 2000 characters, optional), whatsappUsage (string, max 500 characters, optional), mainPain (string, max 1000 characters, optional), secondaryPains (JSON array, max 20 items, optional), desiredOutcome (string, max 1000 characters, optional), estimatedVolume (string, max 100 characters, optional), urgency (string, max 50 characters, optional), decisionRole (string, max 100 characters, optional), budgetSignal (string, max 500 characters, optional), objections (JSON array, max 20 items, optional), recommendedService (string, max 200 characters, optional), leadScore (integer, 0 to 100, optional), temperature (string, max 20 characters, optional), status (string, max 50 characters, required), summary (string, max 5000 characters, optional), nextStep (string, max 1000 characters, optional), createdAt (timestamp, required), and updatedAt (timestamp, required)
2. THE System SHALL persist Conversation records with all fields: id (UUID, required), leadId (UUID, required, references Lead.id), channel (string, max 50 characters, required), stage (string, max 50 characters, required), status (string, max 50 characters, required), lastIntent (string, max 100 characters, optional), handoffRequired (boolean, required), handoffReason (string, max 500 characters, optional), createdAt (timestamp, required), and updatedAt (timestamp, required)
3. THE System SHALL persist Message records with all fields: id (UUID, required), conversationId (UUID, required, references Conversation.id), role (string, max 50 characters, required), direction (string, max 20 characters, required), content (string, max 10000 characters, required), metadata (JSON object, max 50KB, optional), and createdAt (timestamp, required)
4. THE System SHALL persist Agent_Analysis records with all fields: id (UUID, required), conversationId (UUID, required, references Conversation.id), leadId (UUID, required, references Lead.id), detectedSegment (string, max 100 characters, optional), detectedIntent (string, max 100 characters, optional), mainPain (string, max 1000 characters, optional), recommendedService (string, max 200 characters, optional), score (integer, 0 to 100, optional), temperature (string, max 20 characters, optional), status (string, max 50 characters, optional), shouldHandoff (boolean, optional), handoffReason (string, max 500 characters, optional), commercialSummary (string, max 5000 characters, optional), nextBestQuestion (string, max 1000 characters, optional), scoreReasons (JSON array, max 20 items, optional), rawJson (JSON object, max 200KB, optional), and createdAt (timestamp, required)
5. WHEN a record with a foreign key reference is persisted, THE System SHALL enforce referential integrity by rejecting the operation if the referenced parent record does not exist
6. WHEN any field of a Lead or Conversation record is modified, THE System SHALL update the updatedAt timestamp to the current UTC time
7. IF a persistence operation fails due to database unavailability or constraint violation, THEN THE System SHALL return an error indication to the caller and SHALL NOT leave partially written data in the database

### Requirement 13: Channel Adapter Architecture

**User Story:** As a developer, I want the system to use a channel adapter pattern, so that the core agent logic can be reused when integrating with real WhatsApp via Evolution API in the future.

#### Acceptance Criteria

1. THE System SHALL define a Channel_Adapter interface with a sendMessage method accepting parameters (to: string, message: string) returning Promise<void>, and a receiveMessage method accepting parameter (payload: unknown) returning Promise<InboundMessage>
2. THE System SHALL implement a PlaygroundChannelAdapter that implements the Channel_Adapter interface, routing outbound messages to the web playground client and parsing inbound playground requests into InboundMessage format
3. THE System SHALL include an EvolutionChannelAdapter stub that implements the Channel_Adapter interface with methods that throw a "not implemented" error, and that defines placeholder structure for: a webhook endpoint for receiving WhatsApp messages, a sendMessage method for calling Evolution API, and environment variables EVOLUTION_API_URL, EVOLUTION_API_KEY, and EVOLUTION_INSTANCE_NAME
4. THE Assistente_Decodifica service SHALL depend only on the Channel_Adapter interface for sending and receiving messages, with no direct imports or references to PlaygroundChannelAdapter or EvolutionChannelAdapter
5. IF the Channel_Adapter sendMessage method fails, THEN THE System SHALL log the error and return an error indication to the caller without crashing the service

### Requirement 14: Docker Compose Local Development

**User Story:** As a developer, I want to run the entire system locally with Docker Compose, so that I can develop and test without manual service setup.

#### Acceptance Criteria

1. THE System SHALL provide a docker-compose configuration that defines three services: postgres (PostgreSQL database), api (NestJS backend), and web (React frontend)
2. THE System SHALL configure the postgres service with a named volume for data persistence so that data is retained across container restarts
3. THE System SHALL configure service dependencies so that the api service starts only after the postgres service reports healthy, and the web service starts only after the api service reports healthy
4. WHEN a developer runs docker-compose up, THE System SHALL start all services and make the frontend accessible on port 3000 and the API accessible on port 3001 within 120 seconds of command execution
5. THE System SHALL define environment variables DATABASE_URL, LLM_PROVIDER, OPENAI_API_KEY, MODEL_NAME, APP_ENV, and FRONTEND_URL in the docker-compose configuration, reading values from a .env file in the project root
6. THE System SHALL provide a .env.example file in the project root that documents all required environment variables (DATABASE_URL, LLM_PROVIDER, OPENAI_API_KEY, MODEL_NAME, APP_ENV, FRONTEND_URL) and optional future variables (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME) with placeholder values
7. IF a required environment variable (DATABASE_URL, LLM_PROVIDER, MODEL_NAME, APP_ENV, or FRONTEND_URL) is not defined, THEN THE System SHALL fail to start the dependent service and output an error message indicating which variable is missing

### Requirement 15: Frontend Design System

**User Story:** As a Decodifica team member, I want the application to have a professional dark-themed design, so that it looks like a polished internal SaaS tool.

#### Acceptance Criteria

1. THE Frontend SHALL use a dark theme with background color #050505, card color #111111, border color #242424, text color #F5F7F6, muted text color #A7B0AA, green accent #25D366, and dark green #0B1A12
2. THE Frontend SHALL use Tailwind CSS for styling with cards having a border-radius between 8px and 12px, body text no smaller than 14px, and a minimum contrast ratio of 4.5:1 between text and its background
3. THE Frontend SHALL render all content without horizontal overflow and without overlapping elements at viewport widths from 768px (tablet) to 1920px (desktop), with desktop (1024px and above) as the primary layout
4. THE Frontend SHALL use lucide-react for all iconography
5. THE Frontend SHALL present a text-only interface without emojis, decorative illustrations, or animated backgrounds, using the green accent color (#25D366) only for interactive highlights and status indicators

### Requirement 16: API Endpoints

**User Story:** As a developer, I want well-defined REST API endpoints, so that the frontend can communicate with the backend reliably.

#### Acceptance Criteria

1. THE API SHALL expose POST /playground/conversations to create a new conversation and return the created conversation object including its generated ID
2. THE API SHALL expose POST /playground/conversations/:id/messages to accept a message body, trigger the LLM agent, and return the agent response along with updated qualification data within 30 seconds
3. THE API SHALL expose GET /playground/conversations/:id to retrieve a conversation with its full message history in chronological order
4. THE API SHALL expose GET /leads to list leads with optional filtering by status and temperature query parameters, returning results paginated with a default page size of 20 items
5. THE API SHALL expose GET /leads/:id to retrieve a single lead including all qualification data, conversation history reference, and current status
6. THE API SHALL expose PATCH /leads/:id/status to update a lead's status, accepting the new status value in the request body
7. THE API SHALL expose GET /dashboard/summary to retrieve aggregated lead statistics including total lead count, count per status, and count per temperature category
8. THE API SHALL expose GET /knowledge to list all knowledge base items including their ID, title, and content type
9. THE API SHALL expose POST /knowledge to create a new knowledge base item, requiring at minimum a title and content in the request body, and returning the created item with its generated ID
10. THE API SHALL expose PATCH /knowledge/:id to update an existing knowledge base item, accepting partial fields in the request body and returning the updated item
11. IF a request references a resource ID that does not exist, THEN THE API SHALL return a 404 status code with a JSON error response containing a message indicating the resource was not found
12. IF a POST or PATCH request is missing required fields or contains invalid data, THEN THE API SHALL return a 422 status code with a JSON error response containing a message indicating which validation constraints failed
13. IF the LLM agent fails to respond within 30 seconds or returns an error during POST /playground/conversations/:id/messages, THEN THE API SHALL return a 503 status code with a JSON error response indicating the agent is temporarily unavailable

### Requirement 17: Configurable LLM Provider

**User Story:** As a developer, I want the LLM provider to be configurable via environment variables, so that the team can switch between AI models without code changes.

#### Acceptance Criteria

1. THE System SHALL read the LLM_PROVIDER environment variable at startup and initialize the corresponding AI service provider, where supported values include "openai"
2. THE System SHALL read the MODEL_NAME environment variable at startup and use its value to select the model within the configured provider
3. IF the MODEL_NAME environment variable is not set or is empty, THEN THE System SHALL default to "gpt-4o-mini"
4. THE System SHALL read the OPENAI_API_KEY environment variable and use its value for authentication with the LLM provider
5. IF the LLM_PROVIDER environment variable is not set or is empty, THEN THE System SHALL log an error message indicating the missing variable and fail to start
6. IF the LLM_PROVIDER environment variable is set to an unsupported value, THEN THE System SHALL log an error message indicating the unsupported provider and the list of supported providers, and fail to start
7. IF the OPENAI_API_KEY environment variable is not set or is empty, THEN THE System SHALL log an error message indicating the missing API key and fail to start
