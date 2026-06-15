import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { ChannelModule } from './channel/channel.module';
import { LLMModule } from './llm/llm.module';
import { AgentModule } from './agent/agent.module';
import { ConversationModule } from './conversation/conversation.module';
import { LeadModule } from './lead/lead.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { SettingsModule } from './settings/settings.module';
import { BotModule } from './bot/bot.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { InboundModule } from './inbound/inbound.module';
import { InboxModule } from './inbox/inbox.module';
import { FollowUpModule } from './followup/followup.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    ChannelModule,
    LLMModule,
    AgentModule,
    ConversationModule,
    LeadModule,
    DashboardModule,
    KnowledgeModule,
    SettingsModule,
    BotModule,
    AuthModule,
    HealthModule,
    InboundModule,
    InboxModule,
    FollowUpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
