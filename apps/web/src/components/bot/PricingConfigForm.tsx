import { useEffect, useState } from 'react';
import { Button, Card, Input, Textarea } from '@/components/ui';
import type { BotSettings, UpdateBotSettingsInput } from '@/types';

interface PricingConfigFormProps {
  settings: BotSettings;
  onSave: (input: UpdateBotSettingsInput) => void;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
}

/**
 * Edit form for Pricing_Config (Req 17.1, 17.5): pricingRangeEnabled,
 * pricingStartingAt, and pricingText.
 */
export function PricingConfigForm({
  settings,
  onSave,
  isSaving,
  saveError,
  saveSuccess,
}: PricingConfigFormProps) {
  const [rangeEnabled, setRangeEnabled] = useState(
    settings.pricingRangeEnabled,
  );
  const [startingAt, setStartingAt] = useState(String(settings.pricingStartingAt));
  const [text, setText] = useState(settings.pricingText);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Re-sync local state whenever the persisted settings change.
  useEffect(() => {
    setRangeEnabled(settings.pricingRangeEnabled);
    setStartingAt(String(settings.pricingStartingAt));
    setText(settings.pricingText);
  }, [settings]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError(null);

    const parsed = Number(startingAt);
    if (Number.isNaN(parsed) || parsed < 0) {
      setValidationError('Valor inicial deve ser um número maior ou igual a 0.');
      return;
    }

    onSave({
      pricingRangeEnabled: rangeEnabled,
      pricingStartingAt: parsed,
      pricingText: text,
    });
  }

  return (
    <Card title="Configuração de preço">
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={rangeEnabled}
            onChange={(e) => setRangeEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Habilitar faixa de preço nas respostas
        </label>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Valor inicial (R$)
          </label>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={startingAt}
            onChange={(e) => setStartingAt(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            Exibido como {settings.pricingStartingAtText}
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-foreground">
            Texto de preço
          </label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={5000}
          />
        </div>

        {validationError && (
          <p className="text-sm text-red-400">{validationError}</p>
        )}
        {saveError && <p className="text-sm text-red-400">{saveError}</p>}
        {saveSuccess && !saveError && (
          <p className="text-sm text-accent">Configuração salva.</p>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={isSaving}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}
