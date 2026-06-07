import { Controller, Get } from '@nestjs/common';
import { DashboardService, DashboardSummary } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async getSummary(): Promise<DashboardSummary> {
    return this.dashboardService.getSummary();
  }
}
