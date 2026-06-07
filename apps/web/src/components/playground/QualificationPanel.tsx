import {
  Thermometer,
  Target,
  Brain,
  AlertTriangle,
  Briefcase,
  Clock,
  BarChart3,
  PhoneForwarded,
  FileText,
  HelpCircle,
  ShieldAlert,
  TrendingUp,
  Layers,
} from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import { formatScore, formatTemperature, formatStatus, displayOrPlaceholder } from '@/lib/utils';
import type { QualificationData } from '@/types';

export interface QualificationPanelProps {
  qualification: QualificationData | null;
}

/**
 * Returns the Badge variant for a given temperature value.
 */
function getTemperatureBadgeVariant(
  temperature: string | null | undefined
): 'info' | 'warning' | 'success' {
  switch (temperature) {
    case 'frio':
      return 'info';
    case 'morno':
      return 'warning';
    case 'quente':
      return 'success';
    default:
      return 'info';
  }
}

/**
 * Maps stage values to display labels.
 */
function formatStage(stage: string | null | undefined): string {
  if (!stage) return '—';
  const map: Record<string, string> = {
    abertura: 'Abertura',
    descoberta: 'Descoberta',
    diagnostico: 'Diagnóstico',
    explicacao_solucao: 'Explicação da Solução',
    tratamento_objecao: 'Tratamento de Objeção',
    conversao: 'Conversão',
    handoff_humano: 'Handoff Humano',
  };
  return map[stage] ?? stage;
}

/**
 * QualificationPanel displays real-time lead qualification data
 * in a scrollable right column of the Playground page.
 *
 * - When qualification is null (no messages yet), shows placeholder text.
 * - Retains previous values when new response has null fields (handled by parent via state merging).
 * - Shows a prominent handoff badge when shouldHandoff is true.
 * - Updates immediately when API response arrives (no page reload).
 */
export function QualificationPanel({ qualification }: QualificationPanelProps) {
  if (!qualification) {
    return (
      <Card className="flex h-full items-center justify-center">
        <p className="text-sm text-muted">Aguardando primeira mensagem...</p>
      </Card>
    );
  }

  const {
    stage,
    leadScore,
    temperature,
    status,
    detectedSegment,
    detectedIntent,
    mainPain,
    recommendedService,
    urgency,
    estimatedVolume,
    shouldHandoff,
    handoffReason,
    commercialSummary,
    nextBestQuestion,
    scoreReasons,
    objections,
  } = qualification;

  const scoreValue = leadScore ?? 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Qualificação</h2>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Score with progress bar */}
        <section aria-label="Score">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium text-muted">Score</span>
            </div>
            <span className="text-lg font-bold text-foreground">
              {formatScore(leadScore)}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${scoreValue}%` }}
              role="progressbar"
              aria-valuenow={scoreValue}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Score: ${scoreValue} de 100`}
            />
          </div>
        </section>

        {/* Temperature */}
        <section aria-label="Temperatura">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Thermometer className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium text-muted">Temperatura</span>
            </div>
            <Badge variant={getTemperatureBadgeVariant(temperature)}>
              {formatTemperature(temperature)}
            </Badge>
          </div>
        </section>

        {/* Status */}
        <section aria-label="Status">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium text-muted">Status</span>
            </div>
            <Badge variant="default">{formatStatus(status)}</Badge>
          </div>
        </section>

        {/* Stage */}
        <section aria-label="Etapa">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted" />
              <span className="text-xs font-medium text-muted">Etapa</span>
            </div>
            <span className="text-sm text-foreground">{formatStage(stage)}</span>
          </div>
        </section>

        {/* Handoff Badge - prominent when shouldHandoff is true */}
        {shouldHandoff && (
          <section aria-label="Chamar Humano">
            <div className="flex items-center gap-2 rounded-md border border-red-400/30 bg-red-900/30 px-3 py-2">
              <PhoneForwarded className="h-4 w-4 text-red-400" />
              <Badge variant="danger">Chamar Humano</Badge>
            </div>
            {handoffReason && (
              <p className="mt-1 text-xs text-muted">{handoffReason}</p>
            )}
          </section>
        )}

        {/* Nicho detectado (segment) */}
        <section aria-label="Nicho detectado">
          <div className="flex items-start gap-2">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Nicho detectado</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(detectedSegment)}
              </p>
            </div>
          </div>
        </section>

        {/* Intenção (intent) */}
        <section aria-label="Intenção">
          <div className="flex items-start gap-2">
            <Brain className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Intenção</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(detectedIntent)}
              </p>
            </div>
          </div>
        </section>

        {/* Dor principal (main pain) */}
        <section aria-label="Dor principal">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Dor principal</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(mainPain)}
              </p>
            </div>
          </div>
        </section>

        {/* Serviço recomendado */}
        <section aria-label="Serviço recomendado">
          <div className="flex items-start gap-2">
            <Briefcase className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Serviço recomendado</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(recommendedService)}
              </p>
            </div>
          </div>
        </section>

        {/* Urgência */}
        <section aria-label="Urgência">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Urgência</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(urgency)}
              </p>
            </div>
          </div>
        </section>

        {/* Volume estimado */}
        <section aria-label="Volume estimado">
          <div className="flex items-start gap-2">
            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div>
              <span className="text-xs font-medium text-muted">Volume estimado</span>
              <p className="text-sm text-foreground">
                {displayOrPlaceholder(estimatedVolume)}
              </p>
            </div>
          </div>
        </section>

        {/* Handoff info (when not triggered, show status) */}
        {!shouldHandoff && (
          <section aria-label="Handoff">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PhoneForwarded className="h-4 w-4 text-muted" />
                <span className="text-xs font-medium text-muted">Handoff</span>
              </div>
              <Badge variant="default">Não necessário</Badge>
            </div>
          </section>
        )}

        {/* Commercial summary in a card */}
        <section aria-label="Resumo comercial">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span className="text-xs font-medium text-muted">Resumo comercial</span>
          </div>
          <div className="mt-1 rounded-md border border-border bg-background p-3">
            <p className="text-sm text-foreground">
              {displayOrPlaceholder(commercialSummary, 'Não identificado')}
            </p>
          </div>
        </section>

        {/* Next question highlighted */}
        <section aria-label="Próxima pergunta sugerida">
          <div className="flex items-start gap-2">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <span className="text-xs font-medium text-muted">Próxima pergunta sugerida</span>
          </div>
          <div className="mt-1 rounded-md border border-accent/30 bg-accent-dark px-3 py-2">
            <p className="text-sm font-medium text-accent">
              {displayOrPlaceholder(nextBestQuestion, 'Não identificado')}
            </p>
          </div>
        </section>

        {/* Score Reasons as a list */}
        <section aria-label="Razões do score">
          <div className="flex items-start gap-2">
            <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div className="w-full">
              <span className="text-xs font-medium text-muted">Razões do score</span>
              {scoreReasons && scoreReasons.length > 0 ? (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {scoreReasons.map((reason, index) => (
                    <li key={index} className="text-sm text-foreground">
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground">Nenhuma razão registrada</p>
              )}
            </div>
          </div>
        </section>

        {/* Objeções identificadas (list) */}
        <section aria-label="Objeções identificadas">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <div className="w-full">
              <span className="text-xs font-medium text-muted">Objeções identificadas</span>
              {objections && objections.length > 0 ? (
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {objections.map((objection, index) => (
                    <li key={index} className="text-sm text-foreground">
                      {objection}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground">Nenhuma objeção identificada</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </Card>
  );
}
