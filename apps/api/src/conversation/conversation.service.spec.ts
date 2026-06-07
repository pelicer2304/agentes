import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import fc from 'fast-check';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentReplyService } from '../agent/agent-reply.service';
import { AgentAnalysisService } from '../agent/agent-analysis.service';
import { FactExtractorService } from '../agent/fact-extractor.service';
import { ContextTrackerService } from '../agent/context-tracker';
import { HandoffManagerService } from '../agent/handoff-manager';
import { ResponseGuardService } from '../agent/response-guard.service';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { classifyEdgeInput, edgeReply } from '../agent/edge-input';

/**
 * ConversationService specs, updated for the restructured linear pipeline
 * (Tasks 11.4 / 12.1 / 12.2). The pipeline now injects ContextTrackerService
 * and HandoffManagerService and routes the LLM exclusively through
 * `AgentReplyService.composeReply`, with `buildContextualFallback` as the empty
 * reply fallback. Over-length and empty inputs no longer throw — they return a
 * canned edge reply.
 *
 * ContextTrackerService and HandoffManagerService are provided as REAL
 * instances (ContextTracker over a real FactExtractorService, ResponseGuard
 * real) so intent/handoff/guard behavior is realistic; only Prisma,
 * AgentReplyService, AgentAnalysisService and PricingConfigService are mocked.
 */
