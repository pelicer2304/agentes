import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { FollowUpSender } from './followup-sender.service';
import { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import { RateLimiterService } from '../common/rate-limiter';
import { AppConfigService } from '../config/config.service';
import type { ChannelAdapter } from '../channel/channel-adapter.interface';

/**
 * Testes de integração do wiring do FollowUpSender com o ChannelAdapter do
 * WhatsApp (Evolution) — R9.1 (envio confirmado) e R9.4 (falha do Evolution).
 *
 * Aqui não usamos fast-check: são exemplos focados no contrato de wiring. As
 * dependências de borda são fakeadas:
 *  - ChannelAdapterRegistry.get('whatsapp') devolve um adapter cujo
 *    `sendMessage` é um jest.fn (resolve no caso de sucesso, rejeita no de
 *    falha), permitindo afirmar a contagem de chamadas e os parâmetros;
 *  - RateLimiterService.tryConsume sempre permite (token disponível);
 *  - AppConfigService expõe a janela 08:00-20:00 já analisada.
 *
 * O relógio é injetado via `now`. Escolhemos um instante claramente dentro da
 * janela considerando o fuso America/Sao_Paulo (UTC-3): 15:00Z corresponde a
 * 12:00 em São Paulo, no meio da janela 08:00-20:00.
 */
describe('FollowUpSender (integração com ChannelAdapter/Evolution)', () => {
  let sender: FollowUpSender;
  let sendMessageMock: jest.Mock;
  let whatsappAdapter: ChannelAdapter;
  let getAdapterMock: jest.Mock;

  // 15:00Z => 12:00 America/Sao_Paulo (UTC-3): meio da janela 08:00-20:00.
  const NOW_WITHIN_WINDOW = new Date('2024-05-01T15:00:00.000Z');

  const mockRateLimiter = {
    tryConsume: jest.fn().mockReturnValue(true),
  };

  const mockConfig = {
    followUpSendWindowParsed: {
      startHour: 8,
      startMinute: 0,
      endHour: 20,
      endMinute: 0,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    sendMessageMock = jest.fn();
    whatsappAdapter = {
      channel: 'whatsapp',
      sendMessage: sendMessageMock,
      normalizeInbound: jest.fn(),
    };
    getAdapterMock = jest.fn().mockReturnValue(whatsappAdapter);

    const mockRegistry = {
      get: getAdapterMock,
      has: jest.fn().mockReturnValue(true),
    };

    mockRateLimiter.tryConsume.mockReturnValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowUpSender,
        { provide: ChannelAdapterRegistry, useValue: mockRegistry },
        { provide: RateLimiterService, useValue: mockRateLimiter },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    sender = module.get<FollowUpSender>(FollowUpSender);
  });

  describe('caso de sucesso (R9.1) — dentro da janela e com token disponível', () => {
    it('invoca o adapter do WhatsApp exatamente uma vez com os parâmetros corretos e retorna sent com sentAt', async () => {
      sendMessageMock.mockResolvedValueOnce(undefined);

      const outcome = await sender.send({
        phone: '5511999999999',
        instanceName: 'minha-instancia',
        conversationId: 'conv-1',
        content: 'Olá! Ainda posso te ajudar?',
        now: NOW_WITHIN_WINDOW,
      });

      // Resolve o adapter do canal whatsapp.
      expect(getAdapterMock).toHaveBeenCalledWith('whatsapp');

      // sendMessage invocado EXATAMENTE uma vez.
      expect(sendMessageMock).toHaveBeenCalledTimes(1);

      // Parâmetros corretos: to=phone, content, instanceName, conversationId.
      expect(sendMessageMock).toHaveBeenCalledWith({
        to: '5511999999999',
        content: 'Olá! Ainda posso te ajudar?',
        instanceName: 'minha-instancia',
        conversationId: 'conv-1',
      });

      // Outcome sent com o sentAt igual ao instante do envio.
      expect(outcome).toEqual({ status: 'sent', sentAt: NOW_WITHIN_WINDOW });
    });

    it('repassa instanceName undefined quando a instância é null (usa o default do adapter)', async () => {
      sendMessageMock.mockResolvedValueOnce(undefined);

      const outcome = await sender.send({
        phone: '5511888888888',
        instanceName: null,
        conversationId: 'conv-2',
        content: 'Mensagem de reengajamento',
        now: NOW_WITHIN_WINDOW,
      });

      expect(sendMessageMock).toHaveBeenCalledTimes(1);
      expect(sendMessageMock).toHaveBeenCalledWith({
        to: '5511888888888',
        content: 'Mensagem de reengajamento',
        instanceName: undefined,
        conversationId: 'conv-2',
      });
      expect(outcome).toEqual({ status: 'sent', sentAt: NOW_WITHIN_WINDOW });
    });
  });

  describe('caso de falha do Evolution (R9.4) — adapter sendMessage rejeita', () => {
    it('retorna failed(evolution_error) e não marca o nível como enviado', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      sendMessageMock.mockRejectedValueOnce(new Error('evolution indisponível'));

      const outcome = await sender.send({
        phone: '5511777777777',
        instanceName: 'minha-instancia',
        conversationId: 'conv-3',
        content: 'Texto que falha no envio',
        now: NOW_WITHIN_WINDOW,
      });

      // Tentou enviar uma vez via adapter do WhatsApp.
      expect(sendMessageMock).toHaveBeenCalledTimes(1);

      // Outcome failed com motivo evolution_error; nenhum sentAt (nível não enviado).
      expect(outcome).toEqual({ status: 'failed', reason: 'evolution_error' });
      expect(outcome).not.toHaveProperty('sentAt');

      errorSpy.mockRestore();
    });
  });
});
