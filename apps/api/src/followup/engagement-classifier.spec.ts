import { EngagementClassifierService } from './engagement-classifier.service';
import type { AppConfigService } from '../config/config.service';
import type { LLMProvider } from '../llm/llm-provider.interface';
import type { TurnContext } from './followup.types';

/**
 * Testes de exemplo ADVERSARIAIS de falso positivo do EngagementClassifierService.
 *
 * Tarefa 15.3 (opcional, mas testes adversariais OBRIGATÓRIOS) do plano em
 * .kiro/specs/lead-followup/tasks.md. _Requirements: 10.7_
 *
 * PRINCÍPIO ANTI-FALSO-POSITIVO (R10.7):
 * O serviço NÃO usa listas de palavras-chave (R10.3). A decisão de classe é
 * SEMPRE do LLM; o serviço apenas valida/normaliza o JSON do LLM e aplica um
 * GUARD DETERMINÍSTICO DE CONFIANÇA como rede de segurança: qualquer classe de
 * desengajamento (`nao_agora`/`opt_out`) abaixo do limiar de confiança
 * (0.70 por padrão) é REBAIXADA para a classe segura `interesse_normal`
 * (R10.5/R10.6). Assim, fatos de negócio com negações ("os clientes não me
 * chamam, eu que chamo eles") nunca viram desengajamento por engano.
 *
 * Como o classificador delega ao LLM, mockamos `LLMProvider.complete` para
 * retornar exatamente o JSON que um bom LLM produziria em cada cenário e
 * verificamos a normalização determinística do serviço (incluindo o guard).
 */
describe('EngagementClassifierService — testes adversariais de falso positivo (R10.7)', () => {
  /**
   * LLMProvider MOCKADO: cada teste configura `complete` para devolver o
   * conteúdo JSON desejado. Não há chamada de rede real.
   */
  function makeMockProvider(
    content: string,
  ): { provider: LLMProvider; complete: jest.Mock } {
    const complete = jest.fn().mockResolvedValue({
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: 'mock-model',
    });
    return { provider: { complete } as unknown as LLMProvider, complete };
  }

  /** Config mínima com os valores padrão de produção (limiar = 0.70). */
  function makeConfig(threshold = 0.7): AppConfigService {
    return {
      engagementClassifierTimeoutMs: 10000,
      engagementConfidenceThreshold: threshold,
      engagementClassifierModel: '',
    } as unknown as AppConfigService;
  }

  function makeService(
    content: string,
    threshold = 0.7,
  ): { service: EngagementClassifierService; complete: jest.Mock } {
    const { provider, complete } = makeMockProvider(content);
    const service = new EngagementClassifierService(provider, makeConfig(threshold));
    return { service, complete };
  }

  // ---------------------------------------------------------------------------
  // Caso 1 — Fato de negócio com negação NÃO é desengajamento (R10.7)
  // ---------------------------------------------------------------------------
  // Cenário real: o bot pergunta algo de qualificação ("como seus clientes te
  // acionam?") e o lead RESPONDE descrevendo o negócio dele com uma negação
  // ("os clientes não me chamam, eu que chamo eles"). Um classificador ingênuo
  // baseado em keyword ("não", "não me chamam") cairia em falso positivo. Aqui
  // o LLM corretamente classifica como interesse_normal com alta confiança, e o
  // serviço respeita esse resultado.
  it('classifica fato de negócio com negação como interesse_normal (LLM com alta confiança)', async () => {
    const { service, complete } = makeService(
      JSON.stringify({ engagementIntent: 'interesse_normal', confidence: 0.9 }),
    );

    const ctx: TurnContext = {
      lastBotMessage: 'Como seus clientes costumam te acionar?',
      leadMessage: 'os clientes não me chamam, eu que chamo eles',
    };

    const result = await service.classify(ctx);

    expect(result.intent).toBe('interesse_normal');
    expect(result.failSafe).toBe(false);
    expect(result.confidence).toBeCloseTo(0.9);
    // Confirma que o serviço de fato delegou ao LLM (não há atalho por keyword).
    expect(complete).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Caso 2 (TESTE-CHAVE) — Guard de confiança do PRÓPRIO serviço (R10.5/R10.6)
  // ---------------------------------------------------------------------------
  // Mesmo que o LLM ERRE e proponha 'opt_out' para um fato de negócio, se a
  // confiança ficar abaixo do limiar (0.70) o serviço REBAIXA para
  // interesse_normal. Esta é a rede de segurança determinística contra falso
  // positivo, INDEPENDENTE do que o LLM retornou.
  it('rebaixa opt_out de baixa confiança (0.4) para interesse_normal — guard < 0.70 (anti-falso-positivo)', async () => {
    const { service } = makeService(
      JSON.stringify({ engagementIntent: 'opt_out', confidence: 0.4 }),
    );

    const ctx: TurnContext = {
      lastBotMessage: 'Como seus clientes costumam te acionar?',
      leadMessage: 'os clientes não me chamam, eu que chamo eles',
    };

    const result = await service.classify(ctx);

    // Apesar do LLM sugerir opt_out, a baixa confiança aciona o guard.
    expect(result.intent).toBe('interesse_normal');
    expect(result.failSafe).toBe(true); // veio do rebaixamento por confiança
    expect(result.confidence).toBeCloseTo(0.4);
  });

  // Reforço do guard: o mesmo vale para 'nao_agora' de baixa confiança.
  it('rebaixa nao_agora de baixa confiança para interesse_normal (guard < 0.70)', async () => {
    const { service } = makeService(
      JSON.stringify({ engagementIntent: 'nao_agora', confidence: 0.55 }),
    );

    const result = await service.classify({
      lastBotMessage: 'Posso te mandar uma proposta?',
      leadMessage: 'os clientes não me chamam, eu que chamo eles',
    });

    expect(result.intent).toBe('interesse_normal');
    expect(result.failSafe).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Caso 3 — Adiamento legítimo é respeitado quando a confiança é suficiente
  // ---------------------------------------------------------------------------
  // "não, eu volto a te acionar quando eu quiser" é um ADIAMENTO real, não um
  // opt_out e não escala. A distinção fina (adiamento vs. opt-out vs. fato de
  // negócio) é responsabilidade do LLM; o serviço respeita o resultado quando a
  // confiança >= limiar. Documenta que o serviço NÃO transforma isso em opt_out.
  it('respeita nao_agora quando o LLM tem confiança suficiente (adiamento legítimo, não opt_out)', async () => {
    const { service } = makeService(
      JSON.stringify({ engagementIntent: 'nao_agora', confidence: 0.85 }),
    );

    const ctx: TurnContext = {
      lastBotMessage: 'Quer agendar uma conversa esta semana?',
      leadMessage: 'não, eu volto a te acionar quando eu quiser',
    };

    const result = await service.classify(ctx);

    expect(result.intent).toBe('nao_agora');
    expect(result.intent).not.toBe('opt_out'); // adiamento NÃO é opt_out
    expect(result.failSafe).toBe(false);
    expect(result.confidence).toBeCloseTo(0.85);
  });
});
