import { Logger } from '@nestjs/common';

import { FollowUpSchedulerService } from './followup-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { FollowUpService } from './followup.service';

/**
 * Testes do FollowUpSchedulerService.tick(now) (R7.3, R7.6, R6.1).
 *
 * O scheduler é instanciado manualmente com mocks de PrismaService,
 * FollowUpService e AppConfigService, e `tick(now)` é chamado diretamente (o
 * método é público e recebe o relógio injetável), evitando timers reais.
 *
 * Abordagem para mocar a reivindicação (claim) por SQL bruto: o método
 * `claimDueSchedules` usa `prisma.$queryRaw` como *tagged template*. Ele é
 * invocado pelo runtime como uma função cujo primeiro argumento é o array de
 * partes do template (TemplateStringsArray) e os demais são os valores
 * interpolados, na ordem: `lockedUntil`, `now`, `now`, `now`, `CLAIM_BATCH_SIZE`.
 * Mocamos `$queryRaw` como `jest.fn()` que resolve com a lista de linhas
 * reivindicadas (`{ id }[]`) e, quando necessário, inspecionamos esses
 * argumentos para confirmar que `now` e o lease (`now + 60s`) foram aplicados.
 */
describe('FollowUpSchedulerService', () => {
  const LEASE_MS = 60_000;

  let scheduler: FollowUpSchedulerService;

  let prisma: {
    $queryRaw: jest.Mock;
    followUpSchedule: {
      updateMany: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let followUpService: {
    processDue: jest.Mock;
    completeIfExhausted: jest.Mock;
  };
  let config: { followUpPollIntervalMs: number };

  beforeEach(() => {
    jest.clearAllMocks();
    // Silencia os logs de erro do scheduler para manter a saída do teste limpa.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      followUpSchedule: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    followUpService = {
      processDue: jest.fn().mockResolvedValue(undefined),
      completeIfExhausted: jest.fn().mockResolvedValue(undefined),
    };

    config = { followUpPollIntervalMs: 30_000 };

    scheduler = new FollowUpSchedulerService(
      prisma as unknown as PrismaService,
      followUpService as unknown as FollowUpService,
      config as unknown as AppConfigService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('reivindicação por lease e delegação a processDue (R7.3, R7.6)', () => {
    it('chama processDue(id, now) para cada schedule reivindicado e libera o lock ao final', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'sched-1' }, { id: 'sched-2' }]);

      await scheduler.tick(now);

      // Cada id reivindicado é delegado a processDue com o mesmo relógio.
      expect(followUpService.processDue).toHaveBeenCalledTimes(2);
      expect(followUpService.processDue).toHaveBeenNthCalledWith(1, 'sched-1', now);
      expect(followUpService.processDue).toHaveBeenNthCalledWith(2, 'sched-2', now);

      // O lock é liberado (lockedUntil = null) para cada item processado.
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
        data: { lockedUntil: null },
      });
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-2' },
        data: { lockedUntil: null },
      });
    });

    it('libera o lock mesmo quando processDue lança (try/finally, R7.6)', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'sched-err' }]);
      followUpService.processDue.mockRejectedValueOnce(new Error('boom'));

      // O tick não rejeita mesmo com a falha no processamento do item.
      await expect(scheduler.tick(now)).resolves.toBeUndefined();

      expect(followUpService.processDue).toHaveBeenCalledWith('sched-err', now);
      // Lock liberado apesar do erro.
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'sched-err' },
        data: { lockedUntil: null },
      });
    });

    it('processa apenas os ids retornados pelo claim (comportamento observável do WHERE de lock)', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      // O WHERE da query de claim (lockedUntil null OU <= now) já filtra os
      // locks ativos; aqui validamos o comportamento observável: somente os
      // ids efetivamente reivindicados são processados.
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'only-claimed' }]);

      await scheduler.tick(now);

      expect(followUpService.processDue).toHaveBeenCalledTimes(1);
      expect(followUpService.processDue).toHaveBeenCalledWith('only-claimed', now);
    });

    it('aplica o lease de 60s e usa now nos parâmetros da query de claim', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await scheduler.tick(now);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const args = prisma.$queryRaw.mock.calls[0];

      // O primeiro argumento é o TemplateStringsArray; os demais são os valores
      // interpolados: lockedUntil (now + 60s) e o `now` repetido no WHERE.
      const interpolated = args.slice(1);
      const lockedUntil = interpolated[0] as Date;

      expect(lockedUntil).toBeInstanceOf(Date);
      expect(lockedUntil.getTime()).toBe(now.getTime() + LEASE_MS);

      // `now` é passado como argumento de comparação do WHERE (next_run_at <= now
      // e locked_until <= now), garantindo o respeito ao lock ativo.
      const usesNow = interpolated.some(
        (value) => value instanceof Date && value.getTime() === now.getTime(),
      );
      expect(usesNow).toBe(true);
    });

    it('não chama processDue quando nada é reivindicado', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await scheduler.tick(now);

      expect(followUpService.processDue).not.toHaveBeenCalled();
    });
  });

  describe('varredura de encerramento (R6.1)', () => {
    it('chama completeIfExhausted(id, now) para cada candidato com level3FiredAt não nulo', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.followUpSchedule.findMany.mockResolvedValueOnce([
        { id: 'done-1' },
        { id: 'done-2' },
        { id: 'done-3' },
      ]);

      await scheduler.tick(now);

      // A varredura busca os schedules ativos com level3FiredAt não nulo.
      expect(prisma.followUpSchedule.findMany).toHaveBeenCalledWith({
        where: { cycleState: 'active', level3FiredAt: { not: null } },
        select: { id: true },
      });

      expect(followUpService.completeIfExhausted).toHaveBeenCalledTimes(3);
      expect(followUpService.completeIfExhausted).toHaveBeenNthCalledWith(1, 'done-1', now);
      expect(followUpService.completeIfExhausted).toHaveBeenNthCalledWith(2, 'done-2', now);
      expect(followUpService.completeIfExhausted).toHaveBeenNthCalledWith(3, 'done-3', now);
    });
  });

  describe('isolamento de erro por item', () => {
    it('continua processando os demais ids quando processDue de um id lança, sem rejeitar', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      // O segundo item falha; os demais devem ainda ser processados.
      followUpService.processDue
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('falha no b'))
        .mockResolvedValueOnce(undefined);

      await expect(scheduler.tick(now)).resolves.toBeUndefined();

      expect(followUpService.processDue).toHaveBeenCalledTimes(3);
      expect(followUpService.processDue).toHaveBeenNthCalledWith(1, 'a', now);
      expect(followUpService.processDue).toHaveBeenNthCalledWith(2, 'b', now);
      expect(followUpService.processDue).toHaveBeenNthCalledWith(3, 'c', now);

      // O lock de todos os itens (inclusive o que falhou) é liberado.
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'a' },
        data: { lockedUntil: null },
      });
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'b' },
        data: { lockedUntil: null },
      });
      expect(prisma.followUpSchedule.updateMany).toHaveBeenCalledWith({
        where: { id: 'c' },
        data: { lockedUntil: null },
      });
    });

    it('continua a varredura de encerramento quando completeIfExhausted de um id lança, sem rejeitar', async () => {
      const now = new Date('2024-05-01T12:00:00.000Z');
      prisma.followUpSchedule.findMany.mockResolvedValueOnce([
        { id: 'x' },
        { id: 'y' },
      ]);
      followUpService.completeIfExhausted
        .mockRejectedValueOnce(new Error('falha no x'))
        .mockResolvedValueOnce(undefined);

      await expect(scheduler.tick(now)).resolves.toBeUndefined();

      expect(followUpService.completeIfExhausted).toHaveBeenCalledTimes(2);
      expect(followUpService.completeIfExhausted).toHaveBeenNthCalledWith(1, 'x', now);
      expect(followUpService.completeIfExhausted).toHaveBeenNthCalledWith(2, 'y', now);
    });
  });
});
