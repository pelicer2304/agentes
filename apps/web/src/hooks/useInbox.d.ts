import type { InboxListItem } from '@/types';
/**
 * Lists WhatsApp conversations for the Inbox screen (Req 16.1). Polls every
 * 5s so the list reflects newly recorded messages without manual refresh
 * (Req 16.5).
 */
export declare function useInbox(): import("@tanstack/react-query").UseQueryResult<NoInfer<InboxListItem[]>, Error>;
