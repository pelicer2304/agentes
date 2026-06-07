import { Card } from '@/components/ui';
import { displayOrPlaceholder } from '@/lib/utils';
import type { Lead } from '@/types';

interface LeadInfoProps {
  lead: Lead;
}

interface FieldItem {
  label: string;
  value: string | null | undefined;
}

export function LeadInfo({ lead }: LeadInfoProps) {
  const fields: FieldItem[] = [
    { label: 'Nome', value: lead.name },
    { label: 'Telefone', value: lead.phone },
    { label: 'Email', value: lead.email },
    { label: 'Empresa', value: lead.companyName },
    { label: 'Segmento', value: lead.segment },
    { label: 'Descrição do Negócio', value: lead.businessDescription },
    { label: 'Uso do WhatsApp', value: lead.whatsappUsage },
    { label: 'Dor Principal', value: lead.mainPain },
    { label: 'Volume Estimado', value: lead.estimatedVolume },
    { label: 'Urgência', value: lead.urgency },
    { label: 'Papel na Decisão', value: lead.decisionRole },
  ];

  return (
    <Card title="Informações do Lead">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <div key={field.label}>
            <span className="text-xs font-medium text-muted">{field.label}</span>
            <p className="text-sm text-foreground">
              {displayOrPlaceholder(field.value, 'Não informado')}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
