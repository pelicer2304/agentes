import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BotService, BotSettingsResponse } from './bot.service';
import { UpdateBotSettingsDto } from './dto/update-bot-settings.dto';

/**
 * Bot settings endpoints (Requirements 17.1, 17.5).
 *
 * Protected by {@link JwtAuthGuard}: all routes require a valid bearer token.
 *
 * Auto-reply toggle (`BOT_AUTO_REPLY_ENABLED`) is an env-based config and is
 * therefore exposed READ-ONLY here. Making it runtime-updatable would require a
 * persisted settings store, which is out of scope for this task. The current
 * value is reported in `GET /bot/settings` as `autoReplyEnabled` with
 * `autoReplyEditable: false`.
 *
 * Pricing_Config is persisted and updatable. Since `ConversationService` reads
 * it per message via `PricingConfigService.get()`, updates apply to subsequent
 * replies including active conversations (Requirement 17.5).
 */
@Controller('bot')
@UseGuards(JwtAuthGuard)
export class BotController {
  constructor(private readonly botService: BotService) {}

  /** Returns the current auto-reply state (read-only) and Pricing_Config. */
  @Get('settings')
  async getSettings(): Promise<BotSettingsResponse> {
    return this.botService.getSettings();
  }

  /** Updates Pricing_Config. Auto-reply is not updatable (env-based). */
  @Put('settings')
  async putSettings(@Body() dto: UpdateBotSettingsDto): Promise<BotSettingsResponse> {
    return this.botService.updateSettings(dto);
  }

  /** Alias for {@link putSettings} to support PATCH semantics. */
  @Patch('settings')
  async patchSettings(@Body() dto: UpdateBotSettingsDto): Promise<BotSettingsResponse> {
    return this.botService.updateSettings(dto);
  }
}
