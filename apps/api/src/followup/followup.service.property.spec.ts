import fc from 'fast-check';

import { FollowUpService } from './followup.service';
import { FollowUpEligibilityService } from './followup-eligibility.service';
import { ReengagementMessageComposer } from './reengagement-message.composer';
import type { AppConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { FollowUpSender } from './followup-sender.service';
import type {
  FollowUpEventInput,
  FollowUpEventRecorder,
} from './followup-event.recorder';
import type { SendOutcome } from './followup.types';

/**
 * Property-based tests para a orquestração do `FollowUpService`
 * (`followup.service.ts`), com FAKES EM MEMÓRIA e relógio injetado
 * (`now: Date` passado nos métodos).
 *
 * As implementações REAIS (e puras) de `FollowUpEligibilityService` e
 * `ReengagementMessageComposer` são usadas diretamente; o `PrismaService`, o
 * `FollowUpSender`, o `FollowUpEventRecorder` e o `AppConfigService` são
 * fakes/controlados por teste. Cada propriedade roda no mínimo 100 iterações.
 *
 * Feature: lead-followup
 * Properties: 2, 6, 7, 8, 11, 12, 13
 * Requirements: 1.5, 1.6, 1.7, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.6,
 *               4.2, 4.3, 6.1, 6.3, 6.4, 7.3, 7.6, 8.1, 8.2, 8.3
 */

const MS_PER_HOUR = 60 * 60 * 1000;

const CONV_ID = 'conv-1';
const LEAD_ID = 'lead-1';

const CANCEL_REASONS = ['handoff_humano', 'lead_perdido', 'resposta_do_lead'];

// ---------------------------------------------------------------------------
// Config fake (valores documentados no design / config.service.ts)
// ---------------------------------------------------------------------------

const configFake = {
  followUpLevel1Hours: 1,
  followUpLevel2Hours: 24,
  followUpLevel3Hours: 48,
  followUpCompletionWindowHours: 24,
  followUpRetryBackoffSeconds: 60,
  followUpMaxDeferrals: 10,
  followUpSendWindowParsed: {
    startHour: 8,
    startMinute: 0,
    endHour: 20,
    endMinute: 0,
  },
} as unknown as AppConfigService;

// ---------------------------------------------------------------------------
// Tipos das linhas armazenadas no Prisma fake
// ---------------------------------------------------------------------------

interface ScheduleRecord {
  id: string;
  conversationId: string;
  leadId: string;
  cycleState: string;
  inactivityAnchor: Date;
  maxSentLevel: number;
  pendingLevel: number | null;
  nextRunAt: Date | null;
  level3FiredAt: Date | null;
  lockedUntil: Date | null;
  deferredAttempts: number;
  lastError: string | null;
}

interface LeadRecord {
  id: string;
  status: string;
  segment: string | null;
  mainPain: string | null;
  phone: string;
}

interface ConversationRecord {
  id: string;
  leadId: string;
  stage: string;
  status: string;
  botPaused: boolean;
  assignedTo: string | null;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  handoffRequired: boolean;
  instanceName: string | null;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  lead: LeadRecord;
}

/**
 * Avalia uma cláusula `where` do Prisma contra uma linha, suportando os
 * operadores efetivamente usados pelo serviço: igualdade simples, `{ not: x }`
 * e `{ lt: n }`.
 */
function matchWhere(rec: Record<string, unknown>, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const val = rec[key];
    if (cond !== null && typeof cond === 'object') {
      const op = cond as Record<string, unknown>;
      if ('not' in op) {
        if (op.not === null) {
          if (val === null || val === undefined) return false;
        } else if (val === op.not) {
          return false;
        }
      }
      if ('lt' in op) {
        if (!((val as number) < (op.lt as number))) return false;
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

/**
 * Cria um Prisma fake em memória cobrindo apenas os métodos consumidos pelo
 * `FollowUpService`. As mutações são síncronas dentro de cada método async, o
 * que torna `updateMany` atômico sob interleaving de chamadas concorrentes.
 */
function createPrismaFake() {
  const schedules = new Map<string, ScheduleRecord>();
  const conversations = new Map<string, ConversationRecord>();
  let idSeq = 0;

  const findScheduleByConversation = (conversationId: string) =>
    [...schedules.values()].find((s) => s.conversationId === conversationId);

  const fake = {
    followUpSchedule: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string; conversationId?: string } }) => {
        let rec: ScheduleRecord | undefined;
        if (where.id !== undefined) {
          rec = schedules.get(where.id);
        } else if (where.conversationId !== undefined) {
          rec = findScheduleByConversation(where.conversationId);
        }
        return rec ? { ...rec } : null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { conversationId: string };
          create: Partial<ScheduleRecord>;
          update: Partial<ScheduleRecord>;
        }) => {
          const existing = findScheduleByConversation(where.conversationId);
          if (existing) {
            Object.assign(existing, update);
            return { ...existing };
          }
          idSeq += 1;
          const rec: ScheduleRecord = {
            id: `sched-${idSeq}`,
            conversationId: where.conversationId,
            leadId: '',
            cycleState: 'active',
            inactivityAnchor: new Date(0),
            maxSentLevel: 0,
            pendingLevel: null,
            nextRunAt: null,
            level3FiredAt: null,
            lockedUntil: null,
            deferredAttempts: 0,
            lastError: null,
            ...create,
          } as ScheduleRecord;
          schedules.set(rec.id, rec);
          return { ...rec };
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id?: string; conversationId?: string };
          data: Partial<ScheduleRecord>;
        }) => {
          let rec: ScheduleRecord | undefined;
          if (where.id !== undefined) {
            rec = schedules.get(where.id);
          } else if (where.conversationId !== undefined) {
            rec = findScheduleByConversation(where.conversationId);
          }
          if (!rec) {
            throw new Error('FollowUpSchedule record to update not found');
          }
          Object.assign(rec, data);
          return { ...rec };
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Partial<ScheduleRecord>;
        }) => {
          let count = 0;
          for (const rec of schedules.values()) {
            if (matchWhere(rec as unknown as Record<string, unknown>, where)) {
              Object.assign(rec, data);
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
    conversation: {
      findUnique: jest.fn(
        async ({
          where,
          include,
          select,
        }: {
          where: { id: string };
          include?: { lead?: boolean };
          select?: Record<string, boolean>;
        }) => {
          const rec = conversations.get(where.id);
          if (!rec) return null;
          if (select) {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(select)) {
              out[key] = (rec as unknown as Record<string, unknown>)[key];
            }
            return out;
          }
          if (include?.lead) {
            return { ...rec, lead: { ...rec.lead } };
          }
          const { lead: _lead, ...rest } = rec;
          return { ...rest };
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<ConversationRecord> }) => {
          const rec = conversations.get(where.id);
          if (!rec) {
            throw new Error('Conversation record to update not found');
          }
          Object.assign(rec, data);
          return { ...rec };
        },
      ),
    },
    agentSettings: {
      findFirst: jest.fn(async () => null),
    },
    // Helpers de seeding (não fazem parte da interface do PrismaService).
    __addSchedule(partial: Partial<ScheduleRecord>): ScheduleRecord {
      idSeq += 1;
      const rec: ScheduleRecord = {
        id: partial.id ?? `sched-${idSeq}`,
        conversationId: partial.conversationId ?? CONV_ID,
        leadId: partial.leadId ?? LEAD_ID,
        cycleState: partial.cycleState ?? 'active',
        inactivityAnchor: partial.inactivityAnchor ?? new Date(0),
        maxSentLevel: partial.maxSentLevel ?? 0,
        pendingLevel: partial.pendingLevel ?? null,
        nextRunAt: partial.nextRunAt ?? null,
        level3FiredAt: partial.level3FiredAt ?? null,
        lockedUntil: partial.lockedUntil ?? null,
        deferredAttempts: partial.deferredAttempts ?? 0,
        lastError: partial.lastError ?? null,
      };
      schedules.set(rec.id, rec);
      return rec;
    },
    __addConversation(rec: ConversationRecord): void {
      conversations.set(rec.id, rec);
    },
    __getSchedule(id: string): ScheduleRecord | undefined {
      return schedules.get(id);
    },
    __getScheduleByConversation(conversationId: string): ScheduleRecord | undefined {
      return findScheduleByConversation(conversationId);
    },
  };

  return fake;
}

