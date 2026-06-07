import { Injectable } from '@nestjs/common';

/**
 * Input contract for the ResponseGuardService.
 * Contains the generated reply plus conversation context needed for rule evaluation.
 */
export interface GuardInput {
  reply: string;
  userMessage: string;
  segment: string | null;
  mainPain: string | null;
  volume: string | null;
  handoffOffered: boolean;
  handoffAccepted: boolean;
  handoffCompleted: boolean;
  priceAskedCount: number;
  pricingRangeEnabled: boolean;
  startingPrice: string | null;
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

/**
 * Output contract for the ResponseGuardService.
 * Contains the (potentially modified) reply, change flag, and reason.
 */
export interface GuardOutput {
  reply: string;
  changed: boolean;
  guardReason: string | null;
}

/**
 * Internal interface for guard rules.
 * Each rule is a pure function with explicit priority and type.
 */
export interface GuardRule {
  name: string;
  priority: number;
  type: 'full-replace' | 'partial-transform' | 'metadata-only';
  applies(input: GuardInput, currentReply: string): boolean;
  apply(input: GuardInput, currentReply: string): string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ACCEPTANCE_PHRASES: string[] = [
  'sim',
  'pode',
  'pode encaminhar',
  'sim, pode encaminhar',
  'sim pode encaminhar',
  'tá bom, manda',
  'ta bom, manda',
  'tá bom manda',
  'quero proposta',
  'manda',
  'ok',
  'quero sim',
  'pode encaminhar sim',
  'pode mandar',
  'ok, pode',
  'obrigado',
  'obrigada',
  'valeu',
  'beleza',
];

const FRUSTRATION_PHRASES: string[] = [
  'só me diz quanto custa',
  'não tenho tempo',
  'não quero contar minha vida',
  'me dá uma faixa',
  'quero saber o preço mesmo',
  'me passa logo',
  'direto ao ponto',
  'só quero preço',
  'só quero o valor',
  'para de enrolar',
  'só me passa o preço',
];

const PRICE_KEYWORDS: string[] = [
  'preço',
  'preco',
  'valor',
  'custa',
  'custo',
  'orçamento',
  'orcamento',
  'faixa',
];

const PRICE_BLOCKING_PHRASES: string[] = [
  'Não trabalho com valores',
  'Não trabalho com faixas',
  'não posso informar',
  'não consigo informar',
  'prefiro que a equipe',
  'Infelizmente não posso',
  'infelizmente não consigo',
];

const HANDOFF_QUESTION_WORDS: string[] = [
  'encaminhar?',
  'encaminhe?',
  'seguir?',
  'interessa?',
];

const SEGMENT_TEMPLATES: Record<string, string> = {
  clinica:
    'Com o volume de agendamentos e a equipe sobrecarregada, faz sentido avaliar um atendimento humanizado com IA. Quer que eu encaminhe seu caso para a equipe?',
  etiqueta:
    'Pelo que você descreveu, a IA pode coletar material, medida, quantidade, cor, acabamento e prazo antes do vendedor assumir. Quer que eu encaminhe para a equipe avaliar esse fluxo?',
  restaurante:
    'Com esse volume de pedidos, faz sentido avaliar um atendimento com IA para organizar cardápio, pedidos e dúvidas antes do humano assumir. Quer que eu encaminhe?',
  academia:
    'Com perguntas sobre planos, horários e matrícula, a IA pode responder dúvidas iniciais e encaminhar interessados para a equipe. Quer que eu encaminhe esse cenário para avaliação?',
  contabil:
    'Com perguntas repetidas sobre prazos, documentos e impostos, a IA pode aliviar o atendimento inicial e organizar solicitações. Quer que eu encaminhe para a equipe avaliar?',
  imobiliaria:
    'Com o volume de leads e a necessidade de resposta rápida, faz sentido avaliar um pré-atendimento com IA para filtrar e qualificar. Quer que eu encaminhe?',
  petshop:
    'Com o volume de agendamentos de banho e tosa, faz sentido avaliar um atendimento com IA para organizar horários e confirmar automaticamente. Quer que eu encaminhe?',
  loja:
    'Com o volume de perguntas sobre produtos e a equipe sobrecarregada, faz sentido avaliar um atendimento com IA. Quer que eu encaminhe?',
  fallback:
    'Pelo que você descreveu, faz sentido a equipe avaliar um atendimento humanizado com IA para reduzir retrabalho e organizar melhor o WhatsApp. Quer que eu encaminhe seu caso com esse resumo?',
};

const IA_EXPLANATION_PHRASE =
  'A IA responde com base em regras, base de conhecimento e limites definidos';

const IA_EXPLANATION_SHORT_ALTERNATIVE =
  'A ideia é automatizar o que é repetitivo e encaminhar para humano quando o atendimento exigir mais cuidado.';

const HANDOFF_COMPLETED_RESPONSE =
  'Seu atendimento já foi encaminhado para a equipe da Decodifica com o resumo do cenário.';

// ─── Helper Functions ────────────────────────────────────────────────────────

function getSafePriceResponse(
  pricingRangeEnabled: boolean,
  startingPrice: string | null,
): string {
  if (pricingRangeEnabled && startingPrice) {
    return `Para referência, projetos simples começam a partir de ${startingPrice}. Como o valor final depende do escopo, posso encaminhar para a equipe te passar uma estimativa direta.`;
  }
  return 'Sem uma faixa configurada aqui, não consigo te passar um valor fechado. O que posso fazer é encaminhar para a equipe te dar uma estimativa direta com base no seu caso, sem mais perguntas.';
}

function matchesAcceptancePhrase(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase().trim();
  return ACCEPTANCE_PHRASES.some((phrase) => normalized === phrase);
}

function matchesFrustrationPhrase(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase();
  return FRUSTRATION_PHRASES.some((phrase) => normalized.includes(phrase));
}

function containsPriceKeyword(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase();
  return PRICE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function containsPriceBlockingPhrase(reply: string): boolean {
  const normalized = reply.toLowerCase();
  return PRICE_BLOCKING_PHRASES.some((phrase) =>
    normalized.includes(phrase.toLowerCase()),
  );
}

function isIsolatedHandoff(reply: string): boolean {
  if (reply.length >= 60) return false;

  const lower = reply.toLowerCase();
  const hasHandoffQuestion = HANDOFF_QUESTION_WORDS.some((word) =>
    lower.includes(word),
  );
  if (!hasHandoffQuestion) return false;

  // Check if it has contextual preamble: a sentence of 15+ chars before the question
  const questionIndex = Math.min(
    ...HANDOFF_QUESTION_WORDS.filter((w) => lower.includes(w)).map((w) =>
      lower.indexOf(w),
    ),
  );
  const preamble = reply.substring(0, questionIndex).trim();
  if (preamble.length >= 15) return false;

  return true;
}

function getSegmentTemplate(segment: string | null): string {
  if (!segment) return SEGMENT_TEMPLATES.fallback;

  const lower = segment.toLowerCase();

  if (lower.includes('clinica') || lower.includes('clínica')) {
    return SEGMENT_TEMPLATES.clinica;
  }
  if (
    lower.includes('etiqueta') ||
    lower.includes('fábrica') ||
    lower.includes('fabrica')
  ) {
    return SEGMENT_TEMPLATES.etiqueta;
  }
  if (lower.includes('restaurante')) {
    return SEGMENT_TEMPLATES.restaurante;
  }
  if (lower.includes('academia') || lower.includes('fitness')) {
    return SEGMENT_TEMPLATES.academia;
  }
  if (
    lower.includes('contabil') ||
    lower.includes('escritório') ||
    lower.includes('escritorio')
  ) {
    return SEGMENT_TEMPLATES.contabil;
  }
  if (
    lower.includes('imobiliária') ||
    lower.includes('imobiliaria') ||
    lower.includes('corretor')
  ) {
    return SEGMENT_TEMPLATES.imobiliaria;
  }
  if (lower.includes('pet shop') || lower.includes('pet')) {
    return SEGMENT_TEMPLATES.petshop;
  }
  if (lower.includes('loja') || lower.includes('moda')) {
    return SEGMENT_TEMPLATES.loja;
  }

  return SEGMENT_TEMPLATES.fallback;
}

function containsHandoffOffer(reply: string): boolean {
  const lower = reply.toLowerCase();
  return (
    lower.includes('encaminhar?') ||
    lower.includes('encaminhe?')
  );
}

function historyContainsIAExplanation(
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
): boolean {
  return conversationHistory.some(
    (msg) =>
      msg.role === 'assistant' &&
      msg.content.toLowerCase().includes(IA_EXPLANATION_PHRASE.toLowerCase()),
  );
}

// ─── Rule Definitions ────────────────────────────────────────────────────────

const rule2HandoffCompleted: GuardRule = {
  name: 'handoff_completed',
  priority: 1,
  type: 'full-replace',
  applies(input: GuardInput): boolean {
    return input.handoffCompleted && matchesAcceptancePhrase(input.userMessage);
  },
  apply(): string {
    return HANDOFF_COMPLETED_RESPONSE;
  },
};

const rule4FrustratedPrice: GuardRule = {
  name: 'frustrated_price',
  priority: 2,
  type: 'full-replace',
  applies(input: GuardInput): boolean {
    return matchesFrustrationPhrase(input.userMessage);
  },
  apply(input: GuardInput): string {
    return getSafePriceResponse(input.pricingRangeEnabled, input.startingPrice);
  },
};

const rule1IsolatedHandoff: GuardRule = {
  name: 'isolated_handoff_replaced',
  priority: 3,
  type: 'full-replace',
  applies(input: GuardInput, currentReply: string): boolean {
    return isIsolatedHandoff(currentReply);
  },
  apply(input: GuardInput): string {
    return getSegmentTemplate(input.segment);
  },
};

const rule3PriceResponseFix: GuardRule = {
  name: 'price_response_fix',
  priority: 4,
  type: 'full-replace',
  applies(input: GuardInput, currentReply: string): boolean {
    return (
      containsPriceKeyword(input.userMessage) &&
      containsPriceBlockingPhrase(currentReply)
    );
  },
  apply(input: GuardInput): string {
    return getSafePriceResponse(input.pricingRangeEnabled, input.startingPrice);
  },
};

const rule5BrokenPhrases: GuardRule = {
  name: 'broken_phrases_fixed',
  priority: 5,
  type: 'partial-transform',
  applies(_input: GuardInput, currentReply: string): boolean {
    const safePriceNoRange = getSafePriceResponse(false, null);
    return (
      currentReply.includes('Sua pressa, mas') ||
      currentReply.includes('Sua pressa.') ||
      currentReply.includes('falta de organizam') ||
      currentReply.includes('Não trabalho com valores.') ||
      currentReply.includes('Não trabalho com faixas de preço.') ||
      currentReply.includes('!') ||
      currentReply.includes('revisa cada mensagem') ||
      currentReply.includes('evita erro totalmente') ||
      currentReply.includes('sem erros') ||
      currentReply.includes('com zero erros') ||
      // Avoid false positive if safe price response itself contains these substrings
      (currentReply !== safePriceNoRange &&
        (currentReply.includes('Não trabalho com valores.') ||
          currentReply.includes('Não trabalho com faixas de preço.')))
    );
  },
  apply(input: GuardInput, currentReply: string): string {
    let result = currentReply;

    // Order matters: do specific replacements before general ones
    result = result.replace(/Sua pressa, mas/g, 'Entendo sua pressa, mas');
    result = result.replace(/Sua pressa\./g, 'Entendo sua pressa.');
    result = result.replace(/falta de organizam/g, 'falta de organização');

    const safePriceResponse = getSafePriceResponse(
      input.pricingRangeEnabled,
      input.startingPrice,
    );
    result = result.replace(
      /Não trabalho com valores\./g,
      safePriceResponse,
    );
    result = result.replace(
      /Não trabalho com faixas de preço\./g,
      safePriceResponse,
    );

    // Replace all exclamation marks with periods
    result = result.replace(/!/g, '.');

    // Replace misleading AI claims
    result = result.replace(
      /revisa cada mensagem/g,
      'responde com base em regras definidas',
    );
    result = result.replace(
      /evita erro totalmente/g,
      'reduz erros com regras claras',
    );

    // Remove overpromising phrases
    result = result.replace(/sem erros/g, '');
    result = result.replace(/com zero erros/g, '');

    return result;
  },
};

const rule6IAExplanation: GuardRule = {
  name: 'ia_explanation_deduplicated',
  priority: 6,
  type: 'partial-transform',
  applies(input: GuardInput, currentReply: string): boolean {
    return (
      currentReply
        .toLowerCase()
        .includes(IA_EXPLANATION_PHRASE.toLowerCase()) &&
      historyContainsIAExplanation(input.conversationHistory)
    );
  },
  apply(_input: GuardInput, currentReply: string): string {
    // Case-insensitive replacement of the IA explanation phrase and the rest of
    // the sentence (up to the next period) with the short alternative.
    // We find the phrase occurrence and replace the full sentence containing it.
    const lowerReply = currentReply.toLowerCase();
    const lowerPhrase = IA_EXPLANATION_PHRASE.toLowerCase();
    const idx = lowerReply.indexOf(lowerPhrase);

    if (idx === -1) return currentReply;

    // Find the full sentence containing the phrase
    // Look backward for sentence start
    let sentenceStart = idx;
    while (sentenceStart > 0 && currentReply[sentenceStart - 1] !== '.') {
      sentenceStart--;
    }
    // Trim leading spaces
    while (
      sentenceStart < idx &&
      currentReply[sentenceStart] === ' '
    ) {
      sentenceStart++;
    }

    // Look forward for sentence end (period after the phrase)
    let sentenceEnd = idx + IA_EXPLANATION_PHRASE.length;
    while (sentenceEnd < currentReply.length && currentReply[sentenceEnd] !== '.') {
      sentenceEnd++;
    }
    // Include the period if found
    if (sentenceEnd < currentReply.length) {
      sentenceEnd++;
    }

    const before = currentReply.substring(0, sentenceStart);
    const after = currentReply.substring(sentenceEnd);

    return before + IA_EXPLANATION_SHORT_ALTERNATIVE + after;
  },
};

const rule7BlockPrematureHandoff: GuardRule = {
  name: 'handoff_offered_not_accepted',
  priority: 7,
  type: 'metadata-only',
  applies(input: GuardInput, currentReply: string): boolean {
    return containsHandoffOffer(currentReply) && !input.handoffAccepted;
  },
  apply(_input: GuardInput, currentReply: string): string {
    // metadata-only: do not modify the reply
    return currentReply;
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Deterministic post-processing guard that applies prioritized text
 * transformation rules to agent replies before persistence/delivery.
 *
 * Pure function — no LLM calls, no database access, no side effects.
 */
@Injectable()
export class ResponseGuardService {
  private readonly rules: GuardRule[] = [
    rule2HandoffCompleted,
    rule4FrustratedPrice,
    rule1IsolatedHandoff,
    rule3PriceResponseFix,
    rule5BrokenPhrases,
    rule6IAExplanation,
    rule7BlockPrematureHandoff,
  ];

  guard(input: GuardInput): GuardOutput {
    const originalReply = input.reply;
    let currentReply = input.reply;
    let fullReplaceApplied = false;
    const firedReasons: string[] = [];

    for (const rule of this.rules) {
      try {
        if (rule.type === 'full-replace') {
          // Skip full-replace rules if one already fired
          if (fullReplaceApplied) continue;

          if (rule.applies(input, currentReply)) {
            currentReply = rule.apply(input, currentReply);
            fullReplaceApplied = true;
            firedReasons.push(rule.name);
          }
        } else if (rule.type === 'partial-transform') {
          if (rule.applies(input, currentReply)) {
            currentReply = rule.apply(input, currentReply);
            firedReasons.push(rule.name);
          }
        } else if (rule.type === 'metadata-only') {
          if (rule.applies(input, currentReply)) {
            // metadata-only rules don't modify reply
            firedReasons.push(rule.name);
          }
        }
      } catch {
        // If a rule fails, skip it and continue with next rules
        continue;
      }
    }

    const changed = currentReply !== originalReply;
    const guardReason =
      firedReasons.length > 0 ? firedReasons.join('; ') : null;

    return {
      reply: currentReply,
      changed,
      guardReason: changed ? guardReason : null,
    };
  }
}
