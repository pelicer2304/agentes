import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelAdapter,
  ChannelName,
  InboundMessage,
  SendMessageParams,
} from '../../../channel/channel-adapter.interface';
import { EvolutionService } from './evolution.service';
import {
  isNormalizationReject,
  normalizeInbound,
} from './evolution-normalizer';

/**
 * WhatsApp channel adapter backed by Evolution_API.
 *
 * Bridges the transport-agnostic {@link ChannelAdapter} interface to the
 * Evolution integration (Requirements 2.3, 2.4, 3.1, 3.2, 3.3, 6.1):
 *  - `sendMessage` delegates to {@link EvolutionService.sendTextMessage}.
 *  - `normalizeInbound` delegates to the pure `evolution-normalizer`.
 */
@Injectable()
export class EvolutionChannelAdapter implements ChannelAdapter {
  private readonly logger = new Logger(EvolutionChannelAdapter.name);

  /** The channel this adapter handles. */
  readonly channel: ChannelName = 'whatsapp';

  constructor(private readonly evolutionService: EvolutionService) {}

  /**
   * Send a text message to a WhatsApp recipient via Evolution_API.
   *
   * The {@link ChannelAdapter} contract returns `Promise<void>`, but
   * {@link EvolutionService.sendTextMessage} returns a non-throwing
   * {@link import('./evolution.types').EvolutionResult}. We translate a failed
   * result into a thrown error so the caller (e.g. the inbound processor) can
   * catch and handle send failures (Requirement 9.6). The thrown message is
   * already API-key-scrubbed by the service.
   *
   * @param params - Recipient (`to`) and message `content`.
   */
  async sendMessage(params: SendMessageParams): Promise<void> {
    const result = await this.evolutionService.sendTextMessage(
      params.to,
      params.content,
    );

    if (!result.ok) {
      this.logger.error(
        `Failed to send WhatsApp message to ${params.to}: ${result.error}`,
      );
      throw new Error(result.error);
    }
  }

  /**
   * Normalize a raw Evolution webhook payload into an {@link InboundMessage}.
   *
   * The pure normalizer returns `InboundMessage | NormalizationReject`, but the
   * {@link ChannelAdapter} contract returns `Promise<InboundMessage>`. The
   * orchestration/processor layer calls `normalizeInbound` from the normalizer
   * module directly so it can inspect rejections for filtering; this adapter
   * method exists for interface conformance and throws on a rejection.
   *
   * @param payload - The raw Evolution webhook payload.
   * @throws Error when the payload is filtered out (rejected) by the normalizer.
   */
  async normalizeInbound(payload: unknown): Promise<InboundMessage> {
    const result = normalizeInbound(payload);

    if (isNormalizationReject(result)) {
      throw new Error(
        `Inbound payload rejected (${result.reason}): ${result.detail}`,
      );
    }

    return result;
  }
}
