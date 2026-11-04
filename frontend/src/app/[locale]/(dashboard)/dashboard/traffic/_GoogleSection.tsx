'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
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
import { googleSourceStatus } from '@/lib/trafficSources';
import type { SourceState } from '@/lib/actions/integrations';
import { GOOGLE_PAGES_MIN_IMPRESSIONS, ctrPct, impressionsRise } from '@/lib/trafficGooglePages';
import { type TrafficDateWindow, type TrafficGooglePages } from '@/lib/actions/traffic';
import { formatTrafficBucketDate } from './_charts';
import { PagePromptsDialog } from './_PagePromptsDialog';
import { NeedsTag, SourceUnavailable } from './_SourceGate';
import { UntrackedQueriesCard } from './_UntrackedQueries';
import { getTrafficGooglePages } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';

/** CTR as the table shows it: "3.1%". */
function ctr(clicks: number, impressions: number): string {
  return `${(ctrPct(clicks, impressions) ?? 0).toLocaleString('en-US')}%`;
}

/** "Oct 3 – Oct 17". */
function days(since: string, until: string): string {
  return `${formatTrafficBucketDate(since)} – ${formatTrafficBucketDate(until)}`;
}

/**
 * The Google Search Console section (AT-008 part B and AT-009, spec §3.6).
 * Its card "Is AI taking Google clicks?" lists the pages whose impressions rose 15% or
 * more while their CTR fell 20% or more against the period before: an AI
 * Overview may be answering in place of the click. Each page's next step is
 * the Positions panel of a tracked prompt about it, or Add prompts when
 * there is none.
 *
 * Beside it, the Google queries no tracked prompt covers yet, to track
 * (AT-009).
 *
 * Google reports about two days late, so the days compared end on the latest
 * it has reported, and the header says which (§3.01). The section needs
 * Search Console; until it has data it shows its state in full (§3.8b).
 */
