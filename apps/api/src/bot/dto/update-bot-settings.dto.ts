import { IsBoolean, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * DTO for updating Bot settings.
 *
 * Only the Pricing_Config fields are runtime-updatable (Requirements 17.1/17.5).
 * The auto-reply toggle is intentionally omitted here because it is an
 * env-based config (`BOT_AUTO_REPLY_ENABLED`) exposed read-only via
 * `GET /bot/settings`. See {@link BotController} for the rationale.
 *
 * All fields are optional so callers can patch individual values.
 */
export class UpdateBotSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'pricingRangeEnabled must be a boolean' })
  pricingRangeEnabled?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'pricingStartingAt must be a number' })
  @Min(0, { message: 'pricingStartingAt must not be negative' })
  pricingStartingAt?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'pricingText must not exceed 5000 characters' })
  pricingText?: string;
}
