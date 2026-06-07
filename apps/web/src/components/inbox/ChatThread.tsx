import { Card } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';
import type { ConversationMessage } from '@/types';

interface ChatThreadProps {
  messages: ConversationMessage[];
}

/** Label for the message author based on role/direction (Req 16.2). */
function authorLabel(message: ConversationMessage): string {
  if (message.direction === 'inbound' || message.role === 'user') {
    return 'Cliente';
  }
  return message.role === 'assistant' ? 'DecodificaIA / Equipe' : 'Sistema';
}

/**
 * Renders the full chat: client messages, DecodificaIA messages, and team
 * manual messages (Req 16.2). Inbound messages align left, outbound right.
 */
export function ChatThread({ messages }: ChatThreadProps) {
  return (
    <Card title="Conversa">
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <p className="text-sm text-muted">Nenhuma mensagem ainda.</p>
        )}

        {messages.map((message) => {
          const isInbound =
            message.direction === 'inbound' || message.role === 'user';
          return (
            <div
              key={message.id}
              className={cn(
                'flex flex-col',
                isInbound ? 'items-start' : 'items-end',
              )}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                  isInbound
                    ? 'bg-card text-foreground'
                    : 'bg-accent-dark text-accent',
                )}
              >
                <p className="mb-0.5 text-xs font-medium text-muted">
                  {authorLabel(message)}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {message.content}
                </p>
              </div>
              <span className="mt-1 text-[11px] text-muted">
                {formatDate(message.createdAt)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
