import { Reflector } from '@nestjs/core';
import { EvolutionAdminController } from './evolution-admin.controller';
import { EvolutionService } from './evolution.service';
import { ROLES_KEY } from '../../../auth/roles.decorator';
import { DEFAULT_TEST_MESSAGE } from './dto/send-test-message.dto';

describe('EvolutionAdminController', () => {
  let controller: EvolutionAdminController;
  let service: jest.Mocked<Pick<
    EvolutionService,
    'getInstanceStatus' | 'setWebhook' | 'sendTextMessage'
  >>;

  beforeEach(() => {
    service = {
      getInstanceStatus: jest.fn(),
      setWebhook: jest.fn(),
      sendTextMessage: jest.fn(),
    };
    controller = new EvolutionAdminController(
      service as unknown as EvolutionService,
    );
  });

  it('is restricted to the admin role at the controller level', () => {
    const roles = new Reflector().get(ROLES_KEY, EvolutionAdminController);
    expect(roles).toEqual(['admin']);
  });

  it('delegates GET status to EvolutionService.getInstanceStatus', async () => {
    const result = {
      ok: true as const,
      data: {
        instanceName: 'main',
        state: 'open' as const,
        connected: true,
        connectedNumber: '5511999999999',
      },
    };
    service.getInstanceStatus.mockResolvedValue(result);

    await expect(controller.getStatus()).resolves.toBe(result);
    expect(service.getInstanceStatus).toHaveBeenCalledTimes(1);
  });

  it('delegates set-webhook to EvolutionService.setWebhook', async () => {
    const result = { ok: true as const, data: undefined };
    service.setWebhook.mockResolvedValue(result);

    await expect(controller.setWebhook()).resolves.toBe(result);
    expect(service.setWebhook).toHaveBeenCalledTimes(1);
  });

  it('sends the provided text via EvolutionService.sendTextMessage', async () => {
    const result = { ok: true as const, data: { externalMessageId: 'm1' } };
    service.sendTextMessage.mockResolvedValue(result);

    await expect(
      controller.sendTestMessage({ to: '5511999999999', text: 'hello' }),
    ).resolves.toBe(result);
    expect(service.sendTextMessage).toHaveBeenCalledWith(
      '5511999999999',
      'hello',
    );
  });

  it('uses the default message when text is omitted', async () => {
    const result = { ok: true as const, data: { externalMessageId: 'm1' } };
    service.sendTextMessage.mockResolvedValue(result);

    await controller.sendTestMessage({ to: '5511999999999' });
    expect(service.sendTextMessage).toHaveBeenCalledWith(
      '5511999999999',
      DEFAULT_TEST_MESSAGE,
    );
  });

  it('returns the key-safe failure result unchanged', async () => {
    const result = { ok: false as const, error: 'boom' };
    service.sendTextMessage.mockResolvedValue(result);

    await expect(
      controller.sendTestMessage({ to: '5511999999999' }),
    ).resolves.toBe(result);
  });
});
