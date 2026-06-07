import { Card } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { LogEntry } from '@/types';

interface LogSectionProps {
  title: string;
  entries: LogEntry[];
  /** Field to emphasize per row: the message content or the error text. */
  emphasis?: 'content' | 'error' | 'responseMs';
}

/**
 * Renders a single bucket of operational logs (Req 22.2).
 */
export function LogSection({ title, entries, emphasis = 'content' }: LogSectionProps) {
  return (
    <Card title={`${title} (${entries.length})`}>
      {entries.length === 0 ? (
        <p className="text-sm text-muted">Nenhum registro.</p>
      ) : (
        <ul className="divide-y divide-border">
          {entries.slice(0, 20).map((entry) => (
            <li key={entry.id} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {entry.phone ?? entry.instanceName ?? entry.type}
                </span>
                <span className="text-xs text-muted">
                  {formatDate(entry.createdAt)}
                </span>
              </div>
              <p
                className={
                  emphasis === 'error'
                    ? 'mt-0.5 text-red-400'
                    : 'mt-0.5 text-muted'
                }
              >
                {emphasis === 'error'
                  ? (entry.error ?? '—')
                  : emphasis === 'responseMs'
                    ? `${entry.responseMs ?? '—'} ms`
                    : (entry.content ?? entry.type)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
