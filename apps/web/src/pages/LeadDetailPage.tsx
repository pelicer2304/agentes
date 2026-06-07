import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, UserCheck, XCircle } from 'lucide-react';
import { Button, Badge } from '@/components/ui';
import { LeadInfo } from '@/components/leads/LeadInfo';
import { ConversationHistory } from '@/components/leads/ConversationHistory';
import { QualificationSummary } from '@/components/leads/QualificationSummary';
import { useLeadDetail, useUpdateLeadStatus } from '@/hooks/useLeadDetail';
import { formatStatus } from '@/lib/utils';
import type { Message } from '@/types';

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: lead, isLoading, error } = useLeadDetail(id);
  const updateStatus = useUpdateLeadStatus(id);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function handleStatusUpdate(status: string) {
    setFeedback(null);
    updateStatus.mutate(status, {
      onSuccess: () => {
        setFeedback({ type: 'success', message: `Status atualizado para "${formatStatus(status)}"` });
      },
      onError: () => {
        setFeedback({ type: 'error', message: 'Erro ao atualizar status. Tente novamente.' });
      },
    });
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Carregando...</p>
      </div>
    );
  }

  if (error || !lead) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-400">Erro ao carregar lead.</p>
      </div>
    );
  }

  // Get messages from the most recent conversation
  const mostRecentConversation = lead.conversations?.[0];
  const messages: Message[] = mostRecentConversation?.messages ?? [];

  // Get the most recent agent analysis
  const latestAnalysis = lead.agentAnalyses?.[0] ?? null;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Voltar ao dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{lead.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant="default">{formatStatus(lead.status)}</Badge>
              {lead.phone && (
                <span className="text-sm text-muted">{lead.phone}</span>
              )}
            </div>
          </div>
        </div>

        {/* Status action buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleStatusUpdate('chamar_humano')}
            disabled={updateStatus.isPending}
            className="border-yellow-400/30 text-yellow-400 hover:bg-yellow-900/20"
          >
            <Phone className="mr-1.5 h-4 w-4" />
            Chamar Humano
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleStatusUpdate('convertido')}
            disabled={updateStatus.isPending}
            className="border-accent/30 text-accent hover:bg-accent-dark"
          >
            <UserCheck className="mr-1.5 h-4 w-4" />
            Convertido
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => handleStatusUpdate('perdido')}
            disabled={updateStatus.isPending}
          >
            <XCircle className="mr-1.5 h-4 w-4" />
            Perdido
          </Button>
        </div>
      </div>

      {/* Feedback message */}
      {feedback && (
        <div
          className={`mb-4 rounded-md border px-4 py-2 text-sm ${
            feedback.type === 'success'
              ? 'border-accent/30 bg-accent-dark text-accent'
              : 'border-red-400/30 bg-red-900/20 text-red-400'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Content grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <LeadInfo lead={lead} />
          <ConversationHistory messages={messages} />
        </div>
        <div>
          <QualificationSummary analysis={latestAnalysis} />
        </div>
      </div>
    </div>
  );
}
