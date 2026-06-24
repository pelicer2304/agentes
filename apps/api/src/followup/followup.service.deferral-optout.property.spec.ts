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
 * Property-based tests para a EVOLUÇÃO do `FollowUpService`
 * (`followup.service.ts`) — follow-up adiado (`scheduleDeferred`) e opt-out
 * (`onOptOut`/`resumeFromOptOut`), com FAKES EM MEMÓRIA e relógio injetado
 * (`now: Date` passado nos métodos).
 *
 * As implementações REAIS (e puras) de `FollowUpEligibilityService` e
 * `ReengagementMessageComposer` são usadas diretamente; o `PrismaService`, o
 * `FollowUpSender`, o `FollowUpEventRecorder` e o `AppConfigService` são
 * fakes/controlados por teste. Cada propriedade roda no mínimo 100 iterações.
 *
 * Feature: lead-followup
 * Properties: 22, 23, 24, 25
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 12.1, 12.4, 12.5, 12.6
 */

const MS_PER_HOUR = 60 * 60 * 1000;

const CONV_ID = 'conv-1';
const LEAD_ID = 'lead-1';

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
  followUpDefaultDeferralHours: 5,
  followUpMinDeferralHours: 1,
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
  // Campos da evolução (R11/R12).
  deferred: boolean;
  deferralOffsetHours: number | null;
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
function matchWhere(
  rec: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
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
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; conversationId?: string };
        }) => {
          let rec: ScheduleRecord | undefined;
          if (where.id !== undefined) {
            rec = schedules.get(where.id);
          } else if (where.conversationId !== undefined) {
            rec = findScheduleByConversation(where.conversationId);
          }
          return rec ? { ...rec } : null;
        },
      ),
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
            deferred: false,
            deferralOffsetHours: null,
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
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ConversationRecord>;
        }) => {
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
        deferred: partial.deferred ?? false,
        deferralOffsetHours: partial.deferralOffsetHours ?? null,
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
    __getScheduleByConversation(
      conversationId: string,
    ): ScheduleRecord | undefined {
      return findScheduleByConversation(conversationId);
    },
  };

  return fake;
}

type PrismaFake = ReturnType<typeof createPrismaFake>;

// ---------------------------------------------------------------------------
// Sender / Recorder fakes
// ---------------------------------------------------------------------------

