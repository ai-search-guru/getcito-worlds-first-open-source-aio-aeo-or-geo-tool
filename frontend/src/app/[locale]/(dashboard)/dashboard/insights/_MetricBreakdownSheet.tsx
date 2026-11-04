'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { TrendingDown, TrendingUp, Minus, AlertTriangle } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { numberFormat, type NumberFormat } from '@/lib/numberFormat';
import { LOW_SAMPLE_ANSWERS } from '@/lib/insightsSummary';
import { getInsightsBreakdown } from '@/lib/actions/tracking';
import {
  pickDriver,
  type BreakdownFilters,
  type BreakdownMetric,
  type BreakdownRow,
  type InsightsBreakdown,
} from '@/lib/insightsBreakdown';
import { sortBreakdownRowsForDisplay } from './breakdownDisplay';

/** The panel's tabs: each kind of slice it lists. */
export type BreakdownTab = 'prompts' | 'platforms' | 'topics';

const METRIC_TITLE: Record<BreakdownMetric, string> = {
  mentions: 'Mentions',
  visibility: 'Visibility',
};

const METRIC_UNIT: Record<BreakdownMetric, string> = {
  mentions: '',
  visibility: ' pts',
};

interface Props {
  brandId: string | null;
  metric: BreakdownMetric | null;
  onOpenChange: (open: boolean) => void;
  /** The window and filters the cards were loaded with, so the panel explains their numbers. */
  filters?: BreakdownFilters;
  /** The tab to open on, e.g. the one a "Why it changed" row belongs to; Prompts by default. */
  initialTab?: BreakdownTab;
}

