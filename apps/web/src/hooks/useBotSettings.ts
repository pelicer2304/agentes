import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { BotSettings, UpdateBotSettingsInput } from '@/types';

async function fetchBotSettings(): Promise<BotSettings> {
  const { data } = await apiClient.get<BotSettings>('/bot/settings');
  return data;
}

async function updateBotSettings(
  input: UpdateBotSettingsInput,
): Promise<BotSettings> {
  const { data } = await apiClient.put<BotSettings>('/bot/settings', input);
  return data;
}

export interface UseBotSettingsResult {
  settings: BotSettings | undefined;
  isLoading: boolean;
  error: string | null;
  save: (input: UpdateBotSettingsInput) => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  resetSaveState: () => void;
}

/**
 * Loads and persists Bot settings (Req 17.1, 17.5). Auto-reply is read-only
 * (env-based); only Pricing_Config fields are editable via PUT /bot/settings.
 */
export function useBotSettings(): UseBotSettingsResult {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['bot-settings'],
    queryFn: fetchBotSettings,
  });

  const mutation = useMutation({
    mutationFn: updateBotSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['bot-settings'], data);
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    error: query.error ? 'Falha ao carregar configurações do bot' : null,
    save: mutation.mutate,
    isSaving: mutation.isPending,
    saveError: mutation.isError ? 'Falha ao salvar configurações' : null,
    saveSuccess: mutation.isSuccess,
    resetSaveState: () => mutation.reset(),
  };
}
