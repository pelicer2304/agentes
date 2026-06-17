import { Test, TestingModule } from '@nestjs/testing';
import { ConversationService } from './conversation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentReplyService } from '../agent/agent-reply.service';
import { AgentAnalysisService } from '../agent/agent-analysis.service';
import { ContextTrackerService } from '../agent/context-tracker';
import { HandoffManagerService } from '../agent/handoff-manager';
import { ResponseGuardService } from '../agent/response-guard.service';
import { PricingConfigService } from '../inbound/pricing-config.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { FollowUpService } from '../followup/followup.service';
import { EngagementClassifierService } from '../followup/engagement-classifier.service';
import { AppConfigService } from '../config/config.service';
import {
  ConversationContext,
  HandoffState,
  KnownFacts,
} from '../agent/conversation-types';
import { EngagementClassification } from '../followup/followup.types';

/**
 * Task 18.4 — Turn integration tests (jest, no fast-check).
 *
 * Verifies, with mocks, the wiring of the inbound turn around the
 * Engagement_Intent early-branch (R13.3, R13.4):
 *
 *  - `nao_agora` schedules a Deferred_Followup (`scheduleDeferred`) and NEVER
 *    escalates to a human (no handoff), and never calls `onOptOut`.
 *  - `opt_out` cancels via `onOptOut` and NEVER escalates to a human, and never
 *    calls `scheduleDeferred`.
 *  - The turn outcome (side effect + deterministic reply) is produced from the
 *    SYNCHRONOUS classification result and does NOT depend on the asynchronous
 *    CRM analysis (`agentAnalysis.runAsync`): the disengagement turn completes
 *    even when `runAsync` is left pending.
 *
 * Reuses the mock TestingModule pattern of `conversation.service.spec.ts` /
 * `conversation.service.engagement-routing.property.spec.ts`. The cheap gate is
 * satisfied by making `prisma.followUpSchedule.findUnique` return an `active`
 * cycle so the (mocked) classifier path is always taken. `ContextTrackerService`
 * is mocked so the per-turn `handoffState` is controlled (kept `none`).
 */
