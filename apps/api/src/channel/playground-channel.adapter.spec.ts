import { PlaygroundChannelAdapter } from './playground-channel.adapter';

describe('PlaygroundChannelAdapter', () => {
  let adapter: PlaygroundChannelAdapter;

  beforeEach(() => {
    adapter = new PlaygroundChannelAdapter();
  });

  it('should expose channel "playground"', () => {
    expect(adapter.channel).toBe('playground');
  });

  describe('sendMessage', () => {
    it('should complete without throwing (no-op)', async () => {
      await expect(
        adapter.sendMessage({ to: 'conv-123', content: 'Hello' }),
      ).resolves.toBeUndefined();
    });

    it('should not crash even if internal logging fails', async () => {
      // sendMessage should never throw regardless of internal errors
      await expect(
        adapter.sendMessage({ to: '', content: '' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('normalizeInbound', () => {
    it('should parse a valid payload into InboundMessage', async () => {
      const payload = {
        conversationId: 'conv-123',
        content: 'Hello, I need help',
        senderIdentifier: 'session-abc',
      };

      const result = await adapter.normalizeInbound(payload);

      expect(result).toEqual({
        channel: 'playground',
        instance: null,
        externalMessageId: null,
        from: 'session-abc',
        to: null,
        contactName: null,
        content: 'Hello, I need help',
        messageType: 'text',
        timestamp: expect.any(Date),
        rawPayload: payload,
      });
    });

    it('should preserve the raw payload', async () => {
      const payload = {
        conversationId: 'conv-456',
        content: 'Test message',
        senderIdentifier: 'session-xyz',
        metadata: { source: 'web', timestamp: 1234567890 },
      };

      const result = await adapter.normalizeInbound(payload);

      expect(result.rawPayload).toBe(payload);
      expect(result.from).toBe('session-xyz');
      expect(result.content).toBe('Test message');
    });

    it('should throw if payload is null', async () => {
      await expect(adapter.normalizeInbound(null)).rejects.toThrow(
        'Invalid payload: expected an object',
      );
    });

    it('should throw if payload is not an object', async () => {
      await expect(adapter.normalizeInbound('string')).rejects.toThrow(
        'Invalid payload: expected an object',
      );
    });

    it('should throw if conversationId is missing', async () => {
      const payload = {
        content: 'Hello',
        senderIdentifier: 'session-abc',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: conversationId is required',
      );
    });

    it('should throw if conversationId is empty string', async () => {
      const payload = {
        conversationId: '',
        content: 'Hello',
        senderIdentifier: 'session-abc',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: conversationId is required',
      );
    });

    it('should throw if content is missing', async () => {
      const payload = {
        conversationId: 'conv-123',
        senderIdentifier: 'session-abc',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: content is required',
      );
    });

    it('should throw if content is empty string', async () => {
      const payload = {
        conversationId: 'conv-123',
        content: '',
        senderIdentifier: 'session-abc',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: content is required',
      );
    });

    it('should throw if senderIdentifier is missing', async () => {
      const payload = {
        conversationId: 'conv-123',
        content: 'Hello',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: senderIdentifier is required',
      );
    });

    it('should throw if senderIdentifier is empty string', async () => {
      const payload = {
        conversationId: 'conv-123',
        content: 'Hello',
        senderIdentifier: '',
      };

      await expect(adapter.normalizeInbound(payload)).rejects.toThrow(
        'Invalid payload: senderIdentifier is required',
      );
    });
  });
});
