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
   * Derived from the presence of the provider-specific LLM key without exposing
   * its value.
   */
  private isLlmConfigured(): boolean {
    if (this.config.llmProvider === 'openrouter') {
      return this.hasValue(this.config.openrouterApiKey);
    }
    return this.hasValue(this.config.openaiApiKey);
  }

  private hasValue(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
