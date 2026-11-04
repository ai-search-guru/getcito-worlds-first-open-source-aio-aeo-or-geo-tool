'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { summaryLine } from '@/lib/trafficSummaryLine';
import { type TrafficDateWindow, type TrafficSummary } from '@/lib/actions/traffic';
import { getTrafficPageCounts, getUntrackedQueryCount } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';

/**
 * The summary line above the KPI cards (AT-007, spec §3.1): the range's
 * visits, their share of all traffic and change, the top and best-converting
 * platforms, the pages answers cite that nobody clicks, and the Google
 * queries no prompt tracks (AT-009), in one or two sentences with a fixed
 * template. Analytics' and Search Console's facts appear only while they are
 * connected (§3.8b rule 5); the line waits for every number it states, so it
 * never changes under the reader.
 */
export function SummaryLine({
  brandId,
  dateWindow,
  rangeLabel,
  summary,
  summaryLoading,
  gaSessions,
  gscReady,
  queriesRevision = 0,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  /** The page's own words for the range, e.g. "last 7 days". */
  rangeLabel: string;
  summary: TrafficSummary | null;
  /** The summary is still the previous range's while a new one loads. */
  summaryLoading: boolean;
  /**
   * Every session Analytics recorded on the range's days: null when it isn't
   * connected or couldn't be read, undefined while it loads.
   */
  gaSessions: number | null | undefined;
  /** Search Console has data for the brand; undefined while its state loads. */
  gscReady: boolean | undefined;
  /** Bumped when Google queries were tracked from the page: counts them again. */
  queriesRevision?: number;
}) {
  const t = useTranslations('traffic.summaryLine');
  const key = `${brandId}|${dateWindow.dateFrom ?? ''}|${dateWindow.dateTo ?? ''}`;
  // The Cited, not clicked count for the range (AT-006), as the Pages tab counts it.
  const [cited, setCited] = useState<{ key: string; count: number | null } | null>(null);

  // Google queries no prompt tracks (AT-009), when Search Console is connected.
  const untrackedKey = `${key}|${queriesRevision}`;
  const [untracked, setUntracked] = useState<{
    key: string;
    count: number | null;
    capped: boolean;
  } | null>(null);

  useEffect(() => {
    if (!gscReady) return;
    let cancelled = false;
    // The count the Google section's list read carries, when it's on the page.
    getUntrackedQueryCount(brandId, dateWindow)
      .then((queries) => {
        if (!cancelled) {
          setUntracked({ key: untrackedKey, count: queries.count, capped: queries.capped });
        }
      })
      .catch(() => {
        // Best effort, as the cited count.
        if (!cancelled) setUntracked({ key: untrackedKey, count: null, capped: false });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, untrackedKey, gscReady]);

  useEffect(() => {
    let cancelled = false;
    // The Pages card's read carries every tab's count: shared with it.
    getTrafficPageCounts(brandId, dateWindow)
      .then((counts) => {
        if (!cancelled) setCited({ key, count: counts.citedNotClicked });
      })
      .catch(() => {
        // Best effort: the line still states what else it knows.
        if (!cancelled) setCited({ key, count: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, key]);

  useRangeReady(
    'summaryLine',
    cited?.key === key && (!gscReady || untracked?.key === untrackedKey),
  );

  const citedNow = cited?.key === key ? cited : null;
  const untrackedNow = gscReady ? (untracked?.key === untrackedKey ? untracked : null) : undefined;
  if (
    !summary ||
    summaryLoading ||
    gaSessions === undefined ||
    gscReady === undefined ||
    !citedNow ||
    untrackedNow === null
  ) {
    return <Skeleton className="h-4 w-2/3" />;
  }

  const line = summaryLine({
    totalVisits: summary.totalVisits,
    totalVisitsPrev: summary.totalVisitsPrev,
    hasPreviousPeriod: summary.hasPreviousPeriod,
    platforms: summary.platformBreakdown,
    gaSessions,
    citedNotClicked: citedNow.count,
    untrackedQueries: untrackedNow?.count ?? null,
  });
  const range = rangeLabel.charAt(0).toUpperCase() + rangeLabel.slice(1);

  const sentences: string[] = [];
  if (line.visits === 0) {
    sentences.push(t('none', { range }));
  } else {
    const first = [t('visits', { range, count: line.visits })];
    if (line.share) first.push(t('share', { share: line.share }));
    if (line.change !== null) {
      first.push(t(line.change > 0 ? 'up' : 'down', { pct: formatNumber(Math.abs(line.change)) }));
    }
    sentences.push(`${first.join(', ')}.`);

    const best = line.best;
    const rate = best ? `${best.rate.toLocaleString('en-US')}%` : '';
    if (line.top && best && best.platform === line.top.platform) {
      sentences.push(
        t('topAndBest', {
          platform: getPlatformName(line.top.platform),
          count: formatNumber(line.top.visits),
          rate,
        }),
      );
    } else {
      const second: string[] = [];
      if (line.top) {
        second.push(
          t('top', {
            platform: getPlatformName(line.top.platform),
            count: formatNumber(line.top.visits),
          }),
        );
      }
      if (best) second.push(t('best', { platform: getPlatformName(best.platform), rate }));
      if (second.length) sentences.push(`${second.join('; ')}.`);
    }
  }
  if (line.citedNotClicked > 0) sentences.push(t('cited', { count: line.citedNotClicked }));
  if (line.untrackedQueries > 0) {
    sentences.push(
      t('untracked', {
        count: line.untrackedQueries,
        shown: `${formatNumber(line.untrackedQueries)}${untrackedNow?.capped ? '+' : ''}`,
      }),
    );
  }

  return <p className="text-sm text-muted-foreground">{sentences.join(' ')}</p>;
}
