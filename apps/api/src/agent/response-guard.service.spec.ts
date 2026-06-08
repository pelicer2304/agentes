import fc from 'fast-check';

import { ResponseGuardService } from './response-guard.service';
import {
  ConversationContext,
  GuardInput,
  HandoffState,
  IntentCategory,
  KnownFacts,
  SaidRecord,
} from './conversation-types';

/**
 * Property-based tests for the consolidated post-processing guard
 * (`ResponseGuardService.guard`).
 *
 * These cover the response-shaping invariants documented in the design's
 * correctness properties:
 *   - Property 6  : Answer precedes follow-up question (R1.4)
 *   - Property 14 : Replies are not repetitions (R6.1, R6.2)
 *   - Property 15 : A demonstration is offered at most once unsolicited (R6.3, R6.4)
 *   - Property 24 : Replies contain at most one question (R8.2)
 *   - Property 25 : Replies exclude internal labels and identifiers (R8.3)
 *   - Property 26 : Broken fragments are repaired (R8.4)
 *
 * Feature: conversational-agent-quality
 */

// ─── Local mirrors of guard-internal constants (the service does not export
// these, so the tests replicate them to build inputs and assert invariants). ──

const INTERNAL_LABELS: string[] = [
  'handoff_humano',
  'chamar_humano',
  'qualificando',
  'descoberta',
  'handoffOffered',
  'handoffAccepted',
  'handoffCompleted',
  'handoffRequired',
  'leadScore',
  'mainPain',
  'secondaryPains',
  'knownPains',
  'whatsappUsage',
  'estimatedVolume',
  'decisionRole',
  'businessDescription',
  'priceAskedCount',
];

const DEMO_OFFER_KEYWORDS: string[] = [
  'demonstração',
  'demonstracao',
  'demonstrar',
  'simulação',
  'simulacao',
  'simular',
  'fazer uma demo',
  'uma demo',
];

