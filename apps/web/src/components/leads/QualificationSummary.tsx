import { Card, Badge } from '@/components/ui';
import { displayOrPlaceholder, formatScore, formatTemperature } from '@/lib/utils';
import type { AgentAnalysis } from '@/types';

interface QualificationSummaryProps {
  analysis: AgentAnalysis | null;
}

export function QualificationSummary({ analysis }: QualificationSummaryProps) {
  if (!analysis) {
    return (
      <Card title="Qualificação">
        <p className="text-sm text-muted">Nenhuma análise disponível.</p>
      </Card>
    );
  }

  const temperatureVariant = analysis.temperature === 'quente'
    ? 'danger'
    : analysis.temperature === 'morno'
      ? 'warning'
      : 'info';

  return (
    <div className="flex flex-col gap-4">
      <Card title="Qualificação">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <span className="text-xs font-medium text-muted">Score</span>
            <p className="text-sm text-foreground">{formatScore(analysis.score)}</p>
          </div>
          <div>
            <span className="text-xs font-medium text-muted">Temperatura</span>
            <div className="mt-0.5">
              {analysis.temperature ? (
                <Badge variant={temperatureVariant}>
                  {formatTemperature(analysis.temperature)}
                </Badge>
              ) : (
                <span className="text-sm text-foreground">Não informado</span>
              )}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-muted">Dor Principal</span>
            <p className="text-sm text-foreground">
              {displayOrPlaceholder(analysis.mainPain, 'Não informado')}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-muted">Serviço Recomendado</span>
            <p className="text-sm text-foreground">
              {displayOrPlaceholder(analysis.recommendedService, 'Não informado')}
            </p>
          </div>
        </div>
      </Card>

      {analysis.commercialSummary && (
        <Card title="Resumo Comercial">
          <p className="text-sm text-foreground">{analysis.commercialSummary}</p>
        </Card>
      )}

      {analysis.scoreReasons && analysis.scoreReasons.length > 0 && (
        <Card title="Razões do Score">
          <ul className="list-inside list-disc space-y-1">
            {analysis.scoreReasons.map((reason, index) => (
              <li key={index} className="text-sm text-foreground">
                {reason}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(() => {
        const objections = analysis.rawJson
          ? (analysis.rawJson as Record<string, unknown>).objections
          : null;
        if (!Array.isArray(objections) || objections.length === 0) return null;
        return (
          <Card title="Objeções">
            <ul className="list-inside list-disc space-y-1">
              {(objections as string[]).map((objection: string, index: number) => (
                <li key={index} className="text-sm text-foreground">
                  {objection}
                </li>
              ))}
            </ul>
          </Card>
        );
      })()}

      {analysis.nextBestQuestion && (
        <Card title="Próximo Passo">
          <p className="text-sm text-foreground">{analysis.nextBestQuestion}</p>
        </Card>
      )}
    </div>
  );
}
