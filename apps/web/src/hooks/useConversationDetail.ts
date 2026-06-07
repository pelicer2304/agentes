import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { ConversationDetail } from '@/types';

async function fetchDetail(id: string): Promise<ConversationDetail> {
  const { data } = await apiClient.get<ConversationDetail>(`/inbox/${id}`);
  return data;
}

/**
 * Loads a conversation's full chat + lead side panel (Req 16.2, 16.3). Polls
 * every 3s so incoming/outgoing messages appear in near real time.
 */
export function useConversationDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['conversation', id],
    queryFn: () => fetchDetail(id!),
    enabled: !!id,
    refetchInterval: 3000,
  });
}

type ConversationAction =
  | 'assumir'
  | 'pausar'
  | 'retomar'
  | 'converter'
  | 'perdido';

/**
 * Mutations for the conversation actions (Req 16.4): takeover, pause/resume,
 * convert/lost, and manual message send. Each refreshes the detail and inbox
 * caches on success so the UI reflects the new state immediately.
 */
export function useConversationActions(id: string | undefined) {
  const queryClient = useQueryClient();

  const invalidate = (data?: ConversationDetail) => {
    if (data) {
      queryClient.setQueryData(['conversation', id], data);
    }
    queryClient.invalidateQueries({ queryKey: ['conversation', id] });
    queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };

  const action = useMutation({
    mutationFn: async (act: ConversationAction) => {
      const { data } = await apiClient.post<ConversationDetail>(
        `/inbox/${id}/${act}`,
      );
      return data;
    },
    onSuccess: invalidate,
  });

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      const { data } = await apiClient.post<ConversationDetail>(
        `/inbox/${id}/mensagem`,
        { content },
      );
      return data;
    },
    onSuccess: invalidate,
  });

  return {
    takeover: () => action.mutate('assumir'),
    pause: () => action.mutate('pausar'),
    resume: () => action.mutate('retomar'),
    markConverted: () => action.mutate('converter'),
    markLost: () => action.mutate('perdido'),
    isActing: action.isPending,
    actionError: action.isError,
    pendingAction: action.variables ?? null,
    sendMessage: (content: string) => sendMessage.mutate(content),
    sendMessageAsync: (content: string) => sendMessage.mutateAsync(content),
    isSending: sendMessage.isPending,
    sendError: sendMessage.isError
      ? 'Não foi possível enviar a mensagem. Tente novamente.'
      : null,
    resetSend: () => sendMessage.reset(),
  };
}
