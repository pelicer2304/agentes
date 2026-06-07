import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui';
import type { BadgeProps } from '@/components/ui';
import type { InboxListItem } from '@/types';
import {
  formatDate,
  formatScore,
  formatStatus,
  formatTemperature,
  truncateText,
} from '@/lib/utils';

interface InboxTableProps {
  items: InboxListItem[];
}

function temperatureVariant(
  temperature: string | null,
): BadgeProps['variant'] {
  switch (temperature) {
    case 'quente':
      return 'danger';
    case 'morno':
      return 'warning';
    case 'frio':
      return 'info';
    default:
      return 'default';
  }
}

/** Short label describing the handoff state for the list (Req 16.1). */
function handoffLabel(item: InboxListItem): string {
  if (item.handoff.handoffCompleted) return 'Concluído';
  if (item.handoff.handoffAccepted) return 'Aceito';
  if (item.handoff.handoffOffered) return 'Oferecido';
  return '—';
}

/**
 * Renders the WhatsApp conversations inbox list with every column required by
 * Req 16.1. Rows navigate to the conversation detail.
 */
export function InboxTable({ items }: InboxTableProps) {
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-border bg-card px-4 py-8 text-center text-sm text-muted">
        Nenhuma conversa de WhatsApp ainda.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Contato</TableHead>
          <TableHead>Última mensagem</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Temperatura</TableHead>
          <TableHead>Score</TableHead>
          <TableHead>Canal</TableHead>
          <TableHead>Bot</TableHead>
          <TableHead>Handoff</TableHead>
          <TableHead>Data</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow
            key={item.conversationId}
            onClick={() => navigate(`/conversas/${item.conversationId}`)}
            className="cursor-pointer hover:bg-border/40"
          >
            <TableCell>
              <div className="font-medium text-foreground">{item.name}</div>
              <div className="text-xs text-muted">{item.phone}</div>
            </TableCell>
            <TableCell className="max-w-xs">
              <span className="text-sm text-muted">
                {item.lastMessage
                  ? truncateText(item.lastMessage.content, 60)
                  : '—'}
              </span>
            </TableCell>
            <TableCell>
              <Badge variant="default">{formatStatus(item.status)}</Badge>
            </TableCell>
            <TableCell>
              <Badge variant={temperatureVariant(item.temperature)}>
                {formatTemperature(item.temperature)}
              </Badge>
            </TableCell>
            <TableCell>{formatScore(item.leadScore)}</TableCell>
            <TableCell>{item.channel}</TableCell>
            <TableCell>
              <Badge variant={item.botPaused ? 'warning' : 'success'}>
                {item.botPaused ? 'Pausado' : 'Ativo'}
              </Badge>
            </TableCell>
            <TableCell>{handoffLabel(item)}</TableCell>
            <TableCell>
              <span className="text-xs text-muted">
                {formatDate(item.lastMessageAt)}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
