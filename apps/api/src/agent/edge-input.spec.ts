import fc from 'fast-check';
import { EdgeKind } from './conversation-types';
import {
  MAX_MESSAGE_LENGTH,
  classifyEdgeInput,
  edgeReply,
} from './edge-input';

/**
 * Property-based tests for the EdgeInputHandler (Requirement 5).
 *
 * Feature: conversational-agent-quality
 */

/** Phrases that would indicate the agent is having trouble processing input. */
const DIFFICULTY_PHRASES = [
  'dificuldade',
  'não consigo processar',
  'nao consigo processar',
  'não consegui processar',
  'nao consegui processar',
  'problema ao processar',
  'erro ao processar',
  'dificuldades técnicas',
  'dificuldades tecnicas',
];

function containsDifficultyPhrase(reply: string): boolean {
  const lower = reply.toLowerCase();
  return DIFFICULTY_PHRASES.some((phrase) => lower.includes(phrase));
}

/** Edge-input generators: empty/whitespace, emoji sequences, single punctuation. */
const emptyArb = fc.constant('');

const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v', '\u00a0'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((chars) => chars.join(''));

const emojiArb = fc
  .array(fc.constantFrom('😀', '😁', '🎉', '👍', '🙏', '❤️', '🔥', '🚀', '😎', '🤖'), {
    minLength: 1,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));

const punctuationArb = fc.constantFrom(
  '.',
  ',',
  '!',
  '?',
  ';',
  ':',
  '-',
  '#',
  '@',
  '*',
  '%',
  '&',
  '(',
  ')',
);

const edgeInputArb = fc.oneof(emptyArb, whitespaceArb, emojiArb, punctuationArb);

describe('classifyEdgeInput / edgeReply', () => {
  // Feature: conversational-agent-quality, Property 11: Edge inputs invite a restatement and never report processing trouble
  it('invites the user to restate in words and never reports processing trouble for edge inputs', () => {
    fc.assert(
      fc.property(edgeInputArb, (input) => {
        const kind: EdgeKind = classifyEdgeInput(input);

        // The generated inputs must be classified as genuine edge inputs.
        expect(['empty', 'whitespace', 'emoji_only', 'punctuation']).toContain(kind);

        const reply = edgeReply(kind);

        // Non-empty reply that invites restating the request in words.
        expect(reply.length).toBeGreaterThan(0);
        expect(reply.toLowerCase()).toContain('palavras');

        // Never states the agent is having difficulty processing.
        expect(containsDifficultyPhrase(reply)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 13: Over-length messages are rejected with the limit stated
  it('classifies over-length messages as over_length and states the supported length limit', () => {
    const overLengthArb = fc
      .integer({ min: MAX_MESSAGE_LENGTH + 1, max: MAX_MESSAGE_LENGTH + 500 })
      .chain((len) =>
        fc.string({ minLength: len, maxLength: len }).filter((s) => s.length > MAX_MESSAGE_LENGTH),
      );

    fc.assert(
      fc.property(overLengthArb, (input) => {
        const kind: EdgeKind = classifyEdgeInput(input);
        expect(kind).toBe('over_length');

        const reply = edgeReply(kind);
        expect(reply.length).toBeGreaterThan(0);
        // The reply states the supported length limit.
        expect(reply).toContain(String(MAX_MESSAGE_LENGTH));
        // It must not report processing trouble.
        expect(containsDifficultyPhrase(reply)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
