import { useState, useEffect } from 'react';
import { Button, Input, Textarea, Card } from '@/components/ui';
import { DynamicList } from './DynamicList';
import type { AgentSettings } from '@/types';

export interface AgentSettingsFormProps {
  settings: AgentSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: boolean;
  onSave: (data: Omit<AgentSettings, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onResetSaveState: () => void;
}

interface FormErrors {
  agentName?: string;
  initialMessage?: string;
}

export function AgentSettingsForm({
  settings,
  isLoading,
  isSaving,
  saveError,
  saveSuccess,
  onSave,
  onResetSaveState,
}: AgentSettingsFormProps) {
  const [agentName, setAgentName] = useState('');
  const [initialMessage, setInitialMessage] = useState('');
  const [toneOfVoice, setToneOfVoice] = useState('');
  const [services, setServices] = useState<string[]>([]);
  const [doNotPromise, setDoNotPromise] = useState<string[]>([]);
  const [handoffCriteria, setHandoffCriteria] = useState<string[]>([]);
  const [errors, setErrors] = useState<FormErrors>({});

  // Populate form when settings load
  useEffect(() => {
    if (settings) {
      setAgentName(settings.agentName || '');
      setInitialMessage(settings.initialMessage || '');
      setToneOfVoice(settings.toneOfVoice || '');
      setServices(settings.services || []);
      setDoNotPromise(settings.doNotPromise || []);
      setHandoffCriteria(settings.handoffCriteria || []);
    }
  }, [settings]);

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!agentName.trim()) {
      newErrors.agentName = 'Nome do agente é obrigatório';
    }
    if (!initialMessage.trim()) {
      newErrors.initialMessage = 'Mensagem inicial é obrigatória';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onResetSaveState();

    if (!validate()) return;

    onSave({
      agentName: agentName.trim(),
      initialMessage: initialMessage.trim(),
      toneOfVoice: toneOfVoice.trim() || null,
      services: services.length > 0 ? services : null,
      doNotPromise: doNotPromise.length > 0 ? doNotPromise : null,
      handoffCriteria: handoffCriteria.length > 0 ? handoffCriteria : null,
    });
  };

  if (isLoading) {
    return (
      <Card className="animate-pulse">
        <div className="space-y-4">
          <div className="h-4 w-1/3 rounded bg-border" />
          <div className="h-10 rounded bg-border" />
          <div className="h-4 w-1/3 rounded bg-border" />
          <div className="h-20 rounded bg-border" />
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Identidade do Agente
        </h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Nome do Agente *
            </label>
            <Input
              value={agentName}
              onChange={(e) => {
                setAgentName(e.target.value);
                if (errors.agentName) setErrors((prev) => ({ ...prev, agentName: undefined }));
              }}
              placeholder="Ex: Assistente Decodifica"
              maxLength={100}
              error={errors.agentName}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Mensagem Inicial *
            </label>
            <Textarea
              value={initialMessage}
              onChange={(e) => {
                setInitialMessage(e.target.value);
                if (errors.initialMessage)
                  setErrors((prev) => ({ ...prev, initialMessage: undefined }));
              }}
              placeholder="Mensagem de abertura enviada ao iniciar uma conversa"
              maxLength={500}
              rows={3}
              error={errors.initialMessage}
            />
            <p className="mt-1 text-xs text-muted">
              {initialMessage.length}/500 caracteres
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">
              Tom de Voz
            </label>
            <Textarea
              value={toneOfVoice}
              onChange={(e) => setToneOfVoice(e.target.value)}
              placeholder="Descreva o tom de voz desejado para o agente"
              maxLength={300}
              rows={2}
            />
            <p className="mt-1 text-xs text-muted">
              {toneOfVoice.length}/300 caracteres
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Serviços Oferecidos
        </h3>
        <DynamicList
          label="Lista de serviços"
          items={services}
          maxItems={20}
          maxItemLength={200}
          onChange={setServices}
        />
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Regras - Não Prometer
        </h3>
        <DynamicList
          label="O que o agente não deve prometer"
          items={doNotPromise}
          maxItems={20}
          maxItemLength={200}
          onChange={setDoNotPromise}
        />
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-foreground">
          Critérios de Handoff
        </h3>
        <DynamicList
          label="Quando encaminhar para humano"
          items={handoffCriteria}
          maxItems={10}
          maxItemLength={200}
          onChange={setHandoffCriteria}
        />
      </Card>

      {/* Feedback messages */}
      {saveSuccess && (
        <p className="text-sm text-green-400">
          Configurações salvas com sucesso
        </p>
      )}
      {saveError && (
        <p className="text-sm text-red-400">{saveError}</p>
      )}

      <Button type="submit" loading={isSaving} size="lg" className="w-full">
        Salvar configurações
      </Button>
    </form>
  );
}
