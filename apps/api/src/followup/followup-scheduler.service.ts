import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';
import { FollowUpService } from './followup.service';

/**
 * Duração do lease (ms) aplicado ao reivindicar um schedule vencido. Uma linha
 * permanece "reivindicada" enquanto `locked_until > now`; o lease expira em 60s
 * para que falhas/quedas de processo não travem o schedule indefinidamente
 * (R7.6).
 */
const LEASE_MS = 60_000;

/**
 * Número máximo de schedules reivindicados por tick. Limita o trabalho de um
 * único ciclo de poll, mantendo o lote pequeno e previsível; os schedules
 * restantes são reivindicados nos ticks subsequentes (cadência de ~30s).
 */
const CLAIM_BATCH_SIZE = 100;

/** Linha retornada pela query de reivindicação (apenas o `id`). */
interface ClaimedScheduleRow {
  id: string;
}

/** Linha retornada pela varredura da janela de encerramento (apenas o `id`). */
interface CompletionCandidateRow {
  id: string;
}

/**
 * Agendador periódico do follow-up (design.md — "FollowUpSchedulerService" e
 * "Pipeline de disparo"). A cada poll (`tick`):
 *
 *  1. **Reivindica** os schedules vencidos (`cycle_state = 'active'`,
 *     `next_run_at <= now` e lock livre) aplicando um lease de 60s
 *     (`locked_until = now + 60s`). A reivindicação é feita por um único
 *     `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING id`,
 *     atômico e seguro para múltiplas instâncias: o `FOR UPDATE SKIP LOCKED`
 *     impede que duas instâncias reivindiquem a mesma linha e o `RETURNING`
 *     devolve exatamente as linhas reivindicadas por esta instância (R7.3, R7.6).
 *  2. Delega cada schedule reivindicado a {@link FollowUpService.processDue} e
 *     **libera o lock** (`locked_until = null`) ao final de cada item, dentro de
 *     um `try/finally`, garantindo a liberação mesmo em caso de erro.
 *  3. **Varre** os schedules na janela de encerramento (`cycle_state = 'active'`
 *     com `level3_fired_at` não nulo) e chama
 *     {@link FollowUpService.completeIfExhausted} para cada um (R6.1).
 *
 * Erros em um item são isolados (try/catch por item) e não abortam o tick: um
 * schedule problemático nunca impede o processamento dos demais.
 *
 * ## Agendamento do tick (cadência do poll)
 *
 * A cadência idiomática no NestJS seria `@nestjs/schedule` (`@Interval`), porém
 * o intervalo precisa vir da configuração (`followUpPollIntervalMs`) e os
 * decorators não aceitam valores dinâmicos. Além disso, esse pacote ainda não é
 * dependência do projeto (será adicionado na tarefa de wiring). Por isso, e
 * conforme alternativa documentada no design, o tick é agendado via
 * `setInterval` registrado em {@link onModuleInit} e encerrado em
 * {@link onModuleDestroy}. O método {@link tick} permanece público e recebe um
 * relógio injetável (`now`), de modo a ser invocável diretamente nos testes sem
 * depender do mecanismo de agendamento. Quando `@nestjs/schedule` for
 * adicionado, este agendamento pode migrar para `SchedulerRegistry` mantendo o
 * intervalo dinâmico — o design não depende do mecanismo de tick em si.
 */
