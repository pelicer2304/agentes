import { Card, Badge } from '@/components/ui';
import { PricingConfigForm } from '@/components/bot/PricingConfigForm';
import { useBotSettings } from '@/hooks/useBotSettings';

/**
 * Bot screen (Req 17.1, 17.5): read-only auto-reply toggle plus editable
 * Pricing_Config.
 */
export function BotPage() {
  const {
    settings,
    isLoading,
    error,
    save,
    isSaving,
    saveError,
    saveSuccess,
  } = useBotSettings();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Bot</h1>
        <p className="mt-1 text-muted">
          Resposta automática e configuração de preço.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Carregando configurações...</p>
      ) : error || !settings ? (
        <p className="text-sm text-red-400">
          Falha ao carregar as configurações do bot.
        </p>
      ) : (
        <>
          <Card title="Resposta automática">
            <div className="flex items-center gap-3">
              <Badge variant={settings.autoReplyEnabled ? 'success' : 'warning'}>
                {settings.autoReplyEnabled ? 'Ativada' : 'Desativada'}
              </Badge>
              {!settings.autoReplyEditable && (
                <span className="text-xs text-muted">
                  Definida por variável de ambiente (somente leitura).
                </span>
              )}
            </div>
          </Card>

          <PricingConfigForm
            settings={settings}
            onSave={save}
            isSaving={isSaving}
            saveError={saveError}
            saveSuccess={saveSuccess}
          />
        </>
      )}
    </div>
  );
}
