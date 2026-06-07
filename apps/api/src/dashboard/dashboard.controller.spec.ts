import { Test, TestingModule } from '@nestjs/testing';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('DashboardController', () => {
  let controller: DashboardController;
  let service: DashboardService;

  const mockDashboardService = {
    getSummary: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardService, useValue: mockDashboardService },
      ],
    }).compile();

    controller = module.get<DashboardController>(DashboardController);
    service = module.get<DashboardService>(DashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /dashboard/summary', () => {
    it('should return the dashboard summary', async () => {
      const summary = {
        total: 15,
        hot: 5,
        warm: 6,
        cold: 3,
        awaitingHuman: 2,
      };

      mockDashboardService.getSummary.mockResolvedValue(summary);

      const result = await controller.getSummary();

      expect(result).toEqual(summary);
      expect(mockDashboardService.getSummary).toHaveBeenCalledTimes(1);
    });

    it('should return zeros when no leads exist', async () => {
      const emptySummary = {
        total: 0,
        hot: 0,
        warm: 0,
        cold: 0,
        awaitingHuman: 0,
      };

      mockDashboardService.getSummary.mockResolvedValue(emptySummary);

      const result = await controller.getSummary();

      expect(result).toEqual(emptySummary);
    });
  });
});
