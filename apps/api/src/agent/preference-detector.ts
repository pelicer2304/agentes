/**
 * PreferenceDetector
 *
 * Pure, deterministic detection of an explicit Stated_Preference in the latest
 * inbound message. No I/O, no LLM. Tolerant of accents and letter casing.
 *
 * The HandoffManager consumes this signal: a `continue` preference keeps the
 * conversation with the agent (and overrides handoff monotonicity), while a
 * `human` preference routes the lead to a person/proposal regardless of
 * qualification.
 *
 * Feature: conversational-agent-quality
 * Requirements: 7.1, 7.3, 7.4
 */
import { StatedPreference } from './conversation-types';

/**
 * Normalizes a raw message for tolerant matching:
 * - lowercases
 * - strips diacritics/accents (á -> a, ç -> c, ã -> a, ...)
 * - collapses any run of whitespace to a single space
 * - trims surrounding whitespace
 */
function normalize(rawMessage: string): string {
  return rawMessage
    .toLowerCase()
    .normalize('NFD')
    // Remove combining diacritical marks left behind by NFD decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Phrasings where the user wants to keep talking with the agent.
 *
 * Checked BEFORE the human phrasings on purpose: several of these are
 * negations of transfer/human ("nao quero ser transferido", "nao precisa
 * passar pra ninguem") that would otherwise be mis-read as a human request.
 * Matching is substring-based against the normalized message.
 */
const CONTINUE_PHRASES: readonly string[] = [
  'quero continuar falando com voce',
  'continuar falando com voce',
  'continuar com voce',
  'prefiro falar com voce',
  'prefiro continuar com voce',
  'prefiro continuar',
  'quero continuar',
  'pode continuar',
  'vamos continuar',
  'nao quero ser transferido',
  'nao quero ser transferida',
  'nao precisa transferir',
  'nao precisa me transferir',
  'nao precisa passar pra ninguem',
  'nao precisa passar para ninguem',
  'nao precisa passar pra alguem',
  'nao precisa chamar ninguem',
  'nao quero falar com atendente',
  'nao quero falar com humano',
  'nao quero falar com uma pessoa',
  'nao quero atendente',
  'nao quero humano',
  'nao quero um humano',
  'nao quero um atendente',
  'nao quero uma pessoa',
  'continua comigo',
  'fica comigo',
];

/**
 * Phrasings where the user wants a human / a proposal now.
 * Matching is substring-based against the normalized message.
 */
const HUMAN_PHRASES: readonly string[] = [
  'quero falar com atendente',
  'quero falar com um atendente',
  'quero falar com o atendente',
  'quero falar com um humano',
  'quero falar com humano',
  'quero um humano',
  'quero um atendente',
  'quero uma pessoa',
  'quero falar com uma pessoa',
  'quero falar com alguem',
  'falar com atendente',
  'falar com um humano',
  'falar com humano',
  'falar com uma pessoa',
  'me passa pra alguem agora',
  'me passa para alguem agora',
  'me passa pra alguem',
  'me passa para alguem',
  'passa pra alguem',
  'passa para alguem',
  'me passa pra um atendente',
  'me passa para um atendente',
  'quero uma proposta',
  'quero proposta',
  'me manda uma proposta',
  'quero um orcamento',
  'quero orcamento',
  'me chama alguem',
  'chama alguem',
  'quero falar com a equipe',
  'falar com a equipe',
];

/**
 * Detects an explicit stated preference in the latest message.
 *
 * Returns:
 * - `continue` when the user wants to keep talking with the agent
 * - `human` when the user wants a human / a proposal now
 * - `none` when no explicit preference is stated
 *
 * `continue` is resolved before `human` so that negated-transfer phrasings
 * ("nao quero ser transferido") are not mistaken for a human request.
 */
export function detectPreference(rawMessage: string): StatedPreference {
  if (!rawMessage) {
    return 'none';
  }

  const msg = normalize(rawMessage);
  if (msg.length === 0) {
    return 'none';
  }

  if (CONTINUE_PHRASES.some((phrase) => msg.includes(phrase))) {
    return 'continue';
  }

  if (HUMAN_PHRASES.some((phrase) => msg.includes(phrase))) {
    return 'human';
  }

  return 'none';
}
