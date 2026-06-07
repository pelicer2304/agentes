import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';

describe('LeadController', () => {
  let controller: LeadController;
  let service: LeadService;

  const mockLeadService = {
    findAll: jest.fn(),
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LeadController],
      providers: [{ provide: LeadService, useValue: mockLeadService }],
    }).compile();

    controller = module.get<LeadController>(LeadController);
    service = module.get<LeadService>(LeadService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /leads', () => {
    it('should return paginated leads with default params', async () => {
      const paginatedResult = {
        data: [{ id: '1', name: 'Lead 1' }],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      };
      mockLeadService.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.findAll({});

      expect(result).toEqual(paginatedResult);
      expect(mockLeadService.findAll).toHaveBeenCalledWith({
        status: undefined,
        temperature: undefined,
        page: 1,
        pageSize: 20,
      });
    });

    it('should pass filter params to service', async () => {
      mockLeadService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 2,
        pageSize: 10,
        totalPages: 0,
      });

      await controller.findAll({
        status: 'quente',
        temperature: 'morno',
        page: '2',
        pageSize: '10',
      });

      expect(mockLeadService.findAll).toHaveBeenCalledWith({
        status: 'quente',
        temperature: 'morno',
        page: 2,
        pageSize: 10,
      });
    });
  });

  describe('GET /leads/:id', () => {
    it('should return lead by id', async () => {
      const lead = {
        id: 'uuid-1',
        name: 'Test Lead',
        conversations: [],
        agentAnalyses: [],
      };
      mockLeadService.findById.mockResolvedValue(lead);

      const result = await controller.findById('uuid-1');

      expect(result).toEqual(lead);
      expect(mockLeadService.findById).toHaveBeenCalledWith('uuid-1');
    });

    it('should propagate NotFoundException from service', async () => {
      mockLeadService.findById.mockRejectedValue(
        new NotFoundException('Lead with id non-existent not found'),
      );

      await expect(controller.findById('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('PATCH /leads/:id/status', () => {
    it('should update lead status', async () => {
      const updatedLead = { id: 'uuid-1', status: 'convertido' };
      mockLeadService.updateStatus.mockResolvedValue(updatedLead);

      const result = await controller.updateStatus('uuid-1', {
        status: 'convertido',
      });

      expect(result).toEqual(updatedLead);
      expect(mockLeadService.updateStatus).toHaveBeenCalledWith(
        'uuid-1',
        'convertido',
      );
    });

    it('should propagate NotFoundException from service', async () => {
      mockLeadService.updateStatus.mockRejectedValue(
        new NotFoundException('Lead with id non-existent not found'),
      );

      await expect(
        controller.updateStatus('non-existent', { status: 'quente' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
