import { Test, TestingModule } from '@nestjs/testing';
import { EvolutionChannelAdapter } from '../modules/channels/evolution/evolution-channel.adapter';
import { ChannelModule } from './channel.module';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { PlaygroundChannelAdapter } from './playground-channel.adapter';

// The real (global) AppConfigModule is loaded transitively through
// ChannelModule -> EvolutionModule -> AuthModule -> AppConfigModule. Required
// environment variables are provided by test/jest-setup-env.ts so the config
// validation schema passes at import time.
describe('ChannelModule', () => {
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [ChannelModule],
    }).compile();
  });

  it('should provide the ChannelAdapterRegistry', () => {
    const registry = module.get<ChannelAdapterRegistry>(ChannelAdapterRegistry);
    expect(registry).toBeInstanceOf(ChannelAdapterRegistry);
  });

  it('should resolve the playground adapter from the registry', () => {
    const registry = module.get<ChannelAdapterRegistry>(ChannelAdapterRegistry);
    expect(registry.has('playground')).toBe(true);
    expect(registry.get('playground')).toBeInstanceOf(PlaygroundChannelAdapter);
  });

  it('should resolve the whatsapp adapter from the registry', () => {
    const registry = module.get<ChannelAdapterRegistry>(ChannelAdapterRegistry);
    expect(registry.has('whatsapp')).toBe(true);
    expect(registry.get('whatsapp')).toBeInstanceOf(EvolutionChannelAdapter);
  });
});
