import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { AgentSettings } from '@/types';

async function fetchSettings(): Promise<AgentSettings> {
  const { data } = await apiClient.get<AgentSettings>('/settings');
  return data;
}

async function updateSettings(
  settings: Omit<AgentSettings, 'id' | 'createdAt' | 'updatedAt'>
): Promise<AgentSettings> {
  const { data } = await apiClient.patch<AgentSettings>('/settings', settings);
  return data;
}

export interface UseSettingsReturn {
  settings: AgentSettings | undefined;
  isLoading: boolean;
  save: (
    settings: Omit<AgentSettings, 'id' | 'createdAt' | 'updatedAt'>
  ) => void;
  isSaving: boolean;
  error: string | null;
  saveError: string | null;
  saveSuccess: boolean;
  resetSaveState: () => void;
}

export function useSettings(): UseSettingsReturn {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });

  const resetSaveState = () => {
    mutation.reset();
  };

  return {
    settings: query.data,
    isLoading: query.isLoading,
    save: mutation.mutate,
    isSaving: mutation.isPending,
    error: query.error ? 'Falha ao carregar configurações' : null,
    saveError: mutation.isError ? 'Falha ao salvar configurações' : null,
    saveSuccess: mutation.isSuccess,
    resetSaveState,
  };
}
