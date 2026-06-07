import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { llmProviderFactory } from './llm-provider.factory';
import { LLM_PROVIDER_TOKEN } from './llm-provider.interface';

@Module({
  providers: [
    {
      provide: LLM_PROVIDER_TOKEN,
      useFactory: (configService: AppConfigService) =>
        llmProviderFactory(configService),
      inject: [AppConfigService],
    },
  ],
  exports: [LLM_PROVIDER_TOKEN],
})
export class LLMModule {}
