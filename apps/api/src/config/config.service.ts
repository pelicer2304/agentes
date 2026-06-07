import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: NestConfigService) {}

  get databaseUrl(): string {
    return this.configService.get<string>('DATABASE_URL')!;
  }

  // --- LLM provider configuration ---

  get llmProvider(): string {
    return this.configService.get<string>('LLM_PROVIDER')!;
  }

  get openrouterApiKey(): string | null {
    return this.configService.get<string>('OPENROUTER_API_KEY') || null;
  }

  get openrouterBaseUrl(): string | null {
    return this.configService.get<string>('OPENROUTER_BASE_URL') || null;
  }

  /**
   * The LLM API key. The frozen engine uses OpenAIProviderService for both
   * "openai" and "openrouter", so this prefers OPENAI_API_KEY and falls back to
   * OPENROUTER_API_KEY (accepted as an alias).
   */
  get openaiApiKey(): string {
    return (
      this.configService.get<string>('OPENAI_API_KEY') ||
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      ''
    );
  }

  /**
   * The OpenAI-compatible base URL. Prefers OPENAI_BASE_URL and falls back to
   * OPENROUTER_BASE_URL (e.g. https://openrouter.ai/api/v1).
   */
  get openaiBaseUrl(): string | null {
    return (
      this.configService.get<string>('OPENAI_BASE_URL') ||
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      null
    );
  }

  get modelFallback(): string {
    return this.configService.get<string>('LLM_MODEL_FALLBACK') || 'google/gemini-2.5-flash';
  }

  /** Alias for {@link modelFallback}, matching the `LLM_MODEL_FALLBACK` env var name. */
  get llmModelFallback(): string {
    return this.modelFallback;
  }

  get modelName(): string {
    return this.configService.get<string>('MODEL_NAME')!;
  }

  // --- Evolution API configuration ---

  get evolutionApiUrl(): string {
    return this.configService.get<string>('EVOLUTION_API_URL')!;
  }

  get evolutionApiKey(): string {
    return this.configService.get<string>('EVOLUTION_API_KEY')!;
  }

  get evolutionInstanceName(): string {
    return this.configService.get<string>('EVOLUTION_INSTANCE_NAME')!;
  }

  get evolutionWebhookSecret(): string | null {
    return this.configService.get<string>('EVOLUTION_WEBHOOK_SECRET') || null;
  }

  get publicApiUrl(): string {
    return this.configService.get<string>('PUBLIC_API_URL')!;
  }

  // --- Bot behavior toggles ---

  get botAutoReplyEnabled(): boolean {
    return this.configService.get<boolean>('BOT_AUTO_REPLY_ENABLED')!;
  }

  get botPauseOnHandoff(): boolean {
    return this.configService.get<boolean>('BOT_PAUSE_ON_HANDOFF')!;
  }

  /** Parsed from the comma-separated `ADMIN_WHATSAPP_NUMBERS` env var. */
  get adminWhatsappNumbers(): string[] {
    const raw = this.configService.get<string>('ADMIN_WHATSAPP_NUMBERS') || '';
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  // --- Pricing configuration ---

  get pricingRangeEnabled(): boolean {
    return this.configService.get<boolean>('PRICING_RANGE_ENABLED')!;
  }

  get pricingStartingAt(): number {
    return this.configService.get<number>('PRICING_STARTING_AT')!;
  }

  get pricingText(): string | null {
    return this.configService.get<string>('PRICING_TEXT') || null;
  }

  // --- Auth ---

  get jwtSecret(): string {
    return this.configService.get<string>('JWT_SECRET')!;
  }

  get appEnv(): string {
    return this.configService.get<string>('APP_ENV')!;
  }

  get frontendUrl(): string {
    return this.configService.get<string>('FRONTEND_URL')!;
  }

  get isProduction(): boolean {
    return this.appEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.appEnv === 'development';
  }
}
