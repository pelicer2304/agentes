/**
 * Tipos e uniões do mecanismo de follow-up automático de leads.
 *
 * As formas aqui definidas seguem a seção "Components and Interfaces" do
 * design (.kiro/specs/lead-followup/design.md). A lógica que consome estes
 * tipos é majoritariamente pura e testável (elegibilidade, composição da
 * mensagem, classificação do envio), enquanto os efeitos de borda ficam
 * isolados nos serviços correspondentes.
 */

/** Snapshot imutável dos campos lidos da Conversation + Lead no instante avaliado. */
export interface ConversationSnapshot {
  leadStatus: string; // novo | qualificando | chamar_humano | perdido
  stage: string; // abertura | descoberta | conversao | handoff_humano
  conversationStatus: string; // active | inactive
  botPaused: boolean;
  assignedTo: string | null;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  handoffRequired: boolean;
  optedOut: boolean; // derivado de cycleState === 'opted_out' (R12.2)
}

/** Motivos pelos quais uma Conversation é classificada como não elegível. */
export type IneligibilityReason =
  | 'handoff_humano' // qualquer condição do R2.1
  | 'lead_perdido' // status do lead = perdido (R4.1)
  | 'opt_out'; // lead pediu para parar de receber mensagens (R12.2)

/** Resultado da avaliação de elegibilidade de uma Conversation para follow-up. */
export interface EligibilityResult {
  eligible: boolean;
  reason: IneligibilityReason | null;
}

/** Contexto para compor a Reengagement_Message de um nível. */
export interface ReengagementContext {
  level: 1 | 2 | 3;
  segment: string | null; // Lead.segment
  mainPain: string | null; // Lead.mainPain
  agentName: string;
}

/** Mensagem de reengajamento gerada para um Follow_Up_Level. */
export interface ReengagementMessage {
  content: string; // <= 1000 chars, exatamente 1 pergunta/CTA
  referencedSegment: boolean; // true quando o segmento foi referenciado
  referencedPain: boolean; // true quando a dor principal foi referenciada
}

/** Resultado da tentativa de envio de uma Reengagement_Message pelo canal. */
export type SendOutcome =
  | { status: 'sent'; sentAt: Date } // Evolution confirmou
  | { status: 'deferred'; reason: 'out_of_window' | 'rate_limited' }
  | { status: 'failed'; reason: 'evolution_error' };

/** Tipos de Follow_Up_Event gravados em bot_events. */
export type FollowUpEventType =
  | 'followup_sent'
  | 'followup_cancelled'
  | 'followup_completed'
  | 'followup_error';

/** Motivos válidos de cancelamento de um ciclo de follow-up. */
export type CancelReason =
  | 'handoff_humano'
  | 'lead_perdido'
  | 'resposta_do_lead'
  | 'opt_out';

/**
 * Intenção de engajamento detectada em um único turno (R10).
 * - interesse_normal: qualquer coisa fora de adiamento/opt-out (classe segura).
 * - nao_agora: o lead pede explicitamente para ser contatado mais tarde.
 * - opt_out: o lead pede explicitamente para parar de receber mensagens.
 */
export type EngagementIntent = 'interesse_normal' | 'nao_agora' | 'opt_out';

/** Par (pergunta do bot, resposta do lead) que forma o Turn_Context (R10.2). */
export interface TurnContext {
  lastBotMessage: string | null; // última pergunta/outbound do bot
  leadMessage: string; // inbound do lead que respondeu
}

/** Resultado da classificação de engajamento de um turno (R10). */
export interface EngagementClassification {
  intent: EngagementIntent;
  confidence: number; // 0..1
  /** Presente apenas quando intent === 'nao_agora' e o lead indica prazo. */
  deferral?: { durationHours?: number };
  /** true quando o resultado veio do fail-safe (timeout/erro/baixa confiança). */
  failSafe: boolean;
}
