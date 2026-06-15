import { Logger } from '@nestjs/common';

import { FollowUpService } from './followup.service';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import { ReengagementMessageComposer } from './reengagement-message.composer';
import { FOLLOW_UP_EVENT_TYPES } from './followup.constants';

/**
 * Testes de EXEMPLO/ERRO do FollowUpService (Tarefa 8.7).
 *
 * Cobrem exclusivamente os caminhos de FALHA da orquestração, com mocks de
 * borda (PrismaService, FollowUpSender, FollowUpEventRecorder, AppConfigService)
 * e as implementações REAIS e puras de elegibilidade e composição — assim os
 * testes isolam o comportamento de erro sem depender de I/O nem de tempo de
 * parede. O serviço é instanciado manualmente com os mocks.
 *
 * Requisitos exercitados: R1.8 (retry de agendamento esgotado), R2.5
 * (reavaliação indisponível), R2.6/R3.5 (falha de persistência do
 * cancelamento), R6.5 (falha ao registrar o encerramento) e R9.5 (esgotamento
 * de tentativas adiadas).
 */
describe('FollowUpService (exemplo/erro)', () => {
  const NOW = new Date('2024-05-01T12:00:00.000Z');
  const ANCHOR = new Date('2024-05-01T00:00:00.000Z');

  let prisma: {
    followUpSchedule: {
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      upsert: jest.Mock;
    };
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    agentSettings: { findFirst: jest.Mock };
  };
  let sender: { send: jest.Mock };
  let recorder: { record: jest.Mock };
  let config: {
    followUpLevel1Hours: number;
    followUpLevel2Hours: number;
    followUpLevel3Hours: number;
    followUpCompletionWindowHours: number;
    followUpRetryBackoffSeconds: number;
    followUpMaxDeferrals: number;
    followUpSendWindowParsed: {
      startHour: number;
      startMinute: number;
      endHour: number;
      endMinute: number;
    };
  };
  let service: FollowUpService;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  /** Schedule ativo padrão com o Nível 1 pendente. */
  const baseSchedule = () => ({
    id: 'sched-1',
    conversationId: 'conv-1',
    leadId: 'lead-1',
    cycleState: 'active',
    inactivityAnchor: ANCHOR,
    maxSentLevel: 0,
    pendingLevel: 1,
    nextRunAt: new Date('2024-05-01T01:00:00.000Z'),
    level3FiredAt: null,
    deferredAttempts: 0,
    lockedUntil: null,
    lastError: null,
  });

  /** Conversation+Lead elegível (snapshot lido no instante do disparo). */
  const eligibleConversation = () => ({
    id: 'conv-1',
    instanceName: 'inst-1',
    leadId: 'lead-1',
    stage: 'descoberta',
    status: 'active',
    botPaused: false,
    assignedTo: null,
    handoffAccepted: false,
    handoffCompleted: false,
    handoffRequired: false,
    lead: {
      id: 'lead-1',
      status: 'qualificando',
      segment: 'restaurante',
      mainPain: 'falta de clientes',
      phone: '5511999999999',
    },
  });

  beforeEach(() => {
    prisma = {
      followUpSchedule: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        upsert: jest.fn(),
      },
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      agentSettings: { findFirst: jest.fn() },
    };
    sender = { send: jest.fn() };
    recorder = { record: jest.fn().mockResolvedValue(undefined) };
    config = {
      followUpLevel1Hours: 1,
      followUpLevel2Hours: 24,
      followUpLevel3Hours: 48,
      followUpCompletionWindowHours: 24,
      followUpRetryBackoffSeconds: 60,
      followUpMaxDeferrals: 3,
      followUpSendWindowParsed: {
        startHour: 8,
        startMinute: 0,
        endHour: 20,
        endMinute: 0,
      },
    };

    service = new FollowUpService(
      prisma as never,
      new FollowUpEligibilityService(),
      new ReengagementMessageComposer(),
      sender as never,
      recorder as never,
      config as never,
    );

    // Silencia o logging de erro/aviso esperado nos caminhos de falha.
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    jest.clearAllMocks();
  });

  /** Recupera as chamadas de recorder.record por tipo de evento. */
  const recordCallsOfType = (type: string) =>
    recorder.record.mock.calls.filter((call) => call[0].type === type);

  // ---------------------------------------------------------------------------
  // R1.8 — retry de agendamento do próximo nível esgotado
  // ---------------------------------------------------------------------------
  describe('processDue — falha repetida ao agendar o próximo nível (R1.8)', () => {
    it('após esgotar as 3 tentativas, registra followup_error (schedule_failed) e limpa o nível pendente', async () => {
      prisma.followUpSchedule.findUnique.mockResolvedValue(baseSchedule());
      prisma.conversation.findUnique.mockResolvedValue(eligibleConversation());
      prisma.agentSettings.findFirst.mockResolvedValue({ agentName: 'Bot' });

      // Marcação atômica do nível 1 como enviado: sucesso.
      prisma.followUpSchedule.updateMany.mockResolvedValue({ count: 1 });
      // Atualização do lastOutboundAt da conversa: sucesso.
      prisma.conversation.update.mockResolvedValue({});
      // Envio confirmado pelo Evolution.
      sender.send.mockResolvedValue({ status: 'sent', sentAt: NOW });

      // persistScheduleNext falha nas 3 tentativas; o safeUpdate final (4ª
      // chamada de update) limpa o nível pendente com sucesso.
      const dbError = new Error('db unavailable');
      prisma.followUpSchedule.update
        .mockRejectedValueOnce(dbError)
        .mockRejectedValueOnce(dbError)
        .mockRejectedValueOnce(dbError)
        .mockResolvedValue({});

      await service.processDue('sched-1', NOW);

      // Enviou o nível atual exatamente uma vez.
      expect(sender.send).toHaveBeenCalledTimes(1);
      // Marcou o nível como enviado (idempotência atômica).
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledTimes(1);
      // 3 tentativas de agendamento + 1 safeUpdate de limpeza = 4 chamadas.
      expect(prisma.followUpSchedule.update).toHaveBeenCalledTimes(4);

      // Registrou o erro de agendamento com o motivo correto.
      const errorEvents = recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0][0]).toMatchObject({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId: 'conv-1',
        leadId: 'lead-1',
        reason: 'schedule_failed',
      });

      // O nível não fica pendente para re-disparo (safeUpdate com pendingLevel null).
      const lastUpdate = prisma.followUpSchedule.update.mock.calls[3][0];
      expect(lastUpdate.data.pendingLevel).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // R2.5 — reavaliação indisponível no instante do disparo
  // ---------------------------------------------------------------------------
  describe('processDue — reavaliação indisponível no disparo (R2.5)', () => {
    it('suprime o envio, mantém o nível pendente e registra followup_error (reevaluation_failed) quando a leitura lança', async () => {
      prisma.followUpSchedule.findUnique.mockResolvedValue(baseSchedule());
      prisma.conversation.findUnique.mockRejectedValue(
        new Error('snapshot read failed'),
      );

      await service.processDue('sched-1', NOW);

      // Não envia (envio suprimido).
      expect(sender.send).not.toHaveBeenCalled();
      // Não altera o estado do schedule (nível preservado como pendente).
      expect(prisma.followUpSchedule.update).not.toHaveBeenCalled();
      expect(prisma.followUpSchedule.updateMany).not.toHaveBeenCalled();

      // Registra exatamente um followup_error com reevaluation_failed.
      const errorEvents = recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0][0]).toMatchObject({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId: 'conv-1',
        leadId: 'lead-1',
        level: 1,
        reason: 'reevaluation_failed',
      });
    });

    it('trata snapshot ausente (conversa/lead nulo) como falha de reavaliação', async () => {
      prisma.followUpSchedule.findUnique.mockResolvedValue(baseSchedule());
      prisma.conversation.findUnique.mockResolvedValue(null);

      await service.processDue('sched-1', NOW);

      expect(sender.send).not.toHaveBeenCalled();
      expect(prisma.followUpSchedule.update).not.toHaveBeenCalled();

      const errorEvents = recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0][0]).toMatchObject({ reason: 'reevaluation_failed' });
    });
  });

  // ---------------------------------------------------------------------------
  // R2.6 / R3.5 — falha de persistência do cancelamento
  // ---------------------------------------------------------------------------
  describe('cancelamento com falha de persistência (R2.6 / R3.5)', () => {
    it('R2.6: inelegível no disparo e update do cancelamento falha → preserva pendente e registra followup_error, sem followup_cancelled', async () => {
      prisma.followUpSchedule.findUnique.mockResolvedValue(baseSchedule());
      // Conversa tornou-se inelegível (handoff: bot pausado) no instante do disparo.
      const conv = eligibleConversation();
      conv.botPaused = true;
      prisma.conversation.findUnique.mockResolvedValue(conv);
      // A persistência do cancelamento falha.
      prisma.followUpSchedule.update.mockRejectedValue(new Error('db down'));

      await expect(service.processDue('sched-1', NOW)).resolves.toBeUndefined();

      // Suprime o envio.
      expect(sender.send).not.toHaveBeenCalled();
      // Tentou cancelar (preserva pendente porque a escrita falhou).
      expect(prisma.followUpSchedule.update).toHaveBeenCalledTimes(1);
      // Registra erro e NÃO registra cancelamento.
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR)).toHaveLength(1);
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.CANCELLED)).toHaveLength(0);
    });

    it('R3.5: inbound cancela mas updateMany falha → preserva pendente e registra followup_error, sem followup_cancelled', async () => {
      prisma.followUpSchedule.findUnique.mockResolvedValue(baseSchedule());
      prisma.followUpSchedule.updateMany.mockRejectedValue(
        new Error('cancel persistence failed'),
      );

      await expect(
        service.onInboundReceived('conv-1', NOW),
      ).resolves.toBeUndefined();

      // Tentou cancelar atomicamente (pendente preservado pois a escrita falhou).
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledTimes(1);
      // Não reagenda nem reinicia o ciclo.
      expect(prisma.followUpSchedule.update).not.toHaveBeenCalled();
      // Registra followup_error e NÃO registra followup_cancelled.
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR)).toHaveLength(1);
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.CANCELLED)).toHaveLength(0);
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR)[0][0]).toMatchObject(
        {
          conversationId: 'conv-1',
          leadId: 'lead-1',
        },
      );
    });
  });

  // ---------------------------------------------------------------------------
  // R6.5 — falha ao registrar o encerramento
  // ---------------------------------------------------------------------------
  describe('completeIfExhausted — falha ao registrar o encerramento (R6.5)', () => {
    it('preserva o estado completed mesmo se o registro do followup_completed falhar', async () => {
      const level3FiredAt = new Date('2024-04-29T12:00:00.000Z'); // > 24h antes de NOW
      prisma.followUpSchedule.findUnique.mockResolvedValue({
        ...baseSchedule(),
        maxSentLevel: 3,
        pendingLevel: null,
        level3FiredAt,
      });
      // Sem inbound após o disparo do Nível 3.
      prisma.conversation.findUnique.mockResolvedValue({ lastInboundAt: null });
      // O encerramento é persistido com sucesso ANTES do registro do evento.
      prisma.followUpSchedule.update.mockResolvedValue({});
      // O registro do encerramento falha (caso extremo além da degradação do recorder).
      recorder.record.mockRejectedValue(new Error('record completed failed'));

      // Não deve impedir a persistência do estado completed.
      await service.completeIfExhausted('sched-1', NOW).catch(() => undefined);

      // O ciclo foi marcado como completed (estado preservado).
      expect(prisma.followUpSchedule.update).toHaveBeenCalledTimes(1);
      const updateData = prisma.followUpSchedule.update.mock.calls[0][0].data;
      expect(updateData.cycleState).toBe('completed');
      expect(updateData.pendingLevel).toBeNull();
      // Tentou registrar o encerramento.
      expect(recordCallsOfType(FOLLOW_UP_EVENT_TYPES.COMPLETED)).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // R9.5 — esgotamento das tentativas adiadas
  // ---------------------------------------------------------------------------
  describe('processDue — esgotamento das tentativas adiadas (R9.5)', () => {
    it('ao atingir followUpMaxDeferrals, registra followup_error e interrompe o nível (pendingLevel = null)', async () => {
      // deferredAttempts = 2; +1 = 3 = followUpMaxDeferrals → esgotado.
      prisma.followUpSchedule.findUnique.mockResolvedValue({
        ...baseSchedule(),
        deferredAttempts: 2,
      });
      prisma.conversation.findUnique.mockResolvedValue(eligibleConversation());
      prisma.agentSettings.findFirst.mockResolvedValue({ agentName: 'Bot' });
      prisma.followUpSchedule.update.mockResolvedValue({});
      // Envio adiado (rate-limited) atingindo o teto de adiamentos.
      sender.send.mockResolvedValue({ status: 'deferred', reason: 'rate_limited' });

      await service.processDue('sched-1', NOW);

      // Tentou enviar uma vez (adiado).
      expect(sender.send).toHaveBeenCalledTimes(1);
      // Não marcou o nível como enviado.
      expect(prisma.followUpSchedule.updateMany).not.toHaveBeenCalled();

      // Registrou followup_error de esgotamento.
      const errorEvents = recordCallsOfType(FOLLOW_UP_EVENT_TYPES.ERROR);
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0][0]).toMatchObject({
        type: FOLLOW_UP_EVENT_TYPES.ERROR,
        conversationId: 'conv-1',
        leadId: 'lead-1',
        level: 1,
      });

      // Interrompeu o nível: pendingLevel = null no update final.
      expect(prisma.followUpSchedule.update).toHaveBeenCalledTimes(1);
      const updateData = prisma.followUpSchedule.update.mock.calls[0][0].data;
      expect(updateData.pendingLevel).toBeNull();
      expect(updateData.deferredAttempts).toBe(3);
    });
  });
});
