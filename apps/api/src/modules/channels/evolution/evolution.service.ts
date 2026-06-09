import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../../config/config.service';
import {
  ConnectResult,
  EvolutionConnectionState,
  EvolutionResult,
  InstanceStatus,
} from './evolution.types';

/**
 * HTTP method understood by the internal request helper.
 */
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Timeout por tentativa de request ao Evolution_API (ms). */
const EVOLUTION_REQUEST_TIMEOUT_MS = 15_000;
/** Backoff base entre retentativas (ms); cresce linearmente por tentativa. */
const EVOLUTION_RETRY_BACKOFF_MS = 400;

/**
 * Options for an Evolution_API HTTP request.
 */
interface EvolutionRequestOptions {
  /** HTTP method for the request. */
  method: HttpMethod;
  /** Path appended to the configured `EVOLUTION_API_URL` (must start with `/`). */
  path: string;
  /** Optional JSON body to send. */
  body?: unknown;
  /**
   * Number of EXTRA retries on transient failures (network error, timeout,
   * HTTP 5xx, or 429). Defaults to 0 (single attempt). Used by `sendTextMessage`
   * because a transient network failure means the message almost certainly was
   * not delivered, so retrying is safe and avoids silently losing the reply.
   */
  retries?: number;
}

/**
 * `EvolutionService` performs all HTTP calls to Evolution_API.
 *
 * Design guarantees (Requirements 14.1, 14.2, 14.3, 18.2):
 *  - The `apikey` header is attached server-side only; it is never returned to
 *    callers or surfaced to the frontend.
 *  - Every operation returns an {@link EvolutionResult} discriminated union;
 *    no method throws. All errors are caught and returned as
 *    `{ ok: false, error }`.
 *  - Any error message (and anything logged) has the configured
 *    `EVOLUTION_API_KEY` scrubbed to `***` before it leaves the service.
 *
 * Transport: native `fetch` (Node 18+/20), since `@nestjs/axios`/`axios` is not
 * a project dependency.
 */
@Injectable()
export class EvolutionService {
  private readonly logger = new Logger(EvolutionService.name);

  constructor(private readonly config: AppConfigService) {}

  // -------------------------------------------------------------------------
  // Public operations (Requirement 14.1, 14.2)
  // -------------------------------------------------------------------------

  /**
   * Send a plain text message to a recipient on WhatsApp.
   *
   * No-mass-send invariant (Requirement 18.7): this method sends to exactly one
   * recipient per call and intentionally exposes no bulk/broadcast variant.
   * Callers are limited to `InboundMessageProcessor` (one reply per inbound
   * message) and manual team send (one message per Team_Member action). Do not
   * add a code path that loops over leads/contacts to send unsolicited
   * messages. See {@link LogScrubberService} for the documented invariant.
   *
   * @param to - Destination phone number (digits, channel format).
   * @param text - The message body.
   * @returns The created message's `externalMessageId` on success.
   */
  async sendTextMessage(
    to: string,
    text: string,
    delayMs?: number,
  ): Promise<EvolutionResult<{ externalMessageId: string }>> {
    // When a delay is provided, Evolution shows the "composing" (digitando)
    // presence to the recipient for `delay` ms before delivering the message —
    // this is the reliable way to render a human-like typing indicator.
    const body: Record<string, unknown> = { number: to, text };
    if (typeof delayMs === 'number' && delayMs > 0) {
      body.delay = Math.round(delayMs);
      body.presence = 'composing';
    }
    return this.request<{ externalMessageId: string }>(
      {
        method: 'POST',
        path: `/message/sendText/${this.instance}`,
        body,
        // Reenvia em falha transiente: perder a resposta do bot é pior que o
        // risco baixo de duplicar numa indisponibilidade momentânea.
        retries: 2,
      },
      (data) => {
        const payload = data as { key?: { id?: string }; id?: string };
        const externalMessageId = payload?.key?.id ?? payload?.id ?? '';
        return { externalMessageId };
      },
    );
  }

