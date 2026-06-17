import { Module } from '@nestjs/common';

import { ChannelModule } from '../channel/channel.module';
import { LLMModule } from '../llm/llm.module';
import { RateLimiterService } from '../common/rate-limiter';
import { FollowUpService } from './followup.service';
import { FollowUpSchedulerService } from './followup-scheduler.service';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import { ReengagementMessageComposer } from './reengagement-message.composer';
import { FollowUpSender } from './followup-sender.service';
import { FollowUpEventRecorder } from './followup-event.recorder';
import { EngagementClassifierService } from './engagement-classifier.service';

/**
 * Wires the automatic lead follow-up cycle (design.md — "FollowUpService" e
 * "FollowUpSchedulerService").
 *
 * Providers:
 *  - {@link FollowUpService} — orquestra o ciclo completo (agendamento,
 *    reavaliação no disparo, cancelamento, encerramento). É exportado para que
 *    os hooks de inbound/conversa (tarefas 12.x) possam delegar a ele.
 *  - {@link FollowUpSchedulerService} — poll periódico que reivindica os
 *    schedules vencidos e dispara `processDue`/`completeIfExhausted`.
 *  - {@link FollowUpEligibilityService}, {@link ReengagementMessageComposer},
 *    {@link FollowUpSender}, {@link FollowUpEventRecorder} — componentes puros e
 *    de borda coordenados pelo `FollowUpService`.
 *  - {@link RateLimiterService} — fornecido localmente seguindo exatamente o
 *    padrão do `InboundModule` (provider simples; o construtor usa um
 *    `@Optional()` com defaults). Cada módulo mantém sua própria instância em
 *    memória; o `FollowUpSender` consome este provider via chave por telefone.
 *
 * Dependências resolvidas por outros módulos:
 *  - {@link ChannelModule} — exporta o `ChannelAdapterRegistry` usado pelo
 *    {@link FollowUpSender} para resolver o adapter do WhatsApp e entregar a
 *    mensagem de reengajamento.
 *  - {@link LLMModule} — exporta o `LLM_PROVIDER_TOKEN` consumido pelo
 *    {@link EngagementClassifierService} (mesmo padrão do `AgentModule`).
 *  - `PrismaService` está disponível globalmente via o `@Global()`
 *    `PrismaModule`, e `AppConfigService` via o `@Global()` `AppConfigModule`;
 *    portanto nenhum dos dois é re-importado aqui (mesmo padrão do
 *    `InboundModule`). `AgentModule` não é importado porque nenhum serviço de
 *    follow-up depende dele.
 */
@Module({
  imports: [ChannelModule, LLMModule],
  providers: [
    FollowUpService,
    FollowUpSchedulerService,
    FollowUpEligibilityService,
    ReengagementMessageComposer,
    FollowUpSender,
    FollowUpEventRecorder,
    EngagementClassifierService,
    RateLimiterService,
  ],
  exports: [FollowUpService, EngagementClassifierService],
})
export class FollowUpModule {}