type PrismaFake = ReturnType<typeof createPrismaFake>;

// ---------------------------------------------------------------------------
// Sender / Recorder fakes
// ---------------------------------------------------------------------------

type SendBehavior = 'sent' | 'deferred_window' | 'deferred_rate' | 'failed';

function makeSender(behavior: SendBehavior) {
  return {
    send: jest.fn(async ({ now }: { now: Date }): Promise<SendOutcome> => {
      switch (behavior) {
        case 'sent':
          return { status: 'sent', sentAt: now };
        case 'deferred_window':
          return { status: 'deferred', reason: 'out_of_window' };
        case 'deferred_rate':
          return { status: 'deferred', reason: 'rate_limited' };
        case 'failed':
        default:
          return { status: 'failed', reason: 'evolution_error' };
      }
    }),
    isWithinSendWindow: jest.fn(() => true),
  };
}

function makeRecorder(events: FollowUpEventInput[]) {
  return {
    record: jest.fn(async (event: FollowUpEventInput) => {
      events.push(event);
    }),
  };
}

interface Harness {
  service: FollowUpService;
  prisma: PrismaFake;
  sender: ReturnType<typeof makeSender>;
  recorder: ReturnType<typeof makeRecorder>;
  events: FollowUpEventInput[];
}

function makeHarness(behavior: SendBehavior = 'sent'): Harness {
  const events: FollowUpEventInput[] = [];
  const prisma = createPrismaFake();
  const sender = makeSender(behavior);
  const recorder = makeRecorder(events);
  const service = new FollowUpService(
    prisma as unknown as PrismaService,
    new FollowUpEligibilityService(),
    new ReengagementMessageComposer(),
    sender as unknown as FollowUpSender,
    recorder as unknown as FollowUpEventRecorder,
    configFake,
  );
  return { service, prisma, sender, recorder, events };
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------

const dateArb: fc.Arbitrary<Date> = fc.date({
  min: new Date('2020-01-01T12:00:00.000Z'),
  max: new Date('2020-12-31T12:00:00.000Z'),
  noInvalidDate: true,
});

const textOrNullArb: fc.Arbitrary<string | null> = fc.option(
  fc.string({ maxLength: 30 }),
  { nil: null },
);

const levelArb: fc.Arbitrary<1 | 2 | 3> = fc.constantFrom(1, 2, 3);

/** Conversa+Lead ELEGÍVEL para follow-up (nenhuma condição de não-elegibilidade). */
function eligibleConversation(opts: {
  segment: string | null;
  mainPain: string | null;
  leadStatus?: string;
  lastInboundAt?: Date | null;
}): ConversationRecord {
  return {
    id: CONV_ID,
    leadId: LEAD_ID,
    stage: 'descoberta',
    status: 'active',
    botPaused: false,
    assignedTo: null,
    handoffAccepted: false,
    handoffCompleted: false,
    handoffRequired: false,
    instanceName: 'inst-1',
    lastOutboundAt: new Date('2020-06-01T10:00:00.000Z'),
    lastInboundAt: opts.lastInboundAt ?? null,
    lead: {
      id: LEAD_ID,
      status: opts.leadStatus ?? 'qualificando',
      segment: opts.segment,
      mainPain: opts.mainPain,
      phone: '5511999990000',
    },
  };
}

type IneligibilityCause =
  | 'chamar_humano'
  | 'perdido'
  | 'handoffAccepted'
  | 'handoffCompleted'
  | 'stage'
  | 'botPaused'
  | 'assignedTo';

const causeArb: fc.Arbitrary<IneligibilityCause> = fc.constantFrom(
  'chamar_humano',
  'perdido',
  'handoffAccepted',
  'handoffCompleted',
  'stage',
  'botPaused',
  'assignedTo',
);

/** Aplica uma causa de não-elegibilidade garantida sobre uma conversa elegível. */
function applyIneligibility(conv: ConversationRecord, cause: IneligibilityCause): ConversationRecord {
  const c: ConversationRecord = { ...conv, lead: { ...conv.lead } };
  switch (cause) {
    case 'chamar_humano':
      c.lead.status = 'chamar_humano';
      break;
    case 'perdido':
      c.lead.status = 'perdido';
      break;
    case 'handoffAccepted':
      c.handoffAccepted = true;
      break;
    case 'handoffCompleted':
      c.handoffCompleted = true;
      break;
    case 'stage':
      c.stage = 'handoff_humano';
      break;
    case 'botPaused':
      c.botPaused = true;
      break;
    case 'assignedTo':
      c.assignedTo = 'agent-9';
      break;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('FollowUpService — property-based (fakes em memória)', () => {
  // Feature: lead-followup, Property 2: Nunca dispara para conversa não elegível, reavaliando no instante do disparo
  describe('Property 2: processDue suprime envio quando o snapshot do disparo é não elegível', () => {
    it('não chama sender.send, cancela o nível pendente e registra followup_cancelled', async () => {
      // **Validates: Requirements 1.5, 1.7, 2.2, 2.3, 2.4, 4.2, 4.3**
      await fc.assert(
        fc.asyncProperty(
          causeArb,
          levelArb,
          textOrNullArb,
          textOrNullArb,
          dateArb,
          async (cause, pendingLevel, segment, mainPain, now) => {
            const { service, prisma, sender, events } = makeHarness('sent');

            // Snapshot ATUAL (instante do disparo) é não elegível, ainda que no
            // agendamento estivesse elegível (o schedule carrega pendingLevel).
            prisma.__addConversation(
              applyIneligibility(eligibleConversation({ segment, mainPain }), cause),
            );
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel,
              maxSentLevel: pendingLevel - 1,
              nextRunAt: new Date(now.getTime() - MS_PER_HOUR),
              inactivityAnchor: new Date(now.getTime() - 2 * MS_PER_HOUR),
            });

            await service.processDue(sched.id, now);

            const after = prisma.__getSchedule(sched.id)!;

            // Nunca envia para conversa não elegível.
            expect(sender.send).not.toHaveBeenCalled();
            // Nível cancelado, ciclo cancelado, sem agendamento futuro.
            expect(after.pendingLevel).toBeNull();
            expect(after.cycleState).toBe('cancelled');
            // Exatamente um followup_cancelled com motivo de não-elegibilidade.
            const cancelled = events.filter((e) => e.type === 'followup_cancelled');
            expect(cancelled).toHaveLength(1);
            expect(['handoff_humano', 'lead_perdido']).toContain(cancelled[0].reason);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 6: Inbound cancela todos os pendentes de forma idempotente com exatamente um evento
  describe('Property 6: onInboundReceived cancela pendentes com exatamente um evento; reentrância é no-op', () => {
    it('cancela e registra um followup_cancelled (resposta_do_lead); segunda chamada é no-op', async () => {
      // **Validates: Requirements 1.6, 3.1, 3.3, 3.6**
      await fc.assert(
        fc.asyncProperty(
          levelArb,
          causeArb,
          dateArb,
          async (pendingLevel, cause, now) => {
            const { service, prisma, events } = makeHarness('sent');

            // Conversa não elegível após o cancelamento (não reinicia o ciclo),
            // de modo que a segunda chamada permaneça um no-op verificável.
            prisma.__addConversation(
              applyIneligibility(eligibleConversation({ segment: null, mainPain: null }), cause),
            );
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel,
              maxSentLevel: pendingLevel - 1,
            });

            await service.onInboundReceived(CONV_ID, now);

            const afterFirst = prisma.__getSchedule(sched.id)!;
            expect(afterFirst.pendingLevel).toBeNull();
            expect(afterFirst.cycleState).toBe('cancelled');

            const cancelled = events.filter((e) => e.type === 'followup_cancelled');
            expect(cancelled).toHaveLength(1);
            expect(cancelled[0].reason).toBe('resposta_do_lead');
            expect(cancelled[0].conversationId).toBe(CONV_ID);

            // Reentrância: segunda chamada é no-op (sem novo evento, mesmo estado).
            await service.onInboundReceived(CONV_ID, new Date(now.getTime() + 1000));

            expect(events.filter((e) => e.type === 'followup_cancelled')).toHaveLength(1);
            const afterSecond = prisma.__getSchedule(sched.id)!;
            expect(afterSecond.pendingLevel).toBeNull();
            expect(afterSecond.cycleState).toBe('cancelled');
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 7: Inbound de conversa elegível reinicia o ciclo no Nível 1
  describe('Property 7: onInboundReceived em conversa elegível redefine o anchor e reinicia no Nível 1', () => {
    it('define inactivityAnchor=now, pendingLevel=1 e nextRunAt=now+1h', async () => {
      // **Validates: Requirements 3.2**
      await fc.assert(
        fc.asyncProperty(
          levelArb,
          textOrNullArb,
          textOrNullArb,
          dateArb,
          async (pendingLevel, segment, mainPain, now) => {
            const { service, prisma, events } = makeHarness('sent');

            prisma.__addConversation(eligibleConversation({ segment, mainPain }));
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel,
              maxSentLevel: pendingLevel - 1,
              inactivityAnchor: new Date(now.getTime() - 5 * MS_PER_HOUR),
            });

            await service.onInboundReceived(CONV_ID, now);

            const after = prisma.__getSchedule(sched.id)!;
            expect(after.cycleState).toBe('active');
            expect(after.pendingLevel).toBe(1);
            expect(after.maxSentLevel).toBe(0);
            expect(after.inactivityAnchor.getTime()).toBe(now.getTime());
            expect(after.nextRunAt!.getTime()).toBe(now.getTime() + MS_PER_HOUR);

            // Reinício ocorre com exatamente um cancelamento por resposta_do_lead.
            const cancelled = events.filter((e) => e.type === 'followup_cancelled');
            expect(cancelled).toHaveLength(1);
            expect(cancelled[0].reason).toBe('resposta_do_lead');
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 8: Inbound sem nível pendente é no-op
  describe('Property 8: onInboundReceived sem nível pendente não grava evento nem altera o estado', () => {
    it('é no-op para schedule inexistente, cancelado, encerrado ou sem pendingLevel', async () => {
      // **Validates: Requirements 3.4**
      const scenarioArb = fc.constantFrom<'absent' | 'cancelled' | 'completed' | 'active_no_pending'>(
        'absent',
        'cancelled',
        'completed',
        'active_no_pending',
      );

      await fc.assert(
        fc.asyncProperty(scenarioArb, dateArb, async (scenario, now) => {
          const { service, prisma, events } = makeHarness('sent');

          let before: ScheduleRecord | undefined;
          if (scenario === 'cancelled') {
            before = { ...prisma.__addSchedule({ cycleState: 'cancelled', pendingLevel: null }) };
          } else if (scenario === 'completed') {
            before = { ...prisma.__addSchedule({ cycleState: 'completed', pendingLevel: null }) };
          } else if (scenario === 'active_no_pending') {
            before = { ...prisma.__addSchedule({ cycleState: 'active', pendingLevel: null }) };
          }

          await service.onInboundReceived(CONV_ID, now);

          // Nunca grava followup_cancelled.
          expect(events).toHaveLength(0);

          if (scenario === 'absent') {
            expect(prisma.__getScheduleByConversation(CONV_ID)).toBeUndefined();
          } else {
            const after = prisma.__getScheduleByConversation(CONV_ID)!;
            expect(after.cycleState).toBe(before!.cycleState);
            expect(after.pendingLevel).toBe(before!.pendingLevel);
            expect(after.maxSentLevel).toBe(before!.maxSentLevel);
            expect(after.nextRunAt).toEqual(before!.nextRunAt);
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 11: Encerramento após o Nível 3 e estado terminal
  describe('Property 11: completeIfExhausted encerra após 24h do Nível 3 sem inbound', () => {
    it('marca completed sem agendar quando passou a janela e não houve inbound posterior', async () => {
      // **Validates: Requirements 6.1, 6.3, 6.4**
      await fc.assert(
        fc.asyncProperty(
          dateArb,
          fc.integer({ min: 1, max: 240 }), // horas extras além da janela de 24h
          async (level3FiredAt, extraHours) => {
            const { service, prisma, events } = makeHarness('sent');

            // Conversa sem inbound posterior ao Nível 3.
            const conv = eligibleConversation({ segment: null, mainPain: null });
            conv.lastInboundAt = new Date(level3FiredAt.getTime() - MS_PER_HOUR);
            prisma.__addConversation(conv);

            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel: null,
              maxSentLevel: 3,
              level3FiredAt,
            });

            const now = new Date(level3FiredAt.getTime() + (24 + extraHours) * MS_PER_HOUR);
            await service.completeIfExhausted(sched.id, now);

            const after = prisma.__getSchedule(sched.id)!;
            expect(after.cycleState).toBe('completed');
            expect(after.pendingLevel).toBeNull();
            // Não agenda novos níveis.
            expect(after.nextRunAt).toBeNull();

            const completed = events.filter((e) => e.type === 'followup_completed');
            expect(completed).toHaveLength(1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('não encerra por ciclo_concluido quando há inbound após o Nível 3', async () => {
      // **Validates: Requirements 6.4**
      await fc.assert(
        fc.asyncProperty(
          dateArb,
          fc.integer({ min: 1, max: 23 }), // inbound dentro da janela de 24h
          fc.integer({ min: 0, max: 240 }), // quão depois "now" observa
          async (level3FiredAt, inboundOffsetHours, nowExtraHours) => {
            const { service, prisma, events } = makeHarness('sent');

            const conv = eligibleConversation({ segment: null, mainPain: null });
            // Inbound estritamente posterior ao disparo do Nível 3 (dentro da janela).
            conv.lastInboundAt = new Date(level3FiredAt.getTime() + inboundOffsetHours * MS_PER_HOUR);
            prisma.__addConversation(conv);

            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel: null,
              maxSentLevel: 3,
              level3FiredAt,
            });

            const now = new Date(level3FiredAt.getTime() + (24 + nowExtraHours) * MS_PER_HOUR);
            await service.completeIfExhausted(sched.id, now);

            const after = prisma.__getSchedule(sched.id)!;
            // Não encerra por ciclo_concluido: continua ativo, sem evento de encerramento.
            expect(after.cycleState).toBe('active');
            expect(events.filter((e) => e.type === 'followup_completed')).toHaveLength(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: lead-followup, Property 12: Conteúdo e forma dos Follow_Up_Event
  describe('Property 12: todo Follow_Up_Event tem conversationId, leadId, occurredAt Date e campos válidos', () => {
    it('mantém as invariantes de conteúdo em sent/cancelled/completed gerados pelo serviço', async () => {
      // **Validates: Requirements 4.4, 6.2, 8.1, 8.2, 8.3**
      const scenarioArb = fc.constantFrom<
        'sent' | 'cancel_handoff' | 'inbound_cancel' | 'lead_lost' | 'completed'
      >('sent', 'cancel_handoff', 'inbound_cancel', 'lead_lost', 'completed');

      await fc.assert(
        fc.asyncProperty(
          scenarioArb,
          levelArb,
          causeArb,
          textOrNullArb,
          textOrNullArb,
          dateArb,
          async (scenario, pendingLevel, cause, segment, mainPain, now) => {
            const { service, prisma, events } = makeHarness('sent');

            if (scenario === 'sent') {
              prisma.__addConversation(eligibleConversation({ segment, mainPain }));
              const sched = prisma.__addSchedule({
                cycleState: 'active',
                pendingLevel,
                maxSentLevel: pendingLevel - 1,
                inactivityAnchor: new Date(now.getTime() - MS_PER_HOUR),
              });
              await service.processDue(sched.id, now);
            } else if (scenario === 'cancel_handoff') {
              prisma.__addConversation(
                applyIneligibility(eligibleConversation({ segment, mainPain }), cause),
              );
              const sched = prisma.__addSchedule({
                cycleState: 'active',
                pendingLevel,
                maxSentLevel: pendingLevel - 1,
              });
              await service.processDue(sched.id, now);
            } else if (scenario === 'inbound_cancel') {
              prisma.__addConversation(
                applyIneligibility(eligibleConversation({ segment, mainPain }), cause),
              );
              prisma.__addSchedule({ cycleState: 'active', pendingLevel });
              await service.onInboundReceived(CONV_ID, now);
            } else if (scenario === 'lead_lost') {
              prisma.__addConversation(eligibleConversation({ segment, mainPain }));
              prisma.__addSchedule({ cycleState: 'active', pendingLevel });
              await service.onLeadLost(CONV_ID, now);
            } else {
              // completed
              const conv = eligibleConversation({ segment, mainPain });
              conv.lastInboundAt = null;
              prisma.__addConversation(conv);
              const sched = prisma.__addSchedule({
                cycleState: 'active',
                pendingLevel: null,
                maxSentLevel: 3,
                level3FiredAt: new Date(now.getTime() - 48 * MS_PER_HOUR),
              });
              await service.completeIfExhausted(sched.id, now);
            }

            // Pelo menos um evento foi gerado em cada cenário.
            expect(events.length).toBeGreaterThanOrEqual(1);

            for (const ev of events) {
              expect(typeof ev.conversationId).toBe('string');
              expect(ev.conversationId.length).toBeGreaterThan(0);
              expect(typeof ev.leadId).toBe('string');
              expect(ev.leadId.length).toBeGreaterThan(0);
              expect(ev.occurredAt).toBeInstanceOf(Date);

              if (ev.type === 'followup_sent') {
                expect(ev.level).toBeGreaterThanOrEqual(1);
                expect(ev.level).toBeLessThanOrEqual(3);
              }
              if (ev.type === 'followup_cancelled') {
                expect(CANCEL_REASONS).toContain(ev.reason);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 13: Lock de concorrência exclusivo — idempotência da marcação de nível
  describe('Property 13: dois processDue para o mesmo nível resultam em no máximo um followup_sent', () => {
    it('marca o nível atomicamente (maxSentLevel<level), suprimindo disparos repetidos', async () => {
      // **Validates: Requirements 7.3, 7.6**
      await fc.assert(
        fc.asyncProperty(
          levelArb,
          textOrNullArb,
          textOrNullArb,
          dateArb,
          async (level, segment, mainPain, now) => {
            const { service, prisma, sender, events } = makeHarness('sent');

            prisma.__addConversation(eligibleConversation({ segment, mainPain }));
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel: level,
              maxSentLevel: level - 1,
              inactivityAnchor: new Date(now.getTime() - MS_PER_HOUR),
            });

            // Dois disparos concorrentes para o MESMO nível.
            await Promise.all([
              service.processDue(sched.id, now),
              service.processDue(sched.id, now),
            ]);

            const sent = events.filter((e) => e.type === 'followup_sent');
            // No máximo um followup_sent para o nível (idempotência via guarda atômica).
            expect(sent).toHaveLength(1);
            expect(sent[0].level).toBe(level);

            const after = prisma.__getSchedule(sched.id)!;
            expect(after.maxSentLevel).toBe(level);

            // Mesmo que o sender possa ser chamado por ambos, apenas um envio é
            // efetivado como nível enviado (o segundo é suprimido pela guarda).
            expect(sender.send.mock.calls.length).toBeGreaterThanOrEqual(1);
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
