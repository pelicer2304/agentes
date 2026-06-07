import { Test, TestingModule } from '@nestjs/testing';
import { AgentModule } from './agent.module';
import { AgentService } from './agent.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ResponseParserService } from './response-parser.service';
import { ContextTrackerService } from './context-tracker';
import { HandoffManagerService } from './handoff-manager';
import { ResponseGuardService } from './response-guard.service';
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

  // Pipeline providers added by the conversational-agent-quality restructure
  // (Task 12.1): the ContextTracker and HandoffManager are now part of the
  // provider graph and exported for ConversationModule.
  it('should provide ContextTrackerService', () => {
    const service = module.get<ContextTrackerService>(ContextTrackerService);
    expect(service).toBeDefined();
  });

  it('should provide HandoffManagerService', () => {
    const service = module.get<HandoffManagerService>(HandoffManagerService);
    expect(service).toBeDefined();
  });

  it('should provide ResponseGuardService', () => {
    const service = module.get<ResponseGuardService>(ResponseGuardService);
    expect(service).toBeDefined();
  });
});
