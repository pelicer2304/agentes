import { EvolutionChannelAdapter } from './evolution-channel.adapter';
import { EvolutionService } from './evolution.service';
import type { EvolutionResult } from './evolution.types';

/**
 * Minimal EvolutionService stub: only `sendTextMessage` is exercised here.
 */
function createServiceStub(
  result: EvolutionResult<{ externalMessageId: string }>,
): { service: EvolutionService; calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  const service = {
    sendTextMessage: jest.fn(async (to: string, text: string) => {
      calls.push([to, text]);
      return result;
    }),
  } as unknown as EvolutionService;
  return { service, calls };
}

describe('EvolutionChannelAdapter', () => {
  it('handles the whatsapp channel', () => {
    const { service } = createServiceStub({
      ok: true,
      data: { externalMessageId: 'm1' },
    });
    const adapter = new EvolutionChannelAdapter(service);
    expect(adapter.channel).toBe('whatsapp');
  });

  describe('sendMessage', () => {
    it('delegates to EvolutionService.sendTextMessage with to/content', async () => {
      const { service, calls } = createServiceStub({
        ok: true,
        data: { externalMessageId: 'm1' },
      });
      const adapter = new EvolutionChannelAdapter(service);

      await adapter.sendMessage({ to: '5511999999999', content: 'hello' });

      expect(calls).toEqual([['5511999999999', 'hello']]);
    });

    it('throws when the send result is a failure', async () => {
      const { service } = createServiceStub({
        ok: false,
        error: 'Evolution API request failed',
      });
      const adapter = new EvolutionChannelAdapter(service);

      await expect(
        adapter.sendMessage({ to: '5511999999999', content: 'hello' }),
      ).rejects.toThrow('Evolution API request failed');
    });
  });

  describe('normalizeInbound', () => {
    it('returns a normalized InboundMessage for a valid text payload', async () => {
      const { service } = createServiceStub({
        ok: true,
        data: { externalMessageId: 'm1' },
      });
      const adapter = new EvolutionChannelAdapter(service);

      const payload = {
        event: 'messages.upsert',
        instance: 'inst-1',
        data: {
          key: {
            id: 'ABC123',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: false,
          },
          pushName: 'Alice',
          message: { conversation: 'oi' },
          messageType: 'conversation',
          messageTimestamp: 1700000000,
        },
      };

      const result = await adapter.normalizeInbound(payload);

      expect(result.channel).toBe('whatsapp');
      expect(result.externalMessageId).toBe('ABC123');
      expect(result.from).toBe('5511999999999');
      expect(result.content).toBe('oi');
      expect(result.messageType).toBe('text');
    });

    it('throws when the payload is rejected by the normalizer', async () => {
      const { service } = createServiceStub({
        ok: true,
        data: { externalMessageId: 'm1' },
      });
      const adapter = new EvolutionChannelAdapter(service);

      // fromMe payload is rejected by the normalizer.
      const payload = {
        data: {
          key: {
            id: 'ABC123',
            remoteJid: '5511999999999@s.whatsapp.net',
            fromMe: true,
          },
          message: { conversation: 'oi' },
          messageType: 'conversation',
        },
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        /rejected \(fromMe\)/,
      );
    });
  });
});
