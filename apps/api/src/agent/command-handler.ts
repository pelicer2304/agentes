/**
 * CommandHandler — owns the typed-command contract for the conversational
 * pipeline.
 *
 * A typed command is any inbound message whose trimmed text begins with `/`.
 * Commands are resolved here, deterministically and without any LLM call, so
 * they never reach the model (Requirement 4.3 is enforced by the pipeline,
 * which routes any `isCommand` resolution straight to the confirmation reply).
 *
 * The defined commands are:
 *   - `/clear` → clears the conversation history (action `clear`)
 *   - `/reset` → resets the conversation (action `reset`)
 *   - `/help`  → lists the available commands (action `none`)
 *
 * Resolution is tolerant of letter casing and surrounding whitespace, and any
 * arguments after the command token are ignored. An undefined slash token
 * (for example `/token`) resolves to `isCommand: true, name: null` and replies
 * with the available-commands listing.
 *
 * Feature: conversational-agent-quality
 */
import { CommandName, CommandResolution } from './conversation-types';

/**
 * Confirmation replies for each defined command. Each reply names the action
 * that was performed (Requirement 4.2) and is written in Portuguese.
 */
const CONFIRMATION_REPLIES: Record<CommandName, string> = {
  clear:
    'Pronto, limpei o histórico da nossa conversa. Podemos começar de novo quando você quiser.',
  reset:
    'Pronto, reiniciei nossa conversa e zerei o contexto anterior. Podemos recomeçar do zero.',
  help: '', // help always replies with the available-commands listing
};

/**
 * Maps each defined command to the action the pipeline should execute.
 */
const COMMAND_ACTIONS: Record<CommandName, CommandResolution['action']> = {
  clear: 'clear',
  reset: 'reset',
  help: 'none',
};

/**
 * Returns the human-readable listing of the available typed commands. Used both
 * for the `/help` command and as the reply for any undefined slash token
 * (Requirement 4.4). Written in Portuguese.
 */
export function availableCommandsReply(): string {
  return [
    'Esses são os comandos que eu reconheço:',
    '• /clear — limpa o histórico da nossa conversa',
    '• /reset — reinicia a conversa e zera o contexto',
    '• /help — mostra esta lista de comandos',
  ].join('\n');
}

/**
 * Resolves a possible typed command from a raw inbound message.
 *
 * - If the trimmed message does not begin with `/`, returns a non-command
 *   resolution (`isCommand: false`).
 * - If it begins with `/` and the first token matches a defined command
 *   (case-insensitively, ignoring surrounding whitespace and any trailing
 *   arguments), returns the mapped action and a confirmation reply that names
 *   the action performed.
 * - If it begins with `/` but matches no defined command, returns
 *   `isCommand: true, name: null` with the available-commands listing.
 */
export function resolveCommand(rawMessage: string): CommandResolution {
  const trimmed = (rawMessage ?? '').trim();

  // Not a command — the pipeline continues with normal processing.
  if (!trimmed.startsWith('/')) {
    return {
      isCommand: false,
      name: null,
      confirmationReply: '',
      action: 'none',
    };
  }

  // Extract the command token: the first whitespace-delimited word after the
  // leading slash, lowercased so resolution is case-insensitive. Arguments
  // after the token are ignored.
  const token = trimmed.slice(1).split(/\s+/)[0]?.toLowerCase() ?? '';
  const name = (['clear', 'reset', 'help'] as const).find((c) => c === token) ?? null;

  // Undefined slash token — list the available commands (Requirement 4.4).
  if (name === null) {
    return {
      isCommand: true,
      name: null,
      confirmationReply: availableCommandsReply(),
      action: 'none',
    };
  }

  // `/help` lists the available commands; the others confirm their action.
  const confirmationReply =
    name === 'help' ? availableCommandsReply() : CONFIRMATION_REPLIES[name];

  return {
    isCommand: true,
    name,
    confirmationReply,
    action: COMMAND_ACTIONS[name],
  };
}
