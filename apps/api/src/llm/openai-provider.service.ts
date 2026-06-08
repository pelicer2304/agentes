import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../config/config.service';
import {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProvider,
} from './llm-provider.interface';

@Injectable()
export class OpenAIProviderService implements LLMProvider {
  private readonly client: OpenAI;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;
  private readonly logger = new Logger(OpenAIProviderService.name);

  constructor(private readonly configService: AppConfigService) {
    this.client = new OpenAI({
      apiKey: this.configService.openaiApiKey,
      baseURL: this.configService.openaiBaseUrl || undefined,
      timeout: 30_000,
    });
    this.primaryModel = this.configService.modelName;
    this.fallbackModel = this.configService.modelFallback;
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    // Try primary model first
    try {
      return await this.callModel(this.primaryModel, request);
    } catch (error) {
      this.logger.warn(
        `Primary model (${this.primaryModel}) failed: ${error instanceof Error ? error.message : 'Unknown'}. Trying fallback...`,
      );
    }

    // Fallback model
    try {
      return await this.callModel(this.fallbackModel, request);
    } catch (error) {
      this.logger.error(
        `Fallback model (${this.fallbackModel}) also failed: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      throw error;
    }
  }

  private async callModel(
    model: string,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResponse> {
    this.logger.debug(`Sending request to model=${model}`);

    const params = {
      model,
      messages: request.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
      temperature: request.temperature ?? 0.3,
      top_p: 0.8,
      max_tokens: request.maxTokens ?? 900,
      ...(request.responseFormat === 'json' && {
        response_format: { type: 'json_object' as const },
      }),
      // Desliga o "thinking" do Qwen3 via OpenRouter: o raciocínio invisível
      // consumia o orçamento de tokens e truncava o JSON da resposta (caindo
      // no fallback ~20% das vezes) além de elevar a latência. Campos
      // ignorados graciosamente por provedores/modelos que não os suportam.
      reasoning: { enabled: false },
      chat_template_kwargs: { enable_thinking: false },
    };

    // O SDK tipa apenas os campos padrão da OpenAI; os de roteamento do
    // OpenRouter (reasoning/chat_template_kwargs) vão no corpo via cast `any`,
    // e o retorno é tipado de volta como resposta não-streaming.
    const response = (await this.client.chat.completions.create(
      params as never,
    )) as OpenAI.Chat.Completions.ChatCompletion;

    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const usage = response.usage;

    this.logger.debug(
      `Response from ${model}: ${content.length} chars, ${usage?.total_tokens ?? 0} tokens`,
    );

    return {
      content,
      usage: {
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      model: response.model,
    };
  }
}
