import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../../config/config.service';
import {
  InboundMessageProcessor,
  type ProcessOutcome,
} from '../../../inbound/inbound-message.processor';

/**
 * The HTTP headers Evolution_API (or a proxy) may use to carry the configured
 * webhook secret. Checked in order; the first present value is compared for an
 * **exact** match against `EVOLUTION_WEBHOOK_SECRET`.
 *
 * Evolution_API forwards the instance `apikey` header on webhook deliveries, so
 * that is accepted as the primary carrier. A dedicated `x-webhook-secret` header
 * (and a `Bearer` `authorization` token) are also accepted so the secret can be
 * provisioned independently of the instance key.
 */
const SECRET_HEADER_NAMES = ['apikey', 'x-webhook-secret', 'authorization'] as const;

/** The webhook response body shape returned to Evolution_API. */
interface WebhookResponse {
  /** Coarse classification of what the processor did. */
  status: ProcessOutcome['action'] | 'ok';
}

/**
 * `EvolutionWebhookController` exposes `POST /webhooks/evolution`, the single
 * ingress for inbound WhatsApp traffic from Evolution_API.
 *
 * It is intentionally **not** behind `JwtAuthGuard`; it authenticates requests
 * with the webhook secret instead (Requirement 5.2, 18.1). The controller owns
 * only transport-level concerns and delegates all business logic to
 * {@link InboundMessageProcessor}.
 *
 * Processing order is strict (design "EvolutionWebhookController", Requirement 5):
 *   1. **Secret validation FIRST.** When `EVOLUTION_WEBHOOK_SECRET` is
 *      configured, a missing secret or any value that is not an exact match is
 *      rejected with HTTP 401 and the payload is NEVER processed (5.2). When the
 *      secret is not configured, validation is skipped and the request is
 *      accepted (5.3).
 *   2. **Body / required-field validation.** An empty body, a non-object body,
 *      or a body missing the fields required to identify an event is rejected
 *      with HTTP 400 and the payload is NOT processed (5.6).
 *   3. **Delegate to the processor.** The {@link ProcessOutcome} `httpStatus`
 *      (200 or 400) is applied to the response (5.5). Evolution *send* failures
 *      are caught inside the processor and still yield 200 (9.6). Any unhandled
 *      error propagating out of the processor is left to throw so Nest maps it
 *      to HTTP 500 (5.7).
 *
 * ## Wiring
 * This controller is registered by `InboundModule` (not `EvolutionModule`).
 * `InboundModule` already provides {@link InboundMessageProcessor}, while
 * `EvolutionModule` is imported *by* `ChannelModule` which is imported *by*
 * `InboundModule`; registering the controller here avoids the
 * `EvolutionModule -> InboundModule` cycle that would otherwise arise.
 * `AppConfigService` is available globally via the `@Global()` `AppConfigModule`.
 */
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  private readonly logger = new Logger(EvolutionWebhookController.name);

  constructor(
    private readonly processor: InboundMessageProcessor,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Receive an Evolution_API webhook event.
   *
   * The default success status is 200 (`@HttpCode(200)`); when the processor
   * reports a body-level validation failure (`httpStatus: 400`) the response
   * status is overridden via the injected {@link Response}. Unhandled processor
   * errors are rethrown so Nest produces a 500 (Requirement 5.7).
   *
   * @param headers - Incoming request headers (used for secret validation).
   * @param body - The raw, untrusted webhook payload.
   * @param res - Express response, used only to set a non-default status code.
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookResponse> {
    // 1. Secret validation FIRST — never touch the payload on failure (5.2/5.3).
    this.validateSecret(headers);

    // 2. JSON validation — 400 only for a non-object body. Non-message events
    //    (no/array `data`) are accepted and ignored with 200 by the processor,
    //    so Evolution never treats a routine event as a non-recoverable 4xx.
    this.validateBody(body);

    // 3. Delegate to the processor. Unhandled errors propagate to a 500 (5.7).
    const outcome = await this.processor.process(body);

    // Map the processor's body-level status. The success default is 200
    // (@HttpCode); only a 400 needs to override the response status (5.5).
    if (outcome.httpStatus === 400) {
      res.status(400);
    }

    return { status: outcome.action };
  }

  /**
   * Enforce the webhook secret (Requirement 5.2, 5.3, 5.4, 18.1).
   *
   * - When `EVOLUTION_WEBHOOK_SECRET` is not configured (null/empty), validation
   *   is skipped and the request is accepted.
   * - When configured, the presented secret (from {@link SECRET_HEADER_NAMES})
   *   must be an exact match; a missing or mismatched secret throws
   *   {@link UnauthorizedException} (HTTP 401) before any processing.
   *
   * @param headers - The incoming request headers.
   */
  private validateSecret(
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const configured = this.config.evolutionWebhookSecret;
    if (!configured) {
      // Unconfigured secret: skip validation entirely (5.3).
      return;
    }

    const presented = this.extractPresentedSecret(headers);
    if (presented === null || presented !== configured) {
      // Never reveal whether the secret was missing vs. wrong, and never
      // process the payload (5.2).
      this.logger.warn('Rejected webhook: missing or invalid webhook secret');
      throw new UnauthorizedException('Invalid webhook secret');
    }
  }

  /**
   * Read the presented secret from the first matching header. A `Bearer ` prefix
   * on the `authorization` header is stripped before comparison. Returns `null`
   * when no candidate header carries a non-empty value.
   */
  private extractPresentedSecret(
    headers: Record<string, string | string[] | undefined>,
  ): string | null {
    for (const name of SECRET_HEADER_NAMES) {
      const raw = this.headerValue(headers[name]);
      if (raw === null) {
        continue;
      }
      const value =
        name === 'authorization' ? raw.replace(/^Bearer\s+/i, '').trim() : raw;
      if (value.length > 0) {
        return value;
      }
    }
    return null;
  }

  /** Normalize a header value (which may be an array) to a single string. */
  private headerValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      return value.length > 0 ? value[0] : null;
    }
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    return null;
  }

  /**
   * Validate only that the body is a JSON object — the minimum needed for the
   * processor to inspect it. Throws {@link BadRequestException} (HTTP 400) for a
   * null/undefined body or a non-object (e.g. an array or primitive), without
   * processing.
   *
   * IMPORTANT — why we do NOT reject object bodies that lack a `data` envelope:
   * Evolution_API delivers many event types to this single webhook URL
   * (`messages.upsert`, but also `messages.update`/delivery acks,
   * `presence.update`, `contacts.update`, `chats.update`, …). Several of those
   * carry `data` as an array or omit it entirely. Returning a client error for
   * them is harmful: Evolution treats a 4xx as a non-recoverable delivery and
   * cancels retries (the response is mapped to 422 by the global exception
   * filter). So any well-formed JSON object is accepted here and handed to the
   * processor, whose normalizer classifies non-message events and returns HTTP
   * 200 (`ignored`). Only a body that is not a JSON object at all is a true
   * transport-level error and still yields 400.
   */
  private validateBody(body: unknown): asserts body is Record<string, unknown> {
    if (body === null || body === undefined) {
      throw new BadRequestException('Webhook body is empty');
    }
    if (typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Webhook body must be a JSON object');
    }
    // No `data`-envelope requirement: non-message Evolution events (which may
    // omit `data` or send it as an array) are accepted and ignored with 200 by
    // the processor/normalizer, so Evolution does not cancel future deliveries.
  }
}
