import { Logger } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { LLMProvider } from './llm-provider.interface';
import { OpenAIProviderService } from './openai-provider.service';

const SUPPORTED_PROVIDERS = ['openai', 'openrouter'] as const;

export function llmProviderFactory(
  configService: AppConfigService,
): LLMProvider {
  const logger = new Logger('LLMProviderFactory');
  const provider = configService.llmProvider;

  if (!provider) {
    logger.error('LLM_PROVIDER environment variable is not set');
    throw new Error(
      'LLM_PROVIDER environment variable is required but not set.',
    );
  }

  switch (provider) {
    case 'openai':
      logger.log('Initializing OpenAI LLM provider');
      return new OpenAIProviderService(configService);
    case 'openrouter':
      logger.log(`Initializing OpenRouter LLM provider (model: ${configService.modelName}, fallback: ${configService.modelFallback})`);
      return new OpenAIProviderService(configService);
    default:
      logger.error(
        `Unsupported LLM_PROVIDER: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
      );
      throw new Error(
        `Unsupported LLM_PROVIDER: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
      );
  }
}
