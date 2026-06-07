import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus, LEAD_STATUSES } from './dto/update-lead-status.dto';

export interface LeadFilter {
  status?: string;
  temperature?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedLeads {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

@Injectable()
export class LeadService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: LeadFilter = {}): Promise<PaginatedLeads> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize =
      filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;
    const skip = (page - 1) * pageSize;

    const where: Record<string, string> = {};
    if (filter.status) {
      where.status = filter.status;
    }
    if (filter.temperature) {
      where.temperature = filter.temperature;
    }

    const [data, total] = await Promise.all([
      this.prisma.lead.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findById(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        conversations: {
          orderBy: { updatedAt: 'desc' },
          include: {
            messages: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        agentAnalyses: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!lead) {
      throw new NotFoundException(`Lead with id ${id} not found`);
    }

    return lead;
  }

  async updateStatus(id: string, status: LeadStatus) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });

    if (!lead) {
      throw new NotFoundException(`Lead with id ${id} not found`);
    }

    return this.prisma.lead.update({
      where: { id },
      data: { status },
    });
  }

  async updateQualificationData(id: string, data: Record<string, any>) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });

    if (!lead) {
      throw new NotFoundException(`Lead with id ${id} not found`);
    }

    // Null retention: only update fields that have non-null values
    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== null && value !== undefined) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return lead;
    }

    return this.prisma.lead.update({
      where: { id },
      data: updateData,
    });
  }
}
