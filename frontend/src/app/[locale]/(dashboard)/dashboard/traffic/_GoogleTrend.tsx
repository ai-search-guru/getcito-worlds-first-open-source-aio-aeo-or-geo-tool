'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatTrafficBucketDate, GoogleTrendChart } from './_charts';
import { googleTrend, googleTrendDays } from '@/lib/trafficGoogleTrend';
import { type TrafficGoogleTrend, type TrafficTrendPoint } from '@/lib/actions/traffic';
import { getTrafficGoogleTrend } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';

/** Search Console's part when it isn't connected: no clicks, no days. */
const NO_GOOGLE = { clicks: [], firstDay: null, lastDay: null };

/**
 * The AI Referral Trend card's "vs Google clicks" view (AT-008, spec §3.3):
 * the page's AI visits against Google organic clicks, each indexed to 100,
 * with markers on the days actions entered the Action Center and prompts
 * were added.
 *
 * Google reports by day, so the 24-hour range offers the last 7 days rather
 * than reading a window of its own. Without Search Console the view keeps
 * the AI line and says what the Google line needs (§3.8b's partial note).
 */
export function GoogleTrendView({
  brandId,
  trend,
  rangeStart,
  gscConnected,
  onShowWeek,
}: {
  brandId: string;
  /** The page's trend for the range, by day or, for 24 hours, by hour. */
  trend: TrafficTrendPoint[];
  /** When the range starts; none for all time. */
  rangeStart?: string;
  /** Search Console has data for the brand; null while its state loads. */
  gscConnected: boolean | null;
  /** Switches the page to the last 7 days. */
  onShowWeek: () => void;
}) {
  const t = useTranslations('traffic.trend.google');
  const days = useMemo(() => googleTrendDays(trend, rangeStart), [trend, rangeStart]);
  const since = days?.[0];
  const until = days?.[days.length - 1];
  const key = `${brandId}|${since ?? ''}|${until ?? ''}`;
  // The loaded data carries the request it answers, so a new range never
  // draws the previous one's Google line.
  const [loaded, setLoaded] = useState<{ key: string; data: TrafficGoogleTrend | null } | null>(
    null,
  );

  useEffect(() => {
    if (!since || !until) return;
    let cancelled = false;
    getTrafficGoogleTrend(brandId, since, until)
      .then((data) => {
        if (!cancelled) setLoaded({ key, data });
      })
      .catch((err) => {
        // Best effort: the view still draws the AI line.
        console.error('Failed to load the Google trend:', err);
        if (!cancelled) setLoaded({ key, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, since, until, key]);
  useRangeReady('googleTrend', !since || !until || loaded?.key === key);

  if (days === null) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-3 text-center">
        <p className="max-w-[380px] text-sm text-muted-foreground">{t('daily')}</p>
        <Button variant="outline" size="sm" onClick={onShowWeek}>
          {t('showWeek')}
        </Button>
      </div>
    );
  }

  if (!days.length) return null;
  const current = loaded?.key === key ? loaded : null;
  if (!current || gscConnected === null) return <Skeleton className="h-[220px] w-full" />;

  const data = current.data ?? { ...NO_GOOGLE, markers: [] };
  const view = googleTrend(trend, gscConnected ? data : { ...data, ...NO_GOOGLE }, days);
  const status = !gscConnected
    ? t('needsGsc')
    : current.data === null
      ? t('failed')
      : !view.hasGoogle
        ? t('noClicks')
        : view.googleUntil
          ? t('until', { day: formatTrafficBucketDate(view.googleUntil) })
          : null;

  return (
    <div className="space-y-2">
      <GoogleTrendChart points={view.points} googleUntil={view.googleUntil} />
      <div className="space-y-0.5 text-xs text-muted-foreground">
        {status && <p>{status}</p>}
        <p>{t('legend')}</p>
        {view.points.some((p) => p.actions > 0 || p.prompts > 0) && <p>{t('markers')}</p>}
      </div>
    </div>
  );
}
