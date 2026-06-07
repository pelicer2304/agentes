import fc from 'fast-check';
import { availableCommandsReply, resolveCommand } from './command-handler';
import { CommandName } from './conversation-types';

/**
 * Property-based tests for the CommandHandler pure resolution contract.
 *
 * Feature: conversational-agent-quality
 */

// The defined commands and the action each maps to.
const DEFINED_COMMANDS: ReadonlyArray<CommandName> = ['clear', 'reset', 'help'];

const EXPECTED_ACTION: Record<CommandName, 'clear' | 'reset' | 'none'> = {
  clear: 'clear',
  reset: 'reset',
  help: 'none',
};

// A regex that the confirmation reply for each command must satisfy so that the
// reply demonstrably names the action that was performed (Requirement 4.2).
const NAMES_ACTION: Record<CommandName, RegExp> = {
  clear: /limp/i, // "limpei o histórico"
  reset: /reinici/i, // "reiniciei nossa conversa"
  help: /comando/i, // help replies with the available-commands listing
};

/**
 * Re-cases each character of a word randomly so resolution must be
 * case-insensitive.
 */
function randomCasing(word: string): fc.Arbitrary<string> {
  return fc
    .array(fc.boolean(), { minLength: word.length, maxLength: word.length })
    .map((flags) =>
      word
        .split('')
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    );
}

// Whitespace runs to surround the token with (spaces, tabs, newlines).
const whitespace = fc
  .array(fc.constantFrom(' ', '\t', '\n'), { minLength: 0, maxLength: 4 })
  .map((parts) => parts.join(''));

describe('resolveCommand', () => {
  // Feature: conversational-agent-quality, Property 9: Defined commands execute, confirm, and bypass the LLM
  it('resolves any defined command (any casing/whitespace) to its mapped action and a naming confirmation reply', () => {
    const definedCommandInput = fc
      .constantFrom(...DEFINED_COMMANDS)
      .chain((name) =>
        fc.record({
          name: fc.constant(name),
          casedName: randomCasing(name),
          leading: whitespace,
          trailing: whitespace,
          // Optional ignored argument after the command token.
          args: fc.constantFrom('', ' extra', ' foo bar', '   trailing args'),
        }),
      );

    fc.assert(
      fc.property(definedCommandInput, ({ name, casedName, leading, trailing, args }) => {
        const raw = `${leading}/${casedName}${args}${trailing}`;
        const result = resolveCommand(raw);

        expect(result.isCommand).toBe(true);
        expect(result.name).toBe(name);
        expect(result.action).toBe(EXPECTED_ACTION[name]);
        expect(result.confirmationReply.length).toBeGreaterThan(0);
        expect(result.confirmationReply).toMatch(NAMES_ACTION[name]);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: conversational-agent-quality, Property 10: Undefined slash tokens list available commands
  it('lists the available commands for any slash token that matches no defined command', () => {
    const listing = availableCommandsReply();

    const undefinedTokenInput = fc
      .record({
        // A token built from letters/digits; filtered below so it never equals
        // a defined command (case-insensitively).
        token: fc
          .stringMatching(/^[A-Za-z0-9_-]{1,12}$/)
          .filter((t) => !DEFINED_COMMANDS.includes(t.toLowerCase() as CommandName)),
        leading: whitespace,
        trailing: whitespace,
        args: fc.constantFrom('', ' something', ' a b c'),
      })
      // Guard against the leading whitespace accidentally not starting with '/'
      // (it always does here) and against empty tokens.
      .filter(({ token }) => token.trim().length > 0);

    fc.assert(
      fc.property(undefinedTokenInput, ({ token, leading, trailing, args }) => {
        const raw = `${leading}/${token}${args}${trailing}`;
        const result = resolveCommand(raw);

        expect(result.isCommand).toBe(true);
        expect(result.name).toBeNull();
        expect(result.action).toBe('none');
        // The reply is the available-commands listing and names every command.
        expect(result.confirmationReply).toBe(listing);
        expect(result.confirmationReply).toContain('/clear');
        expect(result.confirmationReply).toContain('/reset');
        expect(result.confirmationReply).toContain('/help');
      }),
      { numRuns: 100 },
    );
  });
});
