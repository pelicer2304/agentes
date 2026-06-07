/**
 * Identifies the transport channel an adapter handles.
 */
export type ChannelName = 'playground' | 'whatsapp';

/**
 * Parameters for sending an outbound message through a channel.
 */
export interface SendMessageParams {
  /** Recipient identifier: conversationId (playground) or phone (whatsapp). */
  to: string;
  /** The message content to send. */
  content: string;
  /** WhatsApp instance name (whatsapp only). */
  instanceName?: string;
  /** Originating conversation id, for logging/correlation. */
  conversationId?: string;
}

/**
 * Represents a normalized inbound message from any channel.
 */
export interface InboundMessage {
  /** The channel this message arrived on. */
  channel: ChannelName;
  /** Instance name for the channel; null for playground. */
  instance: string | null;
  /** Channel-native message id; null when unavailable. */
  externalMessageId: string | null;
  /** Sender identifier: phone (whatsapp) or senderIdentifier (playground). */
  from: string;
  /** Recipient identifier; null when not applicable. */
  to: string | null;
  /** Sender display name when provided by the channel. */
  contactName: string | null;
  /** The message content. */
  content: string;
  /** The kind of message payload. */
  messageType: 'text' | 'audio' | 'image' | 'document';
  /** When the message was received. */
  timestamp: Date;
  /** The raw inbound payload from the channel. */
  rawPayload: unknown;
}

/**
 * Channel adapter interface that abstracts the communication transport.
 * Concrete implementations handle channel-specific message routing
 * (e.g., playground HTTP responses, WhatsApp via Evolution API).
 */
export interface ChannelAdapter {
  /** The channel this adapter handles. */
  readonly channel: ChannelName;

  /**
   * Send a message to the client through this channel.
   * @param params - The recipient, content, and channel-specific options.
   */
  sendMessage(params: SendMessageParams): Promise<void>;

  /**
   * Parse an inbound payload into a normalized InboundMessage.
   * @param payload - The raw inbound payload from the channel.
   */
  normalizeInbound(payload: unknown): Promise<InboundMessage>;
}

/**
 * Injection token for the ChannelAdapterRegistry, which resolves a
 * ChannelAdapter by its ChannelName.
 */
export const CHANNEL_ADAPTER_REGISTRY = Symbol('CHANNEL_ADAPTER_REGISTRY');
