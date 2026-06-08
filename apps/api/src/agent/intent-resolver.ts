/**
 * IntentResolver (evolves `intent-classifier.ts`).
 *
 * Assigns EXACTLY ONE `IntentCategory` to every inbound message. This is a pure
 * function: no LLM, no I/O, no clock/random. The same `(rawMessage, ctx)` pair
 * always yields the same `ResolvedIntent` (Property 1: total + deterministic).
 *
 * Migrated and broadened from `intent-classifier.ts`:
 *  - Price detection is broadened to a price keyword combined with an
 *    interrogative/desire marker, INDEPENDENT of whether a segment is known, so
 *    natural phrasings like "queria saber valores" resolve to `price_question`
 *    (Property 2).
 *  - Resolution order is fixed and documented below; frustration is checked
 *    BEFORE price, and ambiguous text falls through to `general` (→ LLM).
 *  - Stated preferences are surfaced as `preference_continue` / `preference_human`
 *    sourced from the PreferenceDetector.
 *
 * Feature: conversational-agent-quality
 * Requirements: 1.1, 1.2, 2.1, 7.4
 */
import {
  IntentCategory,
  IntentContext,
  ResolvedIntent,
  StatedPreference,
} from './conversation-types';

// ---------------------------------------------------------------------------
// TEMPORARY LOCAL FALLBACK — preference-detector.ts (Task 3.1) is being built in
// parallel and does not exist yet. Once it lands, replace `detectPreference`
// below with:
//     import { detectPreference } from './preference-detector';
// and delete this fallback block. Task 3 / Task 12 will reconcile this.
// The phrasings here intentionally mirror the design's PreferenceDetector spec
// so the swap is a no-op for callers of `resolveIntent`.
// ---------------------------------------------------------------------------
const PREFERENCE_CONTINUE_PHRASES = [
  'quero continuar falando com você',
  'quero continuar falando com voce',
  'quero continuar com você',
  'quero continuar com voce',
  'prefiro falar com você',
  'prefiro falar com voce',
  'prefiro continuar com você',
  'prefiro continuar com voce',
  'não quero ser transferido',
  'nao quero ser transferido',
  'não quero ser transferida',
  'nao quero ser transferida',
  'não precisa passar pra ninguém',
  'nao precisa passar pra ninguem',
  'não precisa passar para ninguém',
  'nao precisa passar para ninguem',
  'não precisa transferir',
  'nao precisa transferir',
  'quero continuar com a ia',
  'continuar com você mesmo',
  'continuar com voce mesmo',
];

const PREFERENCE_HUMAN_PHRASES = [
  'quero falar com um humano',
  'quero falar com humano',
  'quero falar com atendente',
  'quero falar com um atendente',
  'quero falar com uma pessoa',
  'quero falar com alguém',
  'quero falar com alguem',
  'quero falar com a equipe',
  'me passa pra alguém',
  'me passa pra alguem',
  'me passa para alguém',
  'me passa para alguem',
  'me passa pra alguém agora',
  'me passa pra alguem agora',
  'quero uma proposta',
  'quero proposta',
  'quero falar com um vendedor',
  'quero falar com o vendedor',
  'me transfere',
  'pode me transferir',
  'quero atendimento humano',
  // Pedidos explícitos de encaminhamento: fecham o handoff e usam a confirmação
  // (não o LLM, que ficava re-oferecendo "com um resumo").
  'pode encaminhar',
  'pode me encaminhar',
  'me encaminha',
  'pode me chamar',
  'manda pra equipe',
  'manda para equipe',
  'pode passar pra equipe',
  'pode passar para equipe',
];

/**
 * Minimal local fallback for detecting an explicit Stated_Preference. Mirrors
 * the design's PreferenceDetector contract so it can be replaced by the real
 * `detectPreference` once `preference-detector.ts` exists.
 */
