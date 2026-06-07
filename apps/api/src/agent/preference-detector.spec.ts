import { detectPreference } from './preference-detector';

/**
 * Unit tests for the PreferenceDetector.
 *
 * Validates the deterministic detection of an explicit Stated_Preference in
 * the latest inbound message.
 *
 * Validates: Requirements 7.1, 7.3, 7.4
 */
describe('PreferenceDetector / detectPreference', () => {
  describe('continue phrasings → "continue"', () => {
    const continuePhrases = [
      'quero continuar falando com você',
      'não quero ser transferido',
      'não precisa passar pra ninguém',
      'prefiro falar com você',
      'pode continuar',
      'vamos continuar',
      'fica comigo',
      'continua comigo',
    ];

    it.each(continuePhrases)('"%s" → continue', (phrase) => {
      expect(detectPreference(phrase)).toBe('continue');
    });
  });

  describe('human phrasings → "human"', () => {
    const humanPhrases = [
      'quero falar com atendente',
      'quero um humano',
      'me passa pra alguém agora',
      'quero uma proposta',
      'quero falar com uma pessoa',
      'me chama alguém',
      'quero um orçamento',
      'falar com a equipe',
    ];

    it.each(humanPhrases)('"%s" → human', (phrase) => {
      expect(detectPreference(phrase)).toBe('human');
    });
  });

  describe('negated-transfer phrasings resolve to "continue", not "human"', () => {
    // These phrases contain "transferido", "atendente", "humano", "pessoa",
    // "ninguém" — substrings that overlap with human phrasings — but are
    // negations and MUST be read as a preference to continue with the agent.
    const negatedTransfer = [
      'não quero ser transferido',
      'não quero ser transferida',
      'não precisa transferir',
      'não precisa me transferir',
      'não precisa passar pra ninguém',
      'não precisa passar para ninguém',
      'não precisa chamar ninguém',
      'não quero falar com atendente',
      'não quero falar com humano',
      'não quero falar com uma pessoa',
      'não quero atendente',
      'não quero humano',
    ];

    it.each(negatedTransfer)('"%s" → continue (not human)', (phrase) => {
      const result = detectPreference(phrase);
      expect(result).toBe('continue');
      expect(result).not.toBe('human');
    });
  });

  describe('ambiguous / no explicit preference → "none"', () => {
    const noneCases = [
      'oi',
      'bom dia',
      'boa tarde',
      'tudo bem?',
      'tenho uma loja de moda íntima e vendo pelo whatsapp',
      'os vendedores perdem muito tempo respondendo as mesmas perguntas',
      'umas 50 por dia',
      'sou o dono',
      'obrigado',
    ];

    it.each(noneCases)('"%s" → none', (phrase) => {
      expect(detectPreference(phrase)).toBe('none');
    });

    it('empty string → none', () => {
      expect(detectPreference('')).toBe('none');
    });

    it('whitespace-only string → none', () => {
      expect(detectPreference('   \n\t  ')).toBe('none');
    });
  });

  describe('accent and casing tolerance', () => {
    it('uppercase with accents still detects continue', () => {
      expect(detectPreference('QUERO CONTINUAR FALANDO COM VOCÊ')).toBe('continue');
    });

    it('no accents still detects continue', () => {
      expect(detectPreference('nao quero ser transferido')).toBe('continue');
    });

    it('mixed case without accents still detects human', () => {
      expect(detectPreference('Quero Falar Com Atendente')).toBe('human');
    });

    it('uppercase without accents still detects human (proposta)', () => {
      expect(detectPreference('QUERO UMA PROPOSTA')).toBe('human');
    });

    it('extra surrounding and internal whitespace is tolerated', () => {
      expect(detectPreference('   quero   continuar    falando  com  você   ')).toBe('continue');
    });

    it('phrase embedded in a longer message is still detected', () => {
      expect(
        detectPreference('olha, na real eu prefiro falar com você mesmo por enquanto'),
      ).toBe('continue');
    });
  });

  describe('precedence: continue is checked before human', () => {
    it('a message mixing a negation with a human keyword resolves to continue', () => {
      // "nao quero falar com atendente" contains the human phrase
      // "falar com atendente" but the negation must win.
      expect(detectPreference('não quero falar com atendente, prefiro continuar')).toBe('continue');
    });
  });
});
