/**
 * EdgeInputHandler — pure classification and canned replies for
 * non-conversational input (Requirement 5).
 *
 * This stage sits near the front of the conversational pipeline so that
 * empty, whitespace-only, emoji-only, single-punctuation, and over-length
 * messages never reach the LLM. Every reply it produces:
 *   - invites the user to restate the request in words (R5.1), and
 *   - never states that the agent is having difficulty processing (R5.4).
 * The `over_length` reply states the supported length limit (R5.3).
 *
 * All functions here are pure: classification and reply text depend only on
 * the raw message. Fact preservation (R5.2) is the pipeline's responsibility —
 * it returns before any fact mutation when an edge input is detected.
 *
 * Feature: conversational-agent-quality
 */
import { EdgeKind } from './conversation-types';

/**
 * The maximum supported inbound message length, in characters. Messages longer
 * than this are classified as `over_length` and rejected with a reply that
 * states this limit, rather than being forwarded to the LLM.
 */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Matches at least one emoji / pictographic code point. Used as a precondition
 * so that purely numeric or symbolic strings are not treated as emoji-only
 * (the Emoji_Component property alone would otherwise include ASCII digits).
 */
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

/**
 * Code points that may legitimately surround emoji in an emoji-only message:
 * the pictographs themselves, skin-tone modifiers, regional indicators, the
 * zero-width joiner, variation selectors, and whitespace.
 */
const EMOJI_DECORATION =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\u{200D}\u{FE0E}\u{FE0F}\s]/gu;

/**
 * Matches a string consisting solely of punctuation, symbols, and whitespace.
 */
const PUNCTUATION_ONLY = /^[\p{P}\p{S}\s]+$/u;

/**
 * True when the trimmed message is composed only of emoji and emoji decoration
 * and contains at least one pictographic code point.
 */
function isEmojiOnly(trimmed: string): boolean {
  if (!PICTOGRAPH.test(trimmed)) {
    return false;
  }
  return trimmed.replace(EMOJI_DECORATION, '').length === 0;
}

/**
 * Classifies a raw inbound message as one of the non-conversational edge kinds,
 * or `none` when the message is ordinary conversational text.
 *
 * Resolution order is fixed: over-length is detected first (regardless of
 * content), then empty, then whitespace-only, then emoji-only, then
 * punctuation/symbol-only; anything else is `none`.
 */
export function classifyEdgeInput(rawMessage: string): EdgeKind {
  const raw = rawMessage ?? '';

  if (raw.length > MAX_MESSAGE_LENGTH) {
    return 'over_length';
  }
  if (raw.length === 0) {
    return 'empty';
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return 'whitespace';
  }
  if (isEmojiOnly(trimmed)) {
    return 'emoji_only';
  }
  if (PUNCTUATION_ONLY.test(trimmed)) {
    return 'punctuation';
  }

  return 'none';
}

/**
 * Produces the user-facing reply for a classified edge input. Every non-`none`
 * reply invites the user to restate the request in words and contains no
 * "difficulty processing" phrasing. The `over_length` reply states the
 * supported length limit. A `none` kind yields an empty string, signalling the
 * pipeline to continue normal processing.
 */
export function edgeReply(kind: EdgeKind): string {
  switch (kind) {
    case 'over_length':
      return (
        `Sua mensagem ficou bem longa — consigo ler textos de até ${MAX_MESSAGE_LENGTH} caracteres. ` +
        'Pode me contar em poucas palavras o que você precisa?'
      );
    case 'empty':
    case 'whitespace':
      return 'A mensagem chegou em branco por aqui. Pode me escrever em palavras o que você precisa?';
    case 'emoji_only':
      return 'Recebi seu emoji! Pode me contar em palavras o que você gostaria de saber?';
    case 'punctuation':
      return 'Recebi sua mensagem, mas sem nenhum texto. Pode me dizer em palavras o que você precisa?';
    case 'none':
    default:
      return '';
  }
}
