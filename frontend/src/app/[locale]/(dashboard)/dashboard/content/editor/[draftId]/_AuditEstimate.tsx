'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingDots } from '@/components/ui/loading-dots';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { CATEGORY_META } from '@/components/audit/AuditReport';
import {
  AI_CHECKS,
  readAuditEstimate,
  type AiVerdict,
  type AuditEstimate,
} from '@/lib/content/auditEstimate';
import { BAND_BAR_CLASSES, BAND_TEXT_CLASSES, qualityBand } from '@/lib/content/quality';
import { cn } from '@/lib/utils';

/** How long after the page settles the estimate is read again: a pause, not each keystroke. */
export const ESTIMATE_DELAY_MS = 1_000;

export interface AuditEstimateState {
  /** The latest estimate; null before the first one lands, or when none could be read. */
  estimate: AuditEstimate | null;
  /** The estimate is of the page as it reads now. */
  settled: boolean;
  /** The last reading failed: it's tried again as the page changes. */
  failed: boolean;
  /** When the AI checks were read, while their verdicts are in the score. */
  aiAt: number | null;
  estimatingAi: boolean;
  /** Reads the AI checks too, on the AI usage; a toast says why when it can't. */
  estimateAi: () => void;
}

/**
 * The draft's Site Audit estimate (customer priorities item 9): read again
 * a second after the page settles (`document`, the page as it goes out),
 * for free. Estimate AI checks reads the AI checks too, on the workspace's
 * AI usage; their verdicts stay in the score as the page changes.
 */
export function useAuditEstimate(
  draftId: string,
  brandId: string,
  document: string,
): AuditEstimateState {
  const t = useTranslations('contentEditor.editor.auditEstimate');
  const { refresh: refreshAiUsage } = useAiUsage();
  const [read, setRead] = useState<{
    document: string;
    estimate: AuditEstimate | null;
    failed: boolean;
  } | null>(null);
  const [ai, setAi] = useState<{ verdicts: AiVerdict[]; at: number } | null>(null);
  const [estimatingAi, setEstimatingAi] = useState(false);
  // The verdicts a reading sends back: the latest, without reading again when they land.
  const verdicts = useRef<AiVerdict[] | undefined>(undefined);
  useEffect(() => {
    verdicts.current = ai?.verdicts;
  }, [ai]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void readAuditEstimate(draftId, brandId, document, { verdicts: verdicts.current }).then(
        (result) => {
          if (!live) return;
          setRead((last) =>
            'error' in result
              ? { document, estimate: last?.estimate ?? null, failed: true }
              : { document, estimate: result.estimate, failed: false },
          );
        },
      );
    }, ESTIMATE_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draftId, brandId, document]);

  const estimateAi = useCallback(() => {
    setEstimatingAi(true);
    void readAuditEstimate(draftId, brandId, document, { ai: true }).then((result) => {
      setEstimatingAi(false);
      if ('error' in result) {
        toast.error(t(`errors.${result.error}`));
        return;
      }
      setRead({ document, estimate: result.estimate, failed: false });
      if (result.verdicts) setAi({ verdicts: result.verdicts, at: Date.now() });
      // The header's meter shows what they used.
      refreshAiUsage();
    });
  }, [draftId, brandId, document, refreshAiUsage, t]);

  return {
    estimate: read?.estimate ?? null,
    settled: read?.document === document,
    failed: read?.failed ?? false,
    aiAt: ai && (read?.estimate?.checks.ai ?? 0) > 0 ? ai.at : null,
    estimatingAi,
    estimateAi,
  };
}

/**
 * Site Audit estimate (customer priorities item 9): about where the page
 * would score in Site Audit, its categories as the audit's report shows
 * them, what it rests on, and Estimate AI checks with what it takes of the
 * month's AI usage. In Quality, and from the header's chip.
 */
export function AuditEstimateCard({
  state,
  className,
}: {
  state: AuditEstimateState;
  className?: string;
}) {
  const t = useTranslations('contentEditor.editor.auditEstimate');
  const format = useFormatter();
  const { usage } = useAiUsage();
  const { estimate, aiAt, estimatingAi, estimateAi } = state;
  const score = estimate?.score ?? null;
  const share = usage && !usage.unlimited ? usage.estimates?.auditAiChecks : undefined;
  const checks = estimate ? estimate.checks.page + estimate.checks.site : 0;

  return (
    <div
      data-slot="audit-estimate"
      className={cn('space-y-2.5 rounded-xl border bg-card p-3', className)}
    >
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{t('title')}</p>
        <span className="rounded-full border px-1.5 text-[11px] text-muted-foreground">
          {t('free')}
        </span>
        <span
          className={cn(
            'ml-auto text-lg font-semibold tabular-nums',
            score === null ? 'text-muted-foreground' : BAND_TEXT_CLASSES[qualityBand(score)],
          )}
        >
          {score === null ? state.failed ? '—' : <LoadingDots /> : t('score', { score })}
        </span>
      </div>
      {estimate ? (
        <>
          <p className="text-xs text-muted-foreground">
            {estimate.checks.site > 0
              ? t('note', { count: checks })
              : t('noteNoSite', { count: checks })}{' '}
            {aiAt !== null
              ? t('noteAi', { time: format.dateTime(aiAt, { hour: 'numeric', minute: '2-digit' }) })
              : t('noteAiMissing', { count: AI_CHECKS })}
          </p>
          <ul className="space-y-1.5">
            {CATEGORY_META.map((cat) => {
              const value = estimate.categories[cat.key] ?? null;
              return (
                <li key={cat.key} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-muted-foreground">
                    {t(`categories.${cat.key}`)}
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      // Red only for what blocks (editor UX review 2026-11-03):
                      // a low category is amber, as Quality's scores are.
                      className={cn(
                        'block h-full rounded-full',
                        value === null ? 'bg-muted' : BAND_BAR_CLASSES[qualityBand(value)],
                      )}
                      style={{ width: `${value ?? 0}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                    {value === null ? t('na') : t('outOf', { score: value })}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
            <Button
              variant="outline"
              size="sm"
              disabled={estimatingAi}
              onClick={estimateAi}
              className="gap-2"
            >
              {estimatingAi && <LoadingDots />}
              {estimatingAi
                ? t('estimating')
                : aiAt !== null
                  ? t('estimateAiAgain')
                  : t('estimateAi')}
            </Button>
            {share !== undefined && usage && (
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                {t(share >= 1 ? 'usage' : 'usageSmall', {
                  estimate: `${Math.round(share)}%`,
                  trial: usage.trial ? 'yes' : 'no',
                })}
              </span>
            )}
          </div>
        </>
      ) : (
        state.failed && <p className="text-xs text-muted-foreground">{t('failed')}</p>
      )}
    </div>
  );
}
