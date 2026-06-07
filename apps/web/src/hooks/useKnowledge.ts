import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { KnowledgeGrouped, KnowledgeItem } from '@/types';

interface CreateKnowledgePayload {
  category: string;
  title: string;
  content: string;
}

interface UpdateKnowledgePayload {
  category?: string;
  title?: string;
  content?: string;
  active?: boolean;
}

export function useKnowledge() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['knowledge'],
    queryFn: async (): Promise<KnowledgeGrouped> => {
      const { data } = await apiClient.get<KnowledgeGrouped>('/knowledge');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: CreateKnowledgePayload): Promise<KnowledgeItem> => {
      const { data } = await apiClient.post<KnowledgeItem>('/knowledge', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: UpdateKnowledgePayload & { id: string }): Promise<KnowledgeItem> => {
      const { data } = await apiClient.patch<KnowledgeItem>(`/knowledge/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });

  const toggleActive = (item: KnowledgeItem) => {
    updateMutation.mutate({ id: item.id, active: !item.active });
  };

  return {
    items: query.data ?? {},
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    toggleActive,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}
