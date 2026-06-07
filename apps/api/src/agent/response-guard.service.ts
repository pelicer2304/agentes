import { Injectable } from '@nestjs/common';
import {
  GuardInput,
  GuardOutput,
  HandoffState,
  IntentCategory,
  KnownFacts,
} from './conversation-types';

// Re-export the consolidated contract so existing importers of these symbols
// from this module keep compiling. The authoritative definitions live in
// `conversation-types.ts`.
export { GuardInput, GuardOutput } from './conversation-types';

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

// ─── Contract accessors ──────────────────────────────────────────────────────
// The consolidated GuardInput nests facts/handoff/said under `context` and
// pricing under `pricing`. These helpers read the flat values the rules need
// from the new shape so rule bodies stay readable.

function segmentOf(input: GuardInput): string | null {
  return input.context.facts.segment ?? null;
}

function pricingEnabledOf(input: GuardInput): boolean {
  return input.pricing.pricingRangeEnabled;
}

function startingPriceOf(input: GuardInput): string | null {
  return input.pricing.startingPriceText ?? null;
}

function handoffAcceptedOf(input: GuardInput): boolean {
  const state: HandoffState = input.context.handoffState;
  return state === 'accepted' || state === 'completed';
}

function handoffCompletedOf(input: GuardInput): boolean {
  return input.context.handoffState === 'completed';
}

