'use client';

import { useTranslations } from 'next-intl';
import type { TrafficEngagement } from '@/lib/actions/traffic';
import { formatNumber } from '@/lib/format';
import { LOW_SAMPLE_VISITS } from '@/lib/trafficChange';
import { formatShare } from '@/lib/trafficKpis';
import { cn } from '@/lib/utils';

/**
 * Referrals by Platform's Google Analytics columns (AT-005, spec §3.4): what
 * each platform's visitors did. Engagement and key events are rates and
 * counts of Analytics' own sessions, so they read Analytics alone, whichever
 * origin counted the platform's visits; a platform Analytics never saw
 * shows "—".
 */

const NONE = <span className="text-muted-foreground">—</span>;

/** The share of the platform's sessions Analytics counts as engaged. */
export function EngagedCell({ analytics }: { analytics: TrafficEngagement | null }) {
  const t = useTranslations('traffic.platforms');
  const share = analytics ? formatShare(analytics.engagedSessions, analytics.sessions) : null;
  if (!analytics || share === null) return NONE;
  // A rate on a handful of sessions says more about chance (§5.4): shown,
  // but muted, with the session count on hover.
  const low = analytics.sessions < LOW_SAMPLE_VISITS;
  return (
    <span
      className={cn('tabular-nums', low && 'text-muted-foreground')}
      title={low ? t('lowSample', { sessions: analytics.sessions }) : undefined}
    >
      {share}
    </span>
  );
}

/** The key events Analytics recorded in the platform's sessions. */
export function KeyEventsCell({ analytics }: { analytics: TrafficEngagement | null }) {
  if (!analytics) return NONE;
  return <span className="tabular-nums">{formatNumber(analytics.keyEvents)}</span>;
}

/** Under the table while Analytics has no data for the brand (§3.8b's partial note). */
export function PlatformValueNote() {
  const t = useTranslations('traffic.platforms');
  return <p className="px-6 py-3 text-xs text-muted-foreground">{t('needsAnalytics')}</p>;
}
