/**
 * PriceAnswerComposer — deterministically answers Price_Questions from the
 * Pricing_Config, bypassing the LLM so the reply is always on-topic and never
 * deflects.
 *
 * Pure function, no LLM, no I/O. Replies in conversational Portuguese.
 *
 * Behavior (Requirement 2):
 * - Always acknowledges the price intent (R2.1).
 * - When the price range is enabled and a non-empty starting-price text is
 *   configured, includes that configured text and excludes any AI-behavior
 *   explanation and any refusal to discuss price (R2.2, R2.4, R2.5).
 * - When the price range is disabled (or no usable starting-price text),
 *   states that the final value depends on scope and offers to route the lead
 *   to the team for a direct estimate (R2.3), still without refusal language
 *   (R2.5).
 *
 * Feature: conversational-agent-quality
 */
import { PriceAnswerInput } from './conversation-types';

/**
 * Composes a deterministic reply to a price question.
 *
 * The returned text always acknowledges the price intent, never contains the
 * canned AI-behavior explanation, and never states or implies a refusal to
 * discuss price.
 */
export function composePriceAnswer(input: PriceAnswerInput): string {
  const startingPriceText = input.startingPriceText?.trim() ?? '';
  const hasStartingPrice = startingPriceText.length > 0;

  if (input.pricingRangeEnabled && hasStartingPrice) {
    // R2.1 acknowledge + R2.2 include the configured starting-price text.
    // No AI-behavior explanation (R2.4) and no refusal phrasing (R2.5).
    // Normaliza a pontuação para o texto configurado não grudar na frase
    // seguinte (ex.: "R$ 2.500" sem ponto).
    const priceClause = /[.!?]$/.test(startingPriceText)
      ? startingPriceText
      : `${startingPriceText}.`;
    return (
      `Boa pergunta. Pra te dar uma base: ${priceClause} ` +
      'O valor final depende do tamanho do atendimento e do que precisa integrar. ' +
      'Quer que eu chame a equipe pra fechar um número certo pro seu caso?'
    );
  }

  // R2.1 acknowledge + R2.3 depends on scope and offer to route to the team.
  return (
    'Boa pergunta sobre preço. O valor fecha conforme o escopo de cada ' +
    'projeto, então, pra te passar um número certo, posso te encaminhar pro ' +
    'nosso time montar uma estimativa pro seu caso. Quer?'
  );
}
