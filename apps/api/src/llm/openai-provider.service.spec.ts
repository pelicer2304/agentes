import { OpenAIProviderService } from './openai-provider.service';
import { AppConfigService } from '../config/config.service';
import { LLMCompletionRequest } from './llm-provider.interface';

// Mock the OpenAI module
jest.mock('openai', () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
    _mockCreate: mockCreate,
  };
});

describe('OpenAIProviderService', () => {
  let service: OpenAIProviderService;
  let mockCreate: jest.Mock;

  const mockConfigService = {
    openaiApiKey: 'test-api-key',
    modelName: 'gpt-4o-mini',
    llmProvider: 'openai',
    databaseUrl: 'postgresql://localhost/test',
    appEnv: 'development',
    frontendUrl: 'http://localhost:3000',
    isProduction: false,
    isDevelopment: true,
  } as AppConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mockCreate = require('openai')._mockCreate;
    service = new OpenAIProviderService(mockConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call OpenAI with correct parameters for a basic request', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"reply": "Hello"}' } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ],
    };

    const result = await service.complete(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Hello' },
        ],
      }),
    );

    expect(result).toEqual({
      content: '{"reply": "Hello"}',
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
      model: 'gpt-4o-mini',
    });
  });

  it('should pass temperature when provided', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'response' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.7,
    };

    await service.complete(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ temperature: 0.7 }),
    );
  });

  it('should pass maxTokens when provided', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'response' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 500,
    };

    await service.complete(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 500 }),
    );
  });

  it('should set response_format to json_object when responseFormat is "json"', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"key": "value"}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
      responseFormat: 'json',
    };

    await service.complete(request);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    );
  });

  it('should handle missing usage data gracefully', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'response' } }],
      usage: undefined,
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = await service.complete(request);

    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });

  it('should handle empty choices gracefully', async () => {
    const mockResponse = {
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
      model: 'gpt-4o-mini',
    };
    mockCreate.mockResolvedValue(mockResponse);

    const request: LLMCompletionRequest = {
      messages: [{ role: 'user', content: 'Hi' }],
    };

    const result = await service.complete(request);

    expect(result.content).toBe('');
  });
});
