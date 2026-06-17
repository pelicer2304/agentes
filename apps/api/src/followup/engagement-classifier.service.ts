import { Inject, Injectable, Logger } from '@nestjs/common';
import { LLM_PROVIDER_TOKEN, LLMProvider } from '../llm/llm-provider.interface';
import { AppConfigService } from '../config/config.service';
import {
  EngagementClassification,
  EngagementIntent,
  TurnContext,
} from './followup.types';

/**
 * Classificador síncrono e leve do Engagement_Intent de um único turno (R10).
 *
 * Faz uma chamada LLM curta (prompt mínimo, temperatura baixa, JSON) via a
 * `LLMProvider` já existente — o mesmo token/injeção usado pelo
 * `AgentReplyService`/`AgentAnalysisService` (`@Inject(LLM_PROVIDER_TOKEN)`).
 * Não usa listas de palavras-chave fixas (R10.3): a classe é sempre decidida
 * pelo LLM, com um guard determinístico de confiança como rede de segurança.
 *
 * O resultado é SEMPRE um `EngagementClassification` válido: o método nunca
 * lança. Em timeout, erro, JSON inválido, classe desconhecida ou confiança
 * insuficiente, retorna a classe segura `interesse_normal` com `failSafe`.
 */
@Injectable()
export class EngagementClassifierService {
  private readonly logger = new Logger(EngagementClassifierService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly llmProvider: LLMProvider,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Classifica o Engagement_Intent do turno a partir do Turn_Context (R10).
   *
   * @returns sempre um EngagementClassification válido (nunca lança).
   */
  async classify(ctx: TurnContext): Promise<EngagementClassification> {
    const timeoutMs = this.config.engagementClassifierTimeoutMs;

    try {
      const response = await this.withTimeout(
        this.llmProvider.complete({
          model: this.config.engagementClassifierModel || undefined,
          temperature: 0.1,
          maxTokens: 200,
          responseFormat: 'json',
          messages: this.buildMessages(ctx),
        }),
        timeoutMs,
      );

      return this.normalize(response.content);
    } catch (error) {
      // Timeout, erro de rede ou qualquer falha inesperada → fail-safe (R10.9).
      this.logger.warn(
        `[engagement-classifier] classificação falhou (${error instanceof Error ? error.message : 'erro desconhecido'}); ` +
          `turno="${this.previewTurn(ctx)}" → interesse_normal (failSafe)`,
      );
      return this.failSafe();
    }
  }

  /**
   * Monta o prompt MÍNIMO: um `system` curto descreve a tarefa e as três
   * classes (reforçando que fatos de negócio com negações são interesse_normal,
   * R10.5/R10.7) e o `user` injeta apenas o Turn_Context (R10.2).
   */
  private buildMessages(
    ctx: TurnContext,
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const system =
      'Você classifica a intenção de engajamento do lead em UM turno. ' +
      'Responda SÓ com JSON {"engagementIntent","confidence","deferral"}. ' +
      'Classes:\n' +
      '- nao_agora: o lead pede explicitamente para ser contatado MAIS TARDE.\n' +
      '- opt_out: o lead pede explicitamente para PARAR de receber mensagens.\n' +
      '- interesse_normal: qualquer outra coisa, INCLUSIVE quando ele descreve ' +
      'um fato do negócio dele em resposta à pergunta (mesmo com negações, ex.: ' +
      '"os clientes não me chamam, eu que chamo eles").\n' +
      'Se houver dúvida ou empate, use interesse_normal com confidence baixa. ' +
      'confidence é um número entre 0 e 1. ' +
      'Se (e somente se) o lead indicar um prazo ("amanhã de manhã", "semana ' +
      'que vem"), estime deferral.durationHours (inteiro de horas).';

    const lastBot = ctx.lastBotMessage ?? '(sem pergunta anterior)';
    const user = `PERGUNTA DO BOT: ${lastBot}\nRESPOSTA DO LEAD: ${ctx.leadMessage}`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  /**
   * Valida e normaliza o JSON do LLM para exatamente um EngagementIntent.
   *
   * - JSON inválido / parse falha / classe desconhecida → interesse_normal + failSafe.
   * - confidence < limiar (ou ausente/inválida) → rebaixa para interesse_normal + failSafe (R10.6).
   * - classe válida com confiança suficiente → resultado do LLM com failSafe=false.
   * - nao_agora com prazo válido no JSON → preenche deferral.durationHours.
   */
  private normalize(rawContent: string): EngagementClassification {
    const parsed = this.parseJson(rawContent);
    if (parsed === null) {
      return this.failSafe();
    }

    const intent = this.coerceIntent(parsed.engagementIntent);
    if (intent === null) {
      // Classe desconhecida → fallback seguro (R10.4).
      return this.failSafe();
    }

    const confidence = this.coerceConfidence(parsed.confidence);
    if (confidence === null) {
      // confidence ausente/inválida → trata como indeterminado (fallback).
      return this.failSafe();
    }

    // interesse_normal já é a classe segura: aceita diretamente como
    // classificação genuína do LLM (não é fallback).
    if (intent === 'interesse_normal') {
      return { intent: 'interesse_normal', confidence, failSafe: false };
    }

    // nao_agora / opt_out abaixo do limiar de confiança são rebaixados à
    // classe segura (R10.6, e o guard de fato-de-negócio de R10.5/R10.7).
    if (confidence < this.config.engagementConfidenceThreshold) {
      return { intent: 'interesse_normal', confidence, failSafe: true };
    }

    // Classe de desengajamento com confiança suficiente — classificação válida.
    const result: EngagementClassification = {
      intent,
      confidence,
      failSafe: false,
    };

    if (intent === 'nao_agora') {
      const durationHours = this.coerceDurationHours(parsed.deferral);
      if (durationHours !== null) {
        result.deferral = { durationHours };
      }
    }

    return result;
  }

  /** Faz o parse tolerante do conteúdo (remove cercas ```json); null se falhar. */
  private parseJson(content: string): Record<string, unknown> | null {
    try {
      let text = (content ?? '').trim();
      if (text.startsWith('```json')) text = text.slice(7);
      else if (text.startsWith('```')) text = text.slice(3);
      if (text.endsWith('```')) text = text.slice(0, -3);
      text = text.trim();
      if (text.length === 0) return null;

      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Mapeia o campo bruto para um EngagementIntent conhecido, ou null. */
  private coerceIntent(value: unknown): EngagementIntent | null {
    if (
      value === 'interesse_normal' ||
      value === 'nao_agora' ||
      value === 'opt_out'
    ) {
      return value;
    }
    return null;
  }

  /** Converte confidence para [0,1]; null se não for um número finito. */
  private coerceConfidence(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  /**
   * Extrai deferral.durationHours quando presente e positivo; arredonda para
   * inteiro de horas. Retorna null quando ausente/inválido.
   */
  private coerceDurationHours(deferral: unknown): number | null {
    if (deferral === null || typeof deferral !== 'object') {
      return null;
    }
    const raw = (deferral as Record<string, unknown>).durationHours;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
      return null;
    }
    return Math.round(raw);
  }

  /** Classe segura padrão de qualquer fallback (R10.6, R10.9). */
  private failSafe(): EngagementClassification {
    return { intent: 'interesse_normal', confidence: 0, failSafe: true };
  }

  /** Pequeno preview do turno para logs, sem vazar a mensagem inteira. */
  private previewTurn(ctx: TurnContext): string {
    const msg = (ctx.leadMessage ?? '').replace(/\s+/g, ' ').trim();
    return msg.length > 60 ? `${msg.slice(0, 60)}…` : msg;
  }

  /**
   * Aplica um timeout via Promise.race; rejeita com erro após `ms` (R10.9).
   * O timer é sempre limpo para não vazar handles.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`engagement classification timed out after ${ms}ms`));
      }, ms);

      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
