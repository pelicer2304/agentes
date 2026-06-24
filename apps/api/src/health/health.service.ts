import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/config.service';

export type DatabaseStatus = 'healthy' | 'unhealthy';
export type HealthStatus = 'ok' | 'degraded';

export interface HealthResult {
  status: HealthStatus;
  database: DatabaseStatus;
  evolutionConfigured: boolean;
  llmConfigured: boolean;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async check(): Promise<HealthResult> {
    const database = await this.probeDatabase();

    return {
      status: database === 'healthy' ? 'ok' : 'degraded',
      database,
      evolutionConfigured: this.isEvolutionConfigured(),
      llmConfigured: this.isLlmConfigured(),
    };
  }

  /**
   * Diagnóstico TEMPORÁRIO do follow-up: estado dos agendamentos recentes e
   * quantos o scheduler "pegaria" agora (mesma condição do claim, só leitura).
   * Sem dados sensíveis (telefone/conteúdo). Remover quando o bug fechar.
   */
  async followUpDebug(): Promise<unknown> {
    const now = new Date();
    const recentSchedules = await this.prisma.followUpSchedule.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        conversationId: true,
        cycleState: true,
        deferred: true,
        pendingLevel: true,
        maxSentLevel: true,
        nextRunAt: true,
        lockedUntil: true,
        deferralOffsetHours: true,
        lastError: true,
        level3FiredAt: true,
        updatedAt: true,
      },
    });
    // Mesma condição do claim do scheduler, porém só SELECT (não trava nada).
    const due = await this.prisma.followUpSchedule.findMany({
      where: {
        cycleState: 'active',
        nextRunAt: { not: null, lte: now },
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
      },
      select: { conversationId: true, nextRunAt: true, pendingLevel: true },
    });
    // Últimos eventos de follow-up (sent/cancelled/error) com o motivo no payload.
    const events = await this.prisma.botEvent.findMany({
      where: { type: { startsWith: 'followup_' } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        type: true,
        payload: true,
        conversationId: true,
        createdAt: true,
      },
    });
    return {
      now: now.toISOString(),
      dueCountViaPrisma: due.length,
      due,
      recentSchedules,
      recentEvents: events,
    };
  }

  /**
   * Probes the database with a lightweight `SELECT 1`. Never throws; failures
   * are reported as `unhealthy` so the endpoint can still respond.
   */
  private async probeDatabase(): Promise<DatabaseStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'healthy';
    } catch {
      return 'unhealthy';
    }
  }

  /**
   * Derived from the presence of the required Evolution config values. Only the
   * presence (not the values) of these secrets is exposed.
   */
  private isEvolutionConfigured(): boolean {
    return (
      this.hasValue(this.config.evolutionApiUrl) &&
      this.hasValue(this.config.evolutionApiKey) &&
      this.hasValue(this.config.evolutionInstanceName)
    );
  }

  /**
   * Derived from the presence of the LLM key the engine actually uses. The
   * frozen OpenAIProviderService reads `openaiApiKey` for both providers
   * (which itself falls back to OPENROUTER_API_KEY).
   */
  private isLlmConfigured(): boolean {
    return this.hasValue(this.config.openaiApiKey);
  }

  private hasValue(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
