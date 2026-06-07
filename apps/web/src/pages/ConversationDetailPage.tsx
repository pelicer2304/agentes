import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  UserCheck,
  Pause,
  Play,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { ChatThread } from '@/components/inbox/ChatThread';
import { LeadSidePanel } from '@/components/inbox/LeadSidePanel';
import { ManualMessageInput } from '@/components/inbox/ManualMessageInput';
import {
  useConversationDetail,
  useConversationActions,
} from '@/hooks/useConversationDetail';

/**
 * Conversation detail screen (Req 16.2, 16.3, 16.4). Polls every 3s and exposes
 * the takeover/pause/resume/convert/lost actions plus a manual send field.
 */
export function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useConversationDetail(id);
  const actions = useConversationActions(id);

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Carregando conversa...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Erro ao carregar a conversa.</p>
      </div>
    );
  }

  const { lead, messages, actions: caps, botPaused } = data;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => navigate('/conversas')}
          className="text-muted transition-colors hover:text-foreground"
          aria-label="Voltar para conversas"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{lead.name}</h1>
          <p className="text-sm text-muted">{lead.phone}</p>
        </div>
      </div>

      {/* Actions (Req 16.4) */}
      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={actions.takeover}
            disabled={!caps.canTakeover || actions.isActing}
          >
            <UserCheck className="mr-1.5 h-4 w-4" />
            Assumir atendimento
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={actions.pause}
            disabled={!caps.canPause || actions.isActing}
          >
            <Pause className="mr-1.5 h-4 w-4" />
            Pausar bot
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={actions.resume}
            disabled={!caps.canResume || actions.isActing}
          >
            <Play className="mr-1.5 h-4 w-4" />
            Retomar bot
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={actions.markConverted}
            disabled={!caps.canMarkConverted || actions.isActing}
            className="border-accent/30 text-accent hover:bg-accent-dark"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            Marcar convertido
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={actions.markLost}
            disabled={!caps.canMarkLost || actions.isActing}
          >
            <XCircle className="mr-1.5 h-4 w-4" />
            Marcar perdido
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          Bot atualmente: {botPaused ? 'pausado' : 'ativo'}
        </p>
        {actions.actionError && (
          <p className="mt-2 text-sm text-red-400">
            Não foi possível concluir a ação. Tente novamente.
          </p>
        )}
      </Card>

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ChatThread messages={messages} />
          <Card title="Enviar mensagem manual">
            <ManualMessageInput
              onSend={actions.sendMessageAsync}
              isSending={actions.isSending}
              error={actions.sendError}
              disabled={!caps.canSendManual}
            />
          </Card>
        </div>
        <div>
          <LeadSidePanel lead={lead} />
        </div>
      </div>
    </div>
  );
}
