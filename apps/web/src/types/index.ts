// ============================================================
// Shared TypeScript types for the frontend.
// These mirror backend DTOs and Prisma models for type-safe
// API communication.
// ============================================================

// --- Enum Types ---

export type ConversationStage =
  | 'abertura'
  | 'descoberta'
  | 'diagnostico'
  | 'explicacao_solucao'
  | 'tratamento_objecao'
  | 'conversao'
  | 'handoff_humano';

export type DetectedIntent =
  | 'vendas'
  | 'suporte'
  | 'agendamento'
  | 'duvidas'
  | 'orcamento'
  | 'integracao'
  | 'curiosidade'
  | 'outro';

export type VolumeLevel = 'baixo' | 'medio' | 'alto' | 'desconhecido';

export type UrgencyLevel = 'baixa' | 'media' | 'alta' | 'desconhecida';

export type DecisionRole = 'dono' | 'gestor' | 'funcionario' | 'desconhecido';

export type BudgetSignal = 'baixo' | 'medio' | 'alto' | 'desconhecido';

export type Temperature = 'frio' | 'morno' | 'quente';

export type LeadStatus =
  | 'novo'
  | 'qualificando'
  | 'frio'
  | 'morno'
  | 'quente'
  | 'chamar_humano'
  | 'convertido'
  | 'perdido';

// --- Model Interfaces ---

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  companyName: string | null;
  segment: string | null;
  businessDescription: string | null;
  whatsappUsage: string | null;
  mainPain: string | null;
  secondaryPains: string[] | null;
  desiredOutcome: string | null;
  estimatedVolume: string | null;
  urgency: string | null;
  decisionRole: string | null;
  budgetSignal: string | null;
  objections: string[] | null;
  recommendedService: string | null;
  leadScore: number | null;
  temperature: Temperature | null;
  status: LeadStatus;
  summary: string | null;
  nextStep: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  leadId: string;
  channel: string;
  stage: ConversationStage;
  status: string;
  lastIntent: DetectedIntent | null;
  handoffRequired: boolean;
  handoffReason: string | null;
  createdAt: string;
  updatedAt: string;
  lead?: Lead;
  messages?: Message[];
  agentAnalyses?: AgentAnalysis[];
  latestAnalysis?: AgentAnalysis | null;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  direction: 'inbound' | 'outbound' | 'internal';
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AgentAnalysis {
  id: string;
  conversationId: string;
  leadId: string;
  detectedSegment: string | null;
  detectedIntent: DetectedIntent | null;
  mainPain: string | null;
  recommendedService: string | null;
  score: number | null;
  temperature: Temperature | null;
  status: LeadStatus | null;
  shouldHandoff: boolean | null;
  handoffReason: string | null;
  commercialSummary: string | null;
  nextBestQuestion: string | null;
  scoreReasons: string[] | null;
  rawJson: Record<string, unknown> | null;
  createdAt: string;
}