function detectPreference(rawMessage: string): StatedPreference {
  const msg = rawMessage.toLowerCase().trim();
  if (!msg) return 'none';
  if (PREFERENCE_CONTINUE_PHRASES.some((p) => msg.includes(p))) return 'continue';
  if (PREFERENCE_HUMAN_PHRASES.some((p) => msg.includes(p))) return 'human';
  return 'none';
}
// --------------------------- end local fallback ----------------------------

// Phrases that look like acceptance but qualify/negate it — guards against a
// false `handoff_accept`.
const NOT_ACCEPT_QUALIFIERS = [
  'mas', 'porém', 'porem', 'não sei', 'nao sei', 'depende',
  'entender melhor', 'pensar', 'talvez', 'ainda não', 'ainda nao',
];

// Acceptance of a PENDING handoff offer (only meaningful when state === 'suggested').
const HANDOFF_ACCEPT_EXACT = [
  'sim, pode', 'pode encaminhar', 'pode encaminhar sim',
  'pode mandar', 'tá bom, manda', 'ta bom, manda',
  'ok, pode', 'ok, pode encaminhar',
  'manda pra equipe', 'manda para equipe', 'pode seguir',
  'quero sim', 'sim por favor', 'pode sim', 'manda sim',
  'encaminha', 'sim, pode encaminhar', 'pode ser, vamos ver',
  'vamos ver', 'pode ser', 'sim, quero', 'sim quero',
  'pode me chamar', 'quero seguir',
];

const HANDOFF_ACCEPT_SHORT = ['sim', 'pode', 'manda'];

const DESISTANCE_PHRASES = [
  'deixa pra lá', 'deixa pra la', 'esquece', 'não quero mais', 'nao quero mais',
  'não preciso', 'nao preciso', 'vou procurar outro',
  'não tenho interesse', 'nao tenho interesse', 'sem interesse',
];

const SIMPLE_ACK = ['ok', 'obrigado', 'obrigada', 'valeu', 'beleza', 'blz', 'vlw', 'brigado', 'tá', 'ta'];

const GREETINGS = ['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'hey', 'eae', 'e aí', 'e ai'];

// Frustration — MUST be checked before price (some frustration phrases contain
// price words, e.g. "só quero o preço").
const FRUSTRATION_PHRASES = [
  'já falei', 'ja falei', 'para de perguntar', 'pare de perguntar',
  'só quero preço', 'so quero preco', 'só quero o preço', 'so quero o preco',
  'não tenho tempo', 'nao tenho tempo', 'só quero o valor', 'so quero o valor',
  'só quero saber o valor', 'so quero saber o valor',
  'já contei tudo', 'ja contei tudo', 'para de enrolar', 'pare de enrolar',
  'só me passa o preço', 'so me passa o preco', 'chega de pergunta',
  'quantas perguntas', 'muita pergunta',
];

// Broadened price detection (Property 2): a price keyword combined with an
// interrogative/desire marker, INDEPENDENT of whether a segment is known.
const PRICE_KEYWORDS = [
  'preço', 'preco', 'valor', 'valores', 'custa', 'custo',
  'orçamento', 'orcamento', 'quanto', 'investimento',
];

const PRICE_MARKERS = [
  'quanto', 'qual', 'queria saber', 'quero saber', 'me passa',
  'me diz', 'tem ideia', 'tem uma ideia', '?',
];

// Non-price interrogative markers for `direct_question`.
const QUESTION_WORDS = [
  'como', 'quando', 'onde', 'quem', 'o que', 'porque', 'por que',
  'funciona', 'qual', 'quais', 'consegue', 'da pra', 'dá pra', 'tem como',
];

function hasAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (haystack.includes(n)) return n;
  }
  return null;
}

function isExactOrLeading(msg: string, phrases: string[]): string | null {
  for (const p of phrases) {
    if (msg === p || msg.startsWith(p + ',') || msg.startsWith(p + ' ')) return p;
  }
  return null;
}

function result(
  category: IntentCategory,
  matchedText?: string,
): ResolvedIntent {
  return {
    category,
    isDirectQuestion: category === 'price_question' || category === 'direct_question',
    priceIntent: category === 'price_question',
    matchedText,
  };
}

