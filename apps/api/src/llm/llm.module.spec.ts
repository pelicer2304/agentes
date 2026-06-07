import { Test, TestingModule } from '@nestjs/testing';
import { Global, Module } from '@nestjs/common';
import { LLMModule } from './llm.module';
import { LLM_PROVIDER_TOKEN } from './llm-provider.interface';
import { AppConfigService } from '../config/config.service';

// Simulate the global AppConfigModule for testing
@Global()
@Module({
  providers: [
    {
      provide: AppConfigService,
      useValue: {
        llmProvider: 'openai',
        openaiApiKey: 'test-key',
        modelName: 'gpt-4o-mini',
      },
    },
  ],
  exports: [AppConfigService],
})
class MockAppConfigModule {}

describe('LLMModule', () => {
  it('should provide LLM_PROVIDER_TOKEN with OpenAI provider', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [MockAppConfigModule, LLMModule],
    }).compile();

    const provider = module.get(LLM_PROVIDER_TOKEN);
    expect(provider).toBeDefined();
    expect(provider.complete).toBeDefined();
  });

  it('should throw when LLM_PROVIDER is unsupported', async () => {
    @Global()
    @Module({
      providers: [
        {
          provide: AppConfigService,
          useValue: {
            llmProvider: 'unsupported',
            openaiApiKey: 'test-key',
            modelName: 'gpt-4o-mini',
          },
        },
      ],
      exports: [AppConfigService],
    })
    class MockUnsupportedConfigModule {}

    await expect(
      Test.createTestingModule({
        imports: [MockUnsupportedConfigModule, LLMModule],
      }).compile(),
    ).rejects.toThrow('Unsupported LLM_PROVIDER');
  });
});
