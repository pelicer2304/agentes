import { useQuery } from '@tanstack/react-query';
import apiClient from '@/api/client';
import type { InboxListItem } from '@/types';

async function fetchInbox(): Promise<InboxListItem[]> {
  const { data } = await apiClient.get<InboxListItem[]>('/inbox');
  return data;
}

/**
 * Lists WhatsApp conversations for the Inbox screen (Req 16.1). Polls every
 * 5s so the list reflects newly recorded messages without manual refresh
 * (Req 16.5).
 */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: fetchInbox,
    refetchInterval: 5000,
  });
}
