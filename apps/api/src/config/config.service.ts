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

  // --- Audio transcription (Groq Whisper) ---

  /**
   * Groq API key for speech-to-text. When null, audio transcription is disabled
   * and audio messages fall back to the "text only" notice — nothing breaks.
   */
  get groqApiKey(): string | null {
    return this.configService.get<string>('GROQ_API_KEY') || null;
  }

  get groqBaseUrl(): string {
    return (
      this.configService.get<string>('GROQ_BASE_URL') ||
      'https://api.groq.com/openai/v1'
    );
  }

  get groqSttModel(): string {
    return (
      this.configService.get<string>('GROQ_STT_MODEL') || 'whisper-large-v3'
    );
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

  // --- Humanized reply behavior (debounce + typing) ---

  /**
   * Quiet-window (ms) for concatenating rapid successive inbound messages into
   * a single agent turn. 0 disables buffering (reply per message).
   */
  get messageDebounceMs(): number {
    const value = this.configService.get<number>('MESSAGE_DEBOUNCE_MS');
    return typeof value === 'number' ? value : 10000;
  }

  /** Whether to send "digitando..." presence and pause before replying. */
  get typingIndicatorEnabled(): boolean {
    const value = this.configService.get<boolean>('TYPING_INDICATOR_ENABLED');
    return value === undefined ? true : value;
  }

  /** Milliseconds of simulated typing per reply character. */
  get typingMsPerChar(): number {
    const value = this.configService.get<number>('TYPING_MS_PER_CHAR');
    return typeof value === 'number' ? value : 45;
  }

  /** Minimum simulated typing pause (ms). */
  get typingMinMs(): number {
    const value = this.configService.get<number>('TYPING_MIN_MS');
    return typeof value === 'number' ? value : 1200;
  }

  /** Maximum simulated typing pause (ms). */
  get typingMaxMs(): number {
    const value = this.configService.get<number>('TYPING_MAX_MS');
    return typeof value === 'number' ? value : 6000;
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