describe('ConversationService', () => {
  let service: ConversationService;
  let prisma: jest.Mocked<any>;
  let agentReply: jest.Mocked<any>;
  let idCounter = 0;

  // A conversation row (with its lead) as returned by prisma.conversation.findUnique.
  const baseConversation = (overrides: Record<string, any> = {}) => ({
    id: 'conv-1',
    leadId: 'lead-1',
    channel: 'playground',
    stage: 'abertura',
    status: 'active',
    handoffRequired: false,
    lead: { id: 'lead-1', name: 'Playground Lead', status: 'novo' },
    ...overrides,
  });

  beforeEach(async () => {
    idCounter = 0;

    const mockPrisma = {
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      lead: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      message: {
        // Reflect the created data so callers can assert role/content.
        create: jest
          .fn()
          .mockImplementation((args: any) =>
            Promise.resolve({ id: `msg-${idCounter++}`, ...(args?.data ?? {}) }),
          ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      agentSettings: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      agentAnalysis: {
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const mockAgentReply = {
      // The ONLY LLM entry point of the pipeline.
      composeReply: jest.fn().mockResolvedValue({
        reply: 'Para automatizar isso, dá para estruturar o fluxo no WhatsApp. Quer que eu detalhe os próximos passos?',
        stage: 'descoberta',
        intent: 'vendas',
        handoffSignal: 'none',
        needsAsyncAnalysis: true,
        usedLocalRule: false,
        usedFallback: false,
        llmMs: 10,
      }),
      buildContextualFallback: jest
        .fn()
        .mockReturnValue(
          'Para eu te ajudar melhor, me conta qual é o seu negócio e como vocês usam o WhatsApp hoje.',
        ),
      generateQuickReply: jest.fn(),
    };

    const mockAgentAnalysis = {
      runAsync: jest.fn().mockResolvedValue(undefined),
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
        // Real instances so intent/handoff/guard behavior is realistic.
        FactExtractorService,
        ContextTrackerService,
        HandoffManagerService,
        ResponseGuardService,
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
    it('returns a canned edge reply (no throw) for empty content', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());

      const result = await service.handleInboundMessage('conv-1', '');

      expect(result.message).toBeDefined();
      expect(result.message.content).toBe(edgeReply('empty'));
      // Edge inputs never reach the LLM and never mutate the lead (R5.2).
      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('returns a canned over-length reply (no throw) for content exceeding 4000 chars', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());
      const longContent = 'a'.repeat(4001);

      const result = await service.handleInboundMessage('conv-1', longContent);

      expect(result.message.content).toBe(edgeReply('over_length'));
      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(prisma.lead.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent conversation', async () => {
      prisma.conversation.findUnique.mockResolvedValue(null);

      await expect(
        service.handleInboundMessage('non-existent-id', 'Hello'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should process a valid message and reach the LLM (composeReply)', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());
      prisma.message.findMany.mockResolvedValue([
        { role: 'assistant', content: 'Olá!', createdAt: new Date() },
        { role: 'user', content: 'Tenho um restaurante', createdAt: new Date() },
      ]);

      const result = await service.handleInboundMessage('conv-1', 'Tenho um restaurante');

      expect(result.message).toBeDefined();
      expect(result.message.role).toBe('assistant');
      expect(result.qualification).toBeDefined();
      expect(result.qualification.stage).toBe('descoberta');
      // Default mock message has intent general → the LLM path is taken.
      expect(agentReply.composeReply).toHaveBeenCalled();
    });

    it('should still return message even if lead update fails', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());
      prisma.message.findMany.mockResolvedValue([]);
      prisma.lead.update.mockRejectedValue(new Error('DB error'));

      const result = await service.handleInboundMessage('conv-1', 'Hello');

      expect(result.message).toBeDefined();
      expect(result.qualification).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 11.5 — Property 12: Edge inputs preserve established facts (R5.2),
  // asserted over pipeline handling: for any edge input the pipeline never
  // mutates the lead (no prisma.lead.update), while the inbound message is
  // still saved.
  // ───────────────────────────────────────────────────────────────────────────
  describe('Property 12 — edge inputs preserve established facts (pipeline)', () => {
    // Generators for the four non-conversational, non-over-length edge kinds.
    const emptyArb = fc.constant('');
    const whitespaceArb = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 10 })
      .map((parts) => parts.join(''));
    const emojiArb = fc
      .array(fc.constantFrom('😀', '🎉', '👍', '🙏', '❤️', '🔥', '😅'), {
        minLength: 1,
        maxLength: 5,
      })
      .map((parts) => parts.join(''));
    const punctuationArb = fc
      .array(fc.constantFrom('.', ',', '!', '?', ';', ':', '-', '…', '*'), {
        minLength: 1,
        maxLength: 6,
      })
      .map((parts) => parts.join(''));
    const edgeInputArb = fc.oneof(emptyArb, whitespaceArb, emojiArb, punctuationArb);

    // Feature: conversational-agent-quality, Property 12: Edge inputs preserve established facts
    it('never calls lead.update for an edge input, yet always saves the inbound message', async () => {
      // A lead that already carries established facts — they must survive.
      const conversationWithFacts = baseConversation({
        stage: 'descoberta',
        lead: {
          id: 'lead-1',
          name: 'Playground Lead',
          status: 'qualificando',
          segment: 'restaurante',
          mainPain: 'demora para responder',
          estimatedVolume: '200 mensagens por dia',
        },
      });

      await fc.assert(
        fc.asyncProperty(edgeInputArb, async (edgeInput) => {
          // Only exercise genuine edge inputs (exclude any accidental 'none').
          const kind = classifyEdgeInput(edgeInput);
          fc.pre(kind !== 'none' && kind !== 'over_length');

          prisma.conversation.findUnique.mockResolvedValue(conversationWithFacts);
          prisma.lead.update.mockClear();
          prisma.message.create.mockClear();
          agentReply.composeReply.mockClear();

          await service.handleInboundMessage('conv-1', edgeInput);

          // Established facts are not mutated: the lead is never updated.
          expect(prisma.lead.update).not.toHaveBeenCalled();
          // The LLM is never reached for an edge input.
          expect(agentReply.composeReply).not.toHaveBeenCalled();
          // The raw inbound message is still persisted.
          expect(prisma.message.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({ role: 'user', content: edgeInput }),
            }),
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 11.6 — Property 21: Completed handoff shapes acknowledgments and
  // questions (R10.4, R10.5).
  // ───────────────────────────────────────────────────────────────────────────
  describe('Property 21 — completed handoff shapes acks and questions (pipeline)', () => {
    // A conversation already routed to the team → ContextTracker derives the
    // 'completed' handoff state (stage handoff_humano + status chamar_humano).
    const completedConversation = () =>
      baseConversation({
        stage: 'handoff_humano',
        handoffRequired: true,
        lead: {
          id: 'lead-1',
          name: 'Playground Lead',
          status: 'chamar_humano',
          segment: 'restaurante',
          mainPain: 'demora para responder',
        },
      });

    const ackArb = fc.constantFrom('obrigado', 'obrigada', 'valeu', 'ok', 'beleza');

    // Feature: conversational-agent-quality, Property 21: Completed handoff shapes acknowledgments and questions
    it('answers a simple acknowledgment with the "already routed to the team" reply', async () => {
      prisma.message.findMany.mockResolvedValue([
        { role: 'assistant', content: 'Vou encaminhar seu caso para a equipe.', createdAt: new Date() },
      ]);

      await fc.assert(
        fc.asyncProperty(ackArb, async (ack) => {
          prisma.conversation.findUnique.mockResolvedValue(completedConversation());
          agentReply.composeReply.mockClear();

          const result = await service.handleInboundMessage('conv-1', ack);

          // The case was already routed to the team (R10.4); no LLM call.
          expect(agentReply.composeReply).not.toHaveBeenCalled();
          expect(result.message.content).toMatch(/encaminhado para a equipe/i);
        }),
        { numRuns: 100 },
      );
    });

    // Feature: conversational-agent-quality, Property 21: Completed handoff shapes acknowledgments and questions
    it('answers a new direct question via the LLM with the team-contact note', async () => {
      const llmAnswer =
        'A integração depende de uma avaliação técnica do time. A equipe pode te passar mais detalhes no contato. Quer que eu adiante alguma informação?';
      agentReply.composeReply.mockResolvedValue({
        reply: llmAnswer,
        stage: 'handoff_humano',
        intent: 'integracao',
        handoffSignal: 'none',
        needsAsyncAnalysis: true,
        usedLocalRule: false,
        usedFallback: false,
        llmMs: 10,
      });

      const questionArb = fc.constantFrom(
        'como funciona a integração?',
        'qual o prazo de implementação?',
        'como vocês fazem o suporte?',
      );

      await fc.assert(
        fc.asyncProperty(questionArb, async (question) => {
          prisma.conversation.findUnique.mockResolvedValue(completedConversation());
          prisma.message.findMany.mockResolvedValue([
            { role: 'assistant', content: 'Seu caso já foi encaminhado.', createdAt: new Date() },
          ]);
          agentReply.composeReply.mockClear();

          const result = await service.handleInboundMessage('conv-1', question);

          // A new direct question is answered (LLM path), not closed with the ack.
          expect(agentReply.composeReply).toHaveBeenCalled();
          // The team-contact note (R10.5) is delivered with the answer.
          expect(result.message.content).toMatch(/mais detalhes no contato/i);
          expect(result.message.content).not.toMatch(
            /já foi encaminhado para a equipe da Decodifica com o resumo/i,
          );
        }),
        { numRuns: 100 },
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 11.7 — integration / mock-based pipeline tests (R4.1, R4.3, R5.3, R9.4).
  // Assert stage ordering command → edge → price → preference → LLM, that the
  // command/edge/price paths never invoke the LLM, that typed /clear and /reset
  // trigger the clear/reset code paths, and that a normal turn persists newly
  // established facts.
  // ───────────────────────────────────────────────────────────────────────────
  describe('pipeline stage ordering and routing', () => {
    it('command stage precedes price: an undefined slash token lists commands and bypasses the LLM', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());

      // "/preço quanto custa" begins with '/' so the command stage wins even
      // though the text also contains price phrasing.
      const result = await service.handleInboundMessage('conv-1', '/preço quanto custa');

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(result.message.content).toContain('comandos que eu reconheço');
    });

    it('typed /clear wipes everything and returns the fresh greeting, bypassing the LLM', async () => {
      const greeting = {
        id: 'greet',
        role: 'assistant',
        direction: 'outbound',
        content:
          'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica.',
      };
      prisma.conversation.findUnique.mockResolvedValue(
        baseConversation({ messages: [greeting], agentAnalyses: [] }),
      );

      const txStub = {
        agentAnalysis: { deleteMany: jest.fn().mockResolvedValue({}) },
        message: {
          deleteMany: jest.fn().mockResolvedValue({}),
          create: jest.fn().mockResolvedValue({}),
        },
        conversation: { update: jest.fn().mockResolvedValue({}) },
        lead: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (fn: Function) => fn(txStub));

      const result = await service.handleInboundMessage('conv-1', '/clear');

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      // Same persistence path as the HTTP DELETE endpoint: clears messages/analyses.
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(txStub.message.deleteMany).toHaveBeenCalled();
      expect(txStub.agentAnalysis.deleteMany).toHaveBeenCalled();
      // Returns the fresh greeting (no confirmation message) with a fully reset lead.
      expect(result.message).toBe(greeting);
      expect(result.qualification.status).toBe('novo');
      expect(result.qualification.leadScore).toBe(0);
    });

    it('typed /reset wipes everything and returns the fresh greeting, bypassing the LLM', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());
      prisma.conversation.update.mockResolvedValue({ id: 'conv-1', status: 'inactive' });

      const greeting = {
        id: 'm2',
        role: 'assistant',
        direction: 'outbound',
        content:
          'Olá. Sou o DecodificaIA, atendente inteligente da Decodifica.',
      };
      const txStub = {
        lead: { create: jest.fn().mockResolvedValue({ id: 'lead-2' }) },
        conversation: {
          create: jest.fn().mockResolvedValue({
            id: 'conv-2',
            leadId: 'lead-2',
            stage: 'abertura',
            status: 'active',
            handoffRequired: false,
          }),
        },
        message: { create: jest.fn().mockResolvedValue(greeting) },
      };
      prisma.$transaction.mockImplementation(async (fn: Function) => fn(txStub));

      const result = await service.handleInboundMessage('conv-1', '/reset');

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { stage: 'handoff_humano', status: 'inactive' },
      });
      expect(txStub.lead.create).toHaveBeenCalled();
      // Returns the fresh greeting from the new conversation with a clean lead state.
      expect(result.message).toBe(greeting);
      expect(result.qualification.status).toBe('novo');
    });

    it('edge stage: an emoji-only message is answered with a canned reply and bypasses the LLM', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());

      const result = await service.handleInboundMessage('conv-1', '😀😀');

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(result.message.content).toBe(edgeReply('emoji_only'));
    });

    it('price stage: a price question is answered deterministically and bypasses the LLM', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());

      const result = await service.handleInboundMessage('conv-1', 'quanto custa?');

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      // Enabled pricing range → the configured starting price is shared.
      expect(result.message.content).toContain('R$ 2.500');
    });

    it('preference stage: an explicit human request routes to handoff and bypasses the LLM', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());

      const result = await service.handleInboundMessage(
        'conv-1',
        'quero falar com um atendente',
      );

      expect(agentReply.composeReply).not.toHaveBeenCalled();
      expect(result.message.content).toMatch(/encaminhar/i);
    });

    it('LLM stage: a general message reaches composeReply', async () => {
      prisma.conversation.findUnique.mockResolvedValue(baseConversation());
      prisma.message.findMany.mockResolvedValue([
        { role: 'user', content: 'me explica melhor isso ai', createdAt: new Date() },
      ]);

      await service.handleInboundMessage('conv-1', 'me explica melhor isso ai');

      expect(agentReply.composeReply).toHaveBeenCalled();
    });

    it('persists newly established facts to the lead on a normal turn (R9.4)', async () => {
      prisma.conversation.findUnique.mockResolvedValue(
        baseConversation({ lead: { id: 'lead-1', name: 'Playground Lead', status: 'novo' } }),
      );
      prisma.message.findMany.mockResolvedValue([
        { role: 'user', content: 'tenho uma clínica odontológica', createdAt: new Date() },
      ]);

      await service.handleInboundMessage('conv-1', 'tenho uma clínica odontológica');

      expect(prisma.lead.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lead-1' },
          data: expect.objectContaining({ segment: 'clínica' }),
        }),
      );
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
        agentAnalyses: [{ id: 'analysis-1', score: 30, temperature: 'frio' }],
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
