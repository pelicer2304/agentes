import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import {
  PricingConfigService,
  PricingConfigView,
  UpdatePricingConfigInput,
} from '../inbound/pricing-config.service';

/**
 * Aggregated Bot settings returned by `GET /bot/settings`.
 *
 * `autoReplyEnabled` reflects the env-based `BOT_AUTO_REPLY_ENABLED` toggle and
 * is exposed read-only for the MVP (Requirement 17.1). The pricing fields come
 * from the persisted Pricing_Config singleton and are runtime-updatable
 * (Requirement 17.5).
 */
export interface BotSettingsResponse {
  /**
   * Current value of the env-based `BOT_AUTO_REPLY_ENABLED` toggle.
   * Read-only for the MVP — see {@link BotService} notes.
   */
  autoReplyEnabled: boolean;
  /** Whether auto-reply can be changed at runtime. Always `false` for the MVP. */
  autoReplyEditable: boolean;
  pricingRangeEnabled: boolean;
  pricingStartingAt: number;
  pricingText: string;
  pricingStartingAtText: string;
}

/**
 * Backing service for the Bot settings endpoints.
 *
 * Composes the read-only env-based auto-reply toggle (via
 * {@link AppConfigService}) with the persisted Pricing_Config (via
 * {@link PricingConfigService}). Because `ConversationService` reads
 * Pricing_Config per message through `PricingConfigService.get()`, any update
 * made here applies to subsequent replies — including active conversations
 * (Requirement 17.5).
 */
@Injectable()
export class BotService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly pricingConfig: PricingConfigService,
  ) {}

  /** Returns the current auto-reply toggle and Pricing_Config. */
  async getSettings(): Promise<BotSettingsResponse> {
    const pricing = await this.pricingConfig.get();
    return this.toResponse(pricing);
  }

  /**
   * Applies Pricing_Config updates. The auto-reply toggle is not updatable at
   * runtime (env-based), so it is excluded from the input.
   */
  async updateSettings(input: UpdatePricingConfigInput): Promise<BotSettingsResponse> {
    const pricing = await this.pricingConfig.update(input);
    return this.toResponse(pricing);
  }

  private toResponse(pricing: PricingConfigView): BotSettingsResponse {
    return {
      autoReplyEnabled: this.appConfig.botAutoReplyEnabled,
      autoReplyEditable: false,
      pricingRangeEnabled: pricing.pricingRangeEnabled,
      pricingStartingAt: pricing.pricingStartingAt,
      pricingText: pricing.pricingText,
      pricingStartingAtText: pricing.pricingStartingAtText,
    };
  }
}
