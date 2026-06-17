import { Test, TestingModule } from '@nestjs/testing';
import fc from 'fast-check';
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
 * Property 20 — Desengajamento nunca escala para o time humano.
 *
 * For ANY current handoff state (`none`, `suggested`, `accepted`) and ANY turn
 * whose Engagement_Intent is `nao_agora` or `opt_out`, the turn routing must
 * never classify the message as a human request/accept, never transition to
 * `accepted` (including via the `general`/`suggested` auto-escalation rule),
 * and `finalHandoff` must stay false.
 *
 * Strategy: the ConversationService is wired with the same mock TestingModule
 * pattern as `conversation.service.spec.ts`, but `ContextTrackerService.build`
 * is mocked so the per-turn `handoffState` is fully controlled by the generator
 * (it is normally derived from the lead/conversation/history). The engagement
 * classifier is mocked to return a disengagement intent each iteration. The
 * cheap gate is satisfied by making `prisma.followUpSchedule.findUnique` return
 * an `active` cycle so the classifier path is always taken.
 */
describe('ConversationService — engagement routing (Property 20)', () => {
  let service: ConversationService;
  let prisma: jest.Mocked<any>;
  let contextTracker: { build: jest.Mock };
  let engagementClassifier: { classify: jest.Mock };
  let followUp: {
    scheduleDeferred: jest.Mock;
    onOptOut: jest.Mock;
    resumeFromOptOut: jest.Mock;
    onLeadLost: jest.Mock;
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
  // The lead status is kept non-`chamar_humano` so the assertion that a
  // disengagement turn never yields `chamar_humano` is meaningful.
  const baseConversation = (leadStatus: string) => ({
    id: 'conv-1',
    leadId: 'lead-1',
    channel: 'playground',
    stage: 'descoberta',
    status: 'active',
    handoffRequired: false,
    lead: { id: 'lead-1', name: 'Playground Lead', status: leadStatus, leadScore: 0 },
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
      // Gate read: an ACTIVE cycle makes the classifier path always fire.
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

    // ContextTracker is mocked so the generator fully controls `handoffState`.
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
    contextTracker = module.get(ContextTrackerService) as unknown as typeof contextTracker;
    engagementClassifier = module.get(
      EngagementClassifierService,
    ) as unknown as typeof engagementClassifier;
    followUp = module.get(FollowUpService) as unknown as typeof followUp;
  });

  // Feature: lead-followup, Property 20: Desengajamento nunca escala para o time humano
  it('a disengagement turn (nao_agora/opt_out) never escalates to a human, for any handoff state', async () => {
    const handoffStateArb = fc.constantFrom<HandoffState>('none', 'suggested', 'accepted');
    const intentArb = fc.constantFrom<EngagementClassification['intent']>(
      'nao_agora',
      'opt_out',
    );
    // nao_agora may carry an inferred deferral; opt_out never does.
    const deferralArb = fc.option(
      fc.record({ durationHours: fc.integer({ min: 1, max: 72 }) }),
      { nil: undefined },
    );
    const confidenceArb = fc.float({ min: 0, max: 1, noNaN: true });
    const leadStatusArb = fc.constantFrom('novo', 'qualificando', 'em_atendimento');

    await fc.assert(
      fc.asyncProperty(
        handoffStateArb,
        intentArb,
        deferralArb,
        confidenceArb,
        leadStatusArb,
        async (handoffState, intent, deferral, confidence, leadStatus) => {
          // Reset side-effect mocks per iteration.
          prisma.conversation.update.mockClear();
          followUp.scheduleDeferred.mockClear();
          followUp.onOptOut.mockClear();
          followUp.resumeFromOptOut.mockClear();
          followUp.onLeadLost.mockClear();

          // Drive the per-turn handoff state via the (mocked) ContextTracker.
          contextTracker.build.mockReturnValue(buildContext(handoffState));
          prisma.conversation.findUnique.mockResolvedValue(baseConversation(leadStatus));

          const classification: EngagementClassification = {
            intent,
            confidence,
            failSafe: false,
            ...(intent === 'nao_agora' && deferral ? { deferral } : {}),
          };
          engagementClassifier.classify.mockResolvedValue(classification);

          const { qualification } = await service.handleInboundMessage(
            'conv-1',
            'vou ver isso e te chamo mais pra frente',
          );

          // 1. The turn never requests/accepts a human handoff.
          expect(qualification.shouldHandoff).toBe(false);
          expect(qualification.handoffReason).toBeNull();

          // 2. The status never escalates to `chamar_humano`.
          expect(qualification.status).not.toBe('chamar_humano');

          // 3. The conversation is never flagged for handoff (no transition to
          //    the human stage / handoffRequired), for any handoff state.
          const handoffMarkingUpdate = prisma.conversation.update.mock.calls.some(
            ([arg]: [any]) =>
              arg?.data?.handoffRequired === true ||
              arg?.data?.stage === 'handoff_humano',
          );
          expect(handoffMarkingUpdate).toBe(false);

          // 4. The disengagement is never treated as handoff_accept /
          //    preference_human — the disengagement branch tags the turn as
          //    a neutral `outro` intent.
          expect(qualification.detectedIntent).not.toBe('handoff_accept');
          expect(qualification.detectedIntent).not.toBe('preference_human');

          // 5. The correct follow-up side effect fires (and never a handoff one).
          if (intent === 'opt_out') {
            expect(followUp.onOptOut).toHaveBeenCalledTimes(1);
            expect(followUp.scheduleDeferred).not.toHaveBeenCalled();
          } else {
            expect(followUp.scheduleDeferred).toHaveBeenCalledTimes(1);
            expect(followUp.onOptOut).not.toHaveBeenCalled();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
