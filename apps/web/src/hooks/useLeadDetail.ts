import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { Lead, Conversation, AgentAnalysis } from '@/types';

export interface LeadDetail extends Lead {
  conversations: (Conversation & { messages: Array<{ id: string; conversationId: string; role: 'user' | 'assistant' | 'system'; direction: string; content: string; metadata: Record<string, unknown> | null; createdAt: string }> })[];
  agentAnalyses: AgentAnalysis[];
}

async function fetchLeadDetail(id: string): Promise<LeadDetail> {
  const { data } = await apiClient.get<LeadDetail>(`/leads/${id}`);
  return data;
}

async function updateLeadStatus(id: string, status: string): Promise<Lead> {
  const { data } = await apiClient.patch<Lead>(`/leads/${id}/status`, { status });
  return data;
}

export function useLeadDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => fetchLeadDetail(id!),
    enabled: !!id,
  });
}

export function useUpdateLeadStatus(id: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: string) => updateLeadStatus(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
}
