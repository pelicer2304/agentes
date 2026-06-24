import { Controller, Get } from '@nestjs/common';
import { HealthResult, HealthService } from './health.service';

/**
 * Public health endpoint. NOT behind the JwtAuthGuard so external monitors and
 * orchestrators (e.g. EasyPanel/Docker healthchecks) can reach it.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check(): Promise<HealthResult> {
    return this.healthService.check();
  }

  /** Diagnóstico TEMPORÁRIO do follow-up (sem auth, sem dados sensíveis). */
  @Get('followup')
  async followUp(): Promise<unknown> {
    return this.healthService.followUpDebug();
  }
}
