import { Test, TestingModule } from '@nestjs/testing';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

describe('KnowledgeController', () => {
  let controller: KnowledgeController;

  const mockKnowledgeService = {
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    toggleActive: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeService, useValue: mockKnowledgeService },
      ],
    }).compile();

    controller = module.get<KnowledgeController>(KnowledgeController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /knowledge', () => {
    it('should return knowledge items grouped by category', async () => {
      const grouped = {
        empresa: [
          { id: '1', category: 'empresa', title: 'About', content: 'Content', active: true, createdAt: new Date(), updatedAt: new Date() },
        ],
        servicos: [
          { id: '2', category: 'servicos', title: 'Service', content: 'Content', active: true, createdAt: new Date(), updatedAt: new Date() },
        ],
      };

      mockKnowledgeService.findAll.mockResolvedValue(grouped);

      const result = await controller.findAll();

      expect(result).toEqual(grouped);
      expect(mockKnowledgeService.findAll).toHaveBeenCalledTimes(1);
    });

    it('should return empty object when no items exist', async () => {
      mockKnowledgeService.findAll.mockResolvedValue({});

      const result = await controller.findAll();

      expect(result).toEqual({});
    });
  });

  describe('POST /knowledge', () => {
    it('should create a new knowledge item', async () => {
      const dto = { category: 'empresa', title: 'New', content: 'Content here' };
      const created = { id: 'uuid-1', ...dto, active: true, createdAt: new Date(), updatedAt: new Date() };

      mockKnowledgeService.create.mockResolvedValue(created);

      const result = await controller.create(dto);

      expect(result).toEqual(created);
      expect(mockKnowledgeService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('PATCH /knowledge/:id', () => {
    it('should update an existing knowledge item', async () => {
      const dto = { title: 'Updated Title' };
      const updated = { id: 'uuid-1', category: 'empresa', title: 'Updated Title', content: 'Content', active: true, createdAt: new Date(), updatedAt: new Date() };

      mockKnowledgeService.update.mockResolvedValue(updated);

      const result = await controller.update('uuid-1', dto);

      expect(result).toEqual(updated);
      expect(mockKnowledgeService.update).toHaveBeenCalledWith('uuid-1', dto);
    });

    it('should pass active field for toggle via update', async () => {
      const dto = { active: false };
      const updated = { id: 'uuid-1', category: 'empresa', title: 'Item', content: 'Content', active: false, createdAt: new Date(), updatedAt: new Date() };

      mockKnowledgeService.update.mockResolvedValue(updated);

      const result = await controller.update('uuid-1', dto);

      expect(result).toEqual(updated);
      expect(mockKnowledgeService.update).toHaveBeenCalledWith('uuid-1', dto);
    });
  });
});
