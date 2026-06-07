import type { ConnectResult, InstanceStatus } from '@/types';
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
    actionFeedback: {
        type: 'success' | 'error';
        message: string;
    } | null;
    clearFeedback: () => void;
}
/**
 * Drives the WhatsApp operational screen (Req 15.2–15.6): instance status,
 * QR pairing, and connect/restart/set-webhook controls. Status polls so the
 * screen reflects connection changes without manual refresh.
 */
export declare function useWhatsApp(): UseWhatsAppResult;
