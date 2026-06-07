import { Test, TestingModule } from '@nestjs/testing';
import { BotService } from './bot.service';
import { AppConfigService } from '../config/config.service';
import {
  PricingConfigService,
  PricingConfigView,
} from '../inbound/pricing-config.service';

describe('BotService', () => {
  let service: BotService;

  const pricingView: PricingConfigView = {
    id: 'pricing-1',
    pricingRangeEnabled: true,
    pricingStartingAt: 2500,
    pricingText: 'A partir de R$ 2.500',
    pricingStartingAtText: 'R$ 2.500',
    updatedAt: new Date('2024-01-02'),
  };

  const mockPricingConfigService = {
    get: jest.fn(),
    update: jest.fn(),
  };

  const mockAppConfigService = {
    botAutoReplyEnabled: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BotService,
        { provide: PricingConfigService, useValue: mockPricingConfigService },
        { provide: AppConfigService, useValue: mockAppConfigService },
      ],
    }).compile();

    service = module.get<BotService>(BotService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('returns the read-only auto-reply state alongside pricing config', async () => {
      mockPricingConfigService.get.mockResolvedValue(pricingView);

      const result = await service.getSettings();

      expect(result).toEqual({
        autoReplyEnabled: true,
        autoReplyEditable: false,
        pricingRangeEnabled: true,
        pricingStartingAt: 2500,
        pricingText: 'A partir de R$ 2.500',
        pricingStartingAtText: 'R$ 2.500',
      });
      expect(mockPricingConfigService.get).toHaveBeenCalledTimes(1);
    });

    it('reflects a disabled auto-reply toggle', async () => {
      mockPricingConfigService.get.mockResolvedValue(pricingView);
      mockAppConfigService.botAutoReplyEnabled = false;

      const result = await service.getSettings();

      expect(result.autoReplyEnabled).toBe(false);
      expect(result.autoReplyEditable).toBe(false);

      mockAppConfigService.botAutoReplyEnabled = true;
    });
  });

  describe('updateSettings', () => {
    it('delegates pricing updates to PricingConfigService and returns merged view', async () => {
      const updated: PricingConfigView = {
        ...pricingView,
        pricingStartingAt: 3000,
        pricingStartingAtText: 'R$ 3.000',
      };
      mockPricingConfigService.update.mockResolvedValue(updated);

      const result = await service.updateSettings({ pricingStartingAt: 3000 });

      expect(mockPricingConfigService.update).toHaveBeenCalledWith({
        pricingStartingAt: 3000,
      });
      expect(result.pricingStartingAt).toBe(3000);
      expect(result.pricingStartingAtText).toBe('R$ 3.000');
      expect(result.autoReplyEnabled).toBe(true);
    });
  });
});
