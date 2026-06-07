import { Card } from '@/components/ui';
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
export function QrCodePanel({ qr, qrError, isLoading }: QrCodePanelProps) {
  const base64 = qr?.qrCodeBase64 ?? null;
  const src = base64
    ? base64.startsWith('data:')
      ? base64
      : `data:image/png;base64,${base64}`
    : null;

  return (
    <Card title="Pareamento (QR Code)">
      <div className="flex flex-col items-center gap-3 py-2">
        {isLoading && (
          <p className="text-sm text-muted">Carregando QR code...</p>
        )}

        {!isLoading && src && (
          <>
            <img
              src={src}
              alt="QR code para parear o WhatsApp"
              className="h-56 w-56 rounded-md border border-border bg-white p-2"
            />
            <p className="text-center text-sm text-muted">
              Escaneie o QR code no WhatsApp do número que deseja conectar.
            </p>
          </>
        )}

        {!isLoading && !src && qr?.pairingCode && (
          <div className="text-center">
            <p className="text-sm text-muted">Código de pareamento:</p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground">
              {qr.pairingCode}
            </p>
          </div>
        )}

        {!isLoading && !src && !qr?.pairingCode && (
          <p className="text-center text-sm text-yellow-400">
            {qrError ??
              'QR code indisponível no momento. Tente conectar/reconectar a instância e atualizar o status.'}
          </p>
        )}
      </div>
    </Card>
  );
}
