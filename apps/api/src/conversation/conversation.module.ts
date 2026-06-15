import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { AgentModule } from '../agent/agent.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { FollowUpModule } from '../followup/followup.module';

@Module({
  imports: [AgentModule, KnowledgeModule, FollowUpModule],
  controllers: [ConversationController],
  providers: [ConversationService, PricingConfigService],
  exports: [ConversationService],
})
export class ConversationModule {}
