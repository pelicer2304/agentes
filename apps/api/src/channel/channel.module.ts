import { Module } from '@nestjs/common';
import { EvolutionChannelAdapter } from '../modules/channels/evolution/evolution-channel.adapter';
import { EvolutionModule } from '../modules/channels/evolution/evolution.module';
import { CHANNEL_ADAPTER_REGISTRY } from './channel-adapter.interface';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { PlaygroundChannelAdapter } from './playground-channel.adapter';

/**
 * Wires the channel transport layer.
 *
 * The {@link ChannelAdapterRegistry} resolves a {@link ChannelAdapter} by its
 * channel name. Adapters are supplied via the {@link CHANNEL_ADAPTER_REGISTRY}
 * token as an array, built by a factory. The Playground adapter is provided
 * here; the WhatsApp/Evolution adapter is contributed by the imported
 * {@link EvolutionModule} (which exports {@link EvolutionChannelAdapter}).
 *
 * Dependency direction is one-way: `ChannelModule -> EvolutionModule`. The
 * Evolution module never imports `ChannelModule`, so there is no cycle.
 */
@Module({
  imports: [EvolutionModule],
  providers: [
    PlaygroundChannelAdapter,
    {
      provide: CHANNEL_ADAPTER_REGISTRY,
      useFactory: (
        playground: PlaygroundChannelAdapter,
        evolution: EvolutionChannelAdapter,
      ) => [playground, evolution],
      inject: [PlaygroundChannelAdapter, EvolutionChannelAdapter],
    },
    ChannelAdapterRegistry,
  ],
  exports: [ChannelAdapterRegistry],
})
export class ChannelModule {}
