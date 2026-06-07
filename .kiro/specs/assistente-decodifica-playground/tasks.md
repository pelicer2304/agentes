# Implementation Plan: Assistente Decodifica Playground

## Overview

This plan implements the Assistente Decodifica Playground MVP as a monorepo with `apps/api` (NestJS + TypeScript + Prisma) and `apps/web` (React + Vite + Tailwind). Tasks are ordered to build foundational infrastructure first, then core backend services, followed by frontend screens, and finally integration wiring.

## Tasks

- [x] 1. Project scaffolding and infrastructure setup
  - [x] 1.1 Initialize monorepo structure with apps/api and apps/web
    - Create root package.json with workspaces configuration
    - Initialize `apps/api` with NestJS CLI (TypeScript strict mode)
    - Initialize `apps/web` with Vite + React + TypeScript template
    - Configure shared tsconfig paths and project references
    - _Requirements: 14.1_

  - [x] 1.2 Configure Docker Compose and environment
    - Create `docker-compose.yml` with postgres, api, and web services
    - Configure postgres with named volume, healthcheck, and port 5432
    - Configure api service with dependency on healthy postgres, port 3001
    - Configure web service with dependency on healthy api, port 3000
    - Create `.env.example` with all required and optional variables
    - Create Dockerfiles for api and web services
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x] 1.3 Set up Prisma schema and database models
    - Install Prisma in apps/api
    - Create `schema.prisma` with Lead, Conversation, Message, AgentAnalysis, KnowledgeBase, and AgentSettings models
    - Configure UUID primary keys, field mappings, and relations
    - Create initial migration
    - Create PrismaModule and PrismaService with onModuleInit connection
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 1.4 Set up ConfigModule with environment validation
    - Create `config.schema.ts` with Joi validation for DATABASE_URL, LLM_PROVIDER, OPENAI_API_KEY, MODEL_NAME, APP_ENV, FRONTEND_URL
    - Create ConfigService exposing typed config values
    - Fail startup with descriptive error if required vars are missing
    - Default MODEL_NAME to "gpt-4o-mini" if not set
    - _Requirements: 14.5, 14.7, 17.1, 17.2, 17.3, 17.5, 17.6, 17.7_

  - [x] 1.5 Set up testing frameworks
    - Configure Jest for apps/api (unit + integration + property tests)
    - Install fast-check for property-based testing
    - Configure Vitest + Testing Library for apps/web
    - Add test scripts to package.json
    - _Requirements: (testing infrastructure)_

- [x] 2. Checkpoint - Verify infrastructure
  - Ensure Docker Compose starts all services successfully, Prisma migrations run, and test frameworks execute.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Backend core modules - Channel and LLM abstractions
  - [x] 3.1 Implement Channel Adapter interface and PlaygroundChannelAdapter
    - Create `channel-adapter.interface.ts` with InboundMessage, ChannelAdapter
    - Implement PlaygroundChannelAdapter (sendMessage routes to response, receiveMessage parses request body)
    - Create ChannelModule with provider registration
    - _Requirements: 13.1, 13.2, 13.4, 13.5_

  - [x] 3.2 Implement EvolutionChannelAdapter stub
    - Create EvolutionChannelAdapter implementing ChannelAdapter interface
    - Both methods throw "not implemented" error
    - Define placeholder for webhook endpoint, env vars (EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME)
    - _Requirements: 13.3_

  - [x] 3.3 Implement LLM Provider interface and OpenAI provider
    - Create `llm-provider.interface.ts` with LLMCompletionRequest, LLMCompletionResponse, LLMProvider
    - Implement OpenAIProviderService using OpenAI SDK with structured JSON output
    - Create LLMProviderFactory selecting provider based on LLM_PROVIDER env var
    - Configure 30-second timeout on LLM calls
    - Create LLMModule with factory provider
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

  - [x] 3.4 Implement Agent service with prompt builder and response parser
    - Create PromptBuilderService: constructs system prompt from agent settings + knowledge base + conversation history
    - Create ResponseParserService: validates JSON structure, enforces enum constraints, rejects invalid responses
    - Create AgentService: orchestrates LLM call, handles retry on parse failure (once within 10s), returns fallback on final failure
    - Define AgentResponse DTO with all fields and enum types
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 3.1, 3.2, 3.3, 3.4, 3.5, 11.6_

  - [ ]* 3.5 Write property tests for response parser (Properties 2, 3, 4, 5, 7)
    - **Property 2: Agent response JSON schema validation (round-trip)**
    - **Property 3: Agent response single question constraint**
    - **Property 4: Agent reply length constraint**
    - **Property 5: No emoji and no repeated filler words**
    - **Property 7: Handoff reason validation**
    - **Validates: Requirements 4.1, 4.5, 3.2, 3.3, 3.4, 7.6**

