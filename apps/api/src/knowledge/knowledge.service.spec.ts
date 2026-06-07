import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../prisma/prisma.service';

describe('KnowledgeService', () => {
  let service: KnowledgeService;

  const mockPrismaService = {
    knowledgeBase: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<KnowledgeService>(KnowledgeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return items grouped by category', async () => {
      const items = [
        { id: '1', category: 'empresa', title: 'About', content: 'Content A', active: true, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', category: 'empresa', title: 'History', content: 'Content B', active: true, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', category: 'servicos', title: 'Service 1', content: 'Content C', active: false, createdAt: new Date(), updatedAt: new Date() },
      ];

      mockPrismaService.knowledgeBase.findMany.mockResolvedValue(items);

      const result = await service.findAll();

      expect(result).toEqual({
        empresa: [items[0], items[1]],
        servicos: [items[2]],
      });
      expect(mockPrismaService.knowledgeBase.findMany).toHaveBeenCalledWith({
        orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
      });
    });

    it('should return empty object when no items exist', async () => {
      mockPrismaService.knowledgeBase.findMany.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual({});
    });

    it('should include both active and inactive items', async () => {
      const items = [
        { id: '1', category: 'empresa', title: 'Active', content: 'C1', active: true, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', category: 'empresa', title: 'Inactive', content: 'C2', active: false, createdAt: new Date(), updatedAt: new Date() },
      ];

      mockPrismaService.knowledgeBase.findMany.mockResolvedValue(items);

      const result = await service.findAll();

      expect(result['empresa']).toHaveLength(2);
      expect(result['empresa'][0].active).toBe(true);
      expect(result['empresa'][1].active).toBe(false);
    });
  });

  describe('create', () => {
    it('should create a new knowledge base item with active=true', async () => {
      const dto = { category: 'empresa', title: 'New Item', content: 'Some content' };
      const created = { id: 'uuid-1', ...dto, active: true, createdAt: new Date(), updatedAt: new Date() };

      mockPrismaService.knowledgeBase.create.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(result).toEqual(created);
      expect(mockPrismaService.knowledgeBase.create).toHaveBeenCalledWith({
        data: {
          category: 'empresa',
          title: 'New Item',
          content: 'Some content',
          active: true,
        },
      });
    });
  });

  describe('update', () => {
    it('should update an existing item', async () => {
      const existing = { id: 'uuid-1', category: 'empresa', title: 'Old', content: 'Old content', active: true, createdAt: new Date(), updatedAt: new Date() };
      const dto = { title: 'Updated Title' };
      const updated = { ...existing, title: 'Updated Title', updatedAt: new Date() };

      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(existing);
      mockPrismaService.knowledgeBase.update.mockResolvedValue(updated);

      const result = await service.update('uuid-1', dto);

      expect(result).toEqual(updated);
      expect(mockPrismaService.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { title: 'Updated Title' },
      });
    });

    it('should update multiple fields at once', async () => {
      const existing = { id: 'uuid-1', category: 'empresa', title: 'Old', content: 'Old content', active: true, createdAt: new Date(), updatedAt: new Date() };
      const dto = { category: 'servicos', title: 'New Title', content: 'New content', active: false };

      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(existing);
      mockPrismaService.knowledgeBase.update.mockResolvedValue({ ...existing, ...dto });

      await service.update('uuid-1', dto);

      expect(mockPrismaService.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { category: 'servicos', title: 'New Title', content: 'New content', active: false },
      });
    });

    it('should throw NotFoundException if item does not exist', async () => {
      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(null);

      await expect(service.update('non-existent', { title: 'X' }))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should not include undefined fields in update data', async () => {
      const existing = { id: 'uuid-1', category: 'empresa', title: 'Old', content: 'Old content', active: true, createdAt: new Date(), updatedAt: new Date() };
      const dto = { content: 'Updated content only' };

      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(existing);
      mockPrismaService.knowledgeBase.update.mockResolvedValue({ ...existing, ...dto });

      await service.update('uuid-1', dto);

      expect(mockPrismaService.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { content: 'Updated content only' },
      });
    });
  });

  describe('toggleActive', () => {
    it('should toggle active from true to false', async () => {
      const existing = { id: 'uuid-1', category: 'empresa', title: 'Item', content: 'Content', active: true, createdAt: new Date(), updatedAt: new Date() };
      const toggled = { ...existing, active: false };

      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(existing);
      mockPrismaService.knowledgeBase.update.mockResolvedValue(toggled);

      const result = await service.toggleActive('uuid-1');

      expect(result.active).toBe(false);
      expect(mockPrismaService.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { active: false },
      });
    });

    it('should toggle active from false to true', async () => {
      const existing = { id: 'uuid-1', category: 'empresa', title: 'Item', content: 'Content', active: false, createdAt: new Date(), updatedAt: new Date() };
      const toggled = { ...existing, active: true };

      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(existing);
      mockPrismaService.knowledgeBase.update.mockResolvedValue(toggled);

      const result = await service.toggleActive('uuid-1');

      expect(result.active).toBe(true);
      expect(mockPrismaService.knowledgeBase.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { active: true },
      });
    });

    it('should throw NotFoundException if item does not exist', async () => {
      mockPrismaService.knowledgeBase.findUnique.mockResolvedValue(null);

      await expect(service.toggleActive('non-existent'))
        .rejects
        .toThrow(NotFoundException);
    });
  });
});
