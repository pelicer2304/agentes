import * as React from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_MESSAGE_LENGTH = 4000;

export interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatInput({ onSend, disabled = false, className }: ChatInputProps) {
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const charCount = message.length;

  function validate(value: string): string | null {
    if (value.trim().length === 0) {
      return 'Digite uma mensagem';
    }
    if (value.length > MAX_MESSAGE_LENGTH) {
      return 'Mensagem deve ter no máximo 4000 caracteres';
    }
    return null;
  }

  function handleSend() {
    const validationError = validate(message);
    if (validationError) {
      setError(validationError);
      return;
    }

    onSend(message.trim());
    setMessage('');
    setError(null);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!disabled) {
        handleSend();
      }
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setMessage(value);

    // Clear error when user starts typing
    if (error) {
      setError(null);
    }

    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }

  return (
    <div className={cn('w-full', className)}>
      <div
        className={cn(
          'flex items-end gap-2 rounded-lg border bg-card p-2',
          error ? 'border-red-500' : 'border-border'
        )}
      >
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Digite sua mensagem..."
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted',
            'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            'min-h-[40px] max-h-[160px]'
          )}
          aria-label="Mensagem"
          aria-invalid={!!error}
          aria-describedby={error ? 'chat-input-error' : undefined}
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || message.trim().length === 0}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors',
            'bg-accent text-background hover:bg-accent/90',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
          aria-label="Enviar mensagem"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between px-1">
        <div>
          {error && (
            <p id="chat-input-error" className="text-xs text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>
        <p
          className={cn(
            'text-xs',
            charCount > MAX_MESSAGE_LENGTH ? 'text-red-400' : 'text-muted'
          )}
        >
          {charCount}/{MAX_MESSAGE_LENGTH}
        </p>
      </div>
    </div>
  );
}
