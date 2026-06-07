import { useQuery } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import apiClient from '@/api/client';
import type { LogEntry, LogsData } from '@/types';

/**
 * Empty logs payload used as a safe default while loading or when the backend
 * does not (yet) expose a logs endpoint (Req 22.2 graceful degradation).
 */
const EMPTY_LOGS: LogsData = {
  receivedMessages: [],
  evolutionErrors: [],
  duplicates: [],
  slowResponses: [],
  sendFailures: [],
};

/** Result of {@link useLogs}, including an availability flag for graceful UX. */
export interface UseLogsResult {
  data: LogsData;
  isLoading: boolean;
  /** False when the backend logs endpoint is missing (404) — render empty UI. */
  available: boolean;
  error: string | null;
  refetch: () => void;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toEntry(raw: unknown, fallbackType: string): LogEntry {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? r.externalMessageId ?? crypto.randomUUID()),
    type: String(r.type ?? r.eventType ?? fallbackType),
    phone: (r.phone as string) ?? null,
    instanceName: (r.instanceName as string) ?? null,
    content: (r.content as string) ?? (r.message as string) ?? null,
    error: (r.error as string) ?? null,
    responseMs:
      typeof r.responseMs === 'number'
        ? (r.responseMs as number)
        : typeof r.responseMs === 'string'
          ? Number(r.responseMs)
          : null,
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

/**
 * Normalizes a best-effort backend logs payload into the structured buckets the
 * Logs screen renders. Accepts either a pre-bucketed object or a flat list of
 * webhook_logs/bot_events rows, which it classifies heuristically.
 */
function normalizeLogs(payload: unknown): LogsData {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    // Pre-bucketed shape from a dedicated logs endpoint.
    if (
      'receivedMessages' in p ||
      'evolutionErrors' in p ||
      'duplicates' in p ||
      'slowResponses' in p ||
      'sendFailures' in p
    ) {
      return {
        receivedMessages: asArray(p.receivedMessages).map((e) =>
          toEntry(e, 'message_inbound_saved'),
        ),
        evolutionErrors: asArray(p.evolutionErrors).map((e) =>
          toEntry(e, 'evolution_error'),
        ),
        duplicates: asArray(p.duplicates).map((e) => toEntry(e, 'duplicate')),
        slowResponses: asArray(p.slowResponses).map((e) =>
          toEntry(e, 'slow_response'),
        ),
        sendFailures: asArray(p.sendFailures).map((e) =>
          toEntry(e, 'send_failed'),
        ),
      };
    }
  }

  // Flat list fallback: classify webhook_logs / bot_events rows into buckets.
  const rows = asArray(
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).items ??
          (payload as Record<string, unknown>).data ??
          [])
      : payload,
  ).map((e) => toEntry(e, 'event'));

  const result: LogsData = {
    receivedMessages: [],
    evolutionErrors: [],
    duplicates: [],
    slowResponses: [],
    sendFailures: [],
  };

  for (const row of rows) {
    const type = row.type;
    if (type.includes('evolution_error') || type.includes('error')) {
      result.evolutionErrors.push(row);
    } else if (type.includes('duplicate')) {
      result.duplicates.push(row);
    } else if (type.includes('send_failed') || type.includes('send_fail')) {
      result.sendFailures.push(row);
    } else if (
      type.includes('inbound') ||
      type.includes('received') ||
      type.includes('webhook')
    ) {
      result.receivedMessages.push(row);
    }
    if (typeof row.responseMs === 'number' && row.responseMs > 10000) {
      result.slowResponses.push(row);
    }
  }

  return result;
}

/**
 * Fetches operational logs (Req 22.2). Resilient by design: if the backend has
 * no dedicated logs endpoint the query resolves to empty buckets with
 * `available: false` rather than throwing.
 */
export function useLogs(): UseLogsResult {
  const query = useQuery({
    queryKey: ['logs'],
    queryFn: async (): Promise<{ data: LogsData; available: boolean }> => {
      try {
        const { data } = await apiClient.get('/logs');
        return { data: normalizeLogs(data), available: true };
      } catch (err) {
        const status = (err as AxiosError).response?.status;
        // Missing endpoint → degrade gracefully to an empty, "unavailable" state.
        if (status === 404 || status === 405) {
          return { data: EMPTY_LOGS, available: false };
        }
        throw err;
      }
    },
    refetchInterval: 15000,
  });

  return {
    data: query.data?.data ?? EMPTY_LOGS,
    isLoading: query.isLoading,
    available: query.data?.available ?? false,
    error: query.error ? 'Falha ao carregar logs' : null,
    refetch: () => query.refetch(),
  };
}
