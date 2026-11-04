'use client';

import type { AgentAuditSpec } from '@/components/agent/AgentChart';
import type { AuditRecommendation, CategoryScore } from '@/lib/actions/audits';
import { CATEGORY_META, ScoreGauge, pct, barColor } from '@/components/audit/AuditReport';
import { cn } from '@/lib/utils';

export function AuditResultCard({ audit }: { audit: AgentAuditSpec }) {
  // The render_audit tool schema uses z.unknown(), so narrow the types here.
  const categoryScores = audit.categoryScores as Record<string, CategoryScore>;
  const recommendations = audit.recommendations as AuditRecommendation[];

  return (
    <div className="my-3 space-y-5 rounded-lg border bg-card p-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <ScoreGauge score={audit.totalScore} />

        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-sm font-semibold">Site Audit</h3>

          <p className="break-all text-xs text-muted-foreground">{audit.url}</p>

          <p className="text-xs text-muted-foreground">
            {audit.signalsEvaluated ?? '—'} / {audit.signalsTotal ?? '—'} signals evaluated
          </p>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Category breakdown</h4>

        {CATEGORY_META.map((category) => {
          const score = categoryScores[category.key]?.score ?? null;
          const percentage = pct(score);

          return (
            <div key={category.key}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{category.label}</span>

                <span className="text-muted-foreground">
                  {percentage === null ? 'n/a' : `${percentage}/100`}
                </span>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full transition-all', barColor(score))}
                  style={{
                    width: `${percentage ?? 0}%`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Top recommendations</h4>

          <ul className="space-y-2 text-sm text-muted-foreground">
            {recommendations.slice(0, 3).map((rec, index) => (
              <li key={`${rec.signalKey}-${index}`} className="flex gap-2">
                <span>•</span>
                <span>{rec.recommendation}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
