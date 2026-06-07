import { cn } from '@/lib/utils';

export interface MessageBubbleProps {
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
  className?: string;
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function MessageBubble({ content, role, createdAt, className }: MessageBubbleProps) {
  const isUser = role === 'user';

  return (
    <div
      className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start', className)}
    >
      <div
        className={cn(
          'max-w-[75%] rounded-lg px-4 py-3',
          isUser
            ? 'bg-accent-dark border border-accent/20 text-foreground'
            : 'bg-card border border-border text-foreground'
        )}
      >
        <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
        <span
          className={cn(
            'mt-1 block text-xs text-muted',
            isUser ? 'text-right' : 'text-left'
          )}
        >
          {formatTime(createdAt)}
        </span>
      </div>
    </div>
  );
}
