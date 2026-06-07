export { AgentModule } from './agent.module';
export { AgentService, LeadFacts } from './agent.service';
export { AgentReplyService } from './agent-reply.service';
export { AgentAnalysisService } from './agent-analysis.service';
export { FactExtractorService } from './fact-extractor.service';
export { ContextTrackerService } from './context-tracker';
export { HandoffManagerService } from './handoff-manager';
export { ResponseGuardService } from './response-guard.service';
export { PromptBuilderService } from './prompt-builder.service';
export { ResponseParserService, ResponseParseError } from './response-parser.service';

// Pure-function pipeline modules
export { resolveIntent } from './intent-resolver';
export { detectPreference } from './preference-detector';
export { resolveCommand, availableCommandsReply } from './command-handler';
export { classifyEdgeInput, edgeReply, MAX_MESSAGE_LENGTH } from './edge-input';
export { composePriceAnswer } from './price-answer';

// Shared in-memory pipeline contracts (single source of truth for the
// conversational-agent-quality pipeline). The pipeline `ConversationContext`
// lives here, replacing the deprecated shape from normalize-output.service.
export {
  KnownFacts,
  IntentCategory,
  ResolvedIntent,
  IntentContext,
  StatedPreference,
  CommandName,
  CommandResolution,
  EdgeKind,
  HandoffState,
  SaidRecord,
  ConversationContext,
  HandoffDecisionInput,
  HandoffDecision,
  PriceAnswerInput,
  GuardInput,
  GuardOutput,
} from './conversation-types';
export {
  AgentResponse,
  ConversationStage,
  DetectedIntent,
  VolumeLevel,
  UrgencyLevel,
  DecisionRole,
  BudgetSignal,
  Temperature,
  LeadStatus,
  CONVERSATION_STAGES,
  DETECTED_INTENTS,
  VOLUME_LEVELS,
  URGENCY_LEVELS,
  DECISION_ROLES,
  BUDGET_SIGNALS,
  TEMPERATURES,
  LEAD_STATUSES,
} from './dto/agent-response.dto';
export {
  AgentSettingsInput,
  KnowledgeBaseItem,
  ConversationMessage,
} from './dto/agent-settings.dto';
