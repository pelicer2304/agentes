import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

/**
 * Wires the Bot settings endpoints (Requirements 17.1, 17.5).
 *
 * - {@link AuthModule} supplies the `JwtAuthGuard` (and Passport JWT strategy)
 *   used to protect the controller.
 * - {@link PricingConfigService} is provided directly here; it only depends on
 *   `PrismaService` (available globally via the `@Global()` `PrismaModule`),
 *   so there is no DI cycle.
 * - `AppConfigService` is available globally via the `@Global()`
 *   `AppConfigModule` and is injected into {@link BotService} for the
 *   read-only auto-reply toggle.
 */
@Module({
  imports: [AuthModule],
  controllers: [BotController],
  providers: [BotService, PricingConfigService],
  exports: [BotService],
})
export class BotModule {}
