import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKnowledgeDto } from './dto/create-knowledge.dto';
import { UpdateKnowledgeDto } from './dto/update-knowledge.dto';

export interface KnowledgeGrouped {
  [category: string]: Array<{
    id: string;
    category: string;
    title: string;
    content: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all knowledge base items grouped by category.
   */
  async findAll(): Promise<KnowledgeGrouped> {
    const items = await this.prisma.knowledgeBase.findMany({
      orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
    });

    const grouped: KnowledgeGrouped = {};
    for (const item of items) {
      if (!grouped[item.category]) {
        grouped[item.category] = [];
      }
      grouped[item.category].push(item);
    }

    return grouped;
  }

  /**
   * Creates a new knowledge base item with active=true.
   */
  async create(dto: CreateKnowledgeDto) {
    return this.prisma.knowledgeBase.create({
      data: {
        category: dto.category,
        title: dto.title,
        content: dto.content,
        active: true,
      },
    });
  }

  /**
   * Updates an existing knowledge base item.
   * Throws NotFoundException if the item does not exist.
   */
  async update(id: string, dto: UpdateKnowledgeDto) {
    const existing = await this.prisma.knowledgeBase.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Knowledge base item with id "${id}" not found`);
    }

    return this.prisma.knowledgeBase.update({
      where: { id },
      data: {
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  /**
   * Toggles the active field of a knowledge base item.
   * Throws NotFoundException if the item does not exist.
   */
  async toggleActive(id: string) {
    const existing = await this.prisma.knowledgeBase.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Knowledge base item with id "${id}" not found`);
    }

    return this.prisma.knowledgeBase.update({
      where: { id },
      data: { active: !existing.active },
    });
  }
}
