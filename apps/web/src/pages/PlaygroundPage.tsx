import { useEffect } from 'react';
import { Plus, RotateCcw, Trash2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { ChatPanel, ChatInput, QualificationPanel } from '@/components/playground';
import { useConversation } from '@/hooks/useConversation';

export function PlaygroundPage() {
  const {
    conversationId,
    messages,
    qualification,
    isLoading,
    isSending,
    error,
    createConversation,
    sendMessage,
    resetConversation,
    clearConversation,
    isCreating,
  } = useConversation();

  // Auto-create a conversation on first load if none exists
  useEffect(() => {
    if (!conversationId && !isCreating) {
      createConversation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold text-foreground">Playground</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearConversation}
            disabled={!conversationId || isCreating}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={resetConversation}
            disabled={!conversationId || isCreating}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Resetar conversa
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={createConversation}
            disabled={isCreating}
            loading={isCreating}
          >
            <Plus className="mr-2 h-4 w-4" />
            Nova conversa
          </Button>
        </div>
      </div>

      {/* Main content: two-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column (~60%): Chat */}
        <div className="flex w-[60%] flex-col border-r border-border">
          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-900/20 px-4 py-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Chat panel */}
          <ChatPanel
            messages={messages}
            isLoading={isSending}
            className="flex-1 rounded-none border-0"
          />

          {/* Chat input */}
          <div className="border-t border-border p-4">
            <ChatInput
              onSend={sendMessage}
              disabled={!conversationId || isSending || isLoading}
            />
          </div>
        </div>

        {/* Right column (~40%): Qualification panel */}
        <div className="w-[40%] overflow-y-auto">
          <QualificationPanel qualification={qualification} />
        </div>
      </div>
    </div>
  );
}