  /**
   * Fetch the current connection state of the configured instance.
   */
  async getInstanceStatus(): Promise<EvolutionResult<InstanceStatus>> {
    return this.request<InstanceStatus>(
      {
        method: 'GET',
        path: `/instance/connectionState/${this.instance}`,
      },
      (data) => {
        const payload = data as {
          instance?: { instanceName?: string; state?: string; number?: string };
          state?: string;
        };
        const rawState = payload?.instance?.state ?? payload?.state;
        const state = this.normalizeState(rawState);
        return {
          instanceName: payload?.instance?.instanceName ?? this.instance,
          state,
          connected: state === 'open',
          connectedNumber: payload?.instance?.number ?? null,
        };
      },
    );
  }

  /**
   * Request a connection/reconnection. When pairing is required, the response
   * carries a base64 QR image and/or a pairing code.
   */
  async connectInstance(): Promise<EvolutionResult<ConnectResult>> {
    return this.request<ConnectResult>(
      {
        method: 'GET',
        path: `/instance/connect/${this.instance}`,
      },
      (data) => this.toConnectResult(data),
    );
  }

  /**
   * Retrieve the pairing QR code (base64) for the instance, when applicable.
   */
  async getQRCode(): Promise<EvolutionResult<{ base64: string | null }>> {
    return this.request<{ base64: string | null }>(
      {
        method: 'GET',
        path: `/instance/connect/${this.instance}`,
      },
      (data) => {
        const result = this.toConnectResult(data);
        return { base64: result.qrCodeBase64 };
      },
    );
  }

  /**
   * Restart the configured instance.
   */
  async restartInstance(): Promise<EvolutionResult<void>> {
    return this.request<void>(
      {
        method: 'POST',
        path: `/instance/restart/${this.instance}`,
      },
      () => undefined,
    );
  }

  /**
   * Configure the Evolution webhook to point at this application.
   * The target URL is derived from `PUBLIC_API_URL` + `/webhooks/evolution`.
   */
  async setWebhook(): Promise<EvolutionResult<void>> {
    const url = `${this.config.publicApiUrl.replace(/\/+$/, '')}/webhooks/evolution`;
    return this.request<void>(
      {
        method: 'POST',
        path: `/webhook/set/${this.instance}`,
        body: {
          webhook: {
            enabled: true,
            url,
            webhookByEvents: false,
            events: ['MESSAGES_UPSERT'],
          },
        },
      },
      () => undefined,
    );
  }

  /**
   * Log the instance out of WhatsApp (disconnect the paired number).
   */
  async logoutInstance(): Promise<EvolutionResult<void>> {
    return this.request<void>(
      {
        method: 'DELETE',
        path: `/instance/logout/${this.instance}`,
      },
      () => undefined,
    );
  }

  /**
   * Send a typing/presence indication to a recipient, where Evolution_API
   * supports it (Requirement 14.2).
   *
   * @param to - Destination phone number.
   */
  async sendTypingOrPresence(
    to: string,
    delayMs = 3000,
  ): Promise<EvolutionResult<void>> {
    return this.request<void>(
      {
        method: 'POST',
        path: `/chat/sendPresence/${this.instance}`,
        body: {
          number: to,
          presence: 'composing',
          delay: Math.round(delayMs),
        },
      },
      () => undefined,
    );
  }

