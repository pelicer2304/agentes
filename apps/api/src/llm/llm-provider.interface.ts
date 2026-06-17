export interface LLMCompletionRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json';
  /**
   * Optional model override for this single request. When provided and
   * non-empty, the provider uses it as the primary model (still falling back
   * to the configured fallback on failure). When omitted, the configured
   * primary model is used. Enables lightweight calls (e.g. the engagement
   * classifier) to target a cheaper/faster model without affecting others.
   */
  model?: string;
}

export interface LLMCompletionResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
}

export interface LLMProvider {
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDER_TOKEN';
