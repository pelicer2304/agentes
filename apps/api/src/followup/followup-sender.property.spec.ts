import fc from 'fast-check';
import { FollowUpSender } from './followup-sender.service';
import type { AppConfigService } from '../config/config.service';
import type { RateLimiterService } from '../common/rate-limiter';
import type { ChannelAdapterRegistry } from '../channel/channel-adapter.registry';
import type {
  ChannelAdapter,
  SendMessageParams,
} from '../channel/channel-adapter.interface';

/**
 * Property-based tests for {@link FollowUpSender} (`followup-sender.service.ts`).
 *
 * O sender é o componente de borda do envio (Requisito 9): ele apenas tenta
 * entregar a Reengagement_Message e classifica o resultado num `SendOutcome`.
 * A marcação atômica do nível, a atualização de `lastOutboundAt` e a
 * preservação do pendente são responsabilidade do `FollowUpService` — por isso
 * aqui validamos **o que o sender de fato faz**:
 *
 *  - Property 14: fora da janela → `deferred(out_of_window)`, sem chamar o
 *    adapter Evolution e sem consumir o rate-limit.
 *  - Property 15: dentro da janela mas com o RateLimiter rejeitando →
 *    `deferred(rate_limited)`, sem chamar o adapter.
 *  - Property 16: dentro da janela, com token e o adapter resolvendo →
 *    `sent` com `sentAt === now` (o instante injetado), valor usado depois pelo
 *    service para atualizar `lastOutboundAt`.
 *  - Property 17: falha do adapter → `failed(evolution_error)` (no sender,
 *    apenas o outcome de falha; a preservação do pendente é do service).
 *
 * Os efeitos de borda (Evolution, RateLimiter, relógio e config) são fakeados
 * e o relógio é injetado via `now`, mantendo as propriedades determinísticas.
 *
 * Feature: lead-followup
 * Properties: 14, 15, 16, 17
 * Requirements: 7.5, 9.2, 9.3, 9.4, 9.6
 */

const MINUTES_PER_DAY = 24 * 60;

/**
 * Fuso da janela de envio no sender: America/Sao_Paulo. Desde 2019 o Brasil
 * não observa horário de verão, então em datas a partir de 2020 o offset é
 * fixo em UTC-3. Fixamos um dia-base em junho/2020 (sem DST) e convertemos uma
 * hora **local de São Paulo** para o instante UTC correspondente, de modo que
 * a expectativa de "dentro/fora da janela" seja inequívoca.
 */
const SP_OFFSET_MINUTES = 180; // UTC = localSP + 3h
const BASE_DAY_UTC = Date.UTC(2020, 5, 15); // 15/06/2020 (sem DST em SP)

/** Janela fixa de envio usada nos testes: 08:00-20:00 (local SP). */
const WINDOW_START_MIN = 8 * 60; // 480
const WINDOW_END_MIN = 20 * 60; // 1200 (exclusivo)

/**
 * Constrói um instante (Date/UTC) cuja hora-do-dia em São Paulo corresponde a
 * `localMinutes` minutos desde a meia-noite. Apenas a hora-do-dia importa para
 * a janela, então eventuais viradas de dia na conversão são irrelevantes.
 */
function spLocalMinutesToDate(localMinutes: number): Date {
  const utcMinutes = (localMinutes + SP_OFFSET_MINUTES) % MINUTES_PER_DAY;
  return new Date(BASE_DAY_UTC + utcMinutes * 60_000);
}

/** Horários (em minutos locais SP) garantidamente DENTRO de [08:00, 20:00). */
const insideWindowDateArb: fc.Arbitrary<Date> = fc
  .integer({ min: WINDOW_START_MIN, max: WINDOW_END_MIN - 1 })
  .map(spLocalMinutesToDate);

/** Horários garantidamente FORA da janela: [00:00, 08:00) ∪ [20:00, 24:00). */
const outsideWindowDateArb: fc.Arbitrary<Date> = fc
  .oneof(
    fc.integer({ min: 0, max: WINDOW_START_MIN - 1 }),
    fc.integer({ min: WINDOW_END_MIN, max: MINUTES_PER_DAY - 1 }),
  )
  .map(spLocalMinutesToDate);

/** Parâmetros arbitrários de envio (fora a janela, controlada à parte). */
interface SendParamsArb {
  phone: string;
  instanceName: string | null;
  conversationId: string;
  content: string;
}

const sendParamsArb: fc.Arbitrary<SendParamsArb> = fc.record({
  phone: fc.string({ minLength: 1, maxLength: 20 }),
  instanceName: fc.oneof(fc.constant(null), fc.string({ minLength: 1, maxLength: 12 })),
  conversationId: fc.uuid(),
  content: fc.string({ minLength: 1, maxLength: 500 }),
});

/**
 * Monta um {@link FollowUpSender} com fakes controláveis.
 *
 * @param allow - retorno fixo de `rateLimiter.tryConsume`.
 * @param adapter - 'resolve' (envio ok) ou 'reject' (falha do Evolution).
 */
