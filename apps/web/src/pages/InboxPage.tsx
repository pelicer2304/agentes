import { InboxTable } from '@/components/inbox/InboxTable';
import { useInbox } from '@/hooks/useInbox';

/**
 * Conversations Inbox screen (Req 16.1, 16.5). Polls every 5s via {@link useInbox}.
 */
export function InboxPage() {
  const { data, isLoading, error } = useInbox();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conversas</h1>
        <p className="mt-1 text-muted">
          Conversas de WhatsApp em tempo real.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Carregando conversas...</p>
      ) : error ? (
        <p className="text-sm text-red-400">
          Falha ao carregar as conversas. Tente novamente.
        </p>
      ) : (
        <InboxTable items={data ?? []} />
      )}
    </div>
  );
}
