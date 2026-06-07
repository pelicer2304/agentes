import { Card } from '@/components/ui';
import { MessageBubble } from '@/components/playground/MessageBubble';
import type { Message } from '@/types';

interface ConversationHistoryProps {
  messages: Message[];
}

export function ConversationHistory({ messages }: ConversationHistoryProps) {
  if (messages.length === 0) {
    return (
      <Card title="Histórico da Conversa">
        <p className="text-sm text-muted">Nenhuma mensagem encontrada.</p>
      </Card>
    );
  }

  return (
    <Card title="Histórico da Conversa">
      <div className="flex max-h-[500px] flex-col gap-3 overflow-y-auto pr-2">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            content={message.content}
            role={message.role === 'user' ? 'user' : 'assistant'}
            createdAt={message.createdAt}
          />
        ))}
      </div>
    </Card>
  );
}