function makeSender(opts: { allow: boolean; adapter: 'resolve' | 'reject' }) {
  const sendMessage = jest.fn(
    async (_params: SendMessageParams): Promise<void> => {
      if (opts.adapter === 'reject') {
        throw new Error('evolution boom');
      }
    },
  );

  const whatsappAdapter: ChannelAdapter = {
    channel: 'whatsapp',
    sendMessage,
    normalizeInbound: jest.fn(),
  };

  const get = jest.fn(() => whatsappAdapter);
  const channelRegistry = { get, has: () => true } as unknown as ChannelAdapterRegistry;

  const tryConsume = jest.fn(() => opts.allow);
  const rateLimiter = { tryConsume } as unknown as RateLimiterService;

  const config = {
    followUpSendWindowParsed: {
      startHour: 8,
      startMinute: 0,
      endHour: 20,
      endMinute: 0,
    },
  } as unknown as AppConfigService;

  const sender = new FollowUpSender(channelRegistry, rateLimiter, config);

  return { sender, sendMessage, tryConsume, get };
}

describe('FollowUpSender — property-based', () => {
  // Feature: lead-followup, Property 14: Disparo fora da janela é adiado sem marcar enviado
  it('Property 14: fora da janela retorna deferred(out_of_window) sem chamar o adapter nem consumir rate-limit', async () => {
    // **Validates: Requirements 9.2**
    await fc.assert(
      fc.asyncProperty(
        outsideWindowDateArb,
        sendParamsArb,
        fc.boolean(),
        async (now, params, allow) => {
          // O resultado independe do estado do rate-limiter: a janela é checada antes.
          const { sender, sendMessage, tryConsume, get } = makeSender({
            allow,
            adapter: 'resolve',
          });

          const outcome = await sender.send({ ...params, now });

          expect(outcome).toEqual({ status: 'deferred', reason: 'out_of_window' });
          // Não consome o rate-limit nem aciona o adapter Evolution.
          expect(tryConsume).not.toHaveBeenCalled();
          expect(get).not.toHaveBeenCalled();
          expect(sendMessage).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: lead-followup, Property 15: Rejeição do Rate_Limiter adia sem marcar enviado
  it('Property 15: dentro da janela com RateLimiter rejeitando retorna deferred(rate_limited) sem chamar o adapter', async () => {
    // **Validates: Requirements 9.3**
    await fc.assert(
      fc.asyncProperty(
        insideWindowDateArb,
        sendParamsArb,
        async (now, params) => {
          const { sender, sendMessage, tryConsume, get } = makeSender({
            allow: false, // RateLimiter rejeita
            adapter: 'resolve',
          });

          const outcome = await sender.send({ ...params, now });

          expect(outcome).toEqual({ status: 'deferred', reason: 'rate_limited' });
          // Consultou o limiter pela chave do telefone, mas não enviou nada.
          expect(tryConsume).toHaveBeenCalledTimes(1);
          expect(tryConsume).toHaveBeenCalledWith(params.phone, now.getTime());
          expect(get).not.toHaveBeenCalled();
          expect(sendMessage).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: lead-followup, Property 16: Envio confirmado devolve sentAt === now
  it('Property 16: dentro da janela, com token e adapter resolvendo, retorna sent com sentAt === now', async () => {
    // **Validates: Requirements 9.6**
    await fc.assert(
      fc.asyncProperty(
        insideWindowDateArb,
        sendParamsArb,
        async (now, params) => {
          const { sender, sendMessage } = makeSender({
            allow: true,
            adapter: 'resolve',
          });

          const outcome = await sender.send({ ...params, now });

          expect(outcome.status).toBe('sent');
          if (outcome.status === 'sent') {
            // O sentAt é exatamente o instante injetado (base para lastOutboundAt).
            expect(outcome.sentAt.getTime()).toBe(now.getTime());
          }
          // Enviou pelo adapter do WhatsApp exatamente uma vez com os dados certos.
          expect(sendMessage).toHaveBeenCalledTimes(1);
          expect(sendMessage).toHaveBeenCalledWith({
            to: params.phone,
            content: params.content,
            instanceName: params.instanceName ?? undefined,
            conversationId: params.conversationId,
          });
        },
      ),
      { numRuns: 200 },
    );
  });

  // Feature: lead-followup, Property 17: Falha do adapter retorna failed(evolution_error)
  it('Property 17: dentro da janela, com token, mas o adapter falhando retorna failed(evolution_error)', async () => {
    // **Validates: Requirements 9.4**
    await fc.assert(
      fc.asyncProperty(
        insideWindowDateArb,
        sendParamsArb,
        async (now, params) => {
          const { sender, sendMessage } = makeSender({
            allow: true,
            adapter: 'reject', // Evolution lança/rejeita
          });

          const outcome = await sender.send({ ...params, now });

          // O sender não marca enviado: apenas classifica como falha do Evolution.
          expect(outcome).toEqual({ status: 'failed', reason: 'evolution_error' });
          expect(sendMessage).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 200 },
    );
  });
});
