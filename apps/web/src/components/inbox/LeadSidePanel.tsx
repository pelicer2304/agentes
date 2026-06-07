import { Card, Badge } from '@/components/ui';
import type { ConversationLeadPanel } from '@/types';
import {
  displayOrPlaceholder,
  formatScore,
  formatStatus,
  formatTemperature,
} from '@/lib/utils';

interface LeadSidePanelProps {
  lead: ConversationLeadPanel;
}

/**
 * Lead side panel with identified pains, commercial summary, and next step
 * (Req 16.3).
 */
export function LeadSidePanel({ lead }: LeadSidePanelProps) {
  const secondaryPains = lead.pains.secondaryPains ?? [];

  return (
    <Card title="Lead">
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-medium text-foreground">{lead.name}</p>
          <p className="text-muted">{lead.phone}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{formatStatus(lead.status)}</Badge>
            <Badge variant="info">{formatTemperature(lead.temperature)}</Badge>
            <span className="text-xs text-muted">
              Score: {formatScore(lead.leadScore)}
            </span>
          </div>
          {lead.segment && (
            <p className="mt-2 text-xs text-muted">Segmento: {lead.segment}</p>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Dor principal
          </p>
          <p className="mt-1 text-foreground">
            {displayOrPlaceholder(lead.pains.mainPain)}
          </p>
          {secondaryPains.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-muted">
              {secondaryPains.map((pain, idx) => (
                <li key={idx}>{pain}</li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Resumo comercial
          </p>
          <p className="mt-1 text-foreground">
            {displayOrPlaceholder(lead.commercialSummary)}
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Próximo passo
          </p>
          <p className="mt-1 text-foreground">
            {displayOrPlaceholder(lead.nextStep)}
          </p>
        </div>
      </div>
    </Card>
  );
}
