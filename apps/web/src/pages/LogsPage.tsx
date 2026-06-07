import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui';
import { LogSection } from '@/components/logs/LogSection';
import { useLogs } from '@/hooks/useLogs';

/**
 * Logs screen (Req 22.2): last received messages, last Evolution errors,
 * ignored duplicates, responses over 10s, and send failures. Degrades
 * gracefully when no backend logs endpoint is available.
 */
export function LogsPage() {
  const { data, isLoading, available, error, refetch } = useLogs();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Logs</h1>
          <p className="mt-1 text-muted">
            Monitoramento de mensagens e erros de produção.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={refetch}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Carregando logs...</p>
      ) : error ? (
        <p className="text-sm text-red-400">Falha ao carregar os logs.</p>
      ) : (
        <>
          {!available && (
            <p className="rounded-md border border-yellow-400/30 bg-yellow-900/20 px-4 py-2 text-sm text-yellow-400">
              Endpoint de logs ainda não disponível no servidor. Exibindo estado
              vazio.
            </p>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LogSection
              title="Últimas mensagens recebidas"
              entries={data.receivedMessages}
              emphasis="content"
            />
            <LogSection
              title="Últimos erros Evolution"
              entries={data.evolutionErrors}
              emphasis="error"
            />
            <LogSection
              title="Duplicadas ignoradas"
              entries={data.duplicates}
              emphasis="content"
            />
            <LogSection
              title="Respostas acima de 10s"
              entries={data.slowResponses}
              emphasis="responseMs"
            />
            <LogSection
              title="Falhas de envio"
              entries={data.sendFailures}
              emphasis="error"
            />
          </div>
        </>
      )}
    </div>
  );
}
