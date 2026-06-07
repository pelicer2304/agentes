import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentService } from './agent.service';
import { AgentReplyService } from './agent-reply.service';
import { AgentAnalysisService } from './agent-analysis.service';
import { FactExtractorService } from './fact-extractor.service';
import { ContextTrackerService } from './context-tracker';
import { HandoffManagerService } from './handoff-manager';
import { PromptBuilderService } from './prompt-builder.service';
import { ResponseParserService } from './response-parser.service';
import { ResponseGuardService } from './response-guard.service';

@Module({
  imports: [LLMModule, PrismaModule],
  providers: [
    AgentService,
    AgentReplyService,
    AgentAnalysisService,
    FactExtractorService,
    ContextTrackerService,
    HandoffManagerService,
    PromptBuilderService,
    ResponseParserService,
    ResponseGuardService,
  ],
  exports: [
    AgentService,
    AgentReplyService,
    AgentAnalysisService,
    FactExtractorService,
    ContextTrackerService,
    HandoffManagerService,
    ResponseGuardService,
  ],
})
export class AgentModule {}
