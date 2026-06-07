import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { PaginatedLeads } from '@/types';

interface UseLeadsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  temperature?: string;
}

async function fetchLeads(params: UseLeadsParams): Promise<PaginatedLeads> {
  const { page = 1, pageSize = 20, status, temperature } = params;
  const { data } = await apiClient.get<PaginatedLeads>('/leads', {
    params: {
      page,
      pageSize,
      ...(status && { status }),
      ...(temperature && { temperature }),
    },
  });
  return data;
}

export function useLeads(params: UseLeadsParams = {}) {
  const { page = 1, pageSize = 20, status, temperature } = params;

  return useQuery({
    queryKey: ['leads', { page, pageSize, status, temperature }],
    queryFn: () => fetchLeads({ page, pageSize, status, temperature }),
  });
}
