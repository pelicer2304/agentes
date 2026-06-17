import fc from 'fast-check';
import { EngagementClassifierService } from './engagement-classifier.service';
import type { AppConfigService } from '../config/config.service';
import type {
  LLMProvider,
  LLMCompletionResponse,
} from '../llm/llm-provider.interface';
import type { EngagementIntent, TurnContext } from './followup.types';

/**
 * Property-based tests for {@link EngagementClassifierService}
 * (`engagement-classifier.service.ts`).
 *
 * O classificador é a única borda LLM do pipeline de engajamento por turno
 * (Requisito 10). Ele recebe um Turn_Context e devolve SEMPRE um
 * `EngagementClassification` válido — nunca lança e nunca produz uma classe
 * fora de `{interesse_normal, nao_agora, opt_out}`. As duas propriedades de
 * correção do design são verificadas aqui com a `LLMProvider` MOCKADA
 * (`jest.fn` no método `complete`) e o `AppConfigService` fakeado, instanciando
 * o serviço manualmente (sem DI do Nest, sem I/O):
 *
 *  - Property 18: totalidade + segurança sob baixa confiança/ambiguidade.
 *  - Property 19: fail-safe por timeout/erro/indeterminação.
 *
 * Feature: lead-followup
 * Properties: 18, 19
 * Requirements: 10.1, 10.4, 10.5, 10.6, 10.7, 10.9, 13.5
 */

const CONFIDENCE_THRESHOLD = 0.7;
const CLASSIFIER_TIMEOUT_MS = 10000;

const VALID_INTENTS: ReadonlyArray<EngagementIntent> = [
  'interesse_normal',
  'nao_agora',
  'opt_out',
];

/**
 * Instancia o serviço com a `LLMProvider` mockada e o config fakeado conforme
 * a tarefa: timeout=10s, limiar=0.70, modelo vazio, infer-deferral=30s.
 */
function makeService(): {
  service: EngagementClassifierService;
  complete: jest.Mock;
} {
  const complete = jest.fn();
  const llmProviderMock = { complete } as unknown as LLMProvider;

  const configMock = {
    engagementClassifierTimeoutMs: CLASSIFIER_TIMEOUT_MS,
    engagementConfidenceThreshold: CONFIDENCE_THRESHOLD,
    engagementClassifierModel: '',
    engagementDeferralInferTimeoutMs: 30000,
  } as unknown as AppConfigService;

  const service = new EngagementClassifierService(llmProviderMock, configMock);
  return { service, complete };
}

/** Envelopa um `content` arbitrário num LLMCompletionResponse completo. */
function llmResponse(content: string): LLMCompletionResponse {
  return {
    content,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    model: 'mock-model',
  };
}

/** Turn_Context genérico (o conteúdo é irrelevante: o LLM está mockado). */
const GENERIC_TURN: TurnContext = {
  lastBotMessage: 'Qual é o segmento da sua empresa?',
  leadMessage: 'somos uma clínica odontológica',
};

/** Fato de negócio com negações (R10.5/R10.7) — não é desengajamento. */
const BUSINESS_FACT_TURN: TurnContext = {
  lastBotMessage: 'Como você costuma conseguir clientes hoje?',
  leadMessage: 'os clientes não me chamam, eu que chamo eles',
};

// --- Arbitrários do retorno do LLM -----------------------------------------

/** Classes válidas conhecidas pelo serviço. */
const knownIntentArb: fc.Arbitrary<string> = fc.constantFrom(
  'interesse_normal',
  'nao_agora',
  'opt_out',
);

/** Valores de classe desconhecidos/ruidosos (devem cair em interesse_normal). */
const unknownIntentArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(
    'maybe',
    'unknown',
    'INTERESSE_NORMAL',
    'nao agora',
    'handoff',
    'desistencia',
    '',
  ),
  fc.string(),
);

const intentValueArb: fc.Arbitrary<string> = fc.oneof(
  knownIntentArb,
  unknownIntentArb,
);

/** confidence em [0,1], sem NaN. */
const confidenceArb: fc.Arbitrary<number> = fc.double({
  min: 0,
  max: 1,
  noNaN: true,
});

type LLMCase = { content: string; expected: EngagementIntent };

/**
 * Calcula o desfecho esperado do serviço para uma classe/confiança brutas,
 * espelhando a especificação (não a implementação): apenas `nao_agora`/`opt_out`
 * com confiança suficiente sobrevivem; tudo o mais é rebaixado a
 * `interesse_normal`.
 */
function expectedFor(intent: string, confidence: number): EngagementIntent {
  if (intent === 'nao_agora' || intent === 'opt_out') {
    return confidence < CONFIDENCE_THRESHOLD ? 'interesse_normal' : intent;
  }
  return 'interesse_normal';
}

