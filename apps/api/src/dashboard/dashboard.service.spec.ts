import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: PrismaService;

  const mockPrismaService = {
    lead: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return correct summary counts', async () => {
      mockPrismaService.lead.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(3)  // hot (quente)
        .mockResolvedValueOnce(4)  // warm (morno)
        .mockResolvedValueOnce(2)  // cold (frio)
        .mockResolvedValueOnce(1); // awaitingHuman (chamar_humano)

      const result = await service.getSummary();

      expect(result).toEqual({
        total: 10,
        hot: 3,
        warm: 4,
        cold: 2,
        awaitingHuman: 1,
      });
    });

    it('should return all zeros when no leads exist', async () => {
      mockPrismaService.lead.count.mockResolvedValue(0);

      const result = await service.getSummary();

      expect(result).toEqual({
        total: 0,
        hot: 0,
        warm: 0,
        cold: 0,
        awaitingHuman: 0,
      });
    });

    it('should query with correct filters', async () => {
      mockPrismaService.lead.count.mockResolvedValue(0);

      await service.getSummary();

      expect(mockPrismaService.lead.count).toHaveBeenCalledTimes(5);
      expect(mockPrismaService.lead.count).toHaveBeenNthCalledWith(1); // total - no filter
      expect(mockPrismaService.lead.count).toHaveBeenNthCalledWith(2, { where: { temperature: 'quente' } });
      expect(mockPrismaService.lead.count).toHaveBeenNthCalledWith(3, { where: { temperature: 'morno' } });
      expect(mockPrismaService.lead.count).toHaveBeenNthCalledWith(4, { where: { temperature: 'frio' } });
      expect(mockPrismaService.lead.count).toHaveBeenNthCalledWith(5, { where: { status: 'chamar_humano' } });
    });
  });
});
