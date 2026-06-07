import { Users, Flame, Sun, Snowflake, PhoneForwarded } from 'lucide-react';
import { Card } from '@/components/ui';
import type { DashboardSummary } from '@/types';

interface SummaryCardsProps {
  summary: DashboardSummary;
}

interface CardItem {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const cards: CardItem[] = [
    {
      label: 'Total de Leads',
      value: summary.total,
      icon: <Users className="h-5 w-5 text-muted" />,
      color: 'text-foreground',
    },
    {
      label: 'Leads Quentes',
      value: summary.hot,
      icon: <Flame className="h-5 w-5 text-red-400" />,
      color: 'text-red-400',
    },
    {
      label: 'Leads Mornos',
      value: summary.warm,
      icon: <Sun className="h-5 w-5 text-yellow-400" />,
      color: 'text-yellow-400',
    },
    {
      label: 'Leads Frios',
      value: summary.cold,
      icon: <Snowflake className="h-5 w-5 text-blue-400" />,
      color: 'text-blue-400',
    },
    {
      label: 'Aguardando Humano',
      value: summary.awaitingHuman,
      icon: <PhoneForwarded className="h-5 w-5 text-accent" />,
      color: 'text-accent',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.label} className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-card">
            {card.icon}
          </div>
          <div>
            <p className="text-xs text-muted">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}