export function GoogleSection({
  brandId,
  dateWindow,
  rangeLabel,
  source,
  domain,
  canConnect,
  onConnected,
  canTrack,
  onQueriesTracked,
  pagesActions,
  queriesActions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  /** Google Search Console's state for the brand; null while unknown. */
  source: SourceState | null;
  domain: string | undefined;
  canConnect: boolean;
  onConnected: () => void;
  /** Admins and managers add prompts from the untracked queries. */
  canTrack: boolean;
  /** Queries became prompts: the summary line counts them again. */
  onQueriesTracked?: () => void;
  /** Each card's Excel / CSV buttons (AT-015). */
  pagesActions?: ReactNode;
  queriesActions?: ReactNode;
}) {
  const t = useTranslations('traffic.google');
  // Tracking prompts for a page reads the list again, for its Positions link.
  const [reloads, setReloads] = useState(0);
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}|${reloads}`;
  // The result carries the range it answers, as the other sections' do.
  const [loaded, setLoaded] = useState<{ key: string; result: TrafficGooglePages | null } | null>(
    null,
  );
  // The page whose suggested prompts are open; each opening starts afresh.
  const [promptsFor, setPromptsFor] = useState<string | null>(null);
  const [promptsOpened, setPromptsOpened] = useState(0);
  // A read-only workspace (plan not active): Add prompts (its dialog asks the
  // AI as it opens) opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Suggesting prompts for a page costs AI and tracking adds prompts: admins and managers.
  const { canManage } = useUserRole();
  const tManagers = useTranslations('managersOnly');

  const gscReady = source === null || googleSourceStatus(source) === 'connected';

  useEffect(() => {
    if (!gscReady) return;
    let cancelled = false;
    getTrafficGooglePages(brandId, dateWindow)
      .then((result) => {
        if (!cancelled) setLoaded({ key, result });
      })
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this section.
        console.error('Failed to load the Google pages:', err);
        if (!cancelled) setLoaded({ key, result: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key, gscReady, reloads]);

  useRangeReady('googleSection', !gscReady || loaded?.key === key);
  const current = loaded?.key === key ? loaded : null;
  const result = current?.result ?? null;

  const message = (text: string) => (
    <p className="px-6 py-4 text-sm text-muted-foreground">{text}</p>
  );
  const body = !current ? (
    <div className="px-6 py-4">
      <Skeleton className="h-4 w-56" />
    </div>
  ) : !result ? (
    message(t('taking.failed'))
  ) : !result.lastDay ? (
    message(t('taking.noPages'))
  ) : !result.since ? (
    message(t('taking.allTime'))
  ) : result.incomplete ? (
    message(t('taking.incomplete'))
  ) : result.rows.length === 0 ? (
    message(t('taking.empty'))
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t('taking.columns.page')}</TableHead>
          <TableHead className="text-right">{t('taking.columns.impressions')}</TableHead>
          <TableHead className="text-right">{t('taking.columns.ctr')}</TableHead>
          <TableHead className="pr-6 text-right">{t('taking.columns.next')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row) => (
          <TableRow key={row.page} className="hover:bg-muted/50">
            <TableCell className="pl-6 max-w-[180px] xl:max-w-[320px]">
              <span
                className="font-mono text-xs text-muted-foreground line-clamp-1"
                title={row.url}
              >
                {row.page}
              </span>
            </TableCell>
            <TableCell
              className="text-right text-sm tabular-nums"
              title={t('taking.impressionsTip', {
                prev: formatNumber(row.prevImpressions),
                now: formatNumber(row.impressions),
              })}
            >
              {`+${formatNumber(impressionsRise(row))}%`}
            </TableCell>
            <TableCell
              className="text-right text-sm tabular-nums text-red-600 dark:text-red-400"
              title={t('taking.ctrTip', {
                prev: formatNumber(row.prevClicks),
                now: formatNumber(row.clicks),
              })}
            >
              {`${ctr(row.prevClicks, row.prevImpressions)} → ${ctr(row.clicks, row.impressions)}`}
            </TableCell>
            <TableCell className="pr-6 text-right">
              {row.promptId ? (
                <Link
                  href={`/dashboard/prompts?positions=${row.promptId}`}
                  title={t('taking.positionsTip')}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
                >
                  {t('taking.positions')}
                </Link>
              ) : !canManage ? (
                <span className="text-xs text-muted-foreground">{tManagers('addPrompts')}</span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  title={t('taking.addPromptsTip')}
                  onClick={guard(
                    () => {
                      setPromptsFor(row.page);
                      setPromptsOpened((n) => n + 1);
                    },
                    { action: tActions('suggestPrompts') },
                  )}
                >
                  {t('taking.addPrompts')}
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <section className="space-y-3" aria-labelledby="google-search-console-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          id="google-search-console-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          <Search className="h-4 w-4 text-muted-foreground" />
          {t('title')}
        </h2>
        <NeedsTag provider="google-search-console" />
        <span className="text-xs text-muted-foreground">
          {t('subtitle')}
          {result?.lastDay &&
            ` · ${t('dataUntil', { day: formatTrafficBucketDate(result.lastDay) })}`}
        </span>
        <Badge variant="outline" className="ml-auto text-xs">
          {rangeLabel}
        </Badge>
      </div>

      {!gscReady && source ? (
        <Card>
          <CardContent className="p-0">
            <SourceUnavailable
              provider="google-search-console"
              state={source}
              domain={domain}
              canConnect={canConnect}
              onConnected={onConnected}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className={cn(!current && 'opacity-80')} aria-busy={!current}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <CardTitle className="text-sm font-medium">{t('taking.title')}</CardTitle>
                  {result?.since && result.until && result.prevSince && result.prevUntil && (
                    <span className="text-xs text-muted-foreground">
                      {t('taking.compared', {
                        days: days(result.since, result.until),
                        prevDays: days(result.prevSince, result.prevUntil),
                      })}
                    </span>
                  )}
                </div>
                {pagesActions}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {body}
              {result && result.count > result.rows.length && (
                <p className="px-6 pt-3 text-xs text-muted-foreground">
                  {t('taking.more', {
                    shown: formatNumber(result.rows.length),
                    count: formatNumber(result.count),
                  })}
                </p>
              )}
              <p className="px-6 py-3 text-xs text-muted-foreground">
                {t('taking.legend', { min: formatNumber(GOOGLE_PAGES_MIN_IMPRESSIONS) })}
              </p>
            </CardContent>
          </Card>
          <UntrackedQueriesCard
            brandId={brandId}
            dateWindow={dateWindow}
            canTrack={canTrack}
            onTracked={onQueriesTracked}
            actions={queriesActions}
          />
        </div>
      )}

      <PagePromptsDialog
        key={promptsOpened}
        brandId={brandId}
        dateWindow={dateWindow}
        domain={domain}
        page={promptsFor}
        onClose={() => setPromptsFor(null)}
        onTracked={() => setReloads((n) => n + 1)}
      />
    </section>
  );
}
