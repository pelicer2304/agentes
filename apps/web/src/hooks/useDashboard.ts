import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { DashboardSummary } from '@/types';

async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await apiClient.get<DashboardSummary>('/dashboard/summary');
  return data;
}

export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: fetchDashboardSummary,
  });
}
