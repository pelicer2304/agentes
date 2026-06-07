/**
 * Pure, deterministic normalizer for raw Evolution_API webhook payloads.
 *
 * `normalizeInbound(payload)` converts a raw {@link EvolutionWebhookPayload} into
 * either a normalized {@link InboundMessage} (ready for the orchestration
 * pipeline) or a {@link NormalizationReject} describing why the payload must not
 * produce a reply.
 *
 * Design constraints (see design.md "evolution-normalizer", Requirement 6):
 *  - PURE: no external state, no I/O.
 *  - DETERMINISTIC: identical input always yields identical output. The
 *    `timestamp` is derived from the payload's `messageTimestamp`; it NEVER uses
 *    `Date.now()`. When the timestamp is absent/invalid it falls back
 *    deterministically to the Unix epoch (`new Date(0)`).
 *
 * Filtering rules:
 *  - Reject as `malformed` when `externalMessageId`, `from`, or `content` is
 *    missing (Requirement 6.2).
 *  - Reject as `fromMe` when the event was sent by the instance itself (6.3).
 *  - Reject as `group` when the origin JID is a group (`@g.us`) (6.4).
 *  - Reject as `unsupported_type` when the message type is outside
 *    `{text, audio, image, document}` (6.5).
 *
 * Note: `audio`, `image`, and `document` are accepted here (they produce an
 * `InboundMessage` so the inbound can be saved); the orchestration layer is
 * responsible for the "unsupported media" notice (Requirement 6.6).
 */

import type { InboundMessage } from '../../../channel/channel-adapter.interface';
import type {
  EvolutionMessageContent,
  EvolutionWebhookData,
  EvolutionWebhookPayload,
} from './evolution.types';

/**
 * The reason a raw payload was rejected and must not produce a reply.
 *  - `malformed`        : required field (`externalMessageId`/`from`/`content`) missing.
 *  - `fromMe`           : the message was sent by the connected instance itself.
 *  - `group`            : the message originates from a WhatsApp group.
 *  - `unsupported_type` : the message type is outside `{text,audio,image,document}`.
 */
export type NormalizationRejectReason =
  | 'malformed'
  | 'fromMe'
  | 'group'
  | 'unsupported_type';

/**
 * Result returned when a raw payload is filtered out. The `rejected` literal is
 * the discriminator that distinguishes this from an {@link InboundMessage}.
 */
export interface NormalizationReject {
  /** Discriminator: always `true` for a rejection. */
  rejected: true;
  /** Why the payload was rejected. */
  reason: NormalizationRejectReason;
  /** Human-readable detail for logging; safe (carries no secrets). */
  detail: string;
}

/**
 * The union produced by {@link normalizeInbound}: either a normalized inbound
 * message or a rejection.
 */
export type NormalizationResult = InboundMessage | NormalizationReject;

/** Suffix identifying a WhatsApp group JID. */
const GROUP_JID_SUFFIX = '@g.us';

/** The accepted message types. */
type AcceptedMessageType = InboundMessage['messageType'];

/**
 * Type guard: returns `true` when a {@link NormalizationResult} is a rejection.
 */
export function isNormalizationReject(
  result: NormalizationResult,
): result is NormalizationReject {
  return (result as NormalizationReject).rejected === true;
}

/**
 * Returns a trimmed string when `value` is a non-empty string, otherwise `null`.
 */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derives the bare phone/sender identifier from a WhatsApp JID by stripping the
 * server suffix (e.g. `5511999999999@s.whatsapp.net` -> `5511999999999`).
 */
function jidToFrom(remoteJid: string): string {
  const atIndex = remoteJid.indexOf('@');
  return atIndex === -1 ? remoteJid : remoteJid.slice(0, atIndex);
}

/**
 * Resolves the normalized message type from the raw Evolution data, inspecting
 * the message content blocks first and falling back to the `messageType`
 * discriminator string. Returns `null` when the type is unsupported.
 */
function resolveMessageType(
  data: EvolutionWebhookData,
): AcceptedMessageType | null {
  const message: EvolutionMessageContent | undefined = data.message;

  if (message) {
    if (
      typeof message.conversation === 'string' ||
      message.extendedTextMessage !== undefined
    ) {
      return 'text';
    }
    if (message.audioMessage !== undefined) {
      return 'audio';
    }
    if (message.imageMessage !== undefined) {
      return 'image';
    }
    if (message.documentMessage !== undefined) {
      return 'document';
    }
  }

  // Fall back to Evolution's discriminator string when content blocks are absent.
  switch (data.messageType) {
    case 'conversation':
    case 'extendedTextMessage':
      return 'text';
    case 'audioMessage':
      return 'audio';
    case 'imageMessage':
      return 'image';
    case 'documentMessage':
      return 'document';
    default:
      return null;
  }
}