/** Mirrors the guard's `normalizeForRepetition` so repetition can be asserted. */
function normalizeForRepetition(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Input factories ─────────────────────────────────────────────────────────

function makeFacts(overrides: Partial<KnownFacts> = {}): KnownFacts {
  return {
    segment: null,
    businessDescription: null,
    whatsappUsage: null,
    volume: null,
    systems: null,
    decisionRole: null,
    knownPains: [],
    mainPain: null,
    priceAskedCount: 0,
    handoffOffered: false,
    handoffAccepted: false,
    handoffCompleted: false,
    painMappingAsked: false,
    secondaryPainsAsked: false,
    volumeAsked: false,
    messageCount: 0,
    ...overrides,
  };
}

function makeSaid(overrides: Partial<SaidRecord> = {}): SaidRecord {
  return {
    offeredDemo: false,
    offeredHandoff: false,
    explainedAiBehavior: false,
    askedVolume: false,
    askedSecondaryPains: false,
    priorAssistantReplies: [],
    ...overrides,
  };
}

function makeContext(opts: {
  handoffState?: HandoffState;
  facts?: Partial<KnownFacts>;
  said?: Partial<SaidRecord>;
}): ConversationContext {
  return {
    facts: makeFacts(opts.facts),
    handoffState: opts.handoffState ?? 'none',
    said: makeSaid(opts.said),
  };
}

function makeInput(opts: {
  reply: string;
  userMessage?: string;
  intent?: IntentCategory;
  handoffState?: HandoffState;
  facts?: Partial<KnownFacts>;
  said?: Partial<SaidRecord>;
  pricing?: { pricingRangeEnabled: boolean; startingPriceText: string | null };
}): GuardInput {
  return {
    reply: opts.reply,
    // A deliberately benign user message: not a frustration phrase, not an
    // acceptance phrase, not a price keyword, not a demo request — so the
    // full-replace rules do not pre-empt the partial-transform rule under test.
    userMessage: opts.userMessage ?? 'tudo bem por ai',
    intent: opts.intent ?? 'general',
    context: makeContext({
      handoffState: opts.handoffState,
      facts: opts.facts,
      said: opts.said,
    }),
    pricing: opts.pricing ?? {
      pricingRangeEnabled: false,
      startingPriceText: null,
    },
  };
}

describe('ResponseGuardService.guard', () => {
  const service = new ResponseGuardService();

  // ── Sentence pools used to compose multi-clause replies. None contain '!',
  // price keywords, handoff question words, demo keywords, or internal labels,
  // so only the rule under test is exercised. ──
  const ANSWER_SENTENCES = [
    'A IA organiza os atendimentos do dia.',
    'O fluxo reduz bastante o retrabalho.',
    'A equipe consegue focar nos casos complexos.',
    'Isso ajuda a padronizar as respostas.',
  ];

  const QUESTION_SENTENCES = [
    'Qual o seu segmento de atuacao?',
    'Quantos pedidos voce recebe por dia?',
    'Como funciona o atendimento hoje?',
    'O que mais te incomoda no processo?',
  ];

  const answerArb = fc.constantFrom(...ANSWER_SENTENCES);
  const questionArb = fc.constantFrom(...QUESTION_SENTENCES);

  // Feature: conversational-agent-quality, Property 6: Answer precedes follow-up question
  it('places answer content before the follow-up question marker', () => {
    // A reply built from a random mix of answer and question sentences, in any
    // order. The guard must reorder so answers precede the (single) question.
    const mixedReplyArb = fc
      .array(fc.oneof(answerArb, questionArb), { minLength: 1, maxLength: 6 })
      .map((sentences) => sentences.join(' '));

    fc.assert(
      fc.property(mixedReplyArb, (reply) => {
        const out = service.guard(makeInput({ reply })).reply;

        const questionIndex = out.indexOf('?');
        if (questionIndex === -1) return; // no question -> nothing to order

        // Everything after the (single) question marker must be free of answer
        // content: no letters or digits trail the question.
        const trailing = out.slice(questionIndex + 1);
        expect(/[\p{L}\p{N}]/u.test(trailing)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 14: Replies are not repetitions
  it('never emits a reply whose normalized form matches a prior assistant reply', () => {
    const wordArb = fc.constantFrom(
      'alpha',
      'beta',
      'gama',
      'servico',
      'atendimento',
      'equipe',
      'fluxo',
      'processo',
      'mensagem',
      'cliente',
    );
    const normalizedPhraseArb = fc
      .array(wordArb, { minLength: 2, maxLength: 6 })
      .map((words) => words.join(' '));

    const scenarioArb = fc
      .uniqueArray(normalizedPhraseArb, { minLength: 1, maxLength: 4 })
      .chain((priors) =>
        fc.record({
          priors: fc.constant(priors),
          pickIndex: fc.nat({ max: priors.length - 1 }),
          intent: fc.constantFrom<IntentCategory>(
            'general',
            'price_question',
            'direct_question',
          ),
        }),
      );

    fc.assert(
      fc.property(scenarioArb, ({ priors, pickIndex, intent }) => {
        // The candidate reply is a denormalized echo of a prior reply (added
        // capitalization and punctuation), so it normalizes to a repetition.
        const candidate = priors[pickIndex].toUpperCase() + '.';

        const out = service.guard(
          makeInput({
            reply: candidate,
            intent,
            said: { priorAssistantReplies: priors },
          }),
        ).reply;

        const normalizedOut = normalizeForRepetition(out);
        for (const prior of priors) {
          expect(normalizedOut).not.toBe(prior);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 15: A demonstration is offered at most once unsolicited
  it('removes a repeated demonstration offer when the user did not ask for one', () => {
    const demoOfferArb = fc.constantFrom(
      'Posso fazer uma demonstração para você.',
      'Quer que eu faça uma simulação do atendimento?',
      'Consigo simular esse cenário rapidamente.',
      'Posso demonstrar como a IA responde.',
    );
    // User messages that are NOT requests for a demo/simulation.
    const benignUserMessageArb = fc.constantFrom(
      'tudo bem por ai',
      'me explica melhor o servico',
      'tenho uma loja de roupas',
      'qual o proximo passo',
    );

    const scenarioArb = fc.record({
      demoOffer: demoOfferArb,
      answer: answerArb,
      userMessage: benignUserMessageArb,
      // Offer comes before or after some answer content.
      offerFirst: fc.boolean(),
    });

    fc.assert(
      fc.property(scenarioArb, ({ demoOffer, answer, userMessage, offerFirst }) => {
        const reply = offerFirst
          ? `${demoOffer} ${answer}`
          : `${answer} ${demoOffer}`;

        const out = service.guard(
          makeInput({
            reply,
            userMessage,
            said: { offeredDemo: true },
          }),
        ).reply;

        const lower = out.toLowerCase();
        for (const keyword of DEMO_OFFER_KEYWORDS) {
          expect(lower.includes(keyword)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 24: Replies contain at most one question
  it('keeps at most one question marker in the guarded reply', () => {
    const mixedReplyArb = fc
      .array(fc.oneof(answerArb, questionArb), { minLength: 1, maxLength: 8 })
      .map((sentences) => sentences.join(' '));

    fc.assert(
      fc.property(mixedReplyArb, (reply) => {
        const out = service.guard(makeInput({ reply })).reply;
        const questionCount = (out.match(/\?/g) || []).length;
        expect(questionCount).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 25: Replies exclude internal labels and identifiers
  it('strips internal state labels and system identifiers from the reply', () => {
    const labelArb = fc.constantFrom(...INTERNAL_LABELS);
    // Templates that embed a label as a standalone token.
    const templateArb = fc.constantFrom(
      (label: string) => `O estagio atual e ${label} no momento.`,
      (label: string) => `Atualizei o campo ${label} aqui.`,
      (label: string) => `Status ${label} confirmado para o lead.`,
    );

    fc.assert(
      fc.property(labelArb, templateArb, (label, template) => {
        const reply = template(label);
        const out = service.guard(makeInput({ reply })).reply;

        const labelPattern = new RegExp(
          `\\b(${INTERNAL_LABELS.join('|')})\\b`,
          'i',
        );
        expect(labelPattern.test(out)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 26: Broken fragments are repaired
  it('repairs known broken fragments and ends with terminal punctuation', () => {
    // Each case ends with terminal punctuation so the repaired reply also ends
    // with terminal punctuation (the repair rules substitute the fragment but
    // never append punctuation).
    const brokenCaseArb = fc.constantFrom(
      { reply: 'Sua pressa, mas vamos resolver isso agora.', fragment: 'Sua pressa, mas' },
      { reply: 'Notei a falta de organizam no processo.', fragment: 'falta de organizam' },
      { reply: 'Isso vai funcionar muito bem para voce!', fragment: '!' },
    );

    fc.assert(
      fc.property(brokenCaseArb, ({ reply, fragment }) => {
        const out = service.guard(makeInput({ reply })).reply;

        expect(out.includes(fragment)).toBe(false);
        // '!' is always rewritten to '.', so it must never survive.
        expect(out.includes('!')).toBe(false);
        // The repaired reply ends with terminal punctuation.
        expect(/[.?]$/.test(out.trim())).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality — premature handoff offer suppression.
  describe('premature handoff offer suppression', () => {
    // Facts that DO qualify the lead for an unsolicited handoff offer:
    // segment + main pain + deepened pain (2+ known pains) + volume.
    const qualifiedFacts: Partial<KnownFacts> = {
      segment: 'restaurante',
      mainPain: 'demora para responder no pico',
      knownPains: ['demora para responder', 'erro em pedido'],
      volume: '200 mensagens por dia',
    };

    it('strips a handoff offer when the lead is NOT yet qualified (general intent)', () => {
      const reply =
        'Com o gargalo, a equipe fica sobrecarregada. Quer que eu encaminhe para nossa equipe avaliar uma solução?';
      const out = service.guard(
        makeInput({
          reply,
          intent: 'general',
          handoffState: 'none',
          facts: { mainPain: 'gargalo na operação' }, // no segment, no volume, not deepened
        }),
      );

      expect(out.reply.toLowerCase()).not.toMatch(/encaminh/);
      expect(out.reply.toLowerCase()).not.toContain('nossa equipe avaliar');
      // It must lead the conversation deeper instead.
      expect(out.reply).toMatch(/\?/);
      expect(out.changed).toBe(true);
    });

    it('keeps the handoff offer once the lead IS qualified', () => {
      const reply =
        'Com esse volume e os erros em pedido, faz sentido a equipe avaliar. Quer que eu encaminhe?';
      const out = service.guard(
        makeInput({
          reply,
          intent: 'general',
          handoffState: 'none',
          facts: qualifiedFacts,
        }),
      );

      expect(out.reply.toLowerCase()).toMatch(/encaminh/);
    });

    it('keeps the handoff confirmation for an explicit human request (preference_human)', () => {
      const reply =
        'Perfeito, vou encaminhar você para o nosso time agora mesmo. Em breve alguém entra em contato.';
      const out = service.guard(
        makeInput({
          reply,
          intent: 'preference_human',
          handoffState: 'none',
          facts: {}, // not qualified, but the user explicitly asked for a human
        }),
      );

      expect(out.reply.toLowerCase()).toMatch(/encaminh/);
    });

    it('does not strip a handoff offer inside a price answer', () => {
      const reply =
        'O valor depende do escopo. Posso encaminhar para a equipe te dar uma estimativa direta.';
      const out = service.guard(
        makeInput({
          reply,
          intent: 'price_question',
          handoffState: 'none',
          facts: {},
        }),
      );

      expect(out.reply.toLowerCase()).toMatch(/encaminh/);
    });
  });

  // Feature: conversational-agent-quality — leading-echo removal.
  describe('leading echo removal', () => {
    it('strips a leading clause that restates the client message', () => {
      const out = service.guard(
        makeInput({
          reply:
            'Com vendas de etiquetas e problemas nos atendimentos, me conta como sua equipe lida com as mensagens hoje?',
          userMessage:
            'meu negocio é de vendas de etiquetas e to com problemas nos atendimentos',
          intent: 'general',
        }),
      );

      expect(out.reply).toBe(
        'Me conta como sua equipe lida com as mensagens hoje?',
      );
      expect(out.reply.toLowerCase()).not.toContain('etiquetas');
    });

    it('leaves a reply without an echoing preamble unchanged', () => {
      const reply = 'Como sua equipe lida com as mensagens hoje?';
      const out = service.guard(
        makeInput({
          reply,
          userMessage: 'vendas de etiquetas',
          intent: 'general',
        }),
      );
      expect(out.reply).toBe(reply);
    });

    it('does not strip a qualified contextual handoff offer', () => {
      const reply =
        'Com esse volume e os erros em pedido, faz sentido a equipe avaliar. Quer que eu encaminhe?';
      const out = service.guard(
        makeInput({
          reply,
          userMessage: 'recebo 200 pedidos e erros em pedido',
          intent: 'general',
          facts: {
            segment: 'restaurante',
            mainPain: 'erros em pedido',
            knownPains: ['erros em pedido', 'demora'],
            volume: '200 pedidos',
          },
        }),
      );
      // The handoff offer (and its contextual preamble) is preserved.
      expect(out.reply.toLowerCase()).toMatch(/encaminh/);
    });

    it('strips an echo first sentence ending in a period', () => {
      const out = service.guard(
        makeInput({
          reply: 'Vendo carros. Como o atendimento atual está funcionando?',
          userMessage: 'entao eu queria saber, hoje eu vendo carros',
          intent: 'direct_question',
        }),
      );
      expect(out.reply).toBe('Como o atendimento atual está funcionando?');
      expect(out.reply.toLowerCase()).not.toContain('vendo carros');
    });

    it('strips a "Com ..." restatement preamble that echoes the client', () => {
      const out = service.guard(
        makeInput({
          reply:
            'Com dois atendentes sobrecarregados, como isso tem impactado as vendas?',
          userMessage: 'tenho 2 atendentes mas nao tao dando conta da demanda',
          intent: 'general',
        }),
      );
      expect(out.reply).toBe('Como isso tem impactado as vendas?');
    });
  });

  // Feature: conversational-agent-quality — internal classification leak removal.
  describe('pipe-delimited classification leak removal', () => {
    it('collapses a "X | Y | Z" classification leak to its first token', () => {
      const out = service.guard(
        makeInput({
          reply:
            'Para tecnologia | logística | automação industrial, dá para automatizar bastante. Como funciona hoje?',
          intent: 'general',
        }),
      );
      expect(out.reply).not.toContain('|');
      expect(out.reply.toLowerCase()).toContain('tecnologia');
    });
  });
});

