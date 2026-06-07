import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { InboxService } from './inbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionService } from '../modules/channels/evolution/evolution.service';

describe('InboxService', () => {
  let service: InboxService;

  const mockPrismaService = {
    conversation: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
    },
    botEvent: {
      create: jest.fn(),
    },
  };

  const mockEvolutionService = {
    sendTextMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InboxService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EvolutionService, useValue: mockEvolutionService },
      ],
    }).compile();

    service = module.get<InboxService>(InboxService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should query only whatsapp conversations with lead and last message', async () => {
      mockPrismaService.conversation.findMany.mockResolvedValue([]);

      await service.list();

      expect(mockPrismaService.conversation.findMany).toHaveBeenCalledWith({
        where: { channel: 'whatsapp' },
        include: {
          lead: true,
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    it('should map conversation to inbox item with lead state and last message (Req 16.1)', async () => {
      const lastMessageAt = new Date('2024-01-02T10:00:00Z');
      mockPrismaService.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          leadId: 'lead-1',
          channel: 'whatsapp',
          status: 'qualificando',
          botPaused: false,
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
          lastOutboundAt: lastMessageAt,
          lastInboundAt: null,
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          lead: {
            id: 'lead-1',
            name: 'Maria',
            phone: '5511999999999',
            status: 'qualificando',
            temperature: 'morno',
            leadScore: 42,
          },
          messages: [
            {
              content: 'Oi, quero saber preço',
              direction: 'inbound',
              role: 'user',
              createdAt: lastMessageAt,
            },
          ],
        },
      ]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        conversationId: 'conv-1',
        leadId: 'lead-1',
        name: 'Maria',
        phone: '5511999999999',
        status: 'qualificando',
        temperature: 'morno',
        leadScore: 42,
        channel: 'whatsapp',
        botPaused: false,
        handoff: {
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
        },
        lastMessageAt,
      });
      expect(result[0].lastMessage).toMatchObject({
        content: 'Oi, quero saber preço',
        direction: 'inbound',
      });
    });

    it('should fall back to phone when lead name is unset', async () => {
      mockPrismaService.conversation.findMany.mockResolvedValue([
        {
          id: 'conv-1',
          leadId: 'lead-1',
          channel: 'whatsapp',
          status: 'novo',
          botPaused: false,
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
          lastOutboundAt: null,
          lastInboundAt: null,
          updatedAt: new Date(),
          lead: { id: 'lead-1', name: '', phone: '5511888888888', status: 'novo' },
          messages: [],
        },
      ]);

      const result = await service.list();

      expect(result[0].name).toBe('5511888888888');
      expect(result[0].lastMessage).toBeNull();
    });

    it('should order conversations by most recent activity (Req 16.5)', async () => {
      mockPrismaService.conversation.findMany.mockResolvedValue([
        {
          id: 'older',
          leadId: 'lead-1',
          channel: 'whatsapp',
          status: 'novo',
          botPaused: false,
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
          lastOutboundAt: new Date('2024-01-01T00:00:00Z'),
          lastInboundAt: null,
          updatedAt: new Date('2024-01-01T00:00:00Z'),
          lead: { id: 'lead-1', name: 'A', phone: '1', status: 'novo' },
          messages: [],
        },
        {
          id: 'newer',
          leadId: 'lead-2',
          channel: 'whatsapp',
          status: 'novo',
          botPaused: false,
          handoffOffered: false,
          handoffAccepted: false,
          handoffCompleted: false,
          lastOutboundAt: new Date('2024-03-01T00:00:00Z'),
          lastInboundAt: null,
          updatedAt: new Date('2024-03-01T00:00:00Z'),
          lead: { id: 'lead-2', name: 'B', phone: '2', status: 'novo' },
          messages: [],
        },
      ]);

      const result = await service.list();

      expect(result.map((item) => item.conversationId)).toEqual([
        'newer',
        'older',
      ]);
    });
  });

  describe('getDetail', () => {
    it('should throw NotFoundException when conversation does not exist', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(service.getDetail('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return full chat plus lead side panel (Req 16.2, 16.3)', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        channel: 'whatsapp',
        status: 'qualificando',
        stage: 'discovery',
        instanceName: 'inst-1',
        botPaused: false,
        assignedTo: null,
        handoffOffered: true,
        handoffAccepted: false,
        handoffCompleted: false,
        lastInboundAt: null,
        lastOutboundAt: null,
        lead: {
          id: 'lead-1',
          name: 'Maria',
          phone: '5511999999999',
          status: 'qualificando',
          temperature: 'morno',
          leadScore: 42,
          segment: 'varejo',
          mainPain: 'demora no atendimento',
          secondaryPains: ['custo'],
          summary: 'Lead interessado em automação',
          nextStep: 'Agendar call',
        },
        messages: [
          {
            id: 'm1',
            role: 'user',
            direction: 'inbound',
            content: 'Oi',
            messageType: 'text',
            createdAt: new Date('2024-01-01T00:00:00Z'),
          },
          {
            id: 'm2',
            role: 'assistant',
            direction: 'outbound',
            content: 'Olá!',
            messageType: 'text',
            createdAt: new Date('2024-01-01T00:01:00Z'),
          },
        ],
        agentAnalyses: [],
      });

      const result = await service.getDetail('conv-1');

      expect(result.messages).toHaveLength(2);
      expect(result.lead).toMatchObject({
        id: 'lead-1',
        name: 'Maria',
        pains: { mainPain: 'demora no atendimento', secondaryPains: ['custo'] },
        commercialSummary: 'Lead interessado em automação',
        nextStep: 'Agendar call',
      });
      expect(result.handoff.handoffOffered).toBe(true);
      expect(result.actions.canSendManual).toBe(true);
    });

    it('should fall back to latest analysis for summary and next step', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        channel: 'whatsapp',
        status: 'qualificando',
        stage: 'discovery',
        instanceName: null,
        botPaused: true,
        assignedTo: 'user-1',
        handoffOffered: false,
        handoffAccepted: false,
        handoffCompleted: false,
        lastInboundAt: null,
        lastOutboundAt: null,
        lead: {
          id: 'lead-1',
          name: 'Joao',
          phone: '551130000000',
          status: 'qualificando',
          temperature: null,
          leadScore: null,
          segment: null,
          mainPain: null,
          secondaryPains: null,
          summary: null,
          nextStep: null,
        },
        messages: [],
        agentAnalyses: [
          {
            mainPain: 'pain from analysis',
            commercialSummary: 'analysis summary',
            nextBestQuestion: 'analysis next step',
          },
        ],
      });

      const result = await service.getDetail('conv-1');

      expect(result.lead.pains.mainPain).toBe('pain from analysis');
      expect(result.lead.commercialSummary).toBe('analysis summary');
      expect(result.lead.nextStep).toBe('analysis next step');
      // botPaused => resume available, pause/takeover unavailable
      expect(result.actions.canResume).toBe(true);
      expect(result.actions.canPause).toBe(false);
      expect(result.actions.canTakeover).toBe(false);
    });
  });

  describe('sendManualMessage', () => {
    const conversationRow = {
      id: 'conv-1',
      leadId: 'lead-1',
      instanceName: 'inst-1',
      lead: { id: 'lead-1', phone: '5511999999999' },
    };

    const detailRow = {
      id: 'conv-1',
      channel: 'whatsapp',
      status: 'aguardando_humano',
      stage: 'discovery',
      instanceName: 'inst-1',
      botPaused: true,
      assignedTo: 'user-1',
      handoffOffered: false,
      handoffAccepted: false,
      handoffCompleted: false,
      lastInboundAt: null,
      lastOutboundAt: null,
      lead: {
        id: 'lead-1',
        name: 'Maria',
        phone: '5511999999999',
        status: 'aguardando_humano',
        temperature: null,
        leadScore: null,
        segment: null,
        mainPain: null,
        secondaryPains: null,
        summary: null,
        nextStep: null,
      },
      messages: [],
      agentAnalyses: [],
    };

    it('should throw NotFoundException when conversation is missing', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.sendManualMessage('missing', 'user-1', 'Olá'),
      ).rejects.toThrow(NotFoundException);
      expect(mockEvolutionService.sendTextMessage).not.toHaveBeenCalled();
    });

    it('should deliver, save outbound message attributed to team, and record human_message_sent on success (Req 13.1, 13.2)', async () => {
      mockPrismaService.conversation.findUnique
        .mockResolvedValueOnce(conversationRow) // requireConversation
        .mockResolvedValueOnce(detailRow); // getDetail
      mockEvolutionService.sendTextMessage.mockResolvedValue({
        ok: true,
        data: { externalMessageId: 'ext-1' },
      });
      mockPrismaService.message.create.mockResolvedValue({ id: 'msg-1' });
      mockPrismaService.conversation.update.mockResolvedValue({});
      mockPrismaService.botEvent.create.mockResolvedValue({});

      await service.sendManualMessage('conv-1', 'user-1', 'Olá cliente');

      expect(mockEvolutionService.sendTextMessage).toHaveBeenCalledWith(
        '5511999999999',
        'Olá cliente',
      );
      expect(mockPrismaService.message.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          conversationId: 'conv-1',
          direction: 'outbound',
          content: 'Olá cliente',
          deliveryStatus: 'sent',
          externalMessageId: 'ext-1',
          externalChatId: '5511999999999',
          instanceName: 'inst-1',
          metadata: { sentBy: 'user-1', manual: true },
        }),
      });
      expect(mockPrismaService.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: expect.objectContaining({ lastOutboundAt: expect.any(Date) }),
        }),
      );
      expect(mockPrismaService.botEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'human_message_sent',
          conversationId: 'conv-1',
          leadId: 'lead-1',
        }),
      });
    });

    it('should record evolution_error and throw BadGatewayException on failure without saving a message (Req 13.3)', async () => {
      mockPrismaService.conversation.findUnique.mockResolvedValue(
        conversationRow,
      );
      mockEvolutionService.sendTextMessage.mockResolvedValue({
        ok: false,
        error: 'send failed',
      });
      mockPrismaService.botEvent.create.mockResolvedValue({});

      await expect(
        service.sendManualMessage('conv-1', 'user-1', 'Olá'),
      ).rejects.toThrow(BadGatewayException);

      expect(mockPrismaService.message.create).not.toHaveBeenCalled();
      expect(mockPrismaService.conversation.update).not.toHaveBeenCalled();
      expect(mockPrismaService.botEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'evolution_error',
          conversationId: 'conv-1',
          leadId: 'lead-1',
        }),
      });
    });
  });
});