describe('ConversationService — turn integration (Task 18.4)', () => {
  let service: ConversationService;
  let prisma: jest.Mocked<any>;
  let contextTracker: { build: jest.Mock };
  let engagementClassifier: { classify: jest.Mock };
  let agentAnalysis: { runAsync: jest.Mock };
  let followUp: {
    scheduleDeferred: jest.Mock;
    onOptOut: jest.Mock;
    resumeFromOptOut: jest.Mock;
    onLeadLost: jest.Mock;
    ensureScheduled: jest.Mock;
    onInboundReceived: jest.Mock;
  };
  let idCounter = 0;

  const minimalFacts = (): KnownFacts => ({
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
    secondaryPainsAsked: false,
    volumeAsked: false,
    messageCount: 2,
  });

  const buildContext = (handoffState: HandoffState): ConversationContext => ({
    facts: minimalFacts(),
    handoffState,
    said: {
      offeredDemo: false,
      offeredHandoff: false,
      explainedAiBehavior: false,
      askedVolume: false,
      askedSecondaryPains: false,
      priorAssistantReplies: [],
    },
  });

  // A conversation row (with its lead) as returned by conversation.findUnique.
  // The lead status stays non-`chamar_humano` so "never escalates" is meaningful.
  const baseConversation = () => ({
    id: 'conv-1',
    leadId: 'lead-1',
    channel: 'playground',
    stage: 'descoberta',
    status: 'active',
    handoffRequired: false,
    lead: {
      id: 'lead-1',
      name: 'Playground Lead',
      status: 'qualificando',
      leadScore: 0,
    },
  });

  beforeEach(async () => {
    idCounter = 0;

    const mockPrisma = {
      conversation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(baseConversation()),
        update: jest.fn().mockResolvedValue({}),
      },
      lead: {
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      message: {
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
      // Gate read: an ACTIVE cycle makes the (mocked) classifier path fire.
      followUpSchedule: {
        findUnique: jest.fn().mockResolvedValue({ cycleState: 'active' }),
      },
      $transaction: jest.fn(),
    };

    const mockAgentReply = {
      composeReply: jest.fn().mockResolvedValue({
        reply: 'resposta do LLM',
        stage: 'descoberta',
        intent: 'vendas',
        handoffSignal: 'none',
        needsAsyncAnalysis: false,
        usedLocalRule: false,
        usedFallback: false,
        llmMs: 1,
      }),
      buildContextualFallback: jest.fn().mockReturnValue('fallback'),
      generateQuickReply: jest.fn(),
    };

    // runAsync default resolves; individual tests may override to a pending one.
    const mockAgentAnalysis = { runAsync: jest.fn().mockResolvedValue(undefined) };

    const mockPricingConfig = {
      get: jest.fn().mockResolvedValue({
        id: 'pricing-1',
        pricingRangeEnabled: true,
        pricingStartingAt: 2500,
        pricingText: 'A partir de R$ 2.500.',
        pricingStartingAtText: 'R$ 2.500',
        updatedAt: new Date(),
      }),
    };

    const mockKnowledge = { findAll: jest.fn().mockResolvedValue({}) };

    // ContextTracker is mocked so the per-turn `handoffState` is controlled.
    const mockContextTracker = {
      build: jest.fn().mockReturnValue(buildContext('none')),
    };

    const mockFollowUpService = {
      ensureScheduled: jest.fn().mockResolvedValue(undefined),
      onInboundReceived: jest.fn().mockResolvedValue(undefined),
      onLeadLost: jest.fn().mockResolvedValue(undefined),
      scheduleDeferred: jest.fn().mockResolvedValue(undefined),
      onOptOut: jest.fn().mockResolvedValue(undefined),
      resumeFromOptOut: jest.fn().mockResolvedValue(undefined),
    };

    const mockEngagementClassifier = {
      classify: jest
        .fn()
        .mockResolvedValue({ intent: 'interesse_normal', confidence: 0, failSafe: true }),
    };

    const mockConfig = { followUpDefaultDeferralHours: 5 };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentReplyService, useValue: mockAgentReply },
        { provide: AgentAnalysisService, useValue: mockAgentAnalysis },
        { provide: ContextTrackerService, useValue: mockContextTracker },
        HandoffManagerService,
        ResponseGuardService,
        { provide: PricingConfigService, useValue: mockPricingConfig },
        { provide: KnowledgeService, useValue: mockKnowledge },
        { provide: FollowUpService, useValue: mockFollowUpService },
        { provide: EngagementClassifierService, useValue: mockEngagementClassifier },
        { provide: AppConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    prisma = module.get(PrismaService);
    contextTracker = module.get(
      ContextTrackerService,
    ) as unknown as typeof contextTracker;
    engagementClassifier = module.get(
      EngagementClassifierService,
    ) as unknown as typeof engagementClassifier;
    agentAnalysis = module.get(
      AgentAnalysisService,
    ) as unknown as typeof agentAnalysis;
    followUp = module.get(FollowUpService) as unknown as typeof followUp;
  });

  // ── Helper: assert the turn never marked a handoff anywhere ───────────────
  const expectNoHandoff = (qualification: any) => {
    expect(qualification.shouldHandoff).toBe(false);
    expect(qualification.handoffReason).toBeNull();
    expect(qualification.status).not.toBe('chamar_humano');
    const handoffMarkingUpdate = prisma.conversation.update.mock.calls.some(
      ([arg]: [any]) =>
        arg?.data?.handoffRequired === true ||
        arg?.data?.stage === 'handoff_humano',
    );
    expect(handoffMarkingUpdate).toBe(false);
  };

  describe('nao_agora turn', () => {
    it('schedules a deferred follow-up (offset 5) without handoff and without opt-out', async () => {
      const classification: EngagementClassification = {
        intent: 'nao_agora',
        confidence: 0.9,
        failSafe: false,
        deferral: { durationHours: 5 },
      };
      engagementClassifier.classify.mockResolvedValue(classification);

      const { message, qualification } = await service.handleInboundMessage(
        'conv-1',
        'agora não, me chama daqui uns dias',
      );

      // The classifier ran (the gate was satisfied by the active cycle).
      expect(engagementClassifier.classify).toHaveBeenCalledTimes(1);

      // scheduleDeferred fired exactly once with (conversationId, offset=5, now).
      expect(followUp.scheduleDeferred).toHaveBeenCalledTimes(1);
      expect(followUp.scheduleDeferred).toHaveBeenCalledWith(
        'conv-1',
        5,
        expect.any(Date),
      );

      // No opt-out side effect, and no human escalation.
      expect(followUp.onOptOut).not.toHaveBeenCalled();
      expectNoHandoff(qualification);

      // The assistant reply is the deterministic deferral acknowledgment.
      expect(message).not.toBeNull();
      expect(message?.role).toBe('assistant');
      expect(message?.content).toBe(
        'Fechado! Te dou um toque daqui a 5 horas então. Quando quiser, é só me chamar.',
      );
    });

    it('uses the default deferral offset (5h) when the classifier infers no duration', async () => {
      const classification: EngagementClassification = {
        intent: 'nao_agora',
        confidence: 0.9,
        failSafe: false,
      };
      engagementClassifier.classify.mockResolvedValue(classification);

      const { qualification } = await service.handleInboundMessage(
        'conv-1',
        'agora não dá',
      );

      expect(followUp.scheduleDeferred).toHaveBeenCalledTimes(1);
      expect(followUp.scheduleDeferred).toHaveBeenCalledWith(
        'conv-1',
        5,
        expect.any(Date),
      );
      expect(followUp.onOptOut).not.toHaveBeenCalled();
      expectNoHandoff(qualification);
    });
  });

  describe('opt_out turn', () => {
    it('cancels via onOptOut without handoff and without scheduling a deferral', async () => {
      const classification: EngagementClassification = {
        intent: 'opt_out',
        confidence: 0.95,
        failSafe: false,
      };
      engagementClassifier.classify.mockResolvedValue(classification);

      const { message, qualification } = await service.handleInboundMessage(
        'conv-1',
        'não quero mais receber mensagens, pode parar',
      );

      expect(engagementClassifier.classify).toHaveBeenCalledTimes(1);

      // onOptOut fired exactly once with (conversationId, now); no deferral.
      expect(followUp.onOptOut).toHaveBeenCalledTimes(1);
      expect(followUp.onOptOut).toHaveBeenCalledWith('conv-1', expect.any(Date));
      expect(followUp.scheduleDeferred).not.toHaveBeenCalled();

      expectNoHandoff(qualification);

      // The assistant reply is the deterministic opt-out confirmation.
      expect(message).not.toBeNull();
      expect(message?.content).toBe(
        'Tudo bem, não te envio mais mensagens. Se mudar de ideia, é só me chamar.',
      );
    });
  });

  describe('classification completes before / independently of async CRM analysis', () => {
    it('produces the deferral outcome even when agentAnalysis.runAsync is left pending', async () => {
      // runAsync as a never-resolving (pending) promise: if the turn outcome
      // depended on the async CRM analysis, it would hang or be skipped.
      agentAnalysis.runAsync.mockReturnValue(new Promise<void>(() => {}));

      const classification: EngagementClassification = {
        intent: 'nao_agora',
        confidence: 0.9,
        failSafe: false,
        deferral: { durationHours: 5 },
      };
      engagementClassifier.classify.mockResolvedValue(classification);

      const { message, qualification } = await service.handleInboundMessage(
        'conv-1',
        'agora não, fica pra depois',
      );

      // The synchronous classification result drove the turn outcome.
      expect(engagementClassifier.classify).toHaveBeenCalledTimes(1);
      expect(followUp.scheduleDeferred).toHaveBeenCalledTimes(1);
      expect(message?.content).toBe(
        'Fechado! Te dou um toque daqui a 5 horas então. Quando quiser, é só me chamar.',
      );
      expectNoHandoff(qualification);

      // The disengagement desfecho does NOT depend on the CRM analysis: the
      // async analysis is not a prerequisite (it is not invoked on this path).
      expect(agentAnalysis.runAsync).not.toHaveBeenCalled();
    });

    it('produces the opt-out outcome even when agentAnalysis.runAsync is left pending', async () => {
      agentAnalysis.runAsync.mockReturnValue(new Promise<void>(() => {}));

      const classification: EngagementClassification = {
        intent: 'opt_out',
        confidence: 0.95,
        failSafe: false,
      };
      engagementClassifier.classify.mockResolvedValue(classification);

      const { message, qualification } = await service.handleInboundMessage(
        'conv-1',
        'para de me mandar mensagem',
      );

      expect(engagementClassifier.classify).toHaveBeenCalledTimes(1);
      expect(followUp.onOptOut).toHaveBeenCalledTimes(1);
      expect(message?.content).toBe(
        'Tudo bem, não te envio mais mensagens. Se mudar de ideia, é só me chamar.',
      );
      expectNoHandoff(qualification);
      expect(agentAnalysis.runAsync).not.toHaveBeenCalled();
    });
  });
});
