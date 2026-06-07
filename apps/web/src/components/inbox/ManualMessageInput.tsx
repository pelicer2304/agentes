import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Textarea } from '@/components/ui';

interface ManualMessageInputProps {
  onSend: (content: string) => Promise<unknown>;
  isSending: boolean;
  error: string | null;
  disabled?: boolean;
}

/**
 * Manual message field for the conversation detail (Req 16.4, 13.1). Sends the
 * message via the parent handler and clears the field on success.
 */
export function ManualMessageInput({
  onSend,
  isSending,
  error,
  disabled,
}: ManualMessageInputProps) {
  const [content, setContent] = useState('');

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed) return;
    try {
      await onSend(trimmed);
      setContent('');
    } catch {
      // Error surfaced via the `error` prop; keep the text for retry.
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Escreva uma mensagem para o cliente..."
        disabled={disabled || isSending}
        rows={3}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end">
        <Button
          onClick={handleSend}
          loading={isSending}
          disabled={disabled || !content.trim()}
        >
          <Send className="mr-1.5 h-4 w-4" />
          Enviar mensagem
        </Button>
      </div>
    </div>
  );
}
