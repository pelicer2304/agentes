import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LeadService } from './lead.service';
import { PrismaService } from '../prisma/prisma.service';

describe('LeadService', () => {
  let service: LeadService;

  const mockPrismaService = {
    lead: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeadService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<LeadService>(LeadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated leads with default page size of 20', async () => {
      const leads = [{ id: '1', name: 'Lead 1', status: 'novo' }];
      mockPrismaService.lead.findMany.mockResolvedValue(leads);
      mockPrismaService.lead.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result).toEqual({
        data: leads,
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 20,
      });
    });

    it('should filter by status', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([]);
      mockPrismaService.lead.count.mockResolvedValue(0);

      await service.findAll({ status: 'quente' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'quente' },
        }),
      );
    });

    it('should filter by temperature', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([]);
      mockPrismaService.lead.count.mockResolvedValue(0);

      await service.findAll({ temperature: 'morno' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { temperature: 'morno' },
        }),
      );
    });

    it('should filter by both status and temperature', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([]);
      mockPrismaService.lead.count.mockResolvedValue(0);

      await service.findAll({ status: 'qualificando', temperature: 'frio' });

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'qualificando', temperature: 'frio' },
        }),
      );
    });

    it('should paginate correctly', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([]);
      mockPrismaService.lead.count.mockResolvedValue(50);

      const result = await service.findAll({ page: 3, pageSize: 10 });

      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(5);
      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('should sort by updatedAt descending', async () => {
      mockPrismaService.lead.findMany.mockResolvedValue([]);
      mockPrismaService.lead.count.mockResolvedValue(0);

      await service.findAll();

      expect(mockPrismaService.lead.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { updatedAt: 'desc' },
        }),
      );
    });
  });

  describe('findById', () => {
    it('should return lead with conversations and latest analysis', async () => {
      const lead = {
        id: 'uuid-1',
        name: 'Test Lead',
        conversations: [],
        agentAnalyses: [],
      };
      mockPrismaService.lead.findUnique.mockResolvedValue(lead);

      const result = await service.findById('uuid-1');

      expect(result).toEqual(lead);
      expect(mockPrismaService.lead.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
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
    });

    it('should throw NotFoundException when lead does not exist', async () => {
      mockPrismaService.lead.findUnique.mockResolvedValue(null);

      await expect(service.findById('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('should update lead status', async () => {
      const lead = { id: 'uuid-1', status: 'novo' };
      const updatedLead = { id: 'uuid-1', status: 'quente' };
      mockPrismaService.lead.findUnique.mockResolvedValue(lead);
      mockPrismaService.lead.update.mockResolvedValue(updatedLead);

      const result = await service.updateStatus('uuid-1', 'quente');

      expect(result).toEqual(updatedLead);
      expect(mockPrismaService.lead.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { status: 'quente' },
      });
    });

    it('should throw NotFoundException when lead does not exist', async () => {
      mockPrismaService.lead.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('non-existent-id', 'quente'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateQualificationData', () => {
    it('should only update non-null fields (null retention)', async () => {
      const lead = {
        id: 'uuid-1',
        segment: 'tech',
        mainPain: 'existing pain',
      };
      const updatedLead = {
        id: 'uuid-1',
        segment: 'saude',
        mainPain: 'existing pain',
      };
      mockPrismaService.lead.findUnique.mockResolvedValue(lead);
      mockPrismaService.lead.update.mockResolvedValue(updatedLead);

      const result = await service.updateQualificationData('uuid-1', {
        segment: 'saude',
        mainPain: null,
        desiredOutcome: null,
      });

      expect(result).toEqual(updatedLead);
      expect(mockPrismaService.lead.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: { segment: 'saude' },
      });
    });

    it('should return existing lead when all fields are null', async () => {
      const lead = { id: 'uuid-1', segment: 'tech' };
      mockPrismaService.lead.findUnique.mockResolvedValue(lead);

      const result = await service.updateQualificationData('uuid-1', {
        segment: null,
        mainPain: null,
      });

      expect(result).toEqual(lead);
      expect(mockPrismaService.lead.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when lead does not exist', async () => {
      mockPrismaService.lead.findUnique.mockResolvedValue(null);

      await expect(
        service.updateQualificationData('non-existent-id', {
          segment: 'tech',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should update all non-null fields', async () => {
      const lead = { id: 'uuid-1' };
      mockPrismaService.lead.findUnique.mockResolvedValue(lead);
      mockPrismaService.lead.update.mockResolvedValue(lead);

      await service.updateQualificationData('uuid-1', {
        segment: 'tech',
        leadScore: 75,
        temperature: 'quente',
        mainPain: 'needs automation',
        recommendedService: 'chatbot',
      });

      expect(mockPrismaService.lead.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          segment: 'tech',
          leadScore: 75,
          temperature: 'quente',
          mainPain: 'needs automation',
          recommendedService: 'chatbot',
        },
      });
    });
  });
});
