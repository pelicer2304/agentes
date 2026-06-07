import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';

/**
 * The masking token used in place of any secret value.
 */
export const SECRET_MASK = '***';

/**
 * Replace every occurrence of each provided secret in `message` with `***`.
 *
 * This is a pure, dependency-light helper used for secret-safe logging
 * (Requirement 18.6). It guarantees that sensitive credentials such as
 * `EVOLUTION_API_KEY` and `JWT_SECRET` never appear verbatim in log output,
 * error messages, or any string echoed back to callers.
 *
 * Behavior:
 *  - Empty / whitespace-only secrets are ignored (they would otherwise mask
 *    the entire string).
 *  - Every occurrence of each non-empty secret is replaced, not just the first.
 *  - Replacement uses a plain substring split/join so no value is treated as a
 *    regular expression (avoids ReDoS and escaping concerns).
 *  - A non-string `message` is coerced to a string before scrubbing.
 *
 * @param message - The string (or value coercible to string) to scrub.
 * @param secrets - The secret values to mask. Empty entries are skipped.
 * @returns The message with every non-empty secret replaced by `***`.
 */
export function scrubSecrets(message: string, secrets: string[]): string {
  let result = typeof message === 'string' ? message : String(message);

  for (const secret of secrets) {
    if (typeof secret !== 'string') {
      continue;
    }
    const trimmed = secret.trim();
    if (trimmed.length === 0) {
      continue;
    }
    // Plain substring replacement of every occurrence; no regex involved.
    result = result.split(secret).join(SECRET_MASK);
  }

  return result;
}

/**
 * Extract a string message from an unknown thrown value, without leaking
 * structured internals beyond a best-effort string representation.
 */
function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
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
 * Injectable wrapper around {@link scrubSecrets} that sources the application's
 * sensitive credentials (`EVOLUTION_API_KEY`, `JWT_SECRET`) from
 * {@link AppConfigService}.
 *
 * Use this anywhere a string or error is about to be logged or returned that
 * might contain a configured secret. `EvolutionService` already scrubs its own
 * API key in error results; this service provides the shared, broader
 * scrubbing (covering both the Evolution key and the JWT secret) for general
 * logging use across the application.
 *
 * --- No-mass-send invariant (Requirement 18.7) ---
 *
 * Outbound WhatsApp messages are produced in exactly two places, and there is
 * deliberately NO bulk / broadcast / mass-send pathway anywhere in the System:
 *
 *  1. `InboundMessageProcessor` — produces at most one outbound reply in direct
 *     response to a single eligible inbound webhook message (engine reply,
 *     unsupported-media notice, handoff confirmation, or contextual fallback).
 *  2. Manual team send (Inbox conversation detail, see task 10.3) — produces a
 *     single outbound message explicitly triggered by an authenticated
 *     Team_Member for one conversation.
 *
 * The admin handoff summary is the only other outbound, and it fans out only to
 * the small, statically configured `ADMIN_WHATSAPP_NUMBERS` list — never to a
 * dynamic or client-derived audience. Any future feature MUST preserve this
 * invariant: do not introduce an endpoint or service method that iterates over
 * leads/contacts to send unsolicited messages.
 */
@Injectable()
export class LogScrubberService {
  constructor(private readonly config: AppConfigService) {}

  /**
   * The set of configured secret values to mask. Empty/absent secrets are
   * filtered out by {@link scrubSecrets}.
   */
  private get secrets(): string[] {
    return [this.config.evolutionApiKey, this.config.jwtSecret];
  }

  /**
   * Scrub the configured secrets out of an arbitrary string.
   *
   * @param message - The string to scrub.
   * @returns The message with `EVOLUTION_API_KEY` and `JWT_SECRET` masked.
   */
  scrub(message: string): string {
    return scrubSecrets(message, this.secrets);
  }

  /**
   * Convert an unknown error to a secret-safe string suitable for logging.
   *
   * @param error - The caught error (or any thrown value).
   * @returns A string representation with configured secrets masked.
   */
  scrubError(error: unknown): string {
    return scrubSecrets(errorToMessage(error), this.secrets);
  }
}
