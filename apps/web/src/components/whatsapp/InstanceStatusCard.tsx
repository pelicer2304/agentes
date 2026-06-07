import { Card, Badge } from '@/components/ui';
import type { BadgeProps } from '@/components/ui';
import type { EvolutionConnectionState, InstanceStatus } from '@/types';

interface InstanceStatusCardProps {
  status: InstanceStatus | null;
  statusError: string | null;
  lastEvent: string | null;
  lastError: string | null;
}

const STATE_LABELS: Record<EvolutionConnectionState, string> = {
  open: 'Conectado',
  connecting: 'Conectando',
  close: 'Desconectado',
  closed: 'Desconectado',
  unknown: 'Desconhecido',
};

function stateVariant(state: EvolutionConnectionState): BadgeProps['variant'] {
  switch (state) {
    case 'open':
      return 'success';
    case 'connecting':
      return 'warning';
    case 'close':
    case 'closed':
      return 'danger';
    default:
      return 'default';
  }
}

/**
 * Displays the instance status, name, connected number, last event, and last
 * Evolution error (Req 15.2, 15.6).
 */
export function InstanceStatusCard({
  status,
  statusError,
  lastEvent,
  lastError,
}: InstanceStatusCardProps) {
  return (
    <Card title="Status da instância">
      {statusError && !status && (
        <p className="mb-3 rounded-md border border-red-400/30 bg-red-900/20 px-3 py-2 text-sm text-red-400">
          Não foi possível obter o status da instância. {statusError}
        </p>
      )}

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">Status</dt>
          <dd className="mt-1">
            {status ? (
              <Badge variant={stateVariant(status.state)}>
                {STATE_LABELS[status.state]}
              </Badge>
            ) : (
              <span className="text-sm text-muted">—</span>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            Instância
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {status?.instanceName ?? '—'}
          </dd>
        </div>

        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            Número conectado
          </dt>
          <dd className="mt-1 text-sm text-foreground">
            {status?.connectedNumber ?? '—'}
          </dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background/50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted">
            Último evento
          </p>
          <p className="mt-1 text-sm text-foreground">
            {lastEvent ?? 'Nenhum evento recente'}
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-muted">
            Último erro Evolution
          </p>
          <p className="mt-1 text-sm text-red-400">
            {lastError ?? 'Nenhum erro registrado'}
          </p>
        </div>
      </div>
    </Card>
  );
}