/**
 * Extracts the message content for the resolved type. For text the actual body
 * is required (returns `null` when absent so the payload is rejected as
 * malformed). For media types a deterministic, non-empty placeholder/caption is
 * always returned so the inbound can be saved (Requirement 6.6).
 */
function extractContent(
  message: EvolutionMessageContent | undefined,
  messageType: AcceptedMessageType,
): string | null {
  switch (messageType) {
    case 'text': {
      const conversation = nonEmptyString(message?.conversation);
      if (conversation !== null) {
        return conversation;
      }
      return nonEmptyString(message?.extendedTextMessage?.text);
    }
    case 'image':
      return nonEmptyString(message?.imageMessage?.caption) ?? '[imagem]';
    case 'document':
      return (
        nonEmptyString(message?.documentMessage?.caption) ??
        nonEmptyString(message?.documentMessage?.fileName) ??
        '[documento]'
      );
    case 'audio':
      return '[áudio]';
    default:
      return null;
  }
}

/**
 * Derives a `Date` from Evolution's `messageTimestamp` (Unix epoch seconds,
 * provided as a number or numeric string). Falls back deterministically to the
 * Unix epoch when the value is missing or invalid. Never uses `Date.now()`.
 */
function resolveTimestamp(messageTimestamp: number | string | undefined): Date {
  if (typeof messageTimestamp === 'number' && Number.isFinite(messageTimestamp)) {
    return new Date(messageTimestamp * 1000);
  }
  if (typeof messageTimestamp === 'string') {
    const seconds = Number.parseInt(messageTimestamp, 10);
    if (Number.isFinite(seconds)) {
      return new Date(seconds * 1000);
    }
  }
  return new Date(0);
}

/**
 * Normalizes a raw Evolution_API webhook payload into an {@link InboundMessage},
 * or returns a {@link NormalizationReject} explaining why it was filtered out.
 *
 * This function is pure and deterministic.
 *
 * @param payload - The raw Evolution webhook payload (untrusted, possibly malformed).
 * @returns An {@link InboundMessage} when the payload is an eligible inbound
 *          message, otherwise a {@link NormalizationReject}.
 */
export function normalizeInbound(payload: unknown): NormalizationResult {
  const root = (payload ?? undefined) as EvolutionWebhookPayload | undefined;
  const data: EvolutionWebhookData | undefined = root?.data;
  const key = data?.key;

  // 1. Structural malformed check: message id and origin JID are mandatory.
  const externalMessageId = nonEmptyString(key?.id);
  const remoteJid = nonEmptyString(key?.remoteJid);
  if (externalMessageId === null || remoteJid === null) {
    return {
      rejected: true,
      reason: 'malformed',
      detail: 'missing externalMessageId or from (remoteJid)',
    };
  }

  // 2. Ignore messages the instance sent itself (Requirement 6.3).
  if (key?.fromMe === true) {
    return {
      rejected: true,
      reason: 'fromMe',
      detail: 'message was sent by the instance itself',
    };
  }

  // 3. Ignore group messages (Requirement 6.4).
  if (remoteJid.endsWith(GROUP_JID_SUFFIX)) {
    return {
      rejected: true,
      reason: 'group',
      detail: 'message originates from a WhatsApp group',
    };
  }

  // 4. Reject types outside {text, audio, image, document} (Requirement 6.5).
  const messageType = resolveMessageType(data as EvolutionWebhookData);
  if (messageType === null) {
    return {
      rejected: true,
      reason: 'unsupported_type',
      detail: `message type "${data?.messageType ?? 'unknown'}" is not supported`,
    };
  }

  // 5. Content malformed check (Requirement 6.2). Media types always yield a
  //    deterministic non-empty placeholder so they are never rejected here.
  const content = extractContent(data?.message, messageType);
  if (content === null) {
    return {
      rejected: true,
      reason: 'malformed',
      detail: 'missing content',
    };
  }

  return {
    channel: 'whatsapp',
    instance: nonEmptyString(root?.instance),
    externalMessageId,
    from: jidToFrom(remoteJid),
    to: null,
    contactName: nonEmptyString(data?.pushName),
    content,
    messageType,
    timestamp: resolveTimestamp(data?.messageTimestamp),
    rawPayload: payload,
  };
}