- [x] 4. Backend domain modules - Conversation and Lead
  - [x] 4.1 Implement ConversationService and ConversationController
    - Create ConversationService: createConversation (new Lead + Conversation + initial greeting message), handleInboundMessage (save user msg, load history, call agent, save assistant msg + analysis, update lead)
    - Implement Prisma transactions for message exchange flow
    - Handle conversation reset (set stage to handoff_humano, mark inactive, create new)
    - Create ConversationController with routes:
      - POST /playground/conversations
      - POST /playground/conversations/:id/messages
      - GET /playground/conversations/:id
    - Create DTOs: CreateConversationDto, SendMessageDto (content: 1-4000 chars)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.2, 5.3, 5.4, 5.5, 16.1, 16.2, 16.3, 16.13_

  - [ ]* 4.2 Write property tests for message validation and stage progression (Properties 1, 6)
    - **Property 1: Message length validation**
    - **Property 6: Conversation stage progression invariant**
    - **Validates: Requirements 2.1, 2.2, 3.5**

  - [x] 4.3 Implement LeadService and LeadController
    - Create LeadService: create, findAll (paginated, filtered by status/temperature), findById, updateStatus, updateQualificationData (with null retention logic)
    - Create LeadController with routes:
      - GET /leads (paginated, filterable)
      - GET /leads/:id
      - PATCH /leads/:id/status
    - Create DTOs: UpdateLeadStatusDto, LeadFilterDto
    - Implement 404 for non-existent resources
    - _Requirements: 5.3, 5.4, 8.2, 9.1, 9.4, 9.5, 9.6, 9.7, 16.4, 16.5, 16.6, 16.11, 16.12_

  - [ ]* 4.4 Write property tests for scoring and lead management (Properties 10, 11, 12, 13, 14)
    - **Property 10: Scoring criteria increment**
    - **Property 11: Temperature classification**
    - **Property 12: Scoring idempotence**
    - **Property 13: Score cap at 100**
    - **Property 14: Handoff threshold trigger**
    - **Validates: Requirements 6.1-6.13, 7.1**

  - [ ]* 4.5 Write property tests for data persistence (Properties 8, 9, 20, 21, 22)
    - **Property 8: AgentResponse to database mapping**
    - **Property 9: Null field retention**
    - **Property 20: Referential integrity enforcement**
    - **Property 21: updatedAt timestamp invariant**
    - **Property 22: Non-existent resource returns 404**
    - **Validates: Requirements 5.2, 5.3, 5.4, 12.5, 12.6, 16.11**

- [x] 5. Backend domain modules - Dashboard, Knowledge, Settings
  - [x] 5.1 Implement DashboardService and DashboardController
    - Create DashboardService: getSummary (total leads, hot/warm/cold counts, awaiting human count)
    - Create DashboardController with route: GET /dashboard/summary
    - _Requirements: 8.1, 8.4, 16.7_

  - [x] 5.2 Implement KnowledgeService and KnowledgeController
    - Create KnowledgeService: findAll (grouped by category), create, update, toggleActive
    - Create KnowledgeController with routes:
      - GET /knowledge
      - POST /knowledge
      - PATCH /knowledge/:id
    - Create DTOs: CreateKnowledgeDto, UpdateKnowledgeDto with validation (category max 50, title max 100, content max 5000)
    - Implement validation errors for empty required fields (422)
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6, 16.8, 16.9, 16.10, 16.11, 16.12_

  - [x] 5.3 Implement SettingsService and SettingsController
    - Create SettingsService: getSettings, updateSettings
    - Create SettingsController with routes:
      - GET /settings
      - PATCH /settings
    - Create UpdateSettingsDto with validation (agentName max 100, initialMessage max 500, toneOfVoice max 300, services max 20 items, doNotPromise max 20 items, handoffCriteria max 10 items)
    - Validate required fields (agentName, initialMessage)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 5.4 Create knowledge base seed data
    - Create Prisma seed script with 12 initial KnowledgeBase items
    - Cover categories: "empresa", "servicos", "automacao", "implantacao", "objecoes", "conversao"
    - Create default AgentSettings record with initial greeting message
    - _Requirements: 10.4, 1.3_

  - [ ]* 5.5 Write property tests for knowledge and validation (Properties 18, 19)
    - **Property 18: Knowledge base grouping by category**
    - **Property 19: Required field validation**
    - **Validates: Requirements 10.1, 10.6, 11.4, 16.12**

  - [ ]* 5.6 Write property tests for pagination and ordering (Property 15)
    - **Property 15: Pagination and ordering**
    - **Validates: Requirements 8.2, 9.2**

