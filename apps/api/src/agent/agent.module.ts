import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentService } from './agent.service';
import { AgentReplyService } from './agent-reply.service';
import { AgentAnalysisService } from './agent-analysis.service';
import { FactExtractorService } from './fact-extractor.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ResponseParserService } from './response-parser.service';
import { NormalizeOutputService } from './normalize-output.service';
import { ResponseGuardService } from './response-guard.service';

@Module({
  imports: [LLMModule, PrismaModule],
  providers: [
    AgentService,
    AgentReplyService,
    AgentAnalysisService,
    FactExtractorService,
    PromptBuilderService,
    ResponseParserService,
    NormalizeOutputService,
    ResponseGuardService,
  ],
  exports: [AgentService, AgentReplyService, AgentAnalysisService, FactExtractorService, ResponseGuardService],
})
export class AgentModule {}
