import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import apiClient from '@/api/client';
import type {
  ConnectResult,
  EvolutionResult,
  InstanceStatus,
} from '@/types';

/**
 * Extracts a user-facing error string from an Evolution result or a thrown
 * Axios error, never exposing technical internals (Req 14.3, 15.3).
 */
function resultError<T>(result: EvolutionResult<T>): string | null {
  return result.ok ? null : result.error;
}

async function fetchStatus(): Promise<EvolutionResult<InstanceStatus>> {
  const { data } = await apiClient.get<EvolutionResult<InstanceStatus>>(
    '/channels/evolution/status',
  );
  return data;
}

/**
 * Best-effort QR retrieval (Req 15.3). The backend may expose connect/qr under
 * different paths or not at all; any failure resolves to a graceful error
 * result rather than throwing, so the screen can show a status message.
 */
async function fetchQr(): Promise<EvolutionResult<ConnectResult>> {
  const candidates = ['/channels/evolution/connect', '/channels/evolution/qr'];
  let lastError = 'Não foi possível obter o QR code.';
  for (const path of candidates) {
    try {
      const { data } = await apiClient.get<EvolutionResult<ConnectResult>>(path);
      return data;
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status && status !== 404 && status !== 405) {
        lastError = 'Falha ao recuperar o QR code do WhatsApp.';
      }
    }
  }
  return { ok: false, error: lastError };
}

async function postAction(
  path: string,
): Promise<EvolutionResult<unknown>> {
  try {
    const { data } = await apiClient.post<EvolutionResult<unknown>>(path);
    return data ?? { ok: true, data: null };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404 || status === 405) {
      return {
        ok: false,
        error: 'Operação não disponível no servidor.',
      };
    }
    return {
      ok: false,
      error: 'Falha ao comunicar com o serviço do WhatsApp.',
    };
  }
}

export interface UseWhatsAppResult {
  status: InstanceStatus | null;
  statusError: string | null;
  isLoading: boolean;
  isFetching: boolean;
  qr: ConnectResult | null;
  qrError: string | null;
  isQrLoading: boolean;
  refreshStatus: () => void;
  connect: () => void;
  restart: () => void;
  setWebhook: () => void;
  isConnecting: boolean;
  isRestarting: boolean;
  isSettingWebhook: boolean;
  lastEvent: string | null;
  lastError: string | null;
  actionFeedback: { type: 'success' | 'error'; message: string } | null;
  clearFeedback: () => void;
}

/**
 * Drives the WhatsApp operational screen (Req 15.2–15.6): instance status,
 * QR pairing, and connect/restart/set-webhook controls. Status polls so the
 * screen reflects connection changes without manual refresh.
 */
export function useWhatsApp(): UseWhatsAppResult {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['whatsapp', 'status'],
    queryFn: fetchStatus,
    refetchInterval: 10000,
  });

  const status =
    statusQuery.data && statusQuery.data.ok ? statusQuery.data.data : null;
  const connected = status?.connected ?? false;
  const statusError = statusQuery.data ? resultError(statusQuery.data) : null;

  // Only fetch the QR while the instance is not connected (Req 15.4).
  const qrQuery = useQuery({
    queryKey: ['whatsapp', 'qr'],
    queryFn: fetchQr,
    enabled: !!statusQuery.data && !connected,
    refetchInterval: connected ? false : 15000,
  });

  const qr = qrQuery.data && qrQuery.data.ok ? qrQuery.data.data : null;
  const qrError =
    !connected && qrQuery.data ? resultError(qrQuery.data) : null;

  const connectMutation = useMutation({
    mutationFn: () => postAction('/channels/evolution/connect'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'qr'] });
    },
  });

  const restartMutation = useMutation({
    mutationFn: () => postAction('/channels/evolution/restart'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'status'] });
    },
  });

  const webhookMutation = useMutation({
    mutationFn: () => postAction('/channels/evolution/set-webhook'),
  });

  // Derive "last event" and "last Evolution error" (Req 15.6) from the most
  // recent action/status outcomes.
  const lastError =
    statusError ??
    (connectMutation.data && !connectMutation.data.ok
      ? connectMutation.data.error
      : null) ??
    (restartMutation.data && !restartMutation.data.ok
      ? restartMutation.data.error
      : null) ??
    (webhookMutation.data && !webhookMutation.data.ok
      ? webhookMutation.data.error
      : null) ??
    qrError;

  const lastEvent = pickLastEvent(
    connectMutation.data,
    restartMutation.data,
    webhookMutation.data,
    status,
  );

  const actionFeedback = pickFeedback(
    connectMutation,
    restartMutation,
    webhookMutation,
  );

  return {
    status,
    statusError,
    isLoading: statusQuery.isLoading,
    isFetching: statusQuery.isFetching,
    qr,
    qrError,
    isQrLoading: qrQuery.isLoading,
    refreshStatus: () => {
      statusQuery.refetch();
      if (!connected) qrQuery.refetch();
    },
    connect: () => connectMutation.mutate(),
    restart: () => restartMutation.mutate(),
    setWebhook: () => webhookMutation.mutate(),
    isConnecting: connectMutation.isPending,
    isRestarting: restartMutation.isPending,
    isSettingWebhook: webhookMutation.isPending,
    lastEvent,
    lastError,
    actionFeedback,
    clearFeedback: () => {
      connectMutation.reset();
      restartMutation.reset();
      webhookMutation.reset();
    },
  };
}

function pickLastEvent(
  connect: EvolutionResult<unknown> | undefined,
  restart: EvolutionResult<unknown> | undefined,
  webhook: EvolutionResult<unknown> | undefined,
  status: InstanceStatus | null,
): string | null {
  if (webhook?.ok) return 'Webhook configurado com sucesso';
  if (restart?.ok) return 'Reinício da instância solicitado';
  if (connect?.ok) return 'Conexão/reconexão solicitada';
  if (status) return `Status consultado: ${status.state}`;
  return null;
}

function pickFeedback(
  connect: { data?: EvolutionResult<unknown>; isSuccess: boolean },
  restart: { data?: EvolutionResult<unknown>; isSuccess: boolean },
  webhook: { data?: EvolutionResult<unknown>; isSuccess: boolean },
): { type: 'success' | 'error'; message: string } | null {
  const entries: Array<{
    data?: EvolutionResult<unknown>;
    ok: string;
  }> = [
    { data: webhook.data, ok: 'Webhook configurado com sucesso.' },
    { data: restart.data, ok: 'Instância reiniciada.' },
    { data: connect.data, ok: 'Solicitação de conexão enviada.' },
  ];

  for (const entry of entries) {
    if (!entry.data) continue;
    if (entry.data.ok) {
      return { type: 'success', message: entry.ok };
    }
    return { type: 'error', message: entry.data.error };
  }
  return null;
}