export function MetricBreakdownSheet({
  brandId,
  metric,
  onOpenChange,
  filters,
  initialTab,
}: Props) {
  const open = Boolean(brandId && metric);
  const locale = useLocale();
  const [data, setData] = useState<InsightsBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters is passed as a fresh object each render from the parent — derive a
  // stable cache key so the fetch effect doesn't re-run needlessly.
  const filtersKey = useMemo(() => JSON.stringify(filters ?? {}), [filters]);

  useEffect(() => {
    if (!open || !brandId || !metric) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getInsightsBreakdown(brandId, metric, filters, locale)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load breakdown');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // filtersKey is the stable dependency; `filters` is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brandId, metric, filtersKey, locale]);

  const title = metric ? METRIC_TITLE[metric] : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">{title} Breakdown</SheetTitle>
          <SheetDescription className="text-xs">
            {!data
              ? 'Comparing the selected window with the previous equal-length window.'
              : data.windowDays === null
                ? 'All time. There is no earlier period of the same length to compare.'
                : `Last ${data.windowDays} day${data.windowDays !== 1 ? 's' : ''} vs previous ${data.windowDays} day${data.windowDays !== 1 ? 's' : ''}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && <BreakdownSkeleton />}

          {error && !loading && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {!loading && !error && data && metric && (
            <BreakdownBody data={data} metric={metric} initialTab={initialTab} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function BreakdownSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-8 w-60" />
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

function BreakdownBody({
  data,
  metric,
  initialTab,
}: {
  data: InsightsBreakdown;
  metric: BreakdownMetric;
  initialTab?: BreakdownTab;
}) {
  const [tab, setTab] = useState<BreakdownTab>(initialTab ?? 'prompts');
  const f = numberFormat(useLocale());
  const samePrompts = data.comparison?.basis === 'same';
  const newCount = data.comparison?.newPrompts ?? 0;

  const pickRows = () =>
    tab === 'prompts' ? data.byPrompt : tab === 'platforms' ? data.byPlatform : data.byTopic;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {data.windowDays === null ? 'All time' : `Current ${data.windowDays}d`}
            </div>
            <div className="text-2xl font-semibold tabular-nums">
              {formatValue(data.curTotal, metric, f)}
              <span className="text-sm font-normal text-muted-foreground">
                {METRIC_UNIT[metric]}
              </span>
            </div>
            {data.windowDays !== null && (
              <div className="text-xs text-muted-foreground">
                {samePrompts && data.comparison!.samePrompts === 0 ? (
                  'No prompt was answered in both periods'
                ) : samePrompts ? (
                  <>
                    Same {data.comparison!.samePrompts}{' '}
                    {data.comparison!.samePrompts === 1 ? 'prompt' : 'prompts'}:{' '}
                    <span className="tabular-nums">
                      {data.prevTotal === null ? '—' : formatValue(data.prevTotal, metric, f)} →{' '}
                      {formatValue(data.comparedCur, metric, f)}
                      {METRIC_UNIT[metric]}
                    </span>
                  </>
                ) : (
                  <>
                    vs previous{' '}
                    {data.prevTotal === null ? (
                      'no data'
                    ) : (
                      <span className="tabular-nums">
                        {formatValue(data.prevTotal, metric, f)}
                        {METRIC_UNIT[metric]}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {data.delta !== null && (
            <DeltaPill delta={data.delta} deltaPct={data.deltaPct} metric={metric} big />
          )}
        </div>
        <RootCauseSummary data={data} metric={metric} />
        {newCount > 0 && (
          <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
            {samePrompts
              ? `Not counted in the change: ${newCount} new ${newCount === 1 ? 'prompt' : 'prompts'} this period.`
              : `The change includes ${newCount} new ${newCount === 1 ? 'prompt' : 'prompts'} added this period.`}
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="w-full">
          <TabsTrigger value="prompts">
            Prompts
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {data.byPrompt.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="platforms">
            Platforms
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {data.byPlatform.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="topics">
            Topics
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">
              {data.byTopic.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-3">
          <BreakdownTable
            rows={pickRows()}
            metric={metric}
            kind={tab}
            comparable={data.windowDays !== null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RootCauseSummary({ data, metric }: { data: InsightsBreakdown; metric: BreakdownMetric }) {
  const f = numberFormat(useLocale());
  const isDrop = (data.delta ?? 0) < 0;
  const topPrompt = pickDriver(data.byPrompt, data.delta);
  const topPlatform = pickDriver(data.byPlatform, data.delta);

  if (!topPrompt) {
    return (
      <div className="mt-2 text-xs text-muted-foreground leading-relaxed">{data.rootCause}</div>
    );
  }

  return (
    <div className="mt-2 text-xs text-muted-foreground leading-relaxed">
      {isDrop ? 'Biggest drop' : 'Biggest gain'}:{' '}
      <Link
        href={`/dashboard/prompts/${topPrompt.id}`}
        className="font-medium text-foreground underline-offset-2 hover:underline"
      >
        &quot;{truncate(topPrompt.label, 60)}&quot;
      </Link>{' '}
      {formatContribution(topPrompt, metric, f)}.
      {topPlatform && (
        <>
          {' '}
          Top platform {isDrop ? 'drop' : 'gain'}: {topPlatform.label}{' '}
          {formatContribution(topPlatform, metric, f)}.
        </>
      )}
    </div>
  );
}

function BreakdownTable({
  rows,
  metric,
  kind,
  comparable,
}: {
  rows: BreakdownRow[];
  metric: BreakdownMetric;
  kind: 'prompts' | 'platforms' | 'topics';
  /** False for All time: no previous window, so no Prev or Change column. */
  comparable: boolean;
}) {
  const t = useTranslations('insights.breakdown');
  const f = numberFormat(useLocale());
  if (rows.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No data in this window yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium px-3 py-2">Name</th>
            {comparable && <th className="text-right font-medium px-2 py-2 w-16">Prev</th>}
            <th className="text-right font-medium px-2 py-2 w-16">Cur</th>
            {comparable && <th className="text-right font-medium px-2 py-2 w-24">Change</th>}
          </tr>
        </thead>
        <tbody>
          {sortBreakdownRowsForDisplay(rows).map((r) => (
            <tr key={r.id} className="border-b last:border-b-0 hover:bg-muted/30">
              <td className="px-3 py-2.5 min-w-0">
                {kind === 'prompts' ? (
                  <Link
                    href={`/dashboard/prompts/${r.id}`}
                    className="line-clamp-2 text-sm transition-colors hover:text-primary hover:underline"
                  >
                    {r.label}
                  </Link>
                ) : (
                  <div className="line-clamp-2 text-sm">{r.label}</div>
                )}
                {r.sublabel && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{r.sublabel}</div>
                )}
              </td>
              {/* A window without answers for the row is "No data", never a 0
                  to change from; a score on under 20 answers is a low sample (VIS-005). */}
              {comparable && (
                <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                  {r.prev === null ? (
                    '—'
                  ) : r.prevRuns === 0 ? (
                    <span className="whitespace-nowrap text-xs">{t('noData')}</span>
                  ) : (
                    formatValue(r.prev, metric, f)
                  )}
                </td>
              )}
              <td
                className={cn(
                  'px-2 py-2 text-right tabular-nums',
                  r.curRuns === 0 && 'text-muted-foreground',
                )}
              >
                {r.curRuns === 0 ? (
                  <span className="whitespace-nowrap text-xs">{t('noData')}</span>
                ) : (
                  formatValue(r.cur, metric, f)
                )}
              </td>
              {comparable && (
                <td className="px-2 py-2 text-right">
                  {r.prevRuns === 0 || r.curRuns === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : metric === 'visibility' &&
                    Math.min(r.prevRuns, r.curRuns) < LOW_SAMPLE_ANSWERS ? (
                    <span className="text-xs text-muted-foreground">{t('lowSample')}</span>
                  ) : (
                    <DeltaPill delta={r.delta ?? 0} deltaPct={r.deltaPct} metric={metric} />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DeltaPill({
  delta,
  deltaPct,
  metric,
  big = false,
}: {
  delta: number;
  deltaPct: number | null;
  metric: BreakdownMetric;
  big?: boolean;
}) {
  const f = numberFormat(useLocale());
  if (delta === 0) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-0.5 text-muted-foreground tabular-nums',
          big ? 'text-sm' : 'text-xs',
        )}
      >
        <Minus className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
        {f.number(0)}
      </span>
    );
  }

  const positive = delta > 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const color = positive ? 'text-green-600 dark:text-green-400' : 'text-red-500';

  // Prefer percentage display for count metrics when available; fall back to
  // absolute delta for visibility (pts) or when previous was zero.
  const showPct = metric !== 'visibility' && deltaPct !== null;
  const sign = positive ? '+' : '−';
  const primary = showPct
    ? `${sign}${f.percent(Math.abs(deltaPct))}`
    : metric === 'visibility'
      ? `${sign}${f.number(Math.abs(delta))} pts`
      : `${sign}${f.number(Math.abs(delta))}`;
  const secondary = showPct ? `${sign}${f.number(Math.abs(delta))}` : null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium tabular-nums',
        big ? 'text-sm' : 'text-xs',
        color,
      )}
    >
      <Icon className={big ? 'h-3.5 w-3.5' : 'h-3 w-3'} />
      <span>{primary}</span>
      {secondary && (
        <span className={cn('font-normal text-muted-foreground', big ? 'text-xs' : 'text-[10px]')}>
          ({secondary})
        </span>
      )}
    </span>
  );
}

function formatValue(value: number, metric: BreakdownMetric, f: NumberFormat): string {
  return f.number(metric === 'visibility' ? Math.round(value * 10) / 10 : value);
}

function formatContribution(row: BreakdownRow, metric: BreakdownMetric, f: NumberFormat): string {
  const delta = row.delta ?? 0;
  const isLoss = delta < 0;
  const abs = Math.abs(delta);

  if (metric === 'visibility') {
    const verb = isLoss ? 'dropped' : 'rose';
    return `${verb} ${f.number(Math.round(abs * 10) / 10)} pts`;
  }

  const verb = isLoss ? 'lost' : 'gained';
  const core = `${verb} ${f.number(abs)} mention${abs !== 1 ? 's' : ''}`;
  if (row.deltaPct === null) return core;
  const sign = row.deltaPct < 0 ? '−' : '+';
  return `${core} (${sign}${f.percent(Math.abs(row.deltaPct))})`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
