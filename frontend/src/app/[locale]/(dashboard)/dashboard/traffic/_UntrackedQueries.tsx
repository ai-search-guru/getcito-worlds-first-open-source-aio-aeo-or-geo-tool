'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { getLocationQuota } from '@/lib/actions/prompt';
import { trackPagePrompts } from '@/lib/actions/promptSuggestions';
import { type TrafficDateWindow, type TrafficUntrackedQueries } from '@/lib/actions/traffic';
import { formatTrafficBucketDate } from './_charts';
import { getUntrackedGoogleQueries } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useTopicFirstDialog } from '@/components/prompts/TopicFirst';
import { isNoTopics } from '@/lib/topicsRequired';

/**
 * Prompt slots left on the plan: null when the plan has no cap, or it
 * couldn't be read (the server still checks each prompt).
 */
function slotsLeftOf(quota: { maxPrompts: number; used: number } | null): number | null {
  if (!quota || quota.maxPrompts === -1) return null;
  return Math.max(0, quota.maxPrompts - quota.used);
}

/**
 * Google queries you don't track yet (AT-009, spec §3.6), beside "Is AI
 * taking Google clicks?" in the Google Search Console section: the top
 * Search Console queries by clicks that no tracked prompt covers. Track adds
 * a query as a prompt; Track all adds the listed ones, as many as the plan's
 * prompt slots allow (PROMPT-012). A tracked query leaves the list.
 */
export function UntrackedQueriesCard({
  brandId,
  dateWindow,
  canTrack,
  onTracked,
  actions,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** Admins and managers add prompts; others see the list. */
  canTrack: boolean;
  /** Queries became prompts: other counts on the page read again. */
  onTracked?: () => void;
  /** The card's Excel / CSV buttons (AT-015). */
  actions?: ReactNode;
}) {
  const t = useTranslations('traffic.google.untracked');
  // A read-only workspace (plan not active): Track and Track all open the
  // upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // A brand with no topic yet: Track asks for one first.
  const topicFirst = useTopicFirstDialog();
  // Tracking reads the list again: the tracked queries leave it.
  const [reloads, setReloads] = useState(0);
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}|${reloads}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    result: TrafficUntrackedQueries | null;
  } | null>(null);
  // The prompt slots left don't depend on the range: read again only after
  // a Track.
  const quotaKey = `${brandId}|${reloads}`;
  const [quota, setQuota] = useState<{ key: string; slotsLeft: number | null } | null>(null);
  const [tracking, setTracking] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    getUntrackedGoogleQueries(brandId, dateWindow)
      .catch((err) => {
        // Best effort: the rest of the page doesn't depend on this card.
        console.error('Failed to load the untracked Google queries:', err);
        return null;
      })
      .then((result) => {
        if (!cancelled) setLoaded({ key, result });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key, reloads]);

  useEffect(() => {
    let cancelled = false;
    getLocationQuota(brandId)
      .catch(() => null)
      .then((q) => {
        if (!cancelled) setQuota({ key: quotaKey, slotsLeft: slotsLeftOf(q) });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, quotaKey]);

  useRangeReady('untrackedQueries', loaded?.key === key && quota?.key === quotaKey);
  const current = loaded?.key === key && quota?.key === quotaKey ? loaded : null;
  const result = current?.result ?? null;
  const slotsLeft = current ? (quota?.slotsLeft ?? null) : null;
  const busy = tracking.size > 0;

  const track = guard(
    async (queries: string[]) => {
      setTracking(new Set(queries));
      const outcome = await trackPagePrompts(
        brandId,
        null,
        queries.map((text) => ({ text, topic: '' })),
      ).catch((err: Error) => ({ promptIds: [] as string[], error: err.message, code: undefined }));
      setTracking(new Set());
      const tracked = outcome.promptIds.length;
      if (tracked > 0) toast.success(t('tracked', { count: tracked }));
      if (isNoTopics(outcome)) {
        topicFirst.show();
      } else if (outcome.error) {
        toast.error(
          outcome.code === 'plan_limit'
            ? t('planLimit', { count: queries.length - tracked })
            : outcome.error,
        );
      }
      if (tracked > 0) {
        setReloads((n) => n + 1);
        onTracked?.();
      }
    },
    { action: tActions('trackPrompts') },
  );

  const trackTitle = !canTrack ? t('trackNotAllowed') : slotsLeft === 0 ? t('noSlots') : undefined;
  const trackable = canTrack && slotsLeft !== 0 && !busy;
  const allCount = result ? Math.min(result.rows.length, slotsLeft ?? result.rows.length) : 0;

  const message = (text: string) => (
    <p className="px-6 py-4 text-sm text-muted-foreground">{text}</p>
  );
  const body = !current ? (
    <div className="px-6 py-4">
      <Skeleton className="h-4 w-56" />
    </div>
  ) : !result ? (
    message(t('failed'))
  ) : !result.lastDay ? (
    message(t('noData'))
  ) : result.rows.length === 0 ? (
    message(t('empty'))
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t('columns.query')}</TableHead>
          <TableHead className="text-right">{t('columns.clicks')}</TableHead>
          <TableHead className="text-right">{t('columns.impressions')}</TableHead>
          <TableHead className="pr-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row) => (
          <TableRow key={row.query} className="hover:bg-muted/50">
            <TableCell className="pl-6 max-w-[200px] xl:max-w-[280px]">
              <span className="line-clamp-1 text-sm" title={row.query}>
                {row.query}
              </span>
            </TableCell>
            <TableCell className="text-right text-sm font-semibold tabular-nums">
              {formatNumber(row.clicks)}
            </TableCell>
            <TableCell className="text-right text-sm tabular-nums">
              {formatNumber(row.impressions)}
            </TableCell>
            <TableCell className="pr-6 text-right">
              {/* A span carries the tooltip: a disabled button gets no hover. */}
              <span title={trackTitle}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  disabled={!trackable}
                  onClick={() => void track([row.query])}
                >
                  {tracking.has(row.query) && <Loader2 className="h-3 w-3 animate-spin" />}
                  {t('track')}
                </Button>
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <Card className={cn(!current && 'opacity-80')} aria-busy={!current}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
            {result?.until && (
              <span className="text-xs text-muted-foreground">
                {result.since
                  ? `${formatTrafficBucketDate(result.since)} – ${formatTrafficBucketDate(result.until)}`
                  : t('untilDay', { day: formatTrafficBucketDate(result.until) })}
              </span>
            )}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {body}
        {result && result.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-3">
            <span className="text-xs text-muted-foreground">
              {t('count', {
                shown: formatNumber(result.rows.length),
                count: `${formatNumber(result.count)}${result.capped ? '+' : ''}`,
              })}
            </span>
            <span title={trackTitle}>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={!trackable || allCount === 0}
                onClick={() => void track(result.rows.slice(0, allCount).map((r) => r.query))}
              >
                {busy && tracking.size > 1 && <Loader2 className="h-3 w-3 animate-spin" />}
                {t('trackAll', { count: allCount })}
              </Button>
            </span>
          </div>
        )}
        <p className="px-6 py-3 text-xs text-muted-foreground">
          {slotsLeft !== null
            ? `${t('legend')} ${t('slotsLeft', { count: slotsLeft })}`
            : t('legend')}
        </p>
        {topicFirst.dialog}
      </CardContent>
    </Card>
  );
}
