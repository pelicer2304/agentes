/**
 * Pure payload-sanitization helpers used by the inbound WhatsApp pipeline to
 * bound and clean untrusted webhook data before it is persisted or passed to
 * the frozen Agent_Engine (Requirements 18.3, 18.4).
 *
 * These functions are intentionally pure (no I/O, no external state) so they
 * are trivial to unit/property test and safe to reuse anywhere.
 */

/**
 * The absolute hard cap on inbound text length. Inbound text whose length
 * exceeds this is REJECTED before storage and before the engine is invoked
 * (Requirement 18.4). This is distinct from the engine truncation cap (4000):
 * content between 4000 and {@link HARD_MESSAGE_CAP} is accepted and truncated
 * for the engine, whereas content above {@link HARD_MESSAGE_CAP} is dropped
 * entirely as abusive/oversized.
 */
export const HARD_MESSAGE_CAP = 20_000;

/**
 * The maximum serialized-JSON length stored for a `rawPayload`. A payload whose
 * JSON serialization exceeds this is replaced with a small truncation marker so
 * an abusive/oversized payload can never bloat the database (Requirement 18.3).
 */
export const MAX_RAW_PAYLOAD_CHARS = 20_000;

/**
 * Matches control characters that must be stripped from stored text. This
 * covers C0 controls (U+0000–U+001F) and DEL (U+007F) EXCEPT the normal
 * whitespace characters tab (`\t`, U+0009), line feed (`\n`, U+000A), and
 * carriage return (`\r`, U+000D), which are preserved. C1 controls
 * (U+0080–U+009F) are also stripped.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Strip control characters from `text`, preserving normal whitespace
 * (`\n`, `\t`, `\r`). Non-string input is coerced to a string first. The result
 * is safe to persist and to display without smuggling terminal escape sequences
 * or null bytes (Requirement 18.3).
 *
 * @param text - The (untrusted) text to sanitize.
 * @returns The text with disallowed control characters removed.
 */
export function sanitizeText(text: string): string {
  const value = typeof text === 'string' ? text : String(text);
  return value.replace(CONTROL_CHARS, '');
}

/**
 * Returns `true` when the inbound text length exceeds the {@link HARD_MESSAGE_CAP}
 * and must therefore be rejected before storage (Requirement 18.4).
 *
 * @param text - The inbound text content.
 */
export function exceedsHardCap(text: string): boolean {
  return typeof text === 'string' && text.length > HARD_MESSAGE_CAP;
}

/**
 * Bound a `rawPayload` so the value stored never exceeds
 * {@link MAX_RAW_PAYLOAD_CHARS} characters of serialized JSON (Requirement 18.3).
 *
 * When the payload serializes within the limit it is returned unchanged. When
 * it exceeds the limit (or cannot be serialized) a small, deterministic marker
 * object is returned instead, recording why and the original size when known.
 *
 * @param payload - The raw, untrusted webhook payload.
 * @param maxChars - Optional override for the serialized-length cap.
 * @returns A payload safe to persist as JSON.
 */
export function boundRawPayload(
  payload: unknown,
  maxChars: number = MAX_RAW_PAYLOAD_CHARS,
): unknown {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch {
    return { __sanitized: true, reason: 'unserializable' };
  }

  // `JSON.stringify` returns `undefined` for values like `undefined` itself.
  if (serialized === undefined) {
    return {};
  }

  if (serialized.length <= maxChars) {
    return payload;
  }

  return {
    __sanitized: true,
    reason: 'oversized_payload',
    originalLength: serialized.length,
  };
}
