import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  awaitingHuman: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(): Promise<DashboardSummary> {
    const [total, hot, warm, cold, awaitingHuman] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { temperature: 'quente' } }),
      this.prisma.lead.count({ where: { temperature: 'morno' } }),
      this.prisma.lead.count({ where: { temperature: 'frio' } }),
      this.prisma.lead.count({ where: { status: 'chamar_humano' } }),
    ]);

    return { total, hot, warm, cold, awaitingHuman };
  }
}
