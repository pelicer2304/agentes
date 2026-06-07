/**
 * Type definitions for the Evolution API integration.
 *
 * This module declares:
 *  - The raw Evolution webhook payload shapes (as received from Evolution_API).
 *  - The `EvolutionResult<T>` discriminated union returned by `EvolutionService`
 *    so failures never leak the `EVOLUTION_API_KEY`.
 *  - `InstanceStatus` and `ConnectResult` describing instance state operations.
 *
 * These types are intentionally permissive about fields Evolution_API may or may
 * not include; the `evolution-normalizer` is responsible for validating and
 * extracting a normalized `InboundMessage` from a raw payload.
 */

// ---------------------------------------------------------------------------
// Raw Evolution webhook payload types
// ---------------------------------------------------------------------------

/**
 * The message key block carried by an Evolution webhook event.
 * Identifies the message and its origin chat.
 */
export interface EvolutionMessageKey {
  /** Channel-native message id (becomes `externalMessageId`). */
  id?: string;
  /** Origin JID; group JIDs end with `@g.us`. Becomes `from`/`externalChatId`. */
  remoteJid?: string;
  /** True when the message was sent by the connected instance itself. */
  fromMe?: boolean;
  /** Sender participant JID for group messages, when present. */
  participant?: string;
}

/**
 * The textual content variants Evolution may use for a text message.
 */
export interface EvolutionTextContent {
  /** Simple text message body. */
  conversation?: string;
  /** Extended text message (links, replies, etc.). */
  extendedTextMessage?: {
    text?: string;
  };
}

/**
 * Media content blocks. Only metadata/captions are relevant for normalization;
 * binary media is not downloaded here.
 */
export interface EvolutionMediaContent {
  audioMessage?: {
    url?: string;
    mimetype?: string;
  };
  imageMessage?: {
    url?: string;
    mimetype?: string;
    caption?: string;
  };
  documentMessage?: {
    url?: string;
    mimetype?: string;
    fileName?: string;
    caption?: string;
  };
}

/**
 * The `message` object of an Evolution webhook event. A union of text and media
 * content blocks; any of them may be present depending on `messageType`.
 */
export type EvolutionMessageContent = EvolutionTextContent & EvolutionMediaContent;

/**
 * The `data` block of an Evolution webhook event.
 */
export interface EvolutionWebhookData {
  /** Message key (id, remoteJid, fromMe). */
  key?: EvolutionMessageKey;
  /** Sender display name. */
  pushName?: string;
  /** The message content (text or media blocks). */
  message?: EvolutionMessageContent;
  /** Evolution's message type discriminator (e.g. `conversation`, `imageMessage`). */
  messageType?: string;
  /** Unix epoch (seconds) the message was sent, when provided. */
  messageTimestamp?: number | string;
}

/**
 * A raw Evolution_API webhook payload as delivered to `POST /webhooks/evolution`.
 */
export interface EvolutionWebhookPayload {
  /** The Evolution event name (e.g. `messages.upsert`). */
  event?: string;
  /** The instance name that received the event. */
  instance?: string;
  /** The event data. */
  data?: EvolutionWebhookData;
  /** Optional destination/server URL echoed by Evolution. */
  destination?: string;
  /** Optional sender (server) field echoed by Evolution. */
  sender?: string;
  /** Date/time the event was emitted, when provided. */
  date_time?: string;
}

// ---------------------------------------------------------------------------
// Service result union
// ---------------------------------------------------------------------------

/**
 * Discriminated result returned by every `EvolutionService` operation.
 *
 * On failure, `error` is a human-readable message with the `EVOLUTION_API_KEY`
 * scrubbed to `***`, so results are always safe to log or return.
 */
export type EvolutionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Instance status / connect operations
// ---------------------------------------------------------------------------

/**
 * Evolution instance connection states surfaced to callers.
 * `open` indicates the WhatsApp session is connected.
 */
export type EvolutionConnectionState =
  | 'open'
  | 'connecting'
  | 'close'
  | 'closed'
  | 'unknown';

/**
 * Snapshot of an Evolution instance's connection state.
 */
export interface InstanceStatus {
  /** The Evolution instance name. */
  instanceName: string;
  /** The current connection state of the instance. */
  state: EvolutionConnectionState;
  /** Whether the instance is connected (`state === 'open'`). */
  connected: boolean;
  /** The connected WhatsApp number, when available. */
  connectedNumber: string | null;
}

/**
 * Result of a connect/reconnect request. When the instance requires pairing,
 * a QR code (base64 and/or pairing code) is returned.
 */
export interface ConnectResult {
  /** The current connection state after the connect attempt. */
  state: EvolutionConnectionState;
  /** Base64-encoded QR image for pairing; null when not applicable. */
  qrCodeBase64: string | null;
  /** Short pairing code for pairing; null when not applicable. */
  pairingCode: string | null;
}
