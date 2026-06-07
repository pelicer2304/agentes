import { RefreshCw, Plug, RotateCcw, Webhook } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { InstanceStatusCard } from '@/components/whatsapp/InstanceStatusCard';
import { QrCodePanel } from '@/components/whatsapp/QrCodePanel';
import { useWhatsApp } from '@/hooks/useWhatsApp';

/**
 * WhatsApp operational screen (Req 15.2–15.6): instance status, QR pairing,
 * and connect/restart/set-webhook controls.
 */
export function WhatsAppPage() {
  const {
    status,
    statusError,
    isLoading,
    isFetching,
    qr,
    qrError,
    isQrLoading,
    refreshStatus,
    connect,
    restart,
    setWebhook,
    isConnecting,
    isRestarting,
    isSettingWebhook,
    lastEvent,
    lastError,
    actionFeedback,
  } = useWhatsApp();

  const connected = status?.connected ?? false;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">WhatsApp</h1>
          <p className="mt-1 text-muted">
            Conecte e monitore a instância do WhatsApp.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refreshStatus}
          loading={isFetching}
        >
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Atualizar status
        </Button>
      </div>

      {actionFeedback && (
        <div
          className={`rounded-md border px-4 py-2 text-sm ${
            actionFeedback.type === 'success'
              ? 'border-accent/30 bg-accent-dark text-accent'
              : 'border-red-400/30 bg-red-900/20 text-red-400'
          }`}
        >
          {actionFeedback.message}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Carregando...</p>
      ) : (
        <>
          <InstanceStatusCard
            status={status}
            statusError={statusError}
            lastEvent={lastEvent}
            lastError={lastError}
          />

          <Card title="Controles">
            <div className="flex flex-wrap gap-2">
              <Button onClick={connect} loading={isConnecting}>
                <Plug className="mr-1.5 h-4 w-4" />
                {connected ? 'Reconectar' : 'Conectar'}
              </Button>
              <Button
                variant="secondary"
                onClick={restart}
                loading={isRestarting}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Reiniciar
              </Button>
              <Button
                variant="secondary"
                onClick={setWebhook}
                loading={isSettingWebhook}
              >
                <Webhook className="mr-1.5 h-4 w-4" />
                Configurar webhook
              </Button>
            </div>
          </Card>

          {/* Hide the QR entirely while connected (Req 15.4). */}
          {!connected && (
            <QrCodePanel qr={qr} qrError={qrError} isLoading={isQrLoading} />
          )}
        </>
      )}
    </div>
  );
}