/** Sender que confirma o envio com `sentAt` igual ao `now` recebido. */
function makeSentSender() {
  return {
    send: jest.fn(
      async ({ now }: { now: Date }): Promise<SendOutcome> => ({
        status: 'sent',
        sentAt: now,
      }),
    ),
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
  sender: ReturnType<typeof makeSentSender>;
  recorder: ReturnType<typeof makeRecorder>;
  events: FollowUpEventInput[];
}

function makeHarness(): Harness {
  const events: FollowUpEventInput[] = [];
  const prisma = createPrismaFake();
  const sender = makeSentSender();
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

/** Conversa+Lead ELEGÍVEL para follow-up (nenhuma condição de não-elegibilidade). */
function eligibleConversation(opts: {
  segment: string | null;
  mainPain: string | null;
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
    lastInboundAt: null,
    lead: {
      id: LEAD_ID,
      status: 'qualificando',
      segment: opts.segment,
      mainPain: opts.mainPain,
      phone: '5511999990000',
    },
  };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('FollowUpService — adiamento e opt-out (fakes em memória)', () => {
  // Feature: lead-followup, Property 22: nao_agora agenda o Deferred_Followup substituindo o Nível 1
  describe('Property 22: scheduleDeferred (re)agenda como adiado em vez do Nível 1 fixo', () => {
    it('define deferred=true, pendingLevel=1, inactivityAnchor=t, nextRunAt=t+offset (não t+1h)', async () => {
      // **Validates: Requirements 11.1, 11.8**
      await fc.assert(
        fc.asyncProperty(
          // offset válido em horas inteiras >= 2h (sempre != 1h, para descartar
          // o "t+1h fixo" do Nível 1 sem ambiguidade de arredondamento).
          fc.integer({ min: 2, max: 720 }),
          textOrNullArb,
          textOrNullArb,
          dateArb,
          // Estado inicial do schedule pré-existente (cobrindo upsert/update).
          fc.boolean(),
          async (offset, segment, mainPain, t, preExisting) => {
            const { service, prisma } = makeHarness();
            prisma.__addConversation(eligibleConversation({ segment, mainPain }));
            if (preExisting) {
              prisma.__addSchedule({
                cycleState: 'active',
                pendingLevel: 1,
                maxSentLevel: 0,
                inactivityAnchor: new Date(t.getTime() - 5 * MS_PER_HOUR),
                nextRunAt: new Date(t.getTime() - 4 * MS_PER_HOUR),
              });
            }

            await service.scheduleDeferred(CONV_ID, offset, t);

            const after = prisma.__getScheduleByConversation(CONV_ID)!;
            expect(after.deferred).toBe(true);
            expect(after.pendingLevel).toBe(1);
            expect(after.maxSentLevel).toBe(0);
            expect(after.cycleState).toBe('active');
            expect(after.inactivityAnchor.getTime()).toBe(t.getTime());
            // offset >= 1h ⇒ resolvido para o próprio offset, sem piso/teto extra.
            expect(after.deferralOffsetHours).toBe(offset);
            expect(after.nextRunAt!.getTime()).toBe(
              t.getTime() + offset * MS_PER_HOUR,
            );
            // Não é o "t + 1h" fixo do Nível 1 (offset inteiro >= 2h).
            expect(after.nextRunAt!.getTime()).not.toBe(
              t.getTime() + MS_PER_HOUR,
            );
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 23: Resolução do Deferral_Offset (default, inferido com piso, fallback)
  describe('Property 23: scheduleDeferred resolve o Deferral_Offset (default 5h, piso 1h, sem teto)', () => {
    it('aplica fallback (5h) para inválido, piso (1h) para <1h e usa o valor para >=1h', async () => {
      // **Validates: Requirements 11.2, 11.3, 11.4**
      type Case = { offset: number; expected: number };

      const invalidArb: fc.Arbitrary<Case> = fc
        .constantFrom(0, -1, -0.5, -100, Number.NaN, Infinity, -Infinity)
        .map((offset) => ({ offset, expected: 5 }));

      const subHourArb: fc.Arbitrary<Case> = fc
        .double({
          min: Number.MIN_VALUE,
          max: 0.999,
          noNaN: true,
          noDefaultInfinity: true,
        })
        .map((offset) => ({ offset, expected: 1 }));

      const validArb: fc.Arbitrary<Case> = fc
        .double({ min: 1, max: 1000, noNaN: true, noDefaultInfinity: true })
        .map((offset) => ({ offset, expected: offset }));

      const caseArb = fc.oneof(invalidArb, subHourArb, validArb);

      await fc.assert(
        fc.asyncProperty(caseArb, dateArb, async ({ offset, expected }, t) => {
          const { service, prisma } = makeHarness();
          prisma.__addConversation(
            eligibleConversation({ segment: null, mainPain: null }),
          );

          await service.scheduleDeferred(CONV_ID, offset, t);

          const after = prisma.__getScheduleByConversation(CONV_ID)!;
          // `deferral_offset_hours` é SmallInt (metadata): gravado arredondado
          // para caber. O nextRunAt abaixo preserva o offset fracionário (é ele
          // que controla o disparo — inclusive prazos em minutos).
          expect(after.deferralOffsetHours).toBe(Math.round(expected));
          // Espelha o arredondamento do construtor Date (trunca frações de ms).
          const expectedMs = new Date(
            t.getTime() + expected * MS_PER_HOUR,
          ).getTime();
          expect(after.nextRunAt!.getTime()).toBe(expectedMs);
          // O Deferred_Followup permanece elegível (deferred=true, Nível 1).
          expect(after.deferred).toBe(true);
          expect(after.pendingLevel).toBe(1);
        }),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 24: Disparo do Deferred_Followup retoma a cadência normal
  describe('Property 24: processDue de um Deferred_Followup agenda o Nível 2 em sentAt+24h e desativa deferred', () => {
    it('marca Nível 1 enviado, pendingLevel=2, nextRunAt=sentAt+24h, deferred=false', async () => {
      // **Validates: Requirements 11.5**
      await fc.assert(
        fc.asyncProperty(
          textOrNullArb,
          textOrNullArb,
          dateArb,
          async (segment, mainPain, sentAt) => {
            const { service, prisma, sender } = makeHarness();
            prisma.__addConversation(eligibleConversation({ segment, mainPain }));

            // Schedule adiado pronto para disparar (Nível 1 pendente).
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel: 1,
              maxSentLevel: 0,
              deferred: true,
              deferralOffsetHours: 5,
              inactivityAnchor: new Date(sentAt.getTime() - 5 * MS_PER_HOUR),
              nextRunAt: new Date(sentAt.getTime() - MS_PER_HOUR),
            });

            // sender 'sent' com sentAt = now passado a processDue.
            await service.processDue(sched.id, sentAt);

            expect(sender.send).toHaveBeenCalledTimes(1);

            const after = prisma.__getSchedule(sched.id)!;
            // Nível 1 marcado como enviado; cadência retomada no Nível 2.
            expect(after.maxSentLevel).toBe(1);
            expect(after.pendingLevel).toBe(2);
            // Retoma a partir do INSTANTE do disparo: sentAt + 24h (não anchor+24h).
            expect(after.nextRunAt!.getTime()).toBe(
              sentAt.getTime() + 24 * MS_PER_HOUR,
            );
            // O flag deferred é desativado a partir do disparo.
            expect(after.deferred).toBe(false);
            expect(after.cycleState).toBe('active');
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // Feature: lead-followup, Property 25: Opt-out cancela sem reiniciar, é idempotente e registra um único evento; reentrada reinicia no Nível 1
  describe('Property 25: onOptOut cancela em opted_out (idempotente, um evento); resumeFromOptOut reinicia no Nível 1', () => {
    it('onOptOut: opted_out + pendingLevel=null + exatamente um followup_cancelled(opt_out); 2ª chamada no-op', async () => {
      // **Validates: Requirements 12.1, 12.5, 12.6**
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom<1 | 2 | 3>(1, 2, 3),
          dateArb,
          async (pendingLevel, t) => {
            const { service, prisma, events } = makeHarness();
            prisma.__addConversation(
              eligibleConversation({ segment: null, mainPain: null }),
            );
            const sched = prisma.__addSchedule({
              cycleState: 'active',
              pendingLevel,
              maxSentLevel: pendingLevel - 1,
              deferred: pendingLevel === 1,
            });

            await service.onOptOut(CONV_ID, t);

            const afterFirst = prisma.__getSchedule(sched.id)!;
            expect(afterFirst.cycleState).toBe('opted_out');
            expect(afterFirst.pendingLevel).toBeNull();
            expect(afterFirst.deferred).toBe(false);

            const cancelled = events.filter(
              (e) => e.type === 'followup_cancelled',
            );
            expect(cancelled).toHaveLength(1);
            expect(cancelled[0].reason).toBe('opt_out');
            expect(cancelled[0].conversationId).toBe(CONV_ID);
            expect(cancelled[0].leadId).toBe(LEAD_ID);
            expect(cancelled[0].occurredAt).toBeInstanceOf(Date);

            // Idempotência: 2ª chamada é no-op (sem novo evento, mesmo estado).
            await service.onOptOut(CONV_ID, new Date(t.getTime() + 1000));

            expect(
              events.filter((e) => e.type === 'followup_cancelled'),
            ).toHaveLength(1);
            const afterSecond = prisma.__getSchedule(sched.id)!;
            expect(afterSecond.cycleState).toBe('opted_out');
            expect(afterSecond.pendingLevel).toBeNull();
          },
        ),
        { numRuns: 200 },
      );
    });

    it('resumeFromOptOut em conversa opted_out: active, pendingLevel=1, anchor=now, nextRunAt=now+1h', async () => {
      // **Validates: Requirements 12.4**
      await fc.assert(
        fc.asyncProperty(dateArb, async (now) => {
          const { service, prisma } = makeHarness();
          prisma.__addConversation(
            eligibleConversation({ segment: null, mainPain: null }),
          );
          const sched = prisma.__addSchedule({
            cycleState: 'opted_out',
            pendingLevel: null,
            maxSentLevel: 0,
            deferred: false,
          });

          await service.resumeFromOptOut(CONV_ID, now);

          const after = prisma.__getSchedule(sched.id)!;
          expect(after.cycleState).toBe('active');
          expect(after.pendingLevel).toBe(1);
          expect(after.maxSentLevel).toBe(0);
          expect(after.deferred).toBe(false);
          expect(after.inactivityAnchor.getTime()).toBe(now.getTime());
          expect(after.nextRunAt!.getTime()).toBe(now.getTime() + MS_PER_HOUR);
        }),
        { numRuns: 200 },
      );
    });
  });
});
