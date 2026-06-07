import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_ADAPTER_REGISTRY,
  ChannelAdapter,
  ChannelName,
} from './channel-adapter.interface';

/**
 * Resolves a {@link ChannelAdapter} by its {@link ChannelName}.
 *
 * Adapters are supplied as a list (via the {@link CHANNEL_ADAPTER_REGISTRY}
 * injection token) and indexed by their `channel` property so consumers can
 * resolve the correct transport without depending on a single adapter token.
 * This lets the Playground and WhatsApp adapters coexist behind one registry.
 */
@Injectable()
export class ChannelAdapterRegistry {
  private readonly adapters = new Map<ChannelName, ChannelAdapter>();

  constructor(
    @Inject(CHANNEL_ADAPTER_REGISTRY) adapters: ChannelAdapter[],
  ) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.channel)) {
        throw new Error(
          `Duplicate channel adapter registered for channel "${adapter.channel}"`,
        );
      }
      this.adapters.set(adapter.channel, adapter);
    }
  }

  /**
   * Resolve the adapter registered for the given channel.
   * @param channel - The channel to resolve an adapter for.
   * @throws Error when no adapter is registered for the channel.
   */
  get(channel: ChannelName): ChannelAdapter {
    const adapter = this.adapters.get(channel);
    if (!adapter) {
      throw new Error(`No channel adapter registered for channel "${channel}"`);
    }
    return adapter;
  }

  /**
   * Returns true when an adapter is registered for the given channel.
   */
  has(channel: ChannelName): boolean {
    return this.adapters.has(channel);
  }
}
