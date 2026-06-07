/**
 * Enum types for the AgentResponse DTO.
 */
export const CONVERSATION_STAGES = [
  'abertura',
  'descoberta',
  'mapeamento_de_dores',
  'diagnostico_operacional',
  'explicacao_solucao',
  'priorizacao',
  'tratamento_objecao',
  'conversao',
  'handoff_humano',
] as const;

export type ConversationStage = (typeof CONVERSATION_STAGES)[number];

export const DETECTED_INTENTS = [
  'vendas',
  'suporte',
  'agendamento',
  'duvidas',
  'orcamento',
  'integracao',
  'curiosidade',
  'outro',
] as const;

export type DetectedIntent = (typeof DETECTED_INTENTS)[number];

export const VOLUME_LEVELS = ['baixo', 'medio', 'alto', 'desconhecido'] as const;
export type VolumeLevel = (typeof VOLUME_LEVELS)[number];

export const URGENCY_LEVELS = ['baixa', 'media', 'alta', 'desconhecida'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const DECISION_ROLES = ['dono', 'gestor', 'funcionario', 'desconhecido'] as const;
export type DecisionRole = (typeof DECISION_ROLES)[number];

export const BUDGET_SIGNALS = ['baixo', 'medio', 'alto', 'desconhecido'] as const;
export type BudgetSignal = (typeof BUDGET_SIGNALS)[number];

export const TEMPERATURES = ['frio', 'morno', 'quente'] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const LEAD_STATUSES = [
  'novo',
  'qualificando',
  'frio',
  'morno',
  'quente',
  'chamar_humano',
  'convertido',
  'perdido',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface PainDetail {
  pain: string;
  impact?: string;
  frequency?: string;
  businessImpact?: string;
}

export interface SolutionScope {
  needsFAQ?: boolean;
  needsLeadQualification?: boolean;
  needsScheduling?: boolean;
  needsBudgetCollection?: boolean;
  needsSalesFlow?: boolean;
  needsSupportFlow?: boolean;
  needsIntegration?: boolean;
  needsHumanHandoff?: boolean;
  needsReports?: boolean;
}

/**
 * Structured response from the LLM agent.
 */
export interface AgentResponse {
  reply: string;
  stage: ConversationStage;
  detectedSegment: string | null;
  businessDescription: string | null;
  detectedIntent: DetectedIntent;
  whatsappUsage: string | null;
  mainPain: string | null;
  secondaryPains: string[];
  allPains?: string[];
  painDetails?: PainDetail[];
  painSummary?: string | null;
  desiredOutcome: string | null;
  estimatedVolume: VolumeLevel;
  urgency: UrgencyLevel;
  decisionRole: DecisionRole;
  budgetSignal: BudgetSignal;
  objections: string[];
  recommendedService: string | null;
  solutionScope?: SolutionScope;
  leadScore: number;
  quoteReadinessScore?: number;
  missingInfoForQuote?: string[];
  scoreReasons: string[];
  temperature: Temperature;
  status: LeadStatus;
  shouldHandoff: boolean;
  handoffReason: string | null;
  commercialSummary: string | null;
  nextBestQuestion: string | null;
}
