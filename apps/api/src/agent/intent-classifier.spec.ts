import { classifyIntent } from './intent-classifier';

describe('IntentClassifier', () => {
  const noContext = { hasSegment: false, handoffOffered: false, handoffCompleted: false };
  const withSegment = { hasSegment: true, handoffOffered: false, handoffCompleted: false };
  const handoffOffered = { hasSegment: true, handoffOffered: true, handoffCompleted: false };
  const handoffDone = { hasSegment: true, handoffOffered: true, handoffCompleted: true };

  describe('should NOT classify as price/timeline/integration', () => {
    it('"Tenho uma loja de moda íntima..." → needs_llm', () => {
      const result = classifyIntent('Tenho uma loja de moda íntima e vendo pelo WhatsApp', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Os vendedores perdem tempo..." → needs_llm', () => {
      const result = classifyIntent('Os vendedores perdem muito tempo perguntando as mesmas coisas', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Umas 50 por dia" → needs_llm (volume info, not local)', () => {
      const result = classifyIntent('Umas 50 por dia', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Sou o dono" → needs_llm (decision role, not local)', () => {
      const result = classifyIntent('Sou o dono', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Tenho um ERP próprio" → needs_llm (integration context, not local)', () => {
      const result = classifyIntent('Tenho um ERP próprio que minha equipe desenvolveu', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Quanto custa?" → needs_llm (price goes to LLM)', () => {
      const result = classifyIntent('Quanto custa?', withSegment);
      expect(result.intent).toBe('needs_llm');
    });

    it('"Quanto tempo leva?" → needs_llm (timeline goes to LLM)', () => {
      const result = classifyIntent('Quanto tempo leva pra implementar?', withSegment);
      expect(result.intent).toBe('needs_llm');
    });
  });

  describe('handoff_accept', () => {
    it('"Pode encaminhar sim" → handoff_accept when offered', () => {
      const result = classifyIntent('Pode encaminhar sim', handoffOffered);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"sim, pode" → handoff_accept when offered', () => {
      const result = classifyIntent('sim, pode', handoffOffered);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"tá bom, manda" → handoff_accept when offered', () => {
      const result = classifyIntent('tá bom, manda', handoffOffered);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"manda" → handoff_accept when offered', () => {
      const result = classifyIntent('manda', handoffOffered);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"sim" → handoff_accept when offered', () => {
      const result = classifyIntent('sim', handoffOffered);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"quero proposta" → handoff_accept when has segment', () => {
      const result = classifyIntent('quero proposta', withSegment);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"quero falar com alguém" → handoff_accept when has segment', () => {
      const result = classifyIntent('quero falar com alguém', withSegment);
      expect(result.intent).toBe('handoff_accept');
    });

    it('"sim, mas não sei se tenho budget" → needs_llm (has qualifier)', () => {
      const result = classifyIntent('sim, mas não sei se tenho budget', handoffOffered);
      expect(result.intent).toBe('needs_llm');
    });

    it('"quero entender melhor" → needs_llm (has qualifier)', () => {
      const result = classifyIntent('quero entender melhor', handoffOffered);
      expect(result.intent).toBe('needs_llm');
    });

    it('"depende do valor" → needs_llm (has qualifier)', () => {
      const result = classifyIntent('depende do valor', handoffOffered);
      expect(result.intent).toBe('needs_llm');
    });
  });

  describe('desistance', () => {
    it('"Deixa pra lá" → desistance', () => {
      const result = classifyIntent('Deixa pra lá', withSegment);
      expect(result.intent).toBe('desistance');
    });

    it('"vou procurar outro" → desistance', () => {
      const result = classifyIntent('vou procurar outro fornecedor', withSegment);
      expect(result.intent).toBe('desistance');
    });
  });

  describe('greeting_no_context', () => {
    it('"oi" without segment → greeting_no_context', () => {
      const result = classifyIntent('oi', noContext);
      expect(result.intent).toBe('greeting_no_context');
    });

    it('"oi" WITH segment → greeting_with_context', () => {
      const result = classifyIntent('oi', withSegment);
      expect(result.intent).toBe('greeting_with_context');
    });
  });

  describe('handoff_completed_ack', () => {
    it('"obrigado" after handoff done → handoff_completed_ack', () => {
      const result = classifyIntent('obrigado', handoffDone);
      expect(result.intent).toBe('handoff_completed_ack');
    });

    it('"ok" after handoff done → handoff_completed_ack', () => {
      const result = classifyIntent('ok', handoffDone);
      expect(result.intent).toBe('handoff_completed_ack');
    });

    it('"quanto custa?" after handoff done → needs_llm (new question)', () => {
      const result = classifyIntent('quanto custa?', handoffDone);
      expect(result.intent).toBe('needs_llm');
    });
  });

  describe('price_question', () => {
    it('"qual o preço" with segment → price_question', () => {
      const result = classifyIntent('qual o preço', withSegment);
      expect(result.intent).toBe('price_question');
    });

    it('"me passa o valor" with segment → price_question', () => {
      const result = classifyIntent('me passa o valor', withSegment);
      expect(result.intent).toBe('price_question');
    });

    it('"quanto fica" with segment → price_question', () => {
      const result = classifyIntent('quanto fica', withSegment);
      expect(result.intent).toBe('price_question');
    });

    it('"quanto custa?" with segment → needs_llm (not in explicit list)', () => {
      const result = classifyIntent('quanto custa?', withSegment);
      expect(result.intent).toBe('needs_llm');
    });
  });

  describe('frustration', () => {
    it('"já falei tudo" → frustration', () => {
      const result = classifyIntent('já falei tudo', withSegment);
      expect(result.intent).toBe('frustration');
    });

    it('"para de perguntar" → frustration', () => {
      const result = classifyIntent('para de perguntar', withSegment);
      expect(result.intent).toBe('frustration');
    });

    it('"não tenho tempo" → frustration', () => {
      const result = classifyIntent('não tenho tempo', withSegment);
      expect(result.intent).toBe('frustration');
    });

    it('"só quero preço" → frustration (not price_question because frustration has priority)', () => {
      const result = classifyIntent('só quero preço', withSegment);
      expect(result.intent).toBe('frustration');
    });
  });

  describe('greeting_with_context', () => {
    it('"oi" with segment → greeting_with_context', () => {
      const result = classifyIntent('oi', withSegment);
      expect(result.intent).toBe('greeting_with_context');
    });

    it('"bom dia" with segment → greeting_with_context', () => {
      const result = classifyIntent('bom dia', withSegment);
      expect(result.intent).toBe('greeting_with_context');
    });

    it('"boa tarde" with segment → greeting_with_context', () => {
      const result = classifyIntent('boa tarde', withSegment);
      expect(result.intent).toBe('greeting_with_context');
    });
  });
});
