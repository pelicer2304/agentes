import { Module } from '@nestjs/common';
import { AuthModule } from '../../../auth/auth.module';
import { EvolutionAdminController } from './evolution-admin.controller';
import { EvolutionChannelAdapter } from './evolution-channel.adapter';
import { EvolutionService } from './evolution.service';

/**
 * Wires the Evolution_API (WhatsApp) integration.
 *
 * Provides:
 *  - {@link EvolutionService}: the HTTP client for Evolution_API. It depends on
 *    `AppConfigService`, which is supplied by the `@Global()` `AppConfigModule`
 *    registered at the application root (this module does not re-import it, by
 *    the same convention as `LLMModule`).
 *  - {@link EvolutionChannelAdapter}: the WhatsApp `ChannelAdapter`, which
 *    delegates to {@link EvolutionService} and the `evolution-normalizer`.
 *
 * Both are exported so `ChannelModule` can include the adapter in the
 * `CHANNEL_ADAPTER_REGISTRY`. This module must NOT import `ChannelModule` to
 * avoid a circular dependency (the dependency direction is
 * `ChannelModule -> EvolutionModule`).
 *
 * NOTE: The `EvolutionWebhookController` is added here later by task 6.4.
 *
 * `AuthModule` is imported so the admin controller's `JwtAuthGuard`/`RolesGuard`
 * have their dependencies (Passport/JWT strategy) available.
 */
@Module({
  imports: [AuthModule],
  controllers: [EvolutionAdminController],
  providers: [EvolutionService, EvolutionChannelAdapter],
  exports: [EvolutionService, EvolutionChannelAdapter],
})
export class EvolutionModule {}
