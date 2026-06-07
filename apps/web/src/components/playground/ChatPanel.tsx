import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MessageBubble } from './MessageBubble';
import type { Message } from '@/types';

export interface ChatPanelProps {
  messages: Message[];
  isLoading?: boolean;
  className?: string;
}

export function ChatPanel({ messages, isLoading = false, className }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  return (
    <div
      className={cn(
        'flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background',
        className
      )}
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            content={message.content}
            role={message.role === 'user' ? 'user' : 'assistant'}
            createdAt={message.createdAt}
          />
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted" />
              <span className="text-sm text-muted">Digitando...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