@Injectable()
export class FollowUpSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FollowUpSchedulerService.name);

  /** Handle do `setInterval` ativo (null quando o agendamento não está ligado). */
  private timer: NodeJS.Timeout | null = null;

  /**
   * Guarda de reentrância (timestamp do início do tick em andamento, ou null).
   * Resiliente: se um tick travar (ex.: chamada de rede pendurada), a guarda se
   * libera após STALE_MS e o poll volta a rodar — sem isso, um único tick
   * travado mataria o scheduler em silêncio para sempre.
   */
  private runningSince: number | null = null;

  /** Após este tempo, um tick "em andamento" é considerado travado e liberado. */
  private static readonly STALE_TICK_MS = 3 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly followUpService: FollowUpService,
    private readonly config: AppConfigService,
  ) {}

  /** Inicia o poll periódico usando o intervalo configurado (em ms). */
  onModuleInit(): void {
    const intervalMs = this.config.followUpPollIntervalMs;
    this.timer = setInterval(() => {
      void this.runTickGuarded();
    }, intervalMs);

    // Não impede o encerramento do processo aguardando o próximo tick.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }

    this.logger.log(
      `FollowUpScheduler iniciado (poll a cada ${intervalMs}ms, lease de ${LEASE_MS}ms).`,
    );
  }

  /** Encerra o poll periódico ao destruir o módulo. */
  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Executa um `tick` protegido contra reentrância e contra exceções não
   * tratadas, para que o `setInterval` nunca derrube o processo nem dispare
   * ticks sobrepostos.
   */
  private async runTickGuarded(): Promise<void> {
    const nowMs = Date.now();
    if (
      this.runningSince !== null &&
      nowMs - this.runningSince < FollowUpSchedulerService.STALE_TICK_MS
    ) {
      // Um tick anterior ainda está em andamento (e não travado): pula o ciclo.
      return;
    }
    if (this.runningSince !== null) {
      // O tick anterior excedeu o limite: provavelmente travado. Libera e segue.
      this.logger.warn(
        `Tick anterior do follow-up travado por >${FollowUpSchedulerService.STALE_TICK_MS}ms; liberando a guarda e seguindo.`,
      );
    }
    this.runningSince = nowMs;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`Falha inesperada no tick do follow-up: ${this.errMsg(err)}`);
    } finally {
      this.runningSince = null;
    }
  }

  /**
   * Executa um ciclo de poll. Público e com relógio injetável para ser testável
   * diretamente.
   *
   *  1. Reivindica os schedules vencidos (lease de 60s) e dispara cada um via
   *     `processDue`, liberando o lock ao final (try/finally).
   *  2. Varre a janela de encerramento e chama `completeIfExhausted` para cada
   *     schedule com o Nível 3 já disparado.
   */
  async tick(now: Date = new Date()): Promise<void> {
    await this.processDueSchedules(now);
    await this.sweepCompletions(now);
  }

  /**
   * Reivindica e processa os schedules vencidos. A reivindicação é atômica e
   * segura para concorrência (UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING).
   */
  private async processDueSchedules(now: Date): Promise<void> {
    const claimed = await this.claimDueSchedules(now);

    // Heartbeat: só loga quando há ciclo ativo (evita ruído quando não há nada).
    // Confirma que o tick está VIVO e o que ele enxerga (active vs reivindicado).
    try {
      const activeCount = await this.prisma.followUpSchedule.count({
        where: { cycleState: 'active' },
      });
      if (activeCount > 0 || claimed.length > 0) {
        this.logger.log(
          `FOLLOWUP_TICK active=${activeCount} claimed=${claimed.length} @ ${now.toISOString()}`,
        );
      }
    } catch {
      // contagem é só diagnóstico; nunca quebra o tick.
    }

    for (const { id } of claimed) {
      try {
        await this.followUpService.processDue(id, now);
      } catch (err) {
        // Isola o erro do item: um schedule problemático não aborta o tick.
        this.logger.error(
          `Falha ao processar o schedule de follow-up ${id}: ${this.errMsg(err)}`,
        );
      } finally {
        // Libera o lock mesmo em caso de erro (R7.6).
        await this.releaseLock(id);
      }
    }
  }

  /**
   * Reivindica atomicamente os schedules vencidos aplicando o lease de 60s.
   *
   * O `SELECT ... FOR UPDATE SKIP LOCKED` na subconsulta garante que duas
   * instâncias nunca reivindiquem a mesma linha, e o `RETURNING id` do `UPDATE`
   * externo devolve exatamente as linhas que esta instância reivindicou. Toda a
   * operação roda em uma única instrução (transação implícita), portanto é
   * atômica sem necessidade de um `$transaction` explícito (R7.3, R7.6).
   */
  private async claimDueSchedules(now: Date): Promise<ClaimedScheduleRow[]> {
    const lockedUntil = new Date(now.getTime() + LEASE_MS);

    try {
      return await this.prisma.$queryRaw<ClaimedScheduleRow[]>`
        UPDATE "follow_up_schedules"
        SET "locked_until" = ${lockedUntil}
        WHERE "id" IN (
          SELECT "id"
          FROM "follow_up_schedules"
          WHERE "cycle_state" = 'active'
            AND "next_run_at" IS NOT NULL
            AND "next_run_at" <= ${now}
            AND ("locked_until" IS NULL OR "locked_until" <= ${now})
          ORDER BY "next_run_at" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${CLAIM_BATCH_SIZE}
        )
        RETURNING "id";
      `;
    } catch (err) {
      this.logger.error(
        `Falha ao reivindicar schedules vencidos: ${this.errMsg(err)}`,
      );
      return [];
    }
  }

  /**
   * Libera o lock de um schedule (`locked_until = null`). Usa `updateMany` para
   * não lançar caso a linha tenha sido removida no intervalo.
   */
  private async releaseLock(scheduleId: string): Promise<void> {
    try {
      await this.prisma.followUpSchedule.updateMany({
        where: { id: scheduleId },
        data: { lockedUntil: null },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao liberar o lock do schedule ${scheduleId}: ${this.errMsg(err)}`,
      );
    }
  }

  /**
   * Varre os schedules na janela de encerramento (Nível 3 já disparado) e
   * delega a decisão de encerramento a {@link FollowUpService.completeIfExhausted}
   * (R6.1). Cada item é isolado para não abortar a varredura.
   */
  private async sweepCompletions(now: Date): Promise<void> {
    let candidates: CompletionCandidateRow[];
    try {
      candidates = await this.prisma.followUpSchedule.findMany({
        where: { cycleState: 'active', level3FiredAt: { not: null } },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(
        `Falha ao varrer a janela de encerramento de follow-up: ${this.errMsg(err)}`,
      );
      return;
    }

    for (const { id } of candidates) {
      try {
        await this.followUpService.completeIfExhausted(id, now);
      } catch (err) {
        this.logger.error(
          `Falha ao avaliar o encerramento do schedule ${id}: ${this.errMsg(err)}`,
        );
      }
    }
  }

  /** Extrai uma mensagem legível de um erro desconhecido para log. */
  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
