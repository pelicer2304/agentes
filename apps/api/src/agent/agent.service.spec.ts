import { Test, TestingModule } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ResponseParserService, ResponseParseError } from './response-parser.service';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { AgentResponse } from './dto/agent-response.dto';
import { AgentSettingsInput, ConversationMessage, KnowledgeBaseItem } from './dto/agent-settings.dto';

describe('AgentService', () => {
  let service: AgentService;
  let llmProvider: jest.Mocked<LLMProvider>;
  let responseParser: ResponseParserService;

  const validAgentResponse: AgentResponse = {
    reply: 'Olá! Me conta qual é o seu negócio?',
    stage: 'abertura',
    detectedSegment: null,
    businessDescription: null,
    detectedIntent: 'curiosidade',
    whatsappUsage: null,
    mainPain: null,
    secondaryPains: [],
    desiredOutcome: null,
    estimatedVolume: 'desconhecido',
    urgency: 'desconhecida',
    decisionRole: 'desconhecido',
    budgetSignal: 'desconhecido',
    objections: [],
    recommendedService: null,
    leadScore: 0,
    scoreReasons: [],
    temperature: 'frio',
    status: 'novo',
    shouldHandoff: false,
    handoffReason: null,
    commercialSummary: null,
    nextBestQuestion: 'Qual é o seu negócio?',
  };

  const settings: AgentSettingsInput = {
    agentName: 'Assistente Decodifica',
    initialMessage: 'Olá!',
    toneOfVoice: 'Consultivo',
    services: ['Chatbot'],
    doNotPromise: [],
    handoffCriteria: [],
  };

  const knowledgeBase: KnowledgeBaseItem[] = [];
  const history: ConversationMessage[] = [
    { role: 'user', content: 'Olá' },
  ];

  beforeEach(async () => {
    const mockLlmProvider: jest.Mocked<LLMProvider> = {
      complete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentService,
        PromptBuilderService,
        ResponseParserService,
        {
          provide: LLM_PROVIDER_TOKEN,
          useValue: mockLlmProvider,
        },
      ],
    }).compile();

    service = module.get<AgentService>(AgentService);
    llmProvider = module.get(LLM_PROVIDER_TOKEN);
    responseParser = module.get<ResponseParserService>(ResponseParserService);
  });

  describe('processMessage', () => {
    it('should return parsed response on successful LLM call', async () => {
      llmProvider.complete.mockResolvedValueOnce({
        content: JSON.stringify(validAgentResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      const result = await service.processMessage(history, settings, knowledgeBase);
      expect(result).toEqual(validAgentResponse);
      expect(llmProvider.complete).toHaveBeenCalledTimes(1);
    });

    it('should retry once on parse failure and succeed', async () => {
      // First call returns invalid JSON
      llmProvider.complete.mockResolvedValueOnce({
        content: 'not valid json',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      // Retry returns valid JSON
      llmProvider.complete.mockResolvedValueOnce({
        content: JSON.stringify(validAgentResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      const result = await service.processMessage(history, settings, knowledgeBase);
      expect(result).toEqual(validAgentResponse);
      expect(llmProvider.complete).toHaveBeenCalledTimes(2);
    });

    it('should retry once on LLM error and succeed', async () => {
      // First call throws
      llmProvider.complete.mockRejectedValueOnce(new Error('Timeout'));

      // Retry succeeds
      llmProvider.complete.mockResolvedValueOnce({
        content: JSON.stringify(validAgentResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      const result = await service.processMessage(history, settings, knowledgeBase);
      expect(result).toEqual(validAgentResponse);
      expect(llmProvider.complete).toHaveBeenCalledTimes(2);
    });

    it('should return fallback response when both attempts fail', async () => {
      llmProvider.complete.mockRejectedValue(new Error('Service unavailable'));

      const result = await service.processMessage(history, settings, knowledgeBase);

      // Contextual fallback when no lead facts are available
      expect(result.reply).toBeTruthy();
      expect(result.reply.length).toBeGreaterThan(10);
      expect(result.stage).toBe('descoberta');
      expect(result.leadScore).toBe(0);
      expect(result.shouldHandoff).toBe(false);
      expect(result.temperature).toBe('frio');
      expect(llmProvider.complete).toHaveBeenCalledTimes(2);
    });

    it('should return fallback when first call has invalid JSON and retry also fails', async () => {
      llmProvider.complete.mockResolvedValue({
        content: '{ invalid json }',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      const result = await service.processMessage(history, settings, knowledgeBase);

      expect(result.reply).toBeTruthy();
      expect(result.reply.length).toBeGreaterThan(10);
      expect(llmProvider.complete).toHaveBeenCalledTimes(2);
    });

    it('should return fallback when first call has valid JSON but invalid schema and retry also fails', async () => {
      const invalidSchema = { ...validAgentResponse, stage: 'invalid_stage' };
      llmProvider.complete.mockResolvedValue({
        content: JSON.stringify(invalidSchema),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      const result = await service.processMessage(history, settings, knowledgeBase);

      expect(result.reply).toBeTruthy();
      expect(result.reply.length).toBeGreaterThan(10);
      expect(llmProvider.complete).toHaveBeenCalledTimes(2);
    });

    it('should pass correct request format to LLM provider', async () => {
      llmProvider.complete.mockResolvedValueOnce({
        content: JSON.stringify(validAgentResponse),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        model: 'gpt-4o-mini',
      });

      await service.processMessage(history, settings, knowledgeBase);

      const callArg = llmProvider.complete.mock.calls[0][0];
      expect(callArg.responseFormat).toBe('json');
      expect(callArg.messages[0].role).toBe('system');
      expect(callArg.messages[1]).toEqual({ role: 'user', content: 'Olá' });
    });
  });
});
