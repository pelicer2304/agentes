import type { ConnectResult } from '@/types';
interface QrCodePanelProps {
    qr: ConnectResult | null;
    qrError: string | null;
    isLoading: boolean;
}
/**
 * Shows the pairing QR code while the instance is disconnected (Req 15.3).
 * Fails gracefully with a status message when the QR cannot be retrieved, and
 * is hidden entirely while connected (handled by the parent — Req 15.4).
 */
export declare function QrCodePanel({ qr, qrError, isLoading }: QrCodePanelProps): import("react/jsx-runtime").JSX.Element;
export {};
