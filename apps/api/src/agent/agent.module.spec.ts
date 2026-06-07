import { Test, TestingModule } from '@nestjs/testing';
import { AgentModule } from './agent.module';
import { AgentService } from './agent.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ResponseParserService } from './response-parser.service';
import { LLM_PROVIDER_TOKEN } from '../llm/llm-provider.interface';
import { AppConfigService } from '../config/config.service';

describe('AgentModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [AgentModule],
    })
      .overrideProvider(LLM_PROVIDER_TOKEN)
      .useValue({ complete: jest.fn() })
      .overrideProvider(AppConfigService)
      .useValue({
        llmProvider: 'openai',
        openaiApiKey: 'test-key',
        modelName: 'gpt-4o-mini',
      })
      .compile();
  });

  it('should be defined', () => {
    expect(module).toBeDefined();
  });

  it('should provide AgentService', () => {
    const service = module.get<AgentService>(AgentService);
    expect(service).toBeDefined();
  });

  it('should provide PromptBuilderService', () => {
    const service = module.get<PromptBuilderService>(PromptBuilderService);
    expect(service).toBeDefined();
  });

  it('should provide ResponseParserService', () => {
    const service = module.get<ResponseParserService>(ResponseParserService);
    expect(service).toBeDefined();
  });
});
