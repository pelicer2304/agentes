import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';

import { FollowUpEventRecorder } from './followup-event.recorder';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Testes de exemplo/erro do FollowUpEventRecorder (R8.4 retry, R8.5 degradação
 * graciosa). O PrismaService é mocado — em particular `prisma.botEvent.create` —
 * para simular sucesso e falhas de persistência.
 */
describe('FollowUpEventRecorder', () => {
  let recorder: FollowUpEventRecorder;

  const mockPrismaService = {
    botEvent: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowUpEventRecorder,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    recorder = module.get<FollowUpEventRecorder>(FollowUpEventRecorder);
  });

  describe('record - sucesso na primeira tentativa', () => {
    it('grava o evento uma única vez com type, conversationId, leadId e payload completo', async () => {
      mockPrismaService.botEvent.create.mockResolvedValueOnce({ id: 'evt-1' });

      const occurredAt = new Date('2024-05-01T13:45:30.123Z');

      await recorder.record({
        type: 'followup_cancelled',
        conversationId: 'conv-1',
        leadId: 'lead-1',
        level: 2,
        reason: 'resposta_do_lead',
        occurredAt,
      });

      expect(mockPrismaService.botEvent.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.botEvent.create).toHaveBeenCalledWith({
        data: {
          type: 'followup_cancelled',
          conversationId: 'conv-1',
          leadId: 'lead-1',
          payload: {
            occurredAt: '2024-05-01T13:45:30.123Z',
            level: 2,
            reason: 'resposta_do_lead',
          },
        },
      });
    });

    it('inclui occurredAt em ISO-8601 com precisão de milissegundos', async () => {
      mockPrismaService.botEvent.create.mockResolvedValueOnce({ id: 'evt-2' });

      await recorder.record({
        type: 'followup_completed',
        conversationId: 'conv-2',
        leadId: 'lead-2',
        occurredAt: new Date('2024-12-31T23:59:59.987Z'),
      });

      const data = mockPrismaService.botEvent.create.mock.calls[0][0].data;
      expect(data.payload.occurredAt).toBe('2024-12-31T23:59:59.987Z');
      // ISO-8601 com milissegundos: termina em .NNNZ
      expect(data.payload.occurredAt).toMatch(/\.\d{3}Z$/);
    });

    it('omite level e reason do payload quando não fornecidos', async () => {
      mockPrismaService.botEvent.create.mockResolvedValueOnce({ id: 'evt-3' });

      await recorder.record({
        type: 'followup_completed',
        conversationId: 'conv-3',
        leadId: 'lead-3',
        occurredAt: new Date('2024-05-01T10:00:00.000Z'),
      });

      const data = mockPrismaService.botEvent.create.mock.calls[0][0].data;
      expect(data.payload).toEqual({ occurredAt: '2024-05-01T10:00:00.000Z' });
      expect(data.payload).not.toHaveProperty('level');
      expect(data.payload).not.toHaveProperty('reason');
    });
  });

  describe('record - retry após falhas iniciais (R8.4)', () => {
    it('reexecuta o create e tem sucesso na segunda tentativa, sem lançar', async () => {
      mockPrismaService.botEvent.create
        .mockRejectedValueOnce(new Error('transient db error'))
        .mockResolvedValueOnce({ id: 'evt-4' });

      await expect(
        recorder.record({
          type: 'followup_sent',
          conversationId: 'conv-4',
          leadId: 'lead-4',
          level: 1,
          occurredAt: new Date('2024-05-01T08:00:00.000Z'),
        }),
      ).resolves.toBeUndefined();

      expect(mockPrismaService.botEvent.create).toHaveBeenCalledTimes(2);
    });

    it('reexecuta o create e tem sucesso na terceira tentativa, sem lançar', async () => {
      mockPrismaService.botEvent.create
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValueOnce({ id: 'evt-5' });

      await expect(
        recorder.record({
          type: 'followup_sent',
          conversationId: 'conv-5',
          leadId: 'lead-5',
          level: 3,
          occurredAt: new Date('2024-05-01T09:00:00.000Z'),
        }),
      ).resolves.toBeUndefined();

      expect(mockPrismaService.botEvent.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('record - falha em todas as tentativas (R8.5)', () => {
    it('não lança, tenta 4 vezes (1 inicial + 3 adicionais) e loga o erro', async () => {
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      mockPrismaService.botEvent.create.mockRejectedValue(
        new Error('persistent db error'),
      );

      await expect(
        recorder.record({
          type: 'followup_error',
          conversationId: 'conv-6',
          leadId: 'lead-6',
          reason: 'evolution_error',
          occurredAt: new Date('2024-05-01T11:00:00.000Z'),
        }),
      ).resolves.toBeUndefined();

      // 1 tentativa inicial + 3 adicionais = 4 chamadas (R8.4).
      expect(mockPrismaService.botEvent.create).toHaveBeenCalledTimes(4);

      // O erro é logado com conversationId e tipo do evento (R8.5).
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logMessage = errorSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain('conv-6');
      expect(logMessage).toContain('followup_error');

      errorSpy.mockRestore();
    });
  });
});