- [x] 6. Checkpoint - Backend complete
  - Ensure all backend tests pass, API endpoints respond correctly, and database operations work.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Frontend foundation and shared components
  - [x] 7.1 Configure Tailwind CSS dark theme and design tokens
    - Install and configure Tailwind CSS with dark theme colors (#050505 bg, #111111 card, #242424 border, #F5F7F6 text, #A7B0AA muted, #25D366 accent, #0B1A12 dark green)
    - Configure border-radius (8-12px), minimum font size (14px)
    - Install lucide-react for iconography
    - Create utility functions (tailwind merge, formatters)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [x] 7.2 Create shared UI components
    - Implement Button, Card, Badge, Input, Table, Pagination components
    - Apply dark theme styling with proper contrast ratios (4.5:1 minimum)
    - Ensure responsive layout from 768px to 1920px (desktop primary)
    - _Requirements: 15.1, 15.2, 15.3_

  - [x] 7.3 Create layout components and routing
    - Implement Sidebar with navigation links (Playground, Dashboard, Settings)
    - Implement PageLayout wrapper component
    - Set up React Router with routes for all pages
    - Configure API client (Axios instance pointing to :3001)
    - Set up React Query provider
    - _Requirements: 15.1, 15.3_

- [x] 8. Frontend - Playground page
  - [x] 8.1 Implement ChatPanel and message display
    - Create ChatPanel component with message list
    - Create MessageBubble component (user right-aligned, assistant left-aligned)
    - Implement auto-scroll to latest message
    - Display initial greeting message on new conversation
    - _Requirements: 2.6, 1.3_

  - [x] 8.2 Implement ChatInput with validation
    - Create ChatInput component with text area and send button
    - Validate message length (1-4000 characters)
    - Show validation error for empty or oversized messages
    - Disable input while waiting for response (loading state)
    - _Requirements: 2.1, 2.2, 2.5_

  - [x] 8.3 Implement QualificationPanel (side panel)
    - Create QualificationPanel displaying: score, status, temperature, segment, intent, pain, recommended service, urgency, volume, handoff info, commercial summary, next question, objections
    - Update panel immediately when API response arrives (no page reload)
    - Show handoff badge when shouldHandoff is true
    - Retain previous values when new response has null fields
    - _Requirements: 5.1, 5.4, 5.5, 7.7_

  - [x] 8.4 Implement PlaygroundPage with conversation hooks
    - Create useConversation hook (React Query): createConversation, sendMessage, getConversation
    - Wire ChatPanel + ChatInput + QualificationPanel into PlaygroundPage
    - Implement "new conversation" button (closes existing, creates new)
    - Implement "reset conversation" button
    - Handle LLM error states (display error, preserve user message)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.3, 2.4, 2.5_

  - [ ]* 8.5 Write component tests for Playground
    - Test ChatPanel renders messages correctly
    - Test ChatInput validation behavior
    - Test QualificationPanel displays and retains data
    - _Requirements: 2.1, 2.2, 2.6, 5.1_

- [x] 9. Frontend - Dashboard and Lead Detail pages
  - [x] 9.1 Implement DashboardPage with summary cards and leads table
    - Create SummaryCards component (total, hot, warm, cold, awaiting human)
    - Create LeadsTable with columns: name/phone, segment, pain, score, status, temperature, last message (truncated 50 chars), date (DD/MM/YYYY HH:mm)
    - Implement pagination (20 per page)
    - Sort by most recent date first
    - Show empty state when no leads exist
    - Create useDashboard and useLeads hooks
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.2 Implement LeadDetailPage
    - Create LeadInfo component showing all lead fields (placeholder for null)
    - Create ConversationHistory component with full message list (chronological)
    - Create QualificationSummary showing most recent AgentAnalysis data
    - Implement status action buttons: "mark as call human", "mark as converted", "mark as lost"
    - Handle PATCH /leads/:id/status with success/error feedback
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [ ]* 9.3 Write component tests for Dashboard and Lead Detail (Property 16, 17)
    - **Property 16: Lead detail null field display**
    - **Property 17: Most recent analysis display**
    - Test SummaryCards renders correct counts
    - Test LeadsTable pagination and sorting
    - **Validates: Requirements 9.1, 9.3, 8.1, 8.2**

- [x] 10. Frontend - Settings and Knowledge Base pages
  - [x] 10.1 Implement SettingsPage with agent configuration form
    - Create AgentSettingsForm with fields: agent name, initial message, tone of voice, services list, do-not-promise list, handoff criteria list
    - Implement dynamic list management (add/remove items)
    - Validate required fields (agent name, initial message)
    - Show success/error feedback on save
    - Create useSettings hook
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [x] 10.2 Implement Knowledge Base management on SettingsPage
    - Create KnowledgeList component grouped by category
    - Create KnowledgeForm for create/edit (category, title, content)
    - Implement active/inactive toggle
    - Validate required fields with error display
    - Create useKnowledge hook
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

  - [ ]* 10.3 Write component tests for Settings and Knowledge
    - Test AgentSettingsForm validation
    - Test KnowledgeForm required field validation
    - Test KnowledgeList grouping by category
    - _Requirements: 11.4, 10.6, 10.1_

- [x] 11. Checkpoint - Frontend complete
  - Ensure all frontend components render correctly, API integration works, and component tests pass.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Integration wiring and final validation
  - [x] 12.1 Wire AppModule with all backend modules
    - Register all modules in AppModule (Config, Prisma, Channel, LLM, Agent, Conversation, Lead, Dashboard, Knowledge, Settings)
    - Configure CORS for frontend origin (FRONTEND_URL)
    - Add global validation pipe (class-validator)
    - Add global exception filter for consistent error responses
    - _Requirements: 16.11, 16.12, 16.13_

  - [x] 12.2 Create shared TypeScript types for frontend
    - Define all interfaces in `apps/web/src/types/index.ts` matching backend DTOs
    - Define AgentResponse, Lead, Conversation, Message, AgentAnalysis, KnowledgeBase, AgentSettings types
    - Define enum types (ConversationStage, DetectedIntent, Temperature, LeadStatus, etc.)
    - _Requirements: 4.1, 12.1, 12.2, 12.3, 12.4_

  - [ ]* 12.3 Write integration tests for full message exchange flow
    - Test POST /playground/conversations creates conversation + lead + greeting
    - Test POST /playground/conversations/:id/messages with mocked LLM returns correct response
    - Test qualification data persists to AgentAnalysis and Lead
    - Test error handling (LLM timeout, invalid JSON, retry)
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 2.4, 2.5, 4.3, 4.4_

  - [ ]* 12.4 Write integration tests for CRUD endpoints
    - Test GET /leads pagination and filtering
    - Test PATCH /leads/:id/status
    - Test GET /dashboard/summary aggregation
    - Test Knowledge CRUD with validation
    - Test 404 for non-existent resources
    - _Requirements: 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 16.11, 16.12_

- [x] 13. Final checkpoint - Full system validation
  - Ensure all tests pass (unit, property, integration, component).
  - Verify Docker Compose starts all services and frontend is accessible on :3000, API on :3001.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (22 properties total)
- Unit tests validate specific examples and edge cases
- The backend uses Prisma transactions to ensure data consistency during message exchange
- The frontend uses React Query for server state management with automatic cache invalidation
- All 22 correctness properties are covered across tasks 3.5, 4.2, 4.4, 4.5, 5.5, 5.6, 9.3

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5"] },
    { "id": 2, "tasks": ["1.4", "7.1"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.3", "7.2"] },
    { "id": 4, "tasks": ["3.4", "7.3"] },
    { "id": 5, "tasks": ["3.5", "4.1", "5.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "5.2", "5.3", "5.4"] },
    { "id": 7, "tasks": ["4.4", "4.5", "5.5", "5.6"] },
    { "id": 8, "tasks": ["8.1", "8.2", "8.3", "12.2"] },
    { "id": 9, "tasks": ["8.4", "9.1"] },
    { "id": 10, "tasks": ["8.5", "9.2", "10.1", "10.2"] },
    { "id": 11, "tasks": ["9.3", "10.3", "12.1"] },
    { "id": 12, "tasks": ["12.3", "12.4"] }
  ]
}
```
