import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  Pagination,
} from '@/components/ui';
import {
  formatDate,
  truncateText,
  formatScore,
  formatTemperature,
  formatStatus,
} from '@/lib/utils';
import type { Lead } from '@/types';

interface LeadsTableProps {
  leads: Lead[];
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function getTemperatureBadgeVariant(
  temperature: string | null | undefined
): 'danger' | 'warning' | 'info' | 'default' {
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

function getStatusBadgeVariant(
  status: string | null | undefined
): 'success' | 'danger' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'quente':
    case 'convertido':
      return 'success';
    case 'chamar_humano':
      return 'warning';
    case 'perdido':
      return 'danger';
    case 'frio':
      return 'info';
    default:
      return 'default';
  }
}

export function LeadsTable({
  leads,
  currentPage,
  totalPages,
  onPageChange,
}: LeadsTableProps) {
  const navigate = useNavigate();

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-card border border-border bg-card p-12">
        <p className="text-muted">Nenhum lead encontrado</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome/Telefone</TableHead>
              <TableHead>Segmento</TableHead>
              <TableHead>Dor Principal</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Temperatura</TableHead>
              <TableHead>Última Mensagem</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{lead.name}</p>
                    <p className="text-xs text-muted">{lead.phone}</p>
                  </div>
                </TableCell>
                <TableCell>{lead.segment ?? '—'}</TableCell>
                <TableCell>
                  {lead.mainPain ? truncateText(lead.mainPain, 50) : '—'}
                </TableCell>
                <TableCell>{formatScore(lead.leadScore)}</TableCell>
                <TableCell>
                  <Badge variant={getStatusBadgeVariant(lead.status)}>
                    {formatStatus(lead.status)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={getTemperatureBadgeVariant(lead.temperature)}>
                    {formatTemperature(lead.temperature)}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px]">
                  {lead.summary ? truncateText(lead.summary, 50) : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(lead.updatedAt)}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    Ver detalhe
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
      />
    </div>
  );
}
