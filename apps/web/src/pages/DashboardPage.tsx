import { useState } from 'react';
import { useDashboard } from '@/hooks/useDashboard';
import { useLeads } from '@/hooks/useLeads';
import { SummaryCards } from '@/components/dashboard/SummaryCards';
import { LeadsTable } from '@/components/dashboard/LeadsTable';
import type { DashboardSummary } from '@/types';

const emptySummary: DashboardSummary = {
  total: 0,
  hot: 0,
  warm: 0,
  cold: 0,
  awaitingHuman: 0,
};

export function DashboardPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const {
    data: summary,
    isLoading: isSummaryLoading,
  } = useDashboard();

  const {
    data: leadsData,
    isLoading: isLeadsLoading,
  } = useLeads({ page, pageSize });

  const isLoading = isSummaryLoading || isLeadsLoading;

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-muted">Visão geral dos leads e métricas.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted">Carregando...</p>
        </div>
      ) : (
        <>
          <SummaryCards summary={summary ?? emptySummary} />

          <LeadsTable
            leads={leadsData?.data ?? []}
            currentPage={leadsData?.page ?? 1}
            totalPages={leadsData?.totalPages ?? 1}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