/**
 * Resolve an inbound message to exactly one IntentCategory.
 *
 * Resolution order (authoritative — top to bottom; first match wins):
 *   1. Stated preference (continue / human)  — most recent preference wins (R7.4)
 *   2. Frustration                            — checked BEFORE price (design)
 *   3. Completed-handoff acknowledgment       — only while state === 'completed'
 *   4. Desistance
 *   5. Handoff acceptance                     — only while state === 'suggested'
 *   6. Price question                         — price keyword + marker (R2.1)
 *   7. Direct (non-price) question
 *   8. Greeting
 *   9. Acknowledgment
 *  10. general                                — ambiguous → LLM
 *
 * Command / edge_input / over_length are resolved by earlier pipeline stages
 * (CommandHandler / EdgeInputHandler) and never reach this function; an empty
 * message therefore resolves defensively to `general`.
 */
export function resolveIntent(rawMessage: string, ctx: IntentContext): ResolvedIntent {
  const msg = (rawMessage ?? '').toLowerCase().trim();

  if (!msg) {
    return result('general');
  }

  // 1. Stated preference — the most explicit directional signal (R7.4 "the most
  //    recent stated preference wins"). Surfaced from the PreferenceDetector.
  const preference = detectPreference(rawMessage);
  if (preference === 'continue') return result('preference_continue', 'preference:continue');
  if (preference === 'human') return result('preference_human', 'preference:human');

  // 2. Frustration — before price, so "só quero o preço" maps to `frustration`.
  const frustration = hasAny(msg, FRUSTRATION_PHRASES);
  if (frustration) return result('frustration', frustration);

  // 3. Completed handoff: a simple ack (or repeated accept) is a closing ack.
  //    A new question while completed is intentionally NOT caught here so it can
  //    fall through to price/direct/general (R10.5).
  if (ctx.handoffState === 'completed') {
    const isAck = SIMPLE_ACK.includes(msg) || msg === 'sim';
    const repeatedAccept =
      isExactOrLeading(msg, HANDOFF_ACCEPT_EXACT) !== null ||
      HANDOFF_ACCEPT_SHORT.includes(msg);
    if (isAck || repeatedAccept) {
      return result('handoff_completed_ack', isAck ? 'ack' : 'repeated-accept');
    }
  }

  // 4. Desistance.
  const desistance = hasAny(msg, DESISTANCE_PHRASES);
  if (desistance) return result('desistance', desistance);

  // 5. Handoff acceptance of a PENDING offer (state must be `suggested`, and the
  //    message must not contain a qualifier that negates the acceptance).
  if (ctx.handoffState === 'suggested') {
    const hasQualifier = hasAny(msg, NOT_ACCEPT_QUALIFIERS) !== null;
    if (!hasQualifier) {
      const accept =
        isExactOrLeading(msg, HANDOFF_ACCEPT_EXACT) ||
        (HANDOFF_ACCEPT_SHORT.includes(msg) ? msg : null);
      if (accept) return result('handoff_accept', accept);
    }
  }

  // 6. Price question — broadened: a price keyword combined with an
  //    interrogative/desire marker, independent of whether a segment is known.
  const priceKeyword = hasAny(msg, PRICE_KEYWORDS);
  if (priceKeyword) {
    const marker = hasAny(msg, PRICE_MARKERS);
    if (marker) return result('price_question', priceKeyword);
  }

  // 7. Direct (non-price) question: an explicit interrogative marker.
  const questionWord = hasAny(msg, QUESTION_WORDS);
  if (msg.includes('?') || questionWord) {
    return result('direct_question', questionWord ?? '?');
  }

  // 8. Greeting (exact or greeting + '!').
  const greeting = GREETINGS.find((g) => msg === g || msg === g + '!');
  if (greeting) return result('greeting', greeting);

  // 9. Acknowledgment (non-terminal ok/obrigado/valeu).
  if (SIMPLE_ACK.includes(msg)) return result('acknowledgment', msg);

  // 10. Ambiguous → general (LLM).
  return result('general');
}
