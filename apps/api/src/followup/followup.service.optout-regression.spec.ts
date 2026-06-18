import { Logger } from '@nestjs/common';

import { FollowUpService } from './followup.service';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import { ReengagementMessageComposer } from './reengagement-message.composer';

/**
 * Testes de REGRESSÃO do bug de produção (feature lead-followup).
 *
 * SINTOMA: após o lead pedir opt-out (e o bot confirmar a baixa), o hook de
 * outbound do InboundMessageProcessor chamava `FollowUpService.ensureScheduled`,
 * cujo UPSERT reativava o ciclo em `cycleState='active', pendingLevel=1,
 * nextRunAt=now+1h`, SOBRESCREVENDO o estado `opted_out` (e, de forma análoga, o
 * estado `deferred` de um adiamento `nao_agora`).
 *
 * CORREÇÃO: `ensureScheduled` agora é defensivo — lê o schedule existente e
 * NÃO (re)agenda quando o ciclo está em `opted_out` (R12.2) ou em
 * `active && deferred` (R11), preservando o estado durável. O caso normal
 * (`active` sem `deferred`) continua (re)agendando o Nível 1.
 */
describe('FollowUpService.ensureScheduled — regressão opt-out / deferred', () => {
  const LAST_OUTBOUND = new Date('2024-05-01T12:00:00.000Z');

  let prisma: {
    followUpSchedule: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    conversation: { findUnique: jest.Mock };
  };
  let service: FollowUpService;
  let errorSpy: jest.SpyInstance;

  const config = {
    followUpLevel1Hours: 1,
    followUpLevel2Hours: 24,
    followUpLevel3Hours: 48,
  };

  beforeEach(() => {
    prisma = {
      followUpSchedule: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
      conversation: { findUnique: jest.fn() },
    };

    service = new FollowUpService(
      prisma as never,
      new FollowUpEligibilityService(),
      new ReengagementMessageComposer(),
      { send: jest.fn() } as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      config as never,
    );

    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // (a) Caso EXATO do bug: opt-out não pode ser ressuscitado por ensureScheduled
  // ---------------------------------------------------------------------------
  it('NÃO reativa o ciclo quando a conversa está opted_out (R12.2)', async () => {
    prisma.followUpSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
      cycleState: 'opted_out',
      pendingLevel: null,
      nextRunAt: null,
      deferred: false,
    });

    await service.ensureScheduled('conv-1');

    // Nenhum (re)agendamento: o opt-out é respeitado, o ciclo não ressuscita.
    expect(prisma.followUpSchedule.upsert).not.toHaveBeenCalled();
    // Curto-circuito antes mesmo de ler a conversa para ancorar a inatividade.
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // (b) Deferred_Followup não pode ser sobrescrito por um Nível 1 de 1h (R11)
  // ---------------------------------------------------------------------------
  it('NÃO sobrescreve o Deferred_Followup quando active && deferred (R11)', async () => {
    prisma.followUpSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
      cycleState: 'active',
      pendingLevel: 1,
      deferred: true,
      deferralOffsetHours: 5,
      nextRunAt: new Date('2024-05-01T17:00:00.000Z'),
    });

    await service.ensureScheduled('conv-1');

    // O adiamento (anchor + offset) é preservado: nada é reagendado.
    expect(prisma.followUpSchedule.upsert).not.toHaveBeenCalled();
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // (c) Caso normal: active sem deferred continua (re)agendando o Nível 1
  // ---------------------------------------------------------------------------
  it('agenda normalmente o Nível 1 quando active e não deferred (fluxo existente)', async () => {
    prisma.followUpSchedule.findUnique.mockResolvedValue({
      id: 'sched-1',
      conversationId: 'conv-1',
      leadId: 'lead-1',
      cycleState: 'active',
      pendingLevel: 1,
      deferred: false,
      nextRunAt: null,
    });
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      leadId: 'lead-1',
      lastOutboundAt: LAST_OUTBOUND,
      lastInboundAt: null,
    });

    await service.ensureScheduled('conv-1');

    // O fluxo existente segue: upsert reancora o Nível 1 a partir do outbound.
    expect(prisma.followUpSchedule.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.followUpSchedule.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ conversationId: 'conv-1' });
    expect(args.update.cycleState).toBe('active');
    expect(args.update.pendingLevel).toBe(1);
    // Nível 1 = anchor (lastOutboundAt) + 1h.
    expect(args.update.nextRunAt).toEqual(
      new Date(LAST_OUTBOUND.getTime() + 60 * 60 * 1000),
    );
  });

  it('agenda normalmente quando não há schedule pré-existente (primeira vez)', async () => {
    prisma.followUpSchedule.findUnique.mockResolvedValue(null);
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv-1',
      leadId: 'lead-1',
      lastOutboundAt: LAST_OUTBOUND,
      lastInboundAt: null,
    });

    await service.ensureScheduled('conv-1');

    expect(prisma.followUpSchedule.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.followUpSchedule.upsert.mock.calls[0][0];
    expect(args.create.cycleState).toBe('active');
    expect(args.create.pendingLevel).toBe(1);
  });
});