function priorAssistantRepliesOf(input: GuardInput): string[] {
  return input.context.said.priorAssistantReplies ?? [];
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

// Leading filler words removed for a humanized tone (migrated from
// NormalizeOutputService.applyToneCleanup).
const FILLER_STARTS: string[] = [
  'entendo.',
  'entendo,',
  'perfeito.',
  'perfeito,',
  'ótimo.',
  'ótimo,',
  'compreendo.',
  'compreendo,',
  'claro.',
  'claro,',
  'show.',
  'show,',
  'ok.',
  'ok,',
  'certo.',
  'certo,',
  'legal.',
  'legal,',
];

// Internal state labels, stage names, and field identifiers that must never
// leak into a user-facing reply (R8.3).
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

// Phrases indicating the agent is offering a demonstration or simulation.
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

// Phrases indicating the user is requesting a demonstration/simulation.
const DEMO_REQUEST_KEYWORDS: string[] = [
  'demonstração',
  'demonstracao',
  'demonstrar',
  'simulação',
  'simulacao',
  'simular',
  'quero ver',
  'quero uma demo',
  'me mostra',
  'pode mostrar',
];

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

function containsHandoffOfferBroad(reply: string): boolean {
  // Broad detector for a handoff/transfer OFFER in any phrasing (not just the
  // `encaminhar?`/`encaminhe?` punctuation forms). Catches "quer que eu
  // encaminhe ...", "posso encaminhar ...", "passar para a equipe", etc.
  const lower = reply
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const patterns = [
    'encaminhar',
    'encaminhe',
    'encaminho',
    'encaminhamento',
    'passar para a equipe',
    'passar para o time',
    'passo para a equipe',
    'passar pro time',
    'falar com a equipe',
    'falar com nosso time',
    'falar com o time',
    'conectar voce com',
    'conectar voce a',
    'chamar a equipe',
    'acionar a equipe',
    'nossa equipe avaliar',
    'a equipe avaliar',
    'equipe te passar',
    'equipe da decodifica',
  ];
  return patterns.some((p) => lower.includes(p));
}

/**
 * Whether the lead is qualified enough for the agent to OFFER a handoff. A
 * pre-sales agent must understand the pain deeply before routing: it needs the
 * business segment, a main pain (or at least one known pain), the pain to have
 * been DEEPENED (a second pain mapped or the secondary-pains question asked),
 * and the volume. Only then is an unsolicited handoff offer allowed.
 */
function isQualifiedForHandoffOffer(facts: KnownFacts): boolean {
  const hasSegment = !!(facts.segment || facts.businessDescription);
  const hasPain = !!facts.mainPain || facts.knownPains.length > 0;
  const painDeepened = facts.knownPains.length >= 2 || facts.secondaryPainsAsked;
  const hasVolume = !!facts.volume;
  return hasSegment && hasPain && painDeepened && hasVolume;
}

/**
 * Builds the contextual deepening question used to REPLACE a premature handoff
 * offer. It steps through the discovery funnel based on what is still missing:
 * segment -> main pain -> deepen the pain (impact / secondary pain) -> volume.
 * Never offers a handoff and never re-asks a known fact.
 */
function buildDeepeningQuestion(facts: KnownFacts): string {
  const hasSegment = !!(facts.segment || facts.businessDescription);
  const hasPain = !!facts.mainPain || facts.knownPains.length > 0;
  const painDeepened = facts.knownPains.length >= 2 || facts.secondaryPainsAsked;
  const hasVolume = !!facts.volume;

  if (!hasSegment) {
    return 'Me conta qual é o seu negócio e como vocês usam o WhatsApp hoje?';
  }
  if (!hasPain) {
    return 'Qual é o principal desafio que vocês enfrentam no atendimento hoje?';
  }
  if (!painDeepened) {
    return secondaryPainQuestionFor(facts.segment);
  }
  if (!hasVolume) {
    return 'Quantas mensagens ou pedidos vocês recebem por dia, em média?';
  }
  // Qualified-but-still-blocked safety net: keep understanding the impact.
  return 'Esse ponto acontece com que frequência e qual o impacto disso no dia a dia de vocês?';
}

/**
 * Segment-aware secondary-pain question, mirroring the agent prompt's
 * deepening suggestions. Falls back to a generic version when the segment is
 * unknown or unmatched.
 */
function secondaryPainQuestionFor(segment: string | null): string {
  const s = (segment || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (s.includes('restaurante') || s.includes('lanchonete') || s.includes('pizzaria')) {
    return 'Além do volume, vocês também têm erro em pedido, demora para confirmar ou perda de venda por falta de resposta?';
  }
  if (s.includes('loja') || s.includes('moda') || s.includes('roupa')) {
    return 'Além disso, vocês têm dificuldade com dúvidas de produto, estoque, entrega ou clientes que somem antes de fechar?';
  }
  if (s.includes('clinica') || s.includes('odonto') || s.includes('medic')) {
    return 'Além da agenda, vocês têm dúvidas repetidas, remarcações ou pacientes sem resposta fora do horário?';
  }
  if (s.includes('imobiliar') || s.includes('corretor')) {
    return 'Além do volume de leads, vocês perdem contatos por demora ou têm retrabalho respondendo as mesmas dúvidas?';
  }
  if (s.includes('carro') || s.includes('veicul') || s.includes('automo') || s.includes('concession') || s.includes('oficina') || s.includes('seminovo')) {
    return 'Além do pós-venda, vocês têm dúvidas repetidas sobre revisão, agendamento, peças ou clientes que somem depois da compra?';
  }
  if (s.includes('academia') || s.includes('fitness')) {
    return 'Além disso, vocês perdem alunos por falta de resposta ou têm muitas dúvidas sobre planos e horários?';
  }
  if (s.includes('pet') || s.includes('veterinar')) {
    return 'Além da agenda de banho e tosa, vocês têm dúvidas repetidas ou perda de clientes por demora?';
  }
  return 'Além desse ponto, existe outra dificuldade no WhatsApp hoje, como perguntas repetidas, perda de clientes ou atendimento fora do horário?';
}

/**
 * Normalize a reply for repetition comparison: lowercase, strip diacritics and
 * punctuation/symbols, collapse whitespace. This matches the normalization the
 * ContextTracker applies when building `said.priorAssistantReplies`, so the
 * comparison is consistent and idempotent on already-normalized prior replies.
 */
function normalizeForRepetition(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ') // strip punctuation/symbols
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Split text into sentences, preserving each sentence's trailing punctuation
 * and the spacing between them so a join('') reconstructs the original text.
 */
function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches && matches.length > 0 ? matches : [text];
}

function isQuestionSentence(sentence: string): boolean {
  return sentence.includes('?');
}

function offersDemo(reply: string): boolean {
  const lower = reply.toLowerCase();
  return DEMO_OFFER_KEYWORDS.some((k) => lower.includes(k));
}

function userRequestedDemo(userMessage: string): boolean {
  const lower = userMessage.toLowerCase();
  return DEMO_REQUEST_KEYWORDS.some((k) => lower.includes(k));
}

/** Lowercase, strip diacritics, return the set of words with length >= 4. */
function significantWords(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  const stop = new Set([
    'voce',
    'voce',
    'como',
    'para',
    'mais',
    'esse',
    'essa',
    'isso',
    'minha',
    'meus',
    'minhas',
    'pelo',
    'pela',
    'com',
    'que',
    'dos',
    'das',
    'uma',
    'meu',
  ]);
  return new Set(words.filter((w) => w.length >= 4 && !stop.has(w)));
}

/**
 * Strip a leading "echo" clause that merely restates what the client just said
 * (e.g. "Com vendas de etiquetas e problemas no atendimento, me conta ..."),
 * which reads as redundant. We only strip the part before the FIRST comma when
 * that clause shares >= 2 significant words with the client's message, keeping
 * the rest (the actual answer/question) and capitalizing it. Returns the reply
 * unchanged when there is no such echo.
 */
function stripLeadingEcho(reply: string, userMessage: string): string {
  const commaIdx = reply.indexOf(',');
  if (commaIdx < 6 || commaIdx > 100) {
    return reply;
  }
  const lead = reply.slice(0, commaIdx);
  // Never strip if the lead clause itself is the question or holds terminal
  // punctuation (it is then a real sentence, not a preamble).
  if (/[?.!]/.test(lead)) {
    return reply;
  }
  const rest = reply.slice(commaIdx + 1).trim();
  if (rest.length < 8) {
    return reply;
  }

  const leadWords = significantWords(lead);
  const msgWords = significantWords(userMessage);
  let shared = 0;
  for (const w of leadWords) {
    if (msgWords.has(w)) {
      shared += 1;
    }
  }
  if (shared < 2) {
    return reply;
  }
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

const rule2HandoffCompleted: GuardRule = {
  name: 'handoff_completed',
  priority: 1,
  type: 'full-replace',
  applies(input: GuardInput): boolean {
    return (
      handoffCompletedOf(input) && matchesAcceptancePhrase(input.userMessage)
    );
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
    return getSafePriceResponse(pricingEnabledOf(input), startingPriceOf(input));
  },
};

const rule1IsolatedHandoff: GuardRule = {
  name: 'isolated_handoff_replaced',
  priority: 3,
  type: 'full-replace',
  applies(_input: GuardInput, currentReply: string): boolean {
    return isIsolatedHandoff(currentReply);
  },
  apply(input: GuardInput): string {
    return getSegmentTemplate(segmentOf(input));
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
    return getSafePriceResponse(pricingEnabledOf(input), startingPriceOf(input));
  },
};

/**
 * Repetition guard (R6.1, R6.2): if the candidate reply is a Repetition of a
 * prior assistant reply, replace it with the answer to a pending price
 * question, or otherwise advance to a different conversational step.
 */
const ruleRepetition: GuardRule = {
  name: 'repetition_replaced',
  priority: 5,
  type: 'full-replace',
  applies(input: GuardInput, currentReply: string): boolean {
    const normalized = normalizeForRepetition(currentReply);
    if (!normalized) return false;
    return priorAssistantRepliesOf(input).some(
      (prior) => normalizeForRepetition(prior) === normalized,
    );
  },
  apply(input: GuardInput, currentReply: string): string {
    // Prefer answering a pending price question over re-advancing.
    if (input.intent === 'price_question') {
      return getSafePriceResponse(
        pricingEnabledOf(input),
        startingPriceOf(input),
      );
    }
    const advance = getSegmentTemplate(segmentOf(input));
    // If even the advance would repeat, fall back to the generic template.
    if (
      normalizeForRepetition(advance) === normalizeForRepetition(currentReply)
    ) {
      return SEGMENT_TEMPLATES.fallback;
    }
    return advance;
  },
};

const rule5BrokenPhrases: GuardRule = {
  name: 'broken_phrases_fixed',
  priority: 6,
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
      pricingEnabledOf(input),
      startingPriceOf(input),
    );
    result = result.replace(/Não trabalho com valores\./g, safePriceResponse);
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

/**
 * Sanitization (R8.3): strip internal field values, internal state labels, and
 * system identifiers from the reply (migrated from
 * NormalizeOutputService.applySanitization, extended with internal-label
 * stripping).
 */
const ruleSanitization: GuardRule = {
  name: 'sanitized',
  priority: 7,
  type: 'partial-transform',
  applies(_input: GuardInput, currentReply: string): boolean {
    const leakPatterns = [
      /Pelo que você descreveu sobre\s+[a-z]{2,15}\.\.\./gi,
      /com\s+[A-Z][a-záéíóú]+\s+d[aoe]\s+[a-záéíóú]+\.\.\./g,
      /erros são raros/gi,
    ];
    if (leakPatterns.some((p) => p.test(currentReply))) return true;

    const labelPattern = new RegExp(
      `\\b(${INTERNAL_LABELS.join('|')})\\b`,
      'i',
    );
    if (labelPattern.test(currentReply)) return true;

    return currentReply.startsWith('Olá!') || /\s{2,}/.test(currentReply);
  },
  apply(_input: GuardInput, currentReply: string): string {
    let reply = currentReply;

    // Remove patterns that look like raw field values leaking into the reply.
    reply = reply.replace(
      /Pelo que você descreveu sobre\s+[a-z]{2,15}\.\.\./gi,
      '',
    );
    reply = reply.replace(
      /com\s+[A-Z][a-záéíóú]+\s+d[aoe]\s+[a-záéíóú]+\.\.\./g,
      '',
    );

    // Replace "erros são raros" with proper phrasing.
    reply = reply.replace(
      /erros são raros/gi,
      'a IA reduz erros quando tem regras, base de conhecimento e limites claros',
    );

    // Strip internal state labels / field identifiers.
    const labelPattern = new RegExp(
      `\\b(${INTERNAL_LABELS.join('|')})\\b`,
      'gi',
    );
    reply = reply.replace(labelPattern, '');

    // Fix exclamation at start (Olá! -> Olá.)
    if (reply.startsWith('Olá!')) {
      reply = 'Olá.' + reply.slice(4);
    }

    // Clean up orphaned punctuation/spacing left by removals.
    reply = reply.replace(/\s+([,.;:?!])/g, '$1');
    reply = reply.replace(/\s{2,}/g, ' ').trim();

    return reply;
  },
};

/**
 * Demo/simulation re-offer guard (R6.3, R6.4): once a demonstration or
 * simulation has been offered, do not offer it again unless the user asked.
 * Strips the offending sentence(s); if nothing meaningful remains, advances to
 * a different next step.
 */
const ruleDemoReoffer: GuardRule = {
  name: 'demo_reoffer_removed',
  priority: 8,
  type: 'partial-transform',
  applies(input: GuardInput, currentReply: string): boolean {
    return (
      input.context.said.offeredDemo &&
      offersDemo(currentReply) &&
      !userRequestedDemo(input.userMessage)
    );
  },
  apply(input: GuardInput, currentReply: string): string {
    const kept = splitSentences(currentReply).filter(
      (sentence) => !offersDemo(sentence),
    );
    const result = kept.join('').replace(/\s{2,}/g, ' ').trim();
    if (!result) {
      return getSegmentTemplate(segmentOf(input));
    }
    return result;
  },
};

const rule6IAExplanation: GuardRule = {
  name: 'ia_explanation_deduplicated',
  priority: 9,
  type: 'partial-transform',
  applies(input: GuardInput, currentReply: string): boolean {
    return (
      currentReply
        .toLowerCase()
        .includes(IA_EXPLANATION_PHRASE.toLowerCase()) &&
      input.context.said.explainedAiBehavior
    );
  },
  apply(_input: GuardInput, currentReply: string): string {
    // Case-insensitive replacement of the IA explanation phrase and the rest of
    // the sentence (up to the next period) with the short alternative.
    const lowerReply = currentReply.toLowerCase();
    const lowerPhrase = IA_EXPLANATION_PHRASE.toLowerCase();
    const idx = lowerReply.indexOf(lowerPhrase);

    if (idx === -1) return currentReply;

    // Find the full sentence containing the phrase.
    let sentenceStart = idx;
    while (sentenceStart > 0 && currentReply[sentenceStart - 1] !== '.') {
      sentenceStart--;
    }
    while (sentenceStart < idx && currentReply[sentenceStart] === ' ') {
      sentenceStart++;
    }

    let sentenceEnd = idx + IA_EXPLANATION_PHRASE.length;
    while (
      sentenceEnd < currentReply.length &&
      currentReply[sentenceEnd] !== '.'
    ) {
      sentenceEnd++;
    }
    if (sentenceEnd < currentReply.length) {
      sentenceEnd++;
    }

    const before = currentReply.substring(0, sentenceStart);
    const after = currentReply.substring(sentenceEnd);

    return before + IA_EXPLANATION_SHORT_ALTERNATIVE + after;
  },
};

/**
 * Answer-before-follow-up ordering (R1.4): when a reply contains both an answer
 * clause and a follow-up question that are out of order, reorder so every
 * answer sentence precedes every question sentence (stable within each group).
 */
const ruleAnswerBeforeFollowup: GuardRule = {
  name: 'answer_before_followup',
  priority: 10,
  type: 'partial-transform',
  applies(_input: GuardInput, currentReply: string): boolean {
    const sentences = splitSentences(currentReply);
    let seenQuestion = false;
    for (const sentence of sentences) {
      if (isQuestionSentence(sentence)) {
        seenQuestion = true;
      } else if (seenQuestion && sentence.trim().length > 0) {
        // A non-question (answer) sentence appears after a question.
        return true;
      }
    }
    return false;
  },
  apply(_input: GuardInput, currentReply: string): string {
    const sentences = splitSentences(currentReply);
    const answers = sentences.filter((s) => !isQuestionSentence(s));
    const questions = sentences.filter((s) => isQuestionSentence(s));
    return [...answers, ...questions]
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  },
};

/**
 * Single-question shaping (R8.2): a reply contains at most one question.
 * Keep all answer sentences and the first question sentence; drop any
 * subsequent question sentences.
 */
const ruleSingleQuestion: GuardRule = {
  name: 'single_question',
  priority: 11,
  type: 'partial-transform',
  applies(_input: GuardInput, currentReply: string): boolean {
    return (currentReply.match(/\?/g) || []).length > 1;
  },
  apply(_input: GuardInput, currentReply: string): string {
    const sentences = splitSentences(currentReply);
    let keptQuestion = false;
    const result: string[] = [];
    for (const sentence of sentences) {
      if (isQuestionSentence(sentence)) {
        if (keptQuestion) continue; // drop additional questions
        keptQuestion = true;
      }
      result.push(sentence);
    }
    return result.join('').replace(/\s{2,}/g, ' ').trim();
  },
};

/**
 * Tone cleanup (R8.1): remove leading fillers and replace "!" with "."
 * (migrated from NormalizeOutputService.applyToneCleanup).
 */
const ruleToneCleanup: GuardRule = {
  name: 'tone_cleanup',
  priority: 12,
  type: 'partial-transform',
  applies(_input: GuardInput, currentReply: string): boolean {
    const lower = currentReply.toLowerCase().trimStart();
    return (
      FILLER_STARTS.some((filler) => lower.startsWith(filler)) ||
      currentReply.includes('!')
    );
  },
  apply(_input: GuardInput, currentReply: string): string {
    let reply = currentReply;
    const lower = reply.toLowerCase().trimStart();

    for (const filler of FILLER_STARTS) {
      if (lower.startsWith(filler)) {
        reply = reply.trimStart().slice(filler.length).trimStart();
        if (reply.length > 0) {
          reply = reply.charAt(0).toUpperCase() + reply.slice(1);
        }
        break;
      }
    }

    reply = reply.replace(/!/g, '.');

    return reply;
  },
};

const rule7BlockPrematureHandoff: GuardRule = {
  name: 'premature_handoff_replaced',
  priority: 13,
  type: 'partial-transform',
  applies(input: GuardInput, currentReply: string): boolean {
    // Deterministic handoff-related intents produce legitimate handoff text
    // (explicit human request, accepting a pending offer, frustration routing,
    // or a post-handoff ack). Their replies must pass through untouched.
    const allowedHandoffIntents: IntentCategory[] = [
      'preference_human',
      'handoff_accept',
      'frustration',
      'handoff_completed_ack',
    ];
    if (allowedHandoffIntents.includes(input.intent)) return false;
    // Price answers legitimately offer to route to the team even before full
    // qualification, and an already-accepted/completed handoff must keep its
    // confirmation text. Otherwise, a handoff OFFER is only allowed once the
    // lead is qualified (segment + deepened pain + volume).
    if (input.intent === 'price_question') return false;
    if (handoffAcceptedOf(input)) return false;
    if (isQualifiedForHandoffOffer(input.context.facts)) return false;
    return containsHandoffOfferBroad(currentReply);
  },
  apply(input: GuardInput, currentReply: string): string {
    // Drop every sentence that carries the premature handoff offer, keeping any
    // genuine answer/diagnostic content the agent produced.
    const kept = splitSentences(currentReply).filter(
      (sentence) => !containsHandoffOfferBroad(sentence),
    );
    const deepening = buildDeepeningQuestion(input.context.facts);
    const remainder = kept.join('').replace(/\s{2,}/g, ' ').trim();

    // If nothing meaningful survives, or the remainder is just filler, lead the
    // conversation deeper instead of offering a handoff.
    if (remainder.length < 20) {
      return deepening;
    }
    // If what remains already ends with a question, don't append a second one
    // (single-question shaping runs after this rule, but keep it clean here).
    if (remainder.includes('?')) {
      return remainder;
    }
    return `${remainder} ${deepening}`.replace(/\s{2,}/g, ' ').trim();
  },
};

// ─── Service ─────────────────────────────────────────────────────────────────

/**
 * Leading-echo removal: strip a redundant opening clause that merely restates
 * what the client just said (e.g. "Com vendas de etiquetas e problemas no
 * atendimento, me conta ..."). Only applies on the LLM discovery path
 * (`general` / `direct_question`) and never to a handoff offer, so the
 * qualified contextual handoff summary keeps its preamble.
 */
const ruleStripLeadingEcho: GuardRule = {
  name: 'leading_echo_removed',
  priority: 14,
  type: 'partial-transform',
  applies(input: GuardInput, currentReply: string): boolean {
    if (input.intent !== 'general' && input.intent !== 'direct_question') {
      return false;
    }
    if (containsHandoffOfferBroad(currentReply)) {
      return false;
    }
    return stripLeadingEcho(currentReply, input.userMessage) !== currentReply;
  },
  apply(input: GuardInput, currentReply: string): string {
    return stripLeadingEcho(currentReply, input.userMessage);
  },
};

/**
 * Deterministic post-processing guard that applies prioritized text
 * transformation rules to agent replies before persistence/delivery.
 *
 * This is the single post-processing stage for every reply (local, price, LLM,
 * fallback). It absorbs the tone/sanitization rules previously stranded in
 * NormalizeOutputService and adds repetition handling, single-question shaping,
 * answer-before-follow-up ordering, and internal-label stripping.
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
    ruleRepetition,
    rule5BrokenPhrases,
    ruleSanitization,
    ruleDemoReoffer,
    rule6IAExplanation,
    ruleAnswerBeforeFollowup,
    ruleSingleQuestion,
    ruleToneCleanup,
    rule7BlockPrematureHandoff,
    ruleStripLeadingEcho,
  ];

  guard(input: GuardInput): GuardOutput {
    const originalReply = input.reply;
    let currentReply = input.reply;
    let fullReplaceApplied = false;
    const firedReasons: string[] = [];

    for (const rule of this.rules) {
      try {
        if (rule.type === 'full-replace') {
          // Skip full-replace rules if one already fired (mutually exclusive)
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