export interface KnowledgeItem {
  id: string;
  category: string;
  title: string;
  content: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentSettings {
  id: string;
  agentName: string;
  initialMessage: string;
  toneOfVoice: string | null;
  services: string[] | null;
  doNotPromise: string[] | null;
  handoffCriteria: string[] | null;
  createdAt: string;
  updatedAt: string;
}

// --- API Response Types ---

export interface AgentResponse {
  reply: string;
  stage: ConversationStage;
  detectedSegment: string | null;
  businessDescription: string | null;
  detectedIntent: DetectedIntent;
  whatsappUsage: string | null;
  mainPain: string | null;
  secondaryPains: string[];
  desiredOutcome: string | null;
  estimatedVolume: VolumeLevel;
  urgency: UrgencyLevel;
  decisionRole: DecisionRole;
  budgetSignal: BudgetSignal;
  objections: string[];
  recommendedService: string | null;
  leadScore: number;
  scoreReasons: string[];
  temperature: Temperature;
  status: LeadStatus;
  shouldHandoff: boolean;
  handoffReason: string | null;
  commercialSummary: string | null;
  nextBestQuestion: string | null;
}

export interface QualificationData {
  stage: ConversationStage;
  detectedSegment: string | null;
  detectedIntent: DetectedIntent | null;
  mainPain: string | null;
  recommendedService: string | null;
  leadScore: number | null;
  temperature: Temperature | null;
  status: LeadStatus | null;
  shouldHandoff: boolean | null;
  handoffReason: string | null;
  commercialSummary: string | null;
  nextBestQuestion: string | null;
  scoreReasons: string[] | null;
  objections: string[] | null;
  urgency: UrgencyLevel | null;
  estimatedVolume: VolumeLevel | null;
  decisionRole: DecisionRole | null;
  budgetSignal: BudgetSignal | null;
}

export interface SendMessageResponse {
  message: Message;
  qualification: QualificationData;
}

export interface DashboardSummary {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  awaitingHuman: number;
}

export interface PaginatedLeads {
  data: Lead[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface KnowledgeGrouped {
  [category: string]: KnowledgeItem[];
}

// ============================================================
// WhatsApp / Evolution operational types (Tasks 15.3–15.6)
// ============================================================

/**
 * Discriminated result returned by every Evolution admin endpoint. Mirrors the
 * backend `EvolutionResult<T>` so failures never leak the API key and are safe
 * to render in the UI.
 */
export type EvolutionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type EvolutionConnectionState =
  | 'open'
  | 'connecting'
  | 'close'
  | 'closed'
  | 'unknown';

/** Snapshot of an Evolution instance's connection state (Req 15.2). */
export interface InstanceStatus {
  instanceName: string;
  state: EvolutionConnectionState;
  connected: boolean;
  connectedNumber: string | null;
}

/** Result of a connect/reconnect request, possibly carrying a pairing QR. */
export interface ConnectResult {
  state: EvolutionConnectionState;
  qrCodeBase64: string | null;
  pairingCode: string | null;
}

// --- Inbox (Req 16.1) ---

export interface InboxLastMessage {
  content: string;
  direction: string;
  role: string;
  createdAt: string;
}

export interface InboxHandoffState {
  handoffOffered: boolean;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
}

export interface InboxListItem {
  conversationId: string;
  leadId: string;
  name: string;
  phone: string;
  lastMessage: InboxLastMessage | null;
  status: string;
  temperature: string | null;
  leadScore: number | null;
  channel: string;
  botPaused: boolean;
  handoff: InboxHandoffState;
  lastMessageAt: string;
}

// --- Conversation detail (Req 16.2, 16.3, 16.4) ---

export interface ConversationLeadPanel {
  id: string;
  name: string;
  phone: string;
  status: string;
  temperature: string | null;
  leadScore: number | null;
  segment: string | null;
  pains: {
    mainPain: string | null;
    secondaryPains: string[] | null;
  };
  commercialSummary: string | null;
  nextStep: string | null;
}

export interface ConversationMessage {
  id: string;
  role: string;
  direction: string;
  content: string;
  messageType: string | null;
  createdAt: string;
}

export interface ConversationActions {
  canTakeover: boolean;
  canPause: boolean;
  canResume: boolean;
  canMarkConverted: boolean;
  canMarkLost: boolean;
  canSendManual: boolean;
}

export interface ConversationDetail {
  conversationId: string;
  channel: string;
  status: string;
  stage: string;
  instanceName: string | null;
  botPaused: boolean;
  assignedTo: string | null;
  handoff: InboxHandoffState;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  messages: ConversationMessage[];
  lead: ConversationLeadPanel;
  actions: ConversationActions;
}

// --- Bot settings (Req 17.1, 17.5) ---

export interface BotSettings {
  autoReplyEnabled: boolean;
  autoReplyEditable: boolean;
  pricingRangeEnabled: boolean;
  pricingStartingAt: number;
  pricingText: string;
  pricingStartingAtText: string;
}

export interface UpdateBotSettingsInput {
  pricingRangeEnabled?: boolean;
  pricingStartingAt?: number;
  pricingText?: string;
}

// --- Logs (Req 22.2) ---

export interface LogEntry {
  id: string;
  type: string;
  phone?: string | null;
  instanceName?: string | null;
  content?: string | null;
  error?: string | null;
  responseMs?: number | null;
  createdAt: string;
}

export interface LogsData {
  receivedMessages: LogEntry[];
  evolutionErrors: LogEntry[];
  duplicates: LogEntry[];
  slowResponses: LogEntry[];
  sendFailures: LogEntry[];
}
