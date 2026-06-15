import fc from 'fast-check';

import { ReengagementMessageComposer } from './reengagement-message.composer';
import type { ReengagementContext } from './followup.types';

/**
 * Testes do ReengagementMessageComposer (lógica pura, fallback determinístico).
 *
 * Tarefas 4.2 (testes de propriedade) e 4.3 (testes de exemplo/fallback) do
 * plano em .kiro/specs/lead-followup/tasks.md.
 *
 * TENSÃO DE DESIGN (documentada): o composer insere o VALOR EXATO de
 * `segment`/`mainPain` no corpo da mensagem e a única CTA/pergunta é uma `?`
 * inserida pelo próprio composer ao final. Logo, se `segment`/`mainPain`
 * (ou `agentName`, que entra na saudação) contivessem o caractere '?', haveria
 * uma `?` "extra" e a contagem de CTA deixaria de ser 1. Por isso, os geradores
 * fast-check abaixo RESTRINGEM esses campos a NÃO conter '?'. A CTA é então
 * contada de forma robusta pela contagem de ocorrências de '?', que deve ser
 * exatamente 1.
 */
describe('ReengagementMessageComposer', () => {
  const composer = new ReengagementMessageComposer();

  /** Conta ocorrências do caractere '?' (proxy robusto para a CTA única). */
  function countQuestionMarks(text: string): number {
    return (text.match(/\?/g) ?? []).length;
  }

  /** Gerador de string sem o caractere '?' (ver TENSÃO DE DESIGN acima). */
  const noQuestionMarkString = (maxLength: number) =>
    fc.string({ maxLength }).filter((s) => !s.includes('?'));

  /** Valor "preenchido": não vazio após trim e sem '?'. */
  const filledNoQuestionMark = (maxLength: number) =>
    fc
      .string({ minLength: 1, maxLength })
      .filter((s) => s.trim().length > 0 && !s.includes('?'));

  /** Valor "vazio/ausente": null, string vazia ou apenas espaços. */
  const emptyOrNull = fc.constantFrom<string | null>(null, '', '   ', '\t');

  const levelArb = fc.constantFrom<1 | 2 | 3>(1, 2, 3);

  // ----------------------------------------------------------------------
  // Property 9: Mensagem referencia segmento e dor quando preenchidos
  // ----------------------------------------------------------------------
  // Feature: lead-followup, Property 9: a mensagem contém o valor EXATO do
  // segmento quando preenchido (referencedSegment=true) e o valor EXATO da dor
  // quando preenchida (referencedPain=true); quando ambos vazios/nulos, a
  // mensagem é genérica, sem referências, e os flags são false.
  // Validates: Requirements 5.1, 5.2, 5.4
  describe('Property 9: referencia segmento e dor quando preenchidos', () => {
    // Comprimentos limitados para garantir que a mensagem completa fique
    // abaixo do limite de 1000 chars e, portanto, NÃO sofra truncamento — só
    // assim o "valor exato" está garantidamente presente. O caso de strings
    // muito longas (que truncam) é coberto pela Property 10 e pelos exemplos.
    it('inclui o valor exato de segment e mainPain quando ambos preenchidos', () => {
      fc.assert(
        fc.property(
          levelArb,
          filledNoQuestionMark(120),
          filledNoQuestionMark(120),
          noQuestionMarkString(40),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.referencedSegment).toBe(true);
            expect(msg.referencedPain).toBe(true);
            expect(msg.content).toContain(segment);
            expect(msg.content).toContain(mainPain);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('inclui o valor exato apenas do segment quando só o segmento está preenchido', () => {
      fc.assert(
        fc.property(
          levelArb,
          filledNoQuestionMark(120),
          emptyOrNull,
          noQuestionMarkString(40),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.referencedSegment).toBe(true);
            expect(msg.referencedPain).toBe(false);
            expect(msg.content).toContain(segment);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('inclui o valor exato apenas do mainPain quando só a dor está preenchida', () => {
      fc.assert(
        fc.property(
          levelArb,
          emptyOrNull,
          filledNoQuestionMark(120),
          noQuestionMarkString(40),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.referencedSegment).toBe(false);
            expect(msg.referencedPain).toBe(true);
            expect(msg.content).toContain(mainPain);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('gera mensagem genérica sem referências e flags false quando ambos vazios/nulos', () => {
      fc.assert(
        fc.property(
          levelArb,
          emptyOrNull,
          emptyOrNull,
          noQuestionMarkString(40),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.referencedSegment).toBe(false);
            expect(msg.referencedPain).toBe(false);
            // A mensagem genérica retoma a conversa sem citar segmento/dor.
            expect(msg.content).toContain('retomar a nossa conversa');
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // ----------------------------------------------------------------------
  // Property 10: Invariantes de forma da mensagem
  // ----------------------------------------------------------------------
  // Feature: lead-followup, Property 10: para qualquer ReengagementContext
  // (incluindo segment/mainPain arbitrariamente longos e o caso genérico),
  // content.length <= 1000 e há exatamente uma pergunta/CTA (uma única '?').
  // Validates: Requirements 5.3, 5.4, 5.5
  describe('Property 10: invariantes de forma (<= 1000 chars e exatamente uma CTA)', () => {
    // segment/mainPain podem ser longos (testando truncamento) ou vazios
    // (testando o caso genérico). Em todos os casos não contêm '?' para que a
    // contagem de '?' reflita exatamente a CTA inserida pelo composer.
    const longOrEmptySegment = fc.oneof(
      emptyOrNull,
      noQuestionMarkString(2000),
    );

    it('respeita o limite de 1000 caracteres e contém exatamente uma CTA', () => {
      fc.assert(
        fc.property(
          levelArb,
          longOrEmptySegment,
          longOrEmptySegment,
          noQuestionMarkString(200),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.content.length).toBeLessThanOrEqual(1000);
            expect(countQuestionMarks(msg.content)).toBe(1);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('mantém a CTA preservada ao final mesmo quando há truncamento', () => {
      fc.assert(
        fc.property(
          levelArb,
          filledNoQuestionMark(2000),
          filledNoQuestionMark(2000),
          noQuestionMarkString(200),
          (level, segment, mainPain, agentName) => {
            const ctx: ReengagementContext = { level, segment, mainPain, agentName };
            const msg = composer.compose(ctx);

            expect(msg.content.length).toBeLessThanOrEqual(1000);
            expect(countQuestionMarks(msg.content)).toBe(1);
            // A '?' é sempre o último caractere do conteúdo (CTA ao final).
            expect(msg.content.endsWith('?')).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  // ----------------------------------------------------------------------
  // 4.3 — Testes de exemplo/fallback de composição (R5.6)
  // ----------------------------------------------------------------------
  // O composer é puro e determinístico (sem LLM nesta implementação): o caminho
  // determinístico está SEMPRE disponível e nunca lança. Estes exemplos cobrem
  // os quatro caminhos (só segmento, só dor, ambos, nenhum), os flags e o
  // truncamento seguro preservando a CTA ao final.
  describe('fallback determinístico (exemplos)', () => {
    it('caso só segmento: referencia o segmento e marca apenas referencedSegment', () => {
      const msg = composer.compose({
        level: 1,
        segment: 'restaurantes',
        mainPain: null,
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(true);
      expect(msg.referencedPain).toBe(false);
      expect(msg.content).toContain('restaurantes');
      expect(msg.content).toContain('Ana');
      expect(countQuestionMarks(msg.content)).toBe(1);
      expect(msg.content.endsWith('?')).toBe(true);
    });

    it('caso só dor: referencia a dor e marca apenas referencedPain', () => {
      const msg = composer.compose({
        level: 2,
        segment: null,
        mainPain: 'baixa taxa de conversão',
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(false);
      expect(msg.referencedPain).toBe(true);
      expect(msg.content).toContain('baixa taxa de conversão');
      expect(countQuestionMarks(msg.content)).toBe(1);
    });

    it('caso ambos: referencia segmento e dor, marcando os dois flags', () => {
      const msg = composer.compose({
        level: 3,
        segment: 'clínicas odontológicas',
        mainPain: 'agenda ociosa',
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(true);
      expect(msg.referencedPain).toBe(true);
      expect(msg.content).toContain('clínicas odontológicas');
      expect(msg.content).toContain('agenda ociosa');
      expect(countQuestionMarks(msg.content)).toBe(1);
    });

    it('caso nenhum: mensagem genérica sem referências e flags false', () => {
      const msg = composer.compose({
        level: 1,
        segment: null,
        mainPain: null,
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(false);
      expect(msg.referencedPain).toBe(false);
      expect(msg.content).toContain('retomar a nossa conversa');
      expect(countQuestionMarks(msg.content)).toBe(1);
    });

    it('trata segmento/dor apenas com espaços como ausentes (genérico)', () => {
      const msg = composer.compose({
        level: 1,
        segment: '   ',
        mainPain: '\t',
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(false);
      expect(msg.referencedPain).toBe(false);
    });

    it('trunca segment muito longo mantendo <= 1000 chars e a CTA ao final', () => {
      const longSegment = 'segmento '.repeat(300); // ~2700 chars, sem '?'
      const msg = composer.compose({
        level: 1,
        segment: longSegment,
        mainPain: null,
        agentName: 'Ana',
      });

      expect(msg.referencedSegment).toBe(true);
      expect(msg.content.length).toBeLessThanOrEqual(1000);
      expect(countQuestionMarks(msg.content)).toBe(1);
      expect(msg.content.endsWith('?')).toBe(true);
    });

    it('trunca mainPain muito longo mantendo <= 1000 chars e a CTA ao final', () => {
      const longPain = 'dor '.repeat(500); // ~2000 chars, sem '?'
      const msg = composer.compose({
        level: 3,
        segment: null,
        mainPain: longPain,
        agentName: 'Ana',
      });

      expect(msg.referencedPain).toBe(true);
      expect(msg.content.length).toBeLessThanOrEqual(1000);
      expect(countQuestionMarks(msg.content)).toBe(1);
      expect(msg.content.endsWith('?')).toBe(true);
    });

    it('é determinístico: a mesma entrada sempre produz a mesma saída', () => {
      const ctx: ReengagementContext = {
        level: 2,
        segment: 'e-commerce',
        mainPain: 'carrinho abandonado',
        agentName: 'Ana',
      };

      expect(composer.compose(ctx)).toEqual(composer.compose(ctx));
    });
  });
});
