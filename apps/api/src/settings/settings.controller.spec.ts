import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

describe('SettingsController', () => {
  let controller: SettingsController;

  const mockSettingsService = {
    getSettings: jest.fn(),
    updateSettings: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        { provide: SettingsService, useValue: mockSettingsService },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /settings', () => {
    it('should return settings from the service', async () => {
      const settings = {
        id: 'uuid-123',
        agentName: 'Assistente Decodifica',
        initialMessage: 'Hello!',
        toneOfVoice: 'Professional',
        services: ['Service A'],
        doNotPromise: ['Rule 1'],
        handoffCriteria: ['Criteria 1'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSettingsService.getSettings.mockResolvedValue(settings);

      const result = await controller.getSettings();

      expect(result).toEqual(settings);
      expect(mockSettingsService.getSettings).toHaveBeenCalledTimes(1);
    });

    it('should return default settings when no record exists', async () => {
      const defaultSettings = {
        id: '',
        agentName: 'Assistente Decodifica',
        initialMessage: 'Olá. Sou o Assistente Decodifica...',
        toneOfVoice: 'Consultor educado...',
        services: ['Chatbot inteligente para WhatsApp'],
        doNotPromise: ['Não prometer prazos específicos sem diagnóstico'],
        handoffCriteria: ['Lead com score >= 70'],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSettingsService.getSettings.mockResolvedValue(defaultSettings);

      const result = await controller.getSettings();

      expect(result).toEqual(defaultSettings);
    });
  });

  describe('PATCH /settings', () => {
    it('should update settings and return the result', async () => {
      const dto: UpdateSettingsDto = {
        agentName: 'New Agent',
        initialMessage: 'New greeting',
        toneOfVoice: 'Friendly',
        services: ['Svc 1', 'Svc 2'],
        doNotPromise: ['No promises'],
        handoffCriteria: ['Score >= 70'],
      };

      const updatedSettings = {
        id: 'uuid-123',
        agentName: dto.agentName,
        initialMessage: dto.initialMessage,
        toneOfVoice: dto.toneOfVoice,
        services: dto.services,
        doNotPromise: dto.doNotPromise,
        handoffCriteria: dto.handoffCriteria,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSettingsService.updateSettings.mockResolvedValue(updatedSettings);

      const result = await controller.updateSettings(dto);

      expect(result).toEqual(updatedSettings);
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(dto);
    });

    it('should pass minimal dto to service', async () => {
      const dto: UpdateSettingsDto = {
        agentName: 'Agent',
        initialMessage: 'Hello',
      };

      const updatedSettings = {
        id: 'uuid-456',
        agentName: 'Agent',
        initialMessage: 'Hello',
        toneOfVoice: null,
        services: null,
        doNotPromise: null,
        handoffCriteria: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockSettingsService.updateSettings.mockResolvedValue(updatedSettings);

      const result = await controller.updateSettings(dto);

      expect(result).toEqual(updatedSettings);
      expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(dto);
    });
  });
});
