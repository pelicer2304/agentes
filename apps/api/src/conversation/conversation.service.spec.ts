import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentReplyService } from '../agent/agent-reply.service';
import { AgentAnalysisService } from '../agent/agent-analysis.service';
import { FactExtractorService } from '../agent/fact-extractor.service';
import { ResponseGuardService } from '../agent/response-guard.service';
import { PricingConfigService } from '../inbound/pricing-config.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: jest.Mocked<any>;
  let agentReply: jest.Mocked<any>;

  beforeEach(async () => {
    const mockPrisma = {
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      lead: {
        create: jest.fn(),
        update: jest.fn(),
      },
      message: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
      agentSettings: {
        findFirst: jest.fn(),
      },
      agentAnalysis: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockAgentReply = {
      generateQuickReply: jest.fn().mockResolvedValue({
        reply: 'Que legal! Me conta mais sobre seu negócio?',
        stage: 'descoberta',
        intent: 'vendas',
        handoffSignal: 'none',
        needsAsyncAnalysis: true,
        usedLocalRule: false,
        usedFallback: false,
        llmMs: 100,
        model: 'gpt-4',
      }),
    };

    const mockAgentAnalysis = {
      runAsync: jest.fn().mockResolvedValue(undefined),
    };

    const mockFactExtractor = {
      extract: jest.fn().mockReturnValue({
        segment: null,
        businessDescription: null,
        whatsappUsage: null,
        volume: null,
        systems: null,
        decisionRole: null,
        knownPains: [],
        mainPain: null,
        priceAskedCount: 0,
        handoffOffered: false,
        handoffAccepted: false,
        handoffCompleted: false,
        painMappingAsked: false,
        messageCount: 2,
      }),
    };

    const mockResponseGuard = {
      guard: jest.fn().mockImplementation((input) => ({
        reply: input.reply,
        changed: false,
        guardReason: null,
      })),
    };

    const mockPricingConfig = {
      get: jest.fn().mockResolvedValue({
        id: 'pricing-1',
        pricingRangeEnabled: true,
        pricingStartingAt: 2500,
        pricingText: 'Projetos simples começam a partir de R$ 2.500.',
        pricingStartingAtText: 'R$ 2.500',
        updatedAt: new Date(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentReplyService, useValue: mockAgentReply },
        { provide: AgentAnalysisService, useValue: mockAgentAnalysis },
        { provide: FactExtractorService, useValue: mockFactExtractor },
        { provide: ResponseGuardService, useValue: mockResponseGuard },
        { provide: PricingConfigService, useValue: mockPricingConfig },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    prisma = module.get(PrismaService);
    agentReply = module.get(AgentReplyService);
  });

  describe('createConversation', () => {
    it('should close existing active conversations and create a new one', async () => {
      const mockLead = { id: 'lead-1', name: 'Playground Lead', phone: 'playground', status: 'novo' };
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'abertura',
        status: 'active',
        handoffRequired: false,
      };
      const mockMessage = {
        id: 'msg-1',
        conversationId: 'conv-1',
        role: 'assistant',
        direction: 'outbound',
        content: 'Olá! Sou o Assistente Decodifica...',
      };

      prisma.agentSettings.findFirst.mockResolvedValue({
        agentName: 'Assistente Decodifica',
        initialMessage: 'Olá! Sou o Assistente Decodifica...',
        toneOfVoice: null,
        services: null,
        doNotPromise: null,
        handoffCriteria: null,
      });

      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          lead: { create: jest.fn().mockResolvedValue(mockLead) },
          conversation: { create: jest.fn().mockResolvedValue(mockConversation) },
          message: { create: jest.fn().mockResolvedValue(mockMessage) },
        };
        return fn(tx);
      });

      const result = await service.createConversation();

      expect(prisma.conversation.updateMany).toHaveBeenCalledWith({
        where: { channel: 'playground', status: 'active' },
        data: { status: 'inactive', stage: 'handoff_humano' },
      });
      expect(result).toBeDefined();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('assistant');
    });

    it('should use default settings when no agent settings exist in DB', async () => {
      prisma.agentSettings.findFirst.mockResolvedValue(null);

      const mockLead = { id: 'lead-1', name: 'Playground Lead', phone: 'playground', status: 'novo' };
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'abertura',
        status: 'active',
        handoffRequired: false,
      };

      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          lead: { create: jest.fn().mockResolvedValue(mockLead) },
          conversation: { create: jest.fn().mockResolvedValue(mockConversation) },
          message: {
            create: jest.fn().mockImplementation((data: any) => ({
              id: 'msg-1',
              ...data.data,
            })),
          },
        };
        return fn(tx);
      });

      const result = await service.createConversation();

      expect(result).toBeDefined();
      expect(result.messages[0].content).toContain('DecodificaIA');
    });
  });

  describe('handleInboundMessage', () => {
    it('should throw BadRequestException for empty content', async () => {
      await expect(
        service.handleInboundMessage('conv-1', ''),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for content exceeding 4000 chars', async () => {
      const longContent = 'a'.repeat(4001);
      await expect(
        service.handleInboundMessage('conv-1', longContent),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.handleInboundMessage('non-existent-id', 'Hello'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should process a valid message and return response with qualification', async () => {
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'abertura',
        status: 'active',
        handoffRequired: false,
        lead: { id: 'lead-1', name: 'Playground Lead', status: 'novo' },
      };

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create.mockResolvedValueOnce({
        id: 'msg-user',
        conversationId: 'conv-1',
        role: 'user',
        direction: 'inbound',
        content: 'Tenho um restaurante',
      });
      prisma.message.findMany.mockResolvedValue([
        { role: 'assistant', content: 'Olá!', createdAt: new Date() },
        { role: 'user', content: 'Tenho um restaurante', createdAt: new Date() },
      ]);
      prisma.agentSettings.findFirst.mockResolvedValue(null);
      prisma.message.create.mockResolvedValueOnce({
        id: 'msg-assistant',
        conversationId: 'conv-1',
        role: 'assistant',
        direction: 'outbound',
        content: 'Que legal! Me conta mais sobre seu negócio?',
      });
      prisma.lead.update.mockResolvedValue({});

      const result = await service.handleInboundMessage('conv-1', 'Tenho um restaurante');

      expect(result.message).toBeDefined();
      expect(result.message.role).toBe('assistant');
      expect(result.qualification).toBeDefined();
      expect(result.qualification.stage).toBe('descoberta');
      expect(agentReply.generateQuickReply).toHaveBeenCalled();
    });

    it('should still return message even if lead update fails', async () => {
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'abertura',
        status: 'active',
        handoffRequired: false,
        lead: { id: 'lead-1', name: 'Playground Lead', status: 'novo' },
      };

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.message.create
        .mockResolvedValueOnce({
          id: 'msg-user',
          conversationId: 'conv-1',
          role: 'user',
          direction: 'inbound',
          content: 'Hello',
        })
        .mockResolvedValueOnce({
          id: 'msg-assistant',
          conversationId: 'conv-1',
          role: 'assistant',
          direction: 'outbound',
          content: 'Que legal! Me conta mais sobre seu negócio?',
        });
      prisma.message.findMany.mockResolvedValue([]);
      prisma.agentSettings.findFirst.mockResolvedValue(null);
      prisma.lead.update.mockRejectedValue(new Error('DB error'));

      const result = await service.handleInboundMessage('conv-1', 'Hello');

      // Should still return the message despite lead update failure
      expect(result.message).toBeDefined();
      expect(result.qualification).toBeDefined();
    });
  });

  describe('getConversation', () => {
    it('should throw NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.getConversation('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return conversation with messages and latest analysis', async () => {
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'descoberta',
        status: 'active',
        lead: { id: 'lead-1', name: 'Playground Lead' },
        messages: [
          { id: 'msg-1', role: 'assistant', content: 'Olá!' },
          { id: 'msg-2', role: 'user', content: 'Oi' },
        ],
        agentAnalyses: [
          { id: 'analysis-1', score: 30, temperature: 'frio' },
        ],
      };

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);

      const result = await service.getConversation('conv-1');

      expect(result.id).toBe('conv-1');
      expect(result.messages).toHaveLength(2);
      expect(result.latestAnalysis).toBeDefined();
      expect(result.latestAnalysis.score).toBe(30);
    });
  });

  describe('resetConversation', () => {
    it('should throw NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.resetConversation('non-existent-id'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should mark current conversation as inactive and create a new one', async () => {
      const mockConversation = {
        id: 'conv-1',
        leadId: 'lead-1',
        channel: 'playground',
        stage: 'descoberta',
        status: 'active',
      };

      prisma.conversation.findUnique.mockResolvedValue(mockConversation);
      prisma.conversation.update.mockResolvedValue({
        ...mockConversation,
        stage: 'handoff_humano',
        status: 'inactive',
      });

      // Mock for createConversation call
      prisma.agentSettings.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: Function) => {
        const tx = {
          lead: {
            create: jest.fn().mockResolvedValue({
              id: 'lead-2',
              name: 'Playground Lead',
              phone: 'playground',
              status: 'novo',
            }),
          },
          conversation: {
            create: jest.fn().mockResolvedValue({
              id: 'conv-2',
              leadId: 'lead-2',
              channel: 'playground',
              stage: 'abertura',
              status: 'active',
              handoffRequired: false,
            }),
          },
          message: {
            create: jest.fn().mockResolvedValue({
              id: 'msg-1',
              conversationId: 'conv-2',
              role: 'assistant',
              direction: 'outbound',
              content: 'Olá!',
            }),
          },
        };
        return fn(tx);
      });

      const result = await service.resetConversation('conv-1');

      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { stage: 'handoff_humano', status: 'inactive' },
      });
      expect(result).toBeDefined();
      expect(result.stage).toBe('abertura');
    });
  });
});
