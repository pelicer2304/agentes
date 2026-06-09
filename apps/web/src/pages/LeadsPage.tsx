import { useState } from 'react';
import { useLeads } from '@/hooks/useLeads';
import { LeadsTable } from '@/components/dashboard/LeadsTable';

/**
 * Listagem de todos os leads (rota /leads). O sidebar aponta pra cá; antes não
 * havia página e a tela ficava em branco. Reusa o mesmo hook/tabela do dashboard.
 */
export function LeadsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data: leadsData, isLoading } = useLeads({ page, pageSize });

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Leads</h1>
        <p className="mt-1 text-muted">Todos os leads capturados pelo agente.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <p className="text-muted">Carregando...</p>
        </div>
      ) : (
        <LeadsTable
          leads={leadsData?.data ?? []}
          currentPage={leadsData?.page ?? 1}
          totalPages={leadsData?.totalPages ?? 1}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
