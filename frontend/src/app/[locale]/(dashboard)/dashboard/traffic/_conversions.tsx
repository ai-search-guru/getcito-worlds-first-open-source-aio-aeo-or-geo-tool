'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ShoppingCart } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { conversionRate, type ConversionFigures } from '@/lib/trafficConversions';
import { googleSourceStatus } from '@/lib/trafficSources';
import type { SourceState } from '@/lib/actions/integrations';
import { type TrafficConversions, type TrafficDateWindow } from '@/lib/actions/traffic';
import { NeedsTag, SourceUnavailable } from './_SourceGate';
import { getTrafficConversions } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';

/**
 * Where AI visitors convert (AT-014, spec §3.4b): which landing pages turn
 * AI visitors into key events (or revenue, when the property reports
 * purchases), and which AI platform × topic of the tracked answers citing
 * them brings buyers. Both cards need Google Analytics: until it has data
 * the section shows its state in full (§3.8b). A short range with fewer than
 * 30 AI visits reads the last 30 days, and the header says so.
 */

const num = (n: number) => <span className="tabular-nums">{formatNumber(n)}</span>;

/** The rate, "Low sample" below 30 AI visits (§5.4), or "—" when it isn't known. */
function RateCell({ figures }: { figures: ConversionFigures }) {
  const t = useTranslations('traffic.conversions');
  const rate = conversionRate(figures);
  if (rate.kind === 'low') {
    return (
      <span
        title={t('lowSampleHint', { visits: figures.aiVisits })}
        className="whitespace-nowrap rounded-md border border-dashed px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
      >
        {t('lowSample')}
      </span>
    );
  }
  if (rate.kind === 'unknown') {
    return (
      <span className="text-muted-foreground" title={t('rateUnknown')}>
        —
      </span>
    );
  }
  return <span className="tabular-nums">{`${rate.pct.toLocaleString('en-US')}%`}</span>;
}

function ConversionCard({
  title,
  legend,
  actions,
  children,
}: {
  title: string;
  legend: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {children}
        <p className="px-6 py-3 text-xs text-muted-foreground">{legend}</p>
      </CardContent>
    </Card>
  );
}

export function ConversionsSection({
  brandId,
  dateWindow,
  rangeLabel,
  source,
  domain,
  canConnect,
  onConnected,
  pagesActions,
  answersActions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** Google Analytics' state for the brand; null while unknown. */
  source: SourceState | null;
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
  /** Each card's Excel / CSV buttons (AT-015). */
  pagesActions?: ReactNode;
  answersActions?: ReactNode;
}) {
  const t = useTranslations('traffic.conversions');
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}`;
  // The result carries the range it answers, as the Pages section does.
  const [loaded, setLoaded] = useState<{
    key: string;
    result: TrafficConversions | null;
  } | null>(null);

  const gaReady = source === null || googleSourceStatus(source) === 'connected';

  useEffect(() => {
    if (!gaReady) return;
    let cancelled = false;
    getTrafficConversions(brandId, dateWindow)
      .then((result) => {
        if (!cancelled) setLoaded({ key, result });
      })
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this section.
        console.error('Failed to load where AI visitors convert:', err);
        if (!cancelled) setLoaded({ key, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key, gaReady]);
  useRangeReady('conversions', !gaReady || loaded?.key === key);

  const current = loaded?.key === key ? loaded : null;
  const result = current?.result ?? null;
  const ranked = result?.hasRevenue ? t('rankedByRevenue') : t('rankedByKeyEvents');
  const revenueColumn = result?.hasRevenue === true;

  const body = (rows: ReactNode, empty: boolean) =>
    !current ? (
      <div className="px-6 py-4">
        <Skeleton className="h-4 w-56" />
      </div>
    ) : !result ? (
      <p className="px-6 py-4 text-sm text-muted-foreground">{t('failed')}</p>
    ) : empty ? (
      <p className="px-6 py-4 text-sm text-muted-foreground">{t('empty')}</p>
    ) : (
      rows
    );

  return (
    <section className="space-y-3" aria-labelledby="ai-conversions-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="ai-conversions-title" className="flex items-center gap-2 text-base font-semibold">
          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </h2>
        <NeedsTag provider="google-analytics" />
        <span className="text-xs text-muted-foreground">
          {ranked}
          {result?.widened && ` · ${t('widened')}`}
        </span>
        <Badge variant="outline" className="ml-auto text-xs">
          {result?.widened ? t('last30Days') : rangeLabel}
        </Badge>
      </div>

      {!gaReady && source ? (
        <Card>
          <CardContent className="p-0">
            <SourceUnavailable
              provider="google-analytics"
              state={source}
              domain={domain}
              canConnect={canConnect}
              onConnected={onConnected}
            />
          </CardContent>
        </Card>
      ) : (
        <div
          className={cn('grid grid-cols-1 gap-4 xl:grid-cols-2', !current && 'opacity-80')}
          aria-busy={!current}
        >
          <ConversionCard
            title={t('pages.title')}
            legend={t('pages.legend')}
            actions={pagesActions}
          >
            {body(
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{t('columns.page')}</TableHead>
                    <TableHead className="text-right">{t('columns.aiVisits')}</TableHead>
                    <TableHead className="text-right">{t('columns.keyEvents')}</TableHead>
                    {revenueColumn && (
                      <TableHead className="text-right">{t('columns.revenue')}</TableHead>
                    )}
                    <TableHead className="text-right">{t('columns.rate')}</TableHead>
                    <TableHead className="pr-6">{t('columns.bestPlatform')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result?.pages.map((row) => (
                    <TableRow key={row.page} className="hover:bg-muted/50">
                      <TableCell className="pl-6 max-w-[180px] xl:max-w-[240px]">
                        <span
                          className="font-mono text-xs text-muted-foreground line-clamp-1"
                          title={row.page}
                        >
                          {row.page}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm">{num(row.aiVisits)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {num(row.keyEvents)}
                      </TableCell>
                      {revenueColumn && (
                        <TableCell className="text-right text-sm">
                          {num(Math.round(row.revenue))}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-sm">
                        <RateCell figures={row} />
                      </TableCell>
                      <TableCell className="pr-6 text-sm">
                        {row.bestPlatform ? getPlatformName(row.bestPlatform) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>,
              (result?.pages.length ?? 0) === 0,
            )}
          </ConversionCard>

          <ConversionCard
            title={t('answers.title')}
            legend={t('answers.legend')}
            actions={answersActions}
          >
            {body(
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">{t('columns.platform')}</TableHead>
                    <TableHead>{t('columns.topic')}</TableHead>
                    <TableHead className="text-right">{t('columns.keyEvents')}</TableHead>
                    {revenueColumn && (
                      <TableHead className="text-right">{t('columns.revenue')}</TableHead>
                    )}
                    <TableHead className="pr-6 text-right">{t('columns.rate')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result?.answers.map((row) => (
                    <TableRow key={`${row.platform}|${row.topicId}`} className="hover:bg-muted/50">
                      <TableCell className="pl-6 text-sm">
                        {getPlatformName(row.platform)}
                      </TableCell>
                      <TableCell className="min-w-28 whitespace-normal text-sm">
                        {row.topic}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold">
                        {num(row.keyEvents)}
                      </TableCell>
                      {revenueColumn && (
                        <TableCell className="text-right text-sm">
                          {num(Math.round(row.revenue))}
                        </TableCell>
                      )}
                      <TableCell className="pr-6 text-right text-sm">
                        <RateCell figures={row} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>,
              (result?.answers.length ?? 0) === 0,
            )}
          </ConversionCard>
        </div>
      )}
    </section>
  );
}