/** JSON válido com ambos os campos (classe conhecida OU desconhecida). */
const validBothArb: fc.Arbitrary<LLMCase> = fc
  .tuple(intentValueArb, confidenceArb)
  .map(([intent, confidence]) => ({
    content: JSON.stringify({ engagementIntent: intent, confidence }),
    expected: expectedFor(intent, confidence),
  }));

/** JSON válido mas sem os campos obrigatórios → fallback seguro. */
const missingFieldArb: fc.Arbitrary<LLMCase> = fc
  .oneof(
    confidenceArb.map((confidence) => JSON.stringify({ confidence })),
    intentValueArb.map((engagementIntent) =>
      JSON.stringify({ engagementIntent }),
    ),
    fc.constant('{}'),
    fc.constant('{"foo":"bar"}'),
  )
  .map((content) => ({ content, expected: 'interesse_normal' as const }));

/** Conteúdo que não é um objeto JSON → fallback seguro. */
const invalidJsonArb: fc.Arbitrary<LLMCase> = fc
  .constantFrom(
    'not json at all',
    '{ broken json',
    '',
    '   ',
    '[1,2,3]',
    'null',
    '42',
    'true',
    '"apenas uma string"',
    '```json\n{ nope',
  )
  .map((content) => ({ content, expected: 'interesse_normal' as const }));

const llmCaseArb: fc.Arbitrary<LLMCase> = fc.oneof(
  validBothArb,
  missingFieldArb,
  invalidJsonArb,
);

describe('EngagementClassifierService — property-based', () => {
  // Feature: lead-followup, Property 18: Classificação de engajamento é total e segura sob baixa confiança
  it('Property 18: retorna sempre um Engagement_Intent válido e rebaixa nao_agora/opt_out incertos a interesse_normal', async () => {
    // **Validates: Requirements 10.1, 10.4, 10.5, 10.6, 10.7**
    await fc.assert(
      fc.asyncProperty(llmCaseArb, async ({ content, expected }) => {
        const { service, complete } = makeService();
        complete.mockResolvedValue(llmResponse(content));

        const result = await service.classify(GENERIC_TURN);

        // Totalidade: a classe está sempre no domínio fechado.
        expect(VALID_INTENTS).toContain(result.intent);
        // Segurança: o desfecho casa com a especificação.
        expect(result.intent).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: lead-followup, Property 18: Fato de negócio com negações nunca é desengajamento
  it('Property 18: fato de negócio ("os clientes não me chamam...") com confiança baixa → interesse_normal', async () => {
    // **Validates: Requirements 10.5, 10.7**
    const lowConfidenceArb = fc.double({
      min: 0,
      max: CONFIDENCE_THRESHOLD,
      maxExcluded: true,
      noNaN: true,
    });

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<EngagementIntent>('nao_agora', 'opt_out'),
        lowConfidenceArb,
        async (suggestedIntent, confidence) => {
          const { service, complete } = makeService();
          // O LLM hesita (confiança < limiar) sobre o fato de negócio.
          complete.mockResolvedValue(
            llmResponse(
              JSON.stringify({
                engagementIntent: suggestedIntent,
                confidence,
              }),
            ),
          );

          const result = await service.classify(BUSINESS_FACT_TURN);

          expect(result.intent).toBe('interesse_normal');
          expect(result.failSafe).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: lead-followup, Property 19: Fail-safe da classificação por timeout/erro/indeterminação
  it('Property 19: quando o complete rejeita, classify nunca lança e retorna interesse_normal com failSafe', async () => {
    // **Validates: Requirements 10.9, 13.5**
    const rejectionArb = fc.oneof(
      fc.string().map((m) => new Error(m)),
      fc.constant(new Error('network down')),
      fc.constant('falha em string'),
      fc.constant(null),
      fc.constant(undefined),
      fc.record({ code: fc.string(), status: fc.integer() }),
    );

    await fc.assert(
      fc.asyncProperty(rejectionArb, async (rejection) => {
        const { service, complete } = makeService();
        complete.mockRejectedValue(rejection);

        // Nunca lança: se lançasse, a propriedade rejeitaria e o teste falharia.
        const result = await service.classify(GENERIC_TURN);

        expect(result.intent).toBe('interesse_normal');
        expect(result.failSafe).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: lead-followup, Property 19: Fail-safe por timeout (excede ENGAGEMENT_CLASSIFIER_TIMEOUT_MS)
  it('Property 19: quando o complete demora além do timeout → interesse_normal com failSafe', async () => {
    // **Validates: Requirements 10.9**
    jest.useFakeTimers();
    try {
      const { service, complete } = makeService();
      // O provider nunca resolve: só o timeout interno deve desempatar.
      complete.mockReturnValue(new Promise<LLMCompletionResponse>(() => {}));

      const pending = service.classify(GENERIC_TURN);
      // Avança o relógio além do timeout configurado, drenando microtasks.
      await jest.advanceTimersByTimeAsync(CLASSIFIER_TIMEOUT_MS + 1);

      const result = await pending;

      expect(result.intent).toBe('interesse_normal');
      expect(result.failSafe).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
