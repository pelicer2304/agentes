import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { AppConfigService } from './config/config.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  getHealth(): { status: string } {
    return this.appService.getHealth();
  }

  @Get('health')
  async getDetailedHealth() {
    let database = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    return {
      status: 'ok',
      database,
      llmProvider: this.config.llmProvider,
      llmModel: this.config.modelName,
      llmFallback: this.config.modelFallback,
      llmProviderConfigured: !!this.config.openaiApiKey,
    };
  }
}
