/**
 * Represents the agent settings used to build prompts.
 */
export interface AgentSettingsInput {
  agentName: string;
  initialMessage: string;
  toneOfVoice: string | null;
  services: string[] | null;
  doNotPromise: string[] | null;
  handoffCriteria: string[] | null;
}

/**
 * Represents a knowledge base item used in prompt construction.
 */
export interface KnowledgeBaseItem {
  category: string;
  title: string;
  content: string;
}

/**
 * Represents a message in the conversation history.
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
