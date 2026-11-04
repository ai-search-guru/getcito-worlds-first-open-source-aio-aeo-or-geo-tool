'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight, Check, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  readLabel,
  type ImproveOutcome,
  type OutcomeVerdict,
  type PlatformRead,
} from '@/lib/improveOutcome';

const VERDICT_CLASS: Record<OutcomeVerdict, string> = {
  improved: 'text-emerald-600 dark:text-emerald-400',
  declined: 'text-red-600 dark:text-red-400',
  unchanged: 'text-muted-foreground',
  not_enough_data: 'text-muted-foreground',
};

const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/**
 * Did the Improve action move the prompt's positions? (PROMPT-008) The
 * prompt's 7 days before it was sent next to its latest 7 days, per platform,
 * refreshed daily by the server and fixed 30 days after completion.
 */
export function ImproveOutcomeCard({
  outcome,
  labels,
}: {
  outcome: ImproveOutcome;
  /** Platform id → name, from the action's payload. */
  labels: Record<string, string>;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.improve.outcome');

  const read = (r: PlatformRead | null) => {
    const label = readLabel(r);
    if (label.kind === 'position') return label.value;
    return t(`reads.${label.kind}`);
  };

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{t('title')}</p>
        <p className="text-xs text-muted-foreground">
          {t(outcome.final ? 'final' : 'updated', {
            date: DATE_FMT.format(new Date(outcome.measuredAt)),
          })}
        </p>
      </div>
      <p className="mt-1 text-sm font-medium">
        {t('summary', {
          improved: outcome.summary.improved,
          measurable: outcome.summary.measurable,
        })}
      </p>
      <div className="mt-2 divide-y rounded-md border">
        <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span>{t('platform')}</span>
          <span>
            {t('before')} → {t(outcome.final ? 'afterFinal' : 'after')}
          </span>
        </div>
        {outcome.platforms.map((p) => (
          <div
            key={p.platform}
            className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-xs"
          >
            <span className="truncate font-medium">{labels[p.platform] ?? p.platform}</span>
            {p.verdict === 'not_enough_data' ? (
              <span className="text-muted-foreground">{t('verdicts.not_enough_data')}</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <span className="text-muted-foreground">{read(p.before)}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{read(p.after)}</span>
                <span
                  className={cn('inline-flex items-center', VERDICT_CLASS[p.verdict])}
                  title={t(`verdicts.${p.verdict}`)}
                  aria-label={t(`verdicts.${p.verdict}`)}
                >
                  {p.verdict === 'improved' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : p.verdict === 'declined' ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}
                </span>
              </span>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t(outcome.final ? 'noteFinal' : 'note')}
      </p>
    </section>
  );
}
