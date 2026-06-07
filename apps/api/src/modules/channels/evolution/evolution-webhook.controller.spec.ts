import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import type {
  InboundMessageProcessor,
  ProcessOutcome,
} from '../../../inbound/inbound-message.processor';
import type { AppConfigService } from '../../../config/config.service';

/**
 * Unit tests for the EvolutionWebhookController body handling.
 *
 * Focus: a routine non-message Evolution event (no `data`, or `data` as an
 * array — e.g. delivery/status updates, presence) must NOT produce a client
 * error. The global exception filter maps BadRequestException to HTTP 422,
 * which Evolution treats as a non-recoverable delivery and then cancels
 * retries. So these events must be accepted and ignored (HTTP 200) by handing
 * them to the processor, whose normalizer classifies and rejects them as 200.
 */
describe('EvolutionWebhookController — body tolerance', () => {
  function makeController(
    processOutcome: ProcessOutcome = { httpStatus: 200, action: 'ignored' },
  ) {
    const process = jest.fn().mockResolvedValue(processOutcome);
    const processor = { process } as unknown as InboundMessageProcessor;
    // No configured secret → secret validation is skipped.
    const config = { evolutionWebhookSecret: null } as unknown as AppConfigService;
    const controller = new EvolutionWebhookController(processor, config);
    return { controller, process };
  }

  function resStub() {
    const status = jest.fn();
    return { res: { status } as unknown as Response, status };
  }

  it('accepts an event with array-shaped `data` and ignores it with 200', async () => {
    const { controller, process } = makeController();
    const { res, status } = resStub();

    // messages.update / contacts.update style: `data` is an array.
    const body = { event: 'messages.update', instance: 'inst', data: [{ a: 1 }] };

    const result = await controller.receive({}, body, res);

    // Delegated to the processor (no throw), and no 400/422 override.
    expect(process).toHaveBeenCalledWith(body);
    expect(status).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'ignored' });
  });

  it('accepts an object event with no `data` envelope and ignores it with 200', async () => {
    const { controller, process } = makeController();
    const { res, status } = resStub();

    const body = { event: 'presence.update', instance: 'inst' };

    const result = await controller.receive({}, body, res);

    expect(process).toHaveBeenCalledWith(body);
    expect(status).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'ignored' });
  });

  it('processes a real inbound message event and returns the processor action', async () => {
    const { controller, process } = makeController({ httpStatus: 200, action: 'replied' });
    const { res, status } = resStub();

    const body = {
      event: 'messages.upsert',
      instance: 'inst',
      data: {
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'MSG1' },
        message: { conversation: '/clear' },
        messageType: 'conversation',
        messageTimestamp: 1780867515,
      },
    };

    const result = await controller.receive({}, body, res);

    expect(process).toHaveBeenCalledWith(body);
    expect(status).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'replied' });
  });

  it('still rejects a non-object body with 400 (true transport error)', async () => {
    const { controller, process } = makeController();
    const { res } = resStub();

    await expect(controller.receive({}, 'not-json', res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(process).not.toHaveBeenCalled();
  });

  it('still rejects a null body with 400', async () => {
    const { controller, process } = makeController();
    const { res } = resStub();

    await expect(controller.receive({}, null, res)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(process).not.toHaveBeenCalled();
  });

  it('applies the processor 400 status override when the processor reports it', async () => {
    const { controller } = makeController({ httpStatus: 400, action: 'error' });
    const { res, status } = resStub();

    const body = { event: 'messages.upsert', instance: 'inst', data: { key: {} } };
    await controller.receive({}, body, res);

    expect(status).toHaveBeenCalledWith(400);
  });

  it('rejects with 401 when a configured secret is missing/mismatched', async () => {
    const process = jest.fn().mockResolvedValue({ httpStatus: 200, action: 'ignored' });
    const processor = { process } as unknown as InboundMessageProcessor;
    const config = { evolutionWebhookSecret: 'expected-secret' } as unknown as AppConfigService;
    const controller = new EvolutionWebhookController(processor, config);
    const { res } = resStub();

    await expect(
      controller.receive({ apikey: 'wrong' }, { data: {} }, res),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(process).not.toHaveBeenCalled();
  });
});
