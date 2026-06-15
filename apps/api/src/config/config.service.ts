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

  // --- Lead follow-up configuration ---

  /** Offset (em horas) do Nível 1 do follow-up a partir do Inactivity_Anchor. */
  get followUpLevel1Hours(): number {
    const value = this.configService.get<number>('FOLLOWUP_LEVEL1_HOURS');
    return typeof value === 'number' ? value : 1;
  }

  /** Offset (em horas) do Nível 2 do follow-up a partir do Inactivity_Anchor. */
  get followUpLevel2Hours(): number {
    const value = this.configService.get<number>('FOLLOWUP_LEVEL2_HOURS');
    return typeof value === 'number' ? value : 24;
  }

  /** Offset (em horas) do Nível 3 do follow-up a partir do Inactivity_Anchor. */
  get followUpLevel3Hours(): number {
    const value = this.configService.get<number>('FOLLOWUP_LEVEL3_HOURS');
    return typeof value === 'number' ? value : 48;
  }

  /** Janela de resposta (em horas) após o Nível 3 antes de encerrar o ciclo. */
  get followUpCompletionWindowHours(): number {
    const value = this.configService.get<number>('FOLLOWUP_COMPLETION_WINDOW_HOURS');
    return typeof value === 'number' ? value : 24;
  }

  /** Janela diária de envio permitida no formato bruto `HH:mm-HH:mm`. */
  get followUpSendWindow(): string {
    return this.configService.get<string>('FOLLOWUP_SEND_WINDOW') || '08:00-20:00';
  }

  /**
   * Janela diária de envio permitida já analisada em horas/minutos de início
   * e fim, para consumo direto pelos serviços de follow-up.
   */
  get followUpSendWindowParsed(): {
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
  } {
    const [start, end] = this.followUpSendWindow.split('-');
    const [startHour, startMinute] = start.split(':').map((part) => Number(part));
    const [endHour, endMinute] = end.split(':').map((part) => Number(part));
    return { startHour, startMinute, endHour, endMinute };
  }

  /** Espera mínima (em segundos) ao reagendar por rate-limit (mínimo 60). */
  get followUpRetryBackoffSeconds(): number {
    const value = this.configService.get<number>('FOLLOWUP_RETRY_BACKOFF_SECONDS');
    return typeof value === 'number' ? value : 60;
  }

  /** Máximo de tentativas adiadas por nível antes de interromper os disparos. */
  get followUpMaxDeferrals(): number {
    const value = this.configService.get<number>('FOLLOWUP_MAX_DEFERRALS');
    return typeof value === 'number' ? value : 10;
  }

  /** Cadência do poll do scheduler de follow-up (em ms). */
  get followUpPollIntervalMs(): number {
    const value = this.configService.get<number>('FOLLOWUP_POLL_INTERVAL_MS');
    return typeof value === 'number' ? value : 30000;
  }
}
