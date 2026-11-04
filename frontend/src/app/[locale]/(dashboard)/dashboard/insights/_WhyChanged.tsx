'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import { LOW_SAMPLE_ANSWERS } from '@/lib/insightsSummary';
import type { Driver, DriverKind, WhyChanged as WhyChangedData } from '@/lib/insightsDrivers';
import { signedChange, TONE_TEXT } from './kpiFormat';
import type { BreakdownTab } from './_MetricBreakdownSheet';

const TAB_OF: Record<DriverKind, BreakdownTab> = {
  platform: 'platforms',
  topic: 'topics',
  prompt: 'prompts',
};

/** "Oct 12", or "Sep 29 – Oct 12" when the prompts were added over several days. */
function addedOn(first: string | null, last: string | null, locale: string): string | null {
  const day = (ts: string) =>
    new Date(ts).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  if (!first || !last) return first ? day(first) : last ? day(last) : null;
  return day(first) === day(last) ? day(last) : `${day(first)} – ${day(last)}`;
}

/**
 * "Why it changed" (VIS-009), as in the v2 mockup: the platforms, topics and
 * prompts that moved Visibility most, each with its own score before → after
 * and its effect on the overall score, and the prompts added this period.
 * A row, or "Full breakdown", opens the breakdown panel.
 */
export function WhyChanged({
  data,
  onOpenBreakdown,
  className,
}: {
  data: WhyChangedData;
  onOpenBreakdown: (tab?: BreakdownTab) => void;
  className?: string;
}) {
  const t = useTranslations('insights.whyChanged');
  const locale = useLocale();
  const f = numberFormat(locale);
  const date = addedOn(data.newPrompts.firstAdded, data.newPrompts.lastAdded, locale);

  const nameOf = (d: Driver) =>
    d.name ?? (d.kind === 'topic' ? t('uncategorized') : t('deletedPrompt'));

  const section = (label: string, drivers: Driver[]) =>
    drivers.length > 0 && (
      <div className="space-y-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        <ul className="space-y-0.5">
          {drivers.map((d) => {
            const name = nameOf(d);
            return (
              <li key={`${d.kind}:${d.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenBreakdown(TAB_OF[d.kind])}
                  title={t('open', { name })}
                  className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="w-[58px] shrink-0 rounded bg-muted py-0.5 text-center text-[10.5px] font-medium text-muted-foreground">
                    {t(`kind.${d.kind}`)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]" title={name}>
                    {name}
                  </span>
                  {/* A slice's own score on a handful of answers says little (VIS-005). */}
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {Math.min(d.answers.prev, d.answers.cur) < LOW_SAMPLE_ANSWERS
                      ? t('rowLowSample')
                      : t('range', { prev: f.number(d.prev, 1), cur: f.number(d.cur, 1) })}
                  </span>
                  <span
                    className={cn(
                      'w-11 shrink-0 text-right text-[12.5px] font-semibold tabular-nums',
                      TONE_TEXT[d.impact > 0 ? 'good' : 'bad'],
                    )}
                  >
                    {signedChange(d.impact, locale)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
          <button
            type="button"
            onClick={() => onOpenBreakdown()}
            className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('fullBreakdown')}
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {data.status === 'lowSample' ? (
          <p className="text-sm text-muted-foreground">
            {t('lowSample', {
              cur: f.number(data.answers.cur),
              prev: f.number(data.answers.prev),
            })}
          </p>
        ) : data.gains.length === 0 && data.drops.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('steady')}</p>
        ) : (
          <>
            {section(t('gains'), data.gains)}
            {section(t('drops'), data.drops)}
          </>
        )}
        {data.newPrompts.count > 0 && (
          <p className="mt-auto rounded-lg border border-dashed px-2.5 py-2 text-xs text-muted-foreground">
            {t(data.samePrompts ? 'newExcluded' : 'newIncluded', {
              count: data.newPrompts.count,
              hasDate: date ? 'yes' : 'no',
              date: date ?? '',
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
