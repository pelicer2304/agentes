import { Module } from '@nestjs/common';
import { ChannelModule } from '../channel/channel.module';
import { ConversationModule } from '../conversation/conversation.module';
import { EvolutionModule } from '../modules/channels/evolution/evolution.module';
import { EvolutionWebhookController } from '../modules/channels/evolution/evolution-webhook.controller';
import { RateLimiterService } from '../common/rate-limiter';
import { InboundMessageProcessor } from './inbound-message.processor';
import { PricingConfigService } from './pricing-config.service';

/**
 * Wires the inbound orchestration layer for the WhatsApp flow.
 *
 * Provides the {@link InboundMessageProcessor} — the orchestration heart that
 * wraps the frozen Agent_Engine with production concerns (idempotency, gating,
 * timeout/fallback, delivery, lifecycle events) — and {@link PricingConfigService}.
 *
 * Dependencies:
 *  - {@link ConversationModule} — supplies `ConversationService` (the frozen
 *    engine entrypoint) invoked by the processor.
 *  - {@link ChannelModule} — supplies `ChannelAdapterRegistry`, used to resolve
 *    the WhatsApp adapter for outbound delivery.
 *  - {@link EvolutionModule} — supplies `EvolutionService`, used by task 8.2 to
 *    deliver the internal handoff summary directly to `ADMIN_WHATSAPP_NUMBERS`
 *    (a one-recipient-per-call send, never to the client). The dependency
 *    direction stays one-way: `ChannelModule -> EvolutionModule` and
 *    `InboundModule -> EvolutionModule`; `EvolutionModule` imports neither, so
 *    there is no DI cycle.
 *  - `PrismaService` is available globally via the `@Global()` `PrismaModule`,
 *    and `AppConfigService` via the `@Global()` `AppConfigModule`; neither is
 *    re-imported here.
 *
 * The {@link InboundMessageProcessor} is exported so the
 * `EvolutionWebhookController` (task 6.4) can delegate to it.
 *
 * The {@link EvolutionWebhookController} (`POST /webhooks/evolution`) is
 * registered HERE rather than in `EvolutionModule`. `InboundModule` already
 * provides the {@link InboundMessageProcessor} the controller delegates to,
 * whereas `EvolutionModule` is imported (transitively, via `ChannelModule`) by
 * `InboundModule`; registering the controller here keeps the dependency
 * direction one-way and avoids an `EvolutionModule -> InboundModule` DI cycle.
 */
@Module({
  imports: [ConversationModule, ChannelModule, EvolutionModule],
  controllers: [EvolutionWebhookController],
  providers: [InboundMessageProcessor, PricingConfigService, RateLimiterService],
  exports: [InboundMessageProcessor],
})
export class InboundModule {}
