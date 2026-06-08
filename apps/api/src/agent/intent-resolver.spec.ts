import { resolveIntent } from './intent-resolver';
import { IntentContext } from './conversation-types';

/**
 * Regression cases for the IntentResolver (`resolveIntent`).
 *
 * Migrated from `intent-classifier.spec.ts` to the new resolver API
 * (`resolveIntent(rawMessage, ctx)` -> `ResolvedIntent`) and extended with:
 *  - natural price phrasings (e.g. "queria saber valores", "qual o valor")
 *  - frustration-vs-price precedence (frustration is resolved BEFORE price)
 *
 * Feature: conversational-agent-quality
 * Requirements: 1.1, 1.2, 2.1
 */
describe('IntentResolver (resolveIntent)', () => {
  const none: IntentContext = { hasFacts: false, handoffState: 'none' };
  const withFacts: IntentContext = { hasFacts: true, handoffState: 'none' };
  const suggested: IntentContext = { hasFacts: true, handoffState: 'suggested' };
  const completed: IntentContext = { hasFacts: true, handoffState: 'completed' };

  describe('ambiguous / informational messages fall through to general', () => {
    it('"Tenho uma loja de moda íntima..." -> general', () => {
      const r = resolveIntent('Tenho uma loja de moda íntima e vendo pelo WhatsApp', withFacts);
      expect(r.category).toBe('general');
    });

    it('"Os vendedores perdem tempo..." -> general', () => {
      const r = resolveIntent('Os vendedores perdem muito tempo perguntando as mesmas coisas', withFacts);
      expect(r.category).toBe('general');
    });

    it('"Umas 50 por dia" -> general (volume info)', () => {
      const r = resolveIntent('Umas 50 por dia', withFacts);
      expect(r.category).toBe('general');
    });

    it('"Sou o dono" -> general (decision role)', () => {
      const r = resolveIntent('Sou o dono', withFacts);
      expect(r.category).toBe('general');
    });

    it('"Tenho um ERP próprio, minha equipe desenvolveu" -> general (integration context)', () => {
      const r = resolveIntent('Tenho um ERP próprio, minha equipe desenvolveu', withFacts);
      expect(r.category).toBe('general');
    });
  });

  describe('price_question — natural phrasings (R2.1, broadened detection)', () => {
    it('"queria saber valores" -> price_question', () => {
      const r = resolveIntent('queria saber valores', withFacts);
      expect(r.category).toBe('price_question');
      expect(r.priceIntent).toBe(true);
      expect(r.isDirectQuestion).toBe(true);
    });

    it('"quanto custa?" -> price_question', () => {
      const r = resolveIntent('quanto custa?', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('"qual o valor" -> price_question', () => {
      const r = resolveIntent('qual o valor', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('"qual o preço" -> price_question', () => {
      const r = resolveIntent('qual o preço', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('"me passa o valor" -> price_question', () => {
      const r = resolveIntent('me passa o valor', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('"quanto fica" -> price_question', () => {
      const r = resolveIntent('quanto fica', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('"tem ideia de orçamento?" -> price_question', () => {
      const r = resolveIntent('tem ideia de orçamento?', withFacts);
      expect(r.category).toBe('price_question');
    });

    it('price detection does not depend on facts being known', () => {
      const r = resolveIntent('queria saber valores', none);
      expect(r.category).toBe('price_question');
    });
  });

  describe('frustration is resolved BEFORE price (precedence)', () => {
    it('"só quero preço" -> frustration (not price_question)', () => {
      const r = resolveIntent('só quero preço', withFacts);
      expect(r.category).toBe('frustration');
      expect(r.priceIntent).toBe(false);
    });

    it('"só quero o valor" -> frustration (not price_question)', () => {
      const r = resolveIntent('só quero o valor', withFacts);
      expect(r.category).toBe('frustration');
    });

    it('"só me passa o preço" -> frustration (not price_question)', () => {
      const r = resolveIntent('só me passa o preço', withFacts);
      expect(r.category).toBe('frustration');
    });

    it('"já falei tudo" -> frustration', () => {
      const r = resolveIntent('já falei tudo', withFacts);
      expect(r.category).toBe('frustration');
    });

    it('"para de perguntar" -> frustration', () => {
      const r = resolveIntent('para de perguntar', withFacts);
      expect(r.category).toBe('frustration');
    });

    it('"não tenho tempo" -> frustration', () => {
      const r = resolveIntent('não tenho tempo', withFacts);
      expect(r.category).toBe('frustration');
    });
  });

  describe('direct_question (non-price)', () => {
    it('"como funciona?" -> direct_question', () => {
      const r = resolveIntent('como funciona?', withFacts);
      expect(r.category).toBe('direct_question');
      expect(r.isDirectQuestion).toBe(true);
      expect(r.priceIntent).toBe(false);
    });

    it('"quando vocês começam?" -> direct_question', () => {
      const r = resolveIntent('quando vocês começam?', withFacts);
      expect(r.category).toBe('direct_question');
    });
  });

  describe('stated preference', () => {
    it('"quero falar com atendente" -> preference_human', () => {
      const r = resolveIntent('quero falar com atendente', withFacts);
      expect(r.category).toBe('preference_human');
    });

    it('"quero uma proposta" -> preference_human', () => {
      const r = resolveIntent('quero uma proposta', withFacts);
      expect(r.category).toBe('preference_human');
    });

    it('"não quero ser transferido" -> preference_continue', () => {
      const r = resolveIntent('não quero ser transferido', withFacts);
      expect(r.category).toBe('preference_continue');
    });

    it('"quero continuar falando com você" -> preference_continue', () => {
      const r = resolveIntent('quero continuar falando com você', withFacts);
      expect(r.category).toBe('preference_continue');
    });
  });

  describe('handoff_accept (only while state === suggested)', () => {
    it('"pode encaminhar sim" -> preference_human (pedido explícito fecha sempre)', () => {
      // "pode encaminhar" é um pedido EXPLÍCITO de encaminhamento: vira
      // preference_human e fecha o handoff mesmo sem oferta prévia detectada
      // (ambos os caminhos confirmam o handoff com a mesma resposta).
      const r = resolveIntent('pode encaminhar sim', suggested);
      expect(r.category).toBe('preference_human');
    });

    it('"sim" -> handoff_accept', () => {
      const r = resolveIntent('sim', suggested);
      expect(r.category).toBe('handoff_accept');
    });

    it('"manda" -> handoff_accept', () => {
      const r = resolveIntent('manda', suggested);
      expect(r.category).toBe('handoff_accept');
    });

    it('"sim, mas não sei se tenho budget" -> general (qualifier blocks accept)', () => {
      const r = resolveIntent('sim, mas não sei se tenho budget', suggested);
      expect(r.category).toBe('general');
    });
  });

  describe('handoff_completed_ack (only while state === completed)', () => {
    it('"obrigado" after handoff completed -> handoff_completed_ack', () => {
      const r = resolveIntent('obrigado', completed);
      expect(r.category).toBe('handoff_completed_ack');
    });

    it('"ok" after handoff completed -> handoff_completed_ack', () => {
      const r = resolveIntent('ok', completed);
      expect(r.category).toBe('handoff_completed_ack');
    });

    it('"quanto custa?" after handoff completed -> price_question (new question falls through)', () => {
      const r = resolveIntent('quanto custa?', completed);
      expect(r.category).toBe('price_question');
    });
  });

  describe('desistance', () => {
    it('"deixa pra lá" -> desistance', () => {
      const r = resolveIntent('deixa pra lá', withFacts);
      expect(r.category).toBe('desistance');
    });

    it('"vou procurar outro fornecedor" -> desistance', () => {
      const r = resolveIntent('vou procurar outro fornecedor', withFacts);
      expect(r.category).toBe('desistance');
    });

    it('"não tenho interesse" -> desistance', () => {
      const r = resolveIntent('não tenho interesse', withFacts);
      expect(r.category).toBe('desistance');
    });
  });

  describe('greeting', () => {
    it('"oi" -> greeting', () => {
      const r = resolveIntent('oi', none);
      expect(r.category).toBe('greeting');
    });

    it('"bom dia!" -> greeting', () => {
      const r = resolveIntent('bom dia!', withFacts);
      expect(r.category).toBe('greeting');
    });

    it('"boa tarde" -> greeting', () => {
      const r = resolveIntent('boa tarde', withFacts);
      expect(r.category).toBe('greeting');
    });
  });

  describe('acknowledgment (non-terminal, state !== completed)', () => {
    it('"obrigado" -> acknowledgment', () => {
      const r = resolveIntent('obrigado', withFacts);
      expect(r.category).toBe('acknowledgment');
    });

    it('"valeu" -> acknowledgment', () => {
      const r = resolveIntent('valeu', withFacts);
      expect(r.category).toBe('acknowledgment');
    });
  });

  describe('totality — every input gets exactly one category', () => {
    it('empty/whitespace message resolves defensively to general', () => {
      expect(resolveIntent('', withFacts).category).toBe('general');
      expect(resolveIntent('   ', withFacts).category).toBe('general');
    });
  });
});
