import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { LeadService } from './lead.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { LeadFilterDto } from './dto/lead-filter.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('leads')
@UseGuards(JwtAuthGuard)
export class LeadController {
  constructor(private readonly leadService: LeadService) {}

  @Get()
  async findAll(@Query() filter: LeadFilterDto) {
    const page = filter.page ? parseInt(filter.page, 10) : 1;
    const pageSize = filter.pageSize ? parseInt(filter.pageSize, 10) : 20;

    return this.leadService.findAll({
      status: filter.status,
      temperature: filter.temperature,
      page,
      pageSize,
    });
  }

  @Get(':id')
  async findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadService.findById(id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadStatusDto,
  ) {
    return this.leadService.updateStatus(id, dto.status);
  }
}
