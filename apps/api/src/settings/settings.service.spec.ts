import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { SettingsService } from './settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

describe('SettingsService', () => {
  let service: SettingsService;

  const mockPrismaService = {
    agentSettings: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SettingsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSettings', () => {
    it('should return default settings when no record exists', async () => {
      mockPrismaService.agentSettings.findFirst.mockResolvedValue(null);

      const result = await service.getSettings();

      expect(result.agentName).toBe('Assistente Decodifica');
      expect(result.initialMessage).toContain('Olá. Sou o Assistente Decodifica');
      expect(result.toneOfVoice).toContain('Consultor educado');
      expect(result.services).toBeInstanceOf(Array);
      expect(result.services!.length).toBeGreaterThan(0);
      expect(result.doNotPromise).toBeInstanceOf(Array);
      expect(result.doNotPromise!.length).toBeGreaterThan(0);
      expect(result.handoffCriteria).toBeInstanceOf(Array);
      expect(result.handoffCriteria!.length).toBeGreaterThan(0);
      expect(result.id).toBe('');
    });

    it('should return stored settings when a record exists', async () => {
      const storedSettings = {
        id: 'uuid-123',
        agentName: 'Custom Agent',
        initialMessage: 'Hello there!',
        toneOfVoice: 'Friendly',
        services: ['Service A', 'Service B'],
        doNotPromise: ['Rule 1'],
        handoffCriteria: ['Criteria 1'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      };

      mockPrismaService.agentSettings.findFirst.mockResolvedValue(storedSettings);

      const result = await service.getSettings();

      expect(result).toEqual({
        id: 'uuid-123',
        agentName: 'Custom Agent',
        initialMessage: 'Hello there!',
        toneOfVoice: 'Friendly',
        services: ['Service A', 'Service B'],
        doNotPromise: ['Rule 1'],
        handoffCriteria: ['Criteria 1'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      });
    });

    it('should query with orderBy createdAt desc', async () => {
      mockPrismaService.agentSettings.findFirst.mockResolvedValue(null);

      await service.getSettings();

      expect(mockPrismaService.agentSettings.findFirst).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('updateSettings', () => {
    const dto: UpdateSettingsDto = {
      agentName: 'New Agent',
      initialMessage: 'New greeting',
      toneOfVoice: 'Professional',
      services: ['Svc 1', 'Svc 2'],
      doNotPromise: ['No promises'],
      handoffCriteria: ['Score >= 70'],
    };

    it('should create a new record when none exists', async () => {
      mockPrismaService.agentSettings.findFirst.mockResolvedValue(null);

      const createdRecord = {
        id: 'new-uuid',
        agentName: dto.agentName,
        initialMessage: dto.initialMessage,
        toneOfVoice: dto.toneOfVoice,
        services: dto.services,
        doNotPromise: dto.doNotPromise,
        handoffCriteria: dto.handoffCriteria,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.agentSettings.create.mockResolvedValue(createdRecord);

      const result = await service.updateSettings(dto);

      expect(mockPrismaService.agentSettings.create).toHaveBeenCalledWith({
        data: {
          agentName: dto.agentName,
          initialMessage: dto.initialMessage,
          toneOfVoice: dto.toneOfVoice,
          services: dto.services,
          doNotPromise: dto.doNotPromise,
          handoffCriteria: dto.handoffCriteria,
        },
      });
      expect(result.agentName).toBe('New Agent');
      expect(result.id).toBe('new-uuid');
    });

    it('should update existing record when one exists', async () => {
      const existingRecord = {
        id: 'existing-uuid',
        agentName: 'Old Agent',
        initialMessage: 'Old greeting',
        toneOfVoice: 'Old tone',
        services: [],
        doNotPromise: [],
        handoffCriteria: [],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      };

      mockPrismaService.agentSettings.findFirst.mockResolvedValue(existingRecord);

      const updatedRecord = {
        id: 'existing-uuid',
        agentName: dto.agentName,
        initialMessage: dto.initialMessage,
        toneOfVoice: dto.toneOfVoice,
        services: dto.services,
        doNotPromise: dto.doNotPromise,
        handoffCriteria: dto.handoffCriteria,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
      };

      mockPrismaService.agentSettings.update.mockResolvedValue(updatedRecord);

      const result = await service.updateSettings(dto);

      expect(mockPrismaService.agentSettings.update).toHaveBeenCalledWith({
        where: { id: 'existing-uuid' },
        data: {
          agentName: dto.agentName,
          initialMessage: dto.initialMessage,
          toneOfVoice: dto.toneOfVoice,
          services: dto.services,
          doNotPromise: dto.doNotPromise,
          handoffCriteria: dto.handoffCriteria,
        },
      });
      expect(result.agentName).toBe('New Agent');
      expect(result.id).toBe('existing-uuid');
    });

    it('should set optional fields to null when not provided', async () => {
      const minimalDto: UpdateSettingsDto = {
        agentName: 'Agent',
        initialMessage: 'Hello',
      };

      mockPrismaService.agentSettings.findFirst.mockResolvedValue(null);

      const createdRecord = {
        id: 'new-uuid',
        agentName: 'Agent',
        initialMessage: 'Hello',
        toneOfVoice: null,
        services: null,
        doNotPromise: null,
        handoffCriteria: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.agentSettings.create.mockResolvedValue(createdRecord);

      await service.updateSettings(minimalDto);

      expect(mockPrismaService.agentSettings.create).toHaveBeenCalledWith({
        data: {
          agentName: 'Agent',
          initialMessage: 'Hello',
          toneOfVoice: null,
          services: Prisma.JsonNull,
          doNotPromise: Prisma.JsonNull,
          handoffCriteria: Prisma.JsonNull,
        },
      });
    });
  });
});
