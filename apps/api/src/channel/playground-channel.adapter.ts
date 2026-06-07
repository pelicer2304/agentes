import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelAdapter,
  ChannelName,
  InboundMessage,
  SendMessageParams,
} from './channel-adapter.interface';

/**
 * Playground channel adapter for the web-based chat simulation.
 *
 * - sendMessage is a no-op because playground messages are returned
 *   directly via the HTTP response (synchronous request/response flow).
 * - normalizeInbound parses the incoming HTTP request body into the
 *   normalized InboundMessage format, marking WhatsApp-only fields as null.
 */
@Injectable()
export class PlaygroundChannelAdapter implements ChannelAdapter {
  private readonly logger = new Logger(PlaygroundChannelAdapter.name);

  /** The channel this adapter handles. */
  readonly channel: ChannelName = 'playground';

  /**
   * In the playground channel, outbound messages are returned directly
   * in the HTTP response. This method is a no-op but logs for traceability.
   * If an error occurs, it logs the error and returns without crashing.
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    try {
      this.logger.debug(
        `Playground sendMessage (no-op): to=${params.to}, content length=${params.content.length}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send message to ${params?.to ?? 'unknown'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Parses the inbound playground request payload into a normalized
   * InboundMessage. Expects a payload with conversationId, content, and
   * senderIdentifier fields. WhatsApp-only fields are set to null.
   */
  async normalizeInbound(payload: unknown): Promise<InboundMessage> {
    const data = payload as Record<string, unknown>;

    if (!data || typeof data !== 'object') {
      throw new Error('Invalid payload: expected an object');
    }

    const conversationId = data.conversationId;
    const content = data.content;
    const senderIdentifier = data.senderIdentifier;

    if (typeof conversationId !== 'string' || !conversationId) {
      throw new Error(
        'Invalid payload: conversationId is required and must be a non-empty string',
      );
    }

    if (typeof content !== 'string' || !content) {
      throw new Error(
        'Invalid payload: content is required and must be a non-empty string',
      );
    }

    if (typeof senderIdentifier !== 'string' || !senderIdentifier) {
      throw new Error(
        'Invalid payload: senderIdentifier is required and must be a non-empty string',
      );
    }

    return {
      channel: 'playground',
      instance: null,
      externalMessageId: null,
      from: senderIdentifier,
      to: null,
      contactName: null,
      content,
      messageType: 'text',
      timestamp: new Date(),
      rawPayload: payload,
    };
  }
}
