import type { LogsData } from '@/types';
/** Result of {@link useLogs}, including an availability flag for graceful UX. */
export interface UseLogsResult {
    data: LogsData;
    isLoading: boolean;
    /** False when the backend logs endpoint is missing (404) — render empty UI. */
    available: boolean;
    error: string | null;
    refetch: () => void;
}
/**
 * Fetches operational logs (Req 22.2). Resilient by design: if the backend has
 * no dedicated logs endpoint the query resolves to empty buckets with
 * `available: false` rather than throwing.
 */
export declare function useLogs(): UseLogsResult;