  /**
   * Baixa a mídia de uma mensagem (ex.: áudio do WhatsApp) como base64, usando
   * o endpoint getBase64FromMediaMessage da Evolution API. Precisa apenas da
   * `key` da mensagem (id/remoteJid). Retorna `{ base64, mimetype }` ou um erro
   * key-safe — o chamador trata a falha caindo no aviso de mídia.
   */
  async getMediaBase64(messageObject: {
    key?: { id?: string; remoteJid?: string; fromMe?: boolean };
    message?: unknown;
  }): Promise<EvolutionResult<{ base64: string; mimetype: string }>> {
    return this.request(
      {
        method: 'POST',
        path: `/chat/getBase64FromMediaMessage/${this.instance}`,
        body: { message: messageObject, convertToMp4: false },
        retries: 1,
      },
      (data) => {
        const d = (data ?? {}) as { base64?: string; mimetype?: string };
        return { base64: d.base64 ?? '', mimetype: d.mimetype ?? '' };
      },
    );
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** The configured Evolution instance name. */
  private get instance(): string {
    return this.config.evolutionInstanceName;
  }

  /**
   * Execute an Evolution_API request and map the response.
   *
   * Catches every error and returns a key-safe {@link EvolutionResult}. The
   * `apikey` header is attached here and never exposed to callers.
   *
   * @param options - The request method, path, and optional body.
   * @param map - Maps the parsed JSON response body to the result data shape.
   */
  private async request<T>(
    options: EvolutionRequestOptions,
    map: (data: unknown) => T,
  ): Promise<EvolutionResult<T>> {
    const baseUrl = this.config.evolutionApiUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${options.path}`;
    const maxAttempts = Math.max(1, (options.retries ?? 0) + 1);

    // Default failure used only if the loop somehow yields nothing.
    let lastFailure: EvolutionResult<T> = {
      ok: false,
      error: this.scrub(`Evolution API request to ${options.path} failed`),
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Per-attempt timeout so a hung connection cannot block the reply
      // forever (and so a retry can actually fire).
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        EVOLUTION_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(url, {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
            apikey: this.config.evolutionApiKey,
          },
          body:
            options.body !== undefined
              ? JSON.stringify(options.body)
              : undefined,
          signal: controller.signal,
        });

        const rawText = await response.text();
        const parsed = this.safeParseJson(rawText);

        if (response.ok) {
          return { ok: true, data: map(parsed) };
        }

        const detail =
          typeof parsed === 'object' && parsed !== null
            ? JSON.stringify(parsed)
            : rawText;
        // 4xx (except 429) is a client error — retrying will not help.
        const transient = response.status >= 500 || response.status === 429;
        lastFailure = this.failure(
          `Evolution API request to ${options.path} failed with status ${response.status}: ${detail}`,
          transient && attempt < maxAttempts,
        );
        if (!transient) return lastFailure;
      } catch (error) {
        // Network error or timeout (AbortError): transient, worth retrying.
        lastFailure = this.failure(
          `Evolution API request to ${options.path} failed: ${this.errorMessage(error)}`,
          attempt < maxAttempts,
        );
      } finally {
        clearTimeout(timer);
      }

      if (attempt < maxAttempts) {
        await this.delay(EVOLUTION_RETRY_BACKOFF_MS * attempt);
      }
    }

    return lastFailure;
  }

  /**
   * Build a failure result with the API key scrubbed. Logs the scrubbed message
   * as a warning when another retry will follow, or as an error when it is the
   * terminal failure (Requirements 14.3, 18.2, 18.6).
   */
  private failure<T = never>(
    message: string,
    willRetry = false,
  ): EvolutionResult<T> {
    const safe = this.scrub(message);
    if (willRetry) {
      this.logger.warn(`${safe} — retrying`);
    } else {
      this.logger.error(safe);
    }
    return { ok: false, error: safe };
  }

  /** Resolves after `ms` milliseconds (used for retry backoff). */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Replace every occurrence of the configured `EVOLUTION_API_KEY` with `***`.
   * No-op when the key is empty.
   */
  private scrub(message: string): string {
    const key = this.config.evolutionApiKey;
    if (!key) {
      return message;
    }
    return message.split(key).join('***');
  }

  /**
   * Extract a string message from an unknown thrown value.
   */
  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'unknown error';
    }
  }

  /**
   * Parse a JSON string, returning the raw string when parsing fails and
   * `null` for an empty body.
   */
  private safeParseJson(text: string): unknown {
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Normalize a raw Evolution connection state into the typed union.
   */
  private normalizeState(raw: string | undefined): EvolutionConnectionState {
    switch (raw) {
      case 'open':
      case 'connecting':
      case 'close':
      case 'closed':
        return raw;
      default:
        return 'unknown';
    }
  }

  /**
   * Map a connect/QR response body into a {@link ConnectResult}.
   */
  private toConnectResult(data: unknown): ConnectResult {
    const payload = data as {
      instance?: { state?: string };
      state?: string;
      base64?: string;
      qrcode?: { base64?: string; pairingCode?: string; code?: string };
      pairingCode?: string;
      code?: string;
    };

    const qrCodeBase64 =
      payload?.qrcode?.base64 ?? payload?.base64 ?? null;
    const pairingCode =
      payload?.qrcode?.pairingCode ??
      payload?.pairingCode ??
      payload?.qrcode?.code ??
      payload?.code ??
      null;

    return {
      state: this.normalizeState(payload?.instance?.state ?? payload?.state),
      qrCodeBase64,
      pairingCode,
    };
  }
}
