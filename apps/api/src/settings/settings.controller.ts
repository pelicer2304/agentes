import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SettingsService, AgentSettingsResponse } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async getSettings(): Promise<AgentSettingsResponse> {
    return this.settingsService.getSettings();
  }

  @Patch()
  async updateSettings(
    @Body() dto: UpdateSettingsDto,
  ): Promise<AgentSettingsResponse> {
    return this.settingsService.updateSettings(dto);
  }
}
