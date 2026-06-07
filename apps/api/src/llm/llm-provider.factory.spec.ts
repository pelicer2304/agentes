import { AppConfigService } from '../config/config.service';
import { llmProviderFactory } from './llm-provider.factory';
import { OpenAIProviderService } from './openai-provider.service';

describe('llmProviderFactory', () => {
  function createMockConfigService(
    overrides: Partial<AppConfigService> = {},
  ): AppConfigService {
    return {
      llmProvider: 'openai',
      openaiApiKey: 'test-api-key',
      modelName: 'gpt-4o-mini',
      databaseUrl: 'postgresql://localhost/test',
      appEnv: 'development',
      frontendUrl: 'http://localhost:3000',
      isProduction: false,
      isDevelopment: true,
      ...overrides,
    } as AppConfigService;
  }

  it('should return an OpenAIProviderService when LLM_PROVIDER is "openai"', () => {
    const configService = createMockConfigService({ llmProvider: 'openai' });
    const provider = llmProviderFactory(configService);
    expect(provider).toBeInstanceOf(OpenAIProviderService);
  });

  it('should throw an error when LLM_PROVIDER is unsupported', () => {
    const configService = createMockConfigService({
      llmProvider: 'anthropic' as any,
    });
    expect(() => llmProviderFactory(configService)).toThrow(
      'Unsupported LLM_PROVIDER: "anthropic". Supported providers: openai',
    );
  });

  it('should throw an error when LLM_PROVIDER is empty', () => {
    const configService = createMockConfigService({ llmProvider: '' });
    expect(() => llmProviderFactory(configService)).toThrow(
      'LLM_PROVIDER environment variable is required but not set.',
    );
  });
});
