import { Injectable } from '@nestjs/common';

import type {
  ReengagementContext,
  ReengagementMessage,
} from './followup.types';

/**
 * ReengagementMessageComposer — composição contextualizada da mensagem de
 * reengajamento (R5).
 *
 * Esta implementação cobre o **caminho determinístico (template contextual)**,
 * que está SEMPRE disponível e é uma função pura: o mesmo `ReengagementContext`
 * sempre produz a mesma `ReengagementMessage`, sem I/O nem dependências de
 * tempo. O enriquecimento opcional via LLM (R5.6) é tratado fora desta classe
 * e sempre faz fallback para este texto determinístico.
 *
 * Invariantes garantidas por construção:
 *  - quando `segment` está preenchido, o conteúdo referencia o VALOR EXATO do
 *    segmento e `referencedSegment = true` (R5.1);
 *  - quando `mainPain` está preenchido, o conteúdo referencia o VALOR EXATO da
 *    dor principal e `referencedPain = true` (R5.2);
 *  - quando ambos estão vazios/nulos, a mensagem é genérica, sem referências, e
 *    `referencedSegment = referencedPain = false` (R5.4);
 *  - o conteúdo contém EXATAMENTE uma pergunta/CTA — o template insere uma única
 *    `?`, sempre ao final, e nenhuma outra `?` é adicionada pelo composer (R5.3);
 *  - o conteúdo tem NO MÁXIMO 1000 caracteres; a normalização final trunca de
 *    forma segura a parte variável da mensagem, preservando intacta a CTA/pergunta
 *    final (R5.5).
 */
@Injectable()
export class ReengagementMessageComposer {
  /** Limite máximo de caracteres do conteúdo da mensagem (R5.5). */
  private static readonly MAX_LENGTH = 1000;

  /**
   * Monta a mensagem de reengajamento determinística para um nível.
   *
   * @param ctx contexto com nível, segmento, dor principal e nome do agente.
   * @returns mensagem com o conteúdo final e os flags de referência.
   */
  compose(ctx: ReengagementContext): ReengagementMessage {
    const hasSegment = ReengagementMessageComposer.isFilled(ctx.segment);
    const hasPain = ReengagementMessageComposer.isFilled(ctx.mainPain);

    const greeting = this.buildGreeting(ctx.agentName);

    let body: string;
    let cta: string;

    if (hasSegment && hasPain) {
      // Referencia o valor EXATO do segmento e da dor principal (R5.1, R5.2).
      body = `${greeting}vi que conversamos sobre ${ctx.segment} e sobre a sua dor com ${ctx.mainPain}, e quero te ajudar a avançar nisso.`;
      cta = 'Podemos retomar de onde paramos?';
    } else if (hasSegment) {
      // Referencia o valor EXATO do segmento (R5.1).
      body = `${greeting}lembrei da nossa conversa sobre ${ctx.segment} e quero entender melhor como te ajudar.`;
      cta = 'Podemos continuar?';
    } else if (hasPain) {
      // Referencia o valor EXATO da dor principal (R5.2).
      body = `${greeting}continuo pensando em como resolver ${ctx.mainPain} para você.`;
      cta = 'Quer dar o próximo passo comigo?';
    } else {
      // Reengajamento genérico, sem referências (R5.4).
      body = `${greeting}passando para retomar a nossa conversa e seguir te ajudando.`;
      cta = 'Podemos continuar de onde paramos?';
    }

    const content = ReengagementMessageComposer.assemble(body, cta);

    return {
      content,
      referencedSegment: hasSegment,
      referencedPain: hasPain,
    };
  }

  /**
   * Saudação contextual. Usa o nome do agente quando disponível; caso contrário,
   * uma saudação neutra. Não introduz nenhuma `?` (preserva a invariante de CTA
   * única).
   */
  private buildGreeting(agentName: string): string {
    const name = typeof agentName === 'string' ? agentName.trim() : '';
    return name.length > 0 ? `Oi! Aqui é ${name}, ` : 'Oi! ';
  }

  /**
   * Considera "preenchido" qualquer valor não nulo cujo conteúdo, após remover
   * espaços nas extremidades, não seja vazio (R5.4 trata vazio como ausente).
   */
  private static isFilled(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * Combina a parte variável (`body`) com a CTA/pergunta única (`cta`),
   * garantindo o limite de 1000 caracteres. Quando o total excede o limite,
   * trunca apenas a parte variável, preservando integralmente a CTA — o que
   * mantém a `?` única ao final do conteúdo (R5.3, R5.5).
   */
  private static assemble(body: string, cta: string): string {
    const full = `${body} ${cta}`;
    if (full.length <= ReengagementMessageComposer.MAX_LENGTH) {
      return full;
    }

    // Reserva espaço para um separador e a CTA completa.
    const reserved = cta.length + 1;
    const available = ReengagementMessageComposer.MAX_LENGTH - reserved;

    if (available <= 0) {
      // Caso degenerado (CTA isolada já excede o limite): trunca a própria CTA.
      return cta.slice(0, ReengagementMessageComposer.MAX_LENGTH);
    }

    const truncatedBody = body.slice(0, available).trimEnd();
    return `${truncatedBody} ${cta}`;
  }
}
