'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  Flag,
  Globe,
  LayoutGrid,
  MousePointerClick,
  PieChart,
  Timer,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { DateRangePreset } from '@/components/filters/DateRangeFilter';
import {
  type TrafficDateWindow,
  type TrafficGoogleTotals,
  type TrafficSources,
  type TrafficSummary,
} from '@/lib/actions/traffic';
import { formatNumber } from '@/lib/format';
import { LOW_SAMPLE_VISITS, visitChange, type VisitChange } from '@/lib/trafficChange';
import {
  formatGoogleDays,
  formatPctChange,
  formatRatio,
  formatShare,
  gscLatestDays,
  isShortRange,
  organicRatio,
} from '@/lib/trafficKpis';
import { getPlatformName, isNamedPlatform } from '@/lib/trafficPlatforms';
import { googleSourceStatus, TRAFFIC_SECTION_SOURCES } from '@/lib/trafficSources';
import { MetricCard } from '../insights/_KpiCards';
import { SummaryLine } from './_SummaryLine';
import type { Change } from '../insights/kpiFormat';
import { SourceKpiCard } from './_SourceGate';
import { getTrafficGoogleTotals } from '@/lib/trafficReads';
import { useRangeReady } from './_RangeReady';

// Four in a row from 1,100px, two below (spec §3.2), one on a phone. In rem,
// so Tailwind orders it after sm: (a px breakpoint would sort before it).
export const TRAFFIC_KPI_GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 min-[68.75rem]:grid-cols-4';

type CardHead = { label: string; tooltip: string; icon: LucideIcon };
type CardBody = { value: string; delta?: Change | null; sub?: ReactNode };
type GaTotals = NonNullable<TrafficGoogleTotals['ga']>;

/** A Google card while its numbers load, or when they failed to. */
const PENDING: CardBody = { value: '—' };

/** A count's change as a card shows it: none, "new", "Low sample", or a %. */
function useChangeDelta() {
  const t = useTranslations('traffic.change');
  return (change: VisitChange): Change | null => {
    if (change.kind === 'none') return null;
    if (change.kind === 'new') return { text: t('new'), tone: 'good' };
    if (change.kind === 'low') return { text: t('lowSample'), tone: 'neutral' };
    return { text: formatPctChange(change.pct), tone: change.pct > 0 ? 'good' : 'bad' };
  };
}

/** A link-styled button inside a card's sub-line. */
function SubAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-foreground underline underline-offset-2"
    >
      {children}
    </button>
  );
}

/**
 * The AI Traffic page's KPI cards (AT-017, spec §3.2), Insights style, in
 * two rows of four:
 *
 * 1. AI-referred visits, top platform and platforms, from the tracking
 *    snippet; and AI share of traffic: those visits against every session
 *    Google Analytics recorded on the same days ("0.5% · 4 of 812 sessions").
 * 2. From Google Analytics, engaged visits and key events from AI; from
 *    Google Search Console, Google clicks. The spec's AI Overviews card waits
 *    for Google to expose that report (§10.1), so the row has three.
 *
 * A Google card whose source has no data yet shows the compact connection
 * state instead (AT-016). Comparisons with Google organic come with AT-005.
 */
export function TrafficKpis({
  brandId,
  dateWindow,
  preset,
  summary,
  summaryLoading,
  sources,
  sourcesFailed,
  canConnect,
  onConnected,
  onRangeChange,
  rangeLabel,
  queriesRevision = 0,
}: {
  brandId: string;
  dateWindow: TrafficDateWindow;
  preset: DateRangePreset;
  summary: TrafficSummary | null;
  /** The summary is still the previous range's while a new one loads. */
  summaryLoading: boolean;
  /** The Google sources' states; null while they load. */
  sources: TrafficSources | null;
  /** The states couldn't be read: try the numbers anyway, as the GA card does. */
  sourcesFailed: boolean;
  canConnect: boolean;
  onConnected: () => void;
  /** Switches the page's range, for "see 30d". */
  onRangeChange: (preset: DateRangePreset) => void;
  /** The page's own words for the range, for the summary line (AT-007). */
  rangeLabel: string;
  /** Bumped when Google queries were tracked: the summary line counts them again. */
  queriesRevision?: number;
}) {
  const t = useTranslations('traffic.kpis');
  const tVisits = useTranslations('traffic.visits');
  const tPlatforms = useTranslations('traffic.platforms');
  const delta = useChangeDelta();

  const sourceReady = (state: TrafficSources['ga'] | undefined) =>
    state ? googleSourceStatus(state) === 'connected' : sourcesFailed;
  const gaReady = sourceReady(sources?.ga);
  const gscReady = sourceReady(sources?.gsc);
  const latestDays = gscLatestDays(preset);
  const key = [brandId, dateWindow.dateFrom, dateWindow.dateTo, gaReady, gscReady, latestDays].join(
    '|',
  );
  // The loaded totals carry the request they answer, as on the GA card, so
  // no loading flag is reset inside the effect. Totals for another range
  // show as "—" until the new ones arrive, and AI share of traffic waits for
  // the summary too: it divides one range's visits by the same range's
  // sessions, and either one from the old range would give a wrong share.
  const [loaded, setLoaded] = useState<{ key: string; totals: TrafficGoogleTotals | null } | null>(
    null,
  );

  useEffect(() => {
    if (!gaReady && !gscReady) return;
    let cancelled = false;
    getTrafficGoogleTotals(brandId, dateWindow, {
      ga: gaReady,
      gsc: gscReady,
      gscLatestDays: latestDays,
    })
      .then((totals) => {
        if (!cancelled) setLoaded({ key, totals });
      })
      .catch((err) => {
        // Best effort: these cards add to the page and must not take it down.
        console.error('Failed to load the Google totals:', err);
        if (!cancelled) setLoaded({ key, totals: null });
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, dateWindow, gaReady, gscReady, latestDays, key]);
  useRangeReady('kpis', (!gaReady && !gscReady) || loaded?.key === key);

  const totalVisits = summary?.totalVisits ?? 0;
  const totalVisitsPrev = summary?.totalVisitsPrev ?? 0;
  const totalPageviews = summary?.totalPageviews ?? 0;
  const analyticsDays = summary?.analyticsDays.length ?? 0;
  // From the summary, not the selected range: while a new range loads, the
  // numbers on screen are still the previous range's.
  const comparable = summary?.hasPreviousPeriod ?? false;
  // The most visits among the platforms it can name, as the summary line and
  // the weekly e-mail pick it: a key only the public beacon sent isn't one.
  const topPlatform = summary?.platformBreakdown.find(
    (p) => p.visits > 0 && isNamedPlatform(p.platform),
  );
  // Its visits through a surface, most first, as the platform table lists them.
  const topSurface = topPlatform?.surfaces[0];
  const totals = loaded?.key === key ? loaded.totals : null;
  const ga = totals?.ga ?? null;
  const gsc = totals?.gsc ?? null;

  /** A Google card's compact state while its source has no data yet; null once it has. */
  const gate = (section: keyof typeof TRAFFIC_SECTION_SOURCES, card: CardHead) => {
    const provider = TRAFFIC_SECTION_SOURCES[section];
    const state = provider === 'google-analytics' ? sources?.ga : sources?.gsc;
    if (!state || googleSourceStatus(state) === 'connected') return null;
    return (
      <SourceKpiCard
        {...card}
        provider={provider}
        state={state}
        canConnect={canConnect}
        onConnected={onConnected}
      />
    );
  };

  /** An Analytics card's numbers: "—" while they load, and a note when the days have none. */
  const fromGa = (fill: (totals: GaTotals) => CardBody): CardBody =>
    !ga ? PENDING : ga.sessions === 0 ? { value: '—', sub: t('noRangeData') } : fill(ga);

  const aiShare = { label: t('aiShare'), tooltip: t('aiShareTip'), icon: PieChart };
  const engaged = { label: t('engaged'), tooltip: t('engagedTip'), icon: Timer };
  const keyEvents = { label: t('keyEvents'), tooltip: t('keyEventsTip'), icon: Flag };
  const clicks = {
    label: t('googleClicks'),
    tooltip: t('googleClicksTip'),
    icon: MousePointerClick,
  };

  const clicksBody = (): CardBody => {
    if (!gsc) return PENDING;
    const days = formatGoogleDays(gsc.since, gsc.until);
    return {
      value: formatNumber(gsc.clicks),
      delta: delta(
        visitChange(gsc.clicks, gsc.prevClicks ?? 0, { comparable: gsc.prevClicks !== null }),
      ),
      sub:
        // Short ranges read Google's latest reported days (§3.01).
        latestDays === 1
          ? t('latestDay', { days })
          : latestDays
            ? t('latestDays', { days })
            : gsc.prevClicks === null
              ? t('allTime')
              : t('clicksPrevious', { previous: gsc.prevClicks }),
    };
  };

  // Analytics' sessions for the summary line: undefined while they load,
  // null without Analytics, so the line never states a fact from a source
  // that isn't connected (§3.8b rule 5).
  const gaSessions = !gaReady
    ? null
    : loaded?.key === key
      ? (loaded.totals?.ga?.sessions ?? null)
      : undefined;

  return (
    <div className="space-y-3">
      <SummaryLine
        brandId={brandId}
        dateWindow={dateWindow}
        rangeLabel={rangeLabel}
        summary={summary}
        summaryLoading={summaryLoading}
        gaSessions={gaSessions}
        gscReady={sources || sourcesFailed ? gscReady : undefined}
        queriesRevision={queriesRevision}
      />
      <div className={TRAFFIC_KPI_GRID}>
        {/* One visit per session; the sub-line gives the pageviews and the
            previous period's visits (AT-003). Google Analytics reports no
            pageviews, so when it filled any day (AT-004) the line says how
            many instead of a pageview count that would cover only part of
            the range. */}
        <MetricCard
          label={t('visits')}
          tooltip={t('visitsTip')}
          icon={Users}
          value={formatNumber(totalVisits)}
          delta={delta(visitChange(totalVisits, totalVisitsPrev, { comparable }))}
          sub={
            analyticsDays > 0
              ? comparable
                ? tVisits('kpiSubAnalytics', { previous: totalVisitsPrev, days: analyticsDays })
                : tVisits('kpiSubAnalyticsNoPrevious', { days: analyticsDays })
              : comparable
                ? tVisits('kpiSub', { pageviews: totalPageviews, previous: totalVisitsPrev })
                : tVisits('kpiSubNoPrevious', { pageviews: totalPageviews })
          }
        />
        <MetricCard
          label={t('topPlatform')}
          tooltip={t('topPlatformTip')}
          icon={Globe}
          value={topPlatform ? getPlatformName(topPlatform.platform) : '—'}
          sub={
            !topPlatform
              ? t('noData')
              : topSurface
                ? // Part of the platform's visits: ChatGPT Shopping (#1283).
                  t('topPlatformSurfaceSub', {
                    visits: topPlatform.visits,
                    surfaceVisits: topSurface.visits,
                    surface: tPlatforms(`surfaceNames.${topSurface.surface}`, {
                      platform: getPlatformName(topPlatform.platform),
                    }),
                  })
                : t('topPlatformSub', { visits: topPlatform.visits })
          }
        />
        <MetricCard
          label={t('platforms')}
          tooltip={t('platformsTip')}
          icon={LayoutGrid}
          value={formatNumber(summary?.platformBreakdown.length ?? 0)}
          sub={t('platformsSub')}
        />
        {gate('aiShare', aiShare) ?? (
          <MetricCard
            {...aiShare}
            {...(summaryLoading
              ? // The visits and the sessions must be the same range's.
                PENDING
              : fromGa(({ sessions }) => ({
                  value: formatShare(totalVisits, sessions) ?? '—',
                  sub: t('aiShareSub', { visits: totalVisits, sessions }),
                })))}
          />
        )}
        {/* Row 2: what AI visitors do, and Google's own clicks. */}
        {gate('engagedVisits', engaged) ?? (
          <MetricCard
            {...engaged}
            {...fromGa(({ aiSessions, aiEngagedSessions, organic }) =>
              aiSessions === 0
                ? { value: '—', sub: t('noAiSessions') }
                : {
                    value: formatShare(aiEngagedSessions, aiSessions) ?? '—',
                    // A rate on a handful of sessions says more about chance (§5.4).
                    delta: aiSessions < LOW_SAMPLE_VISITS ? delta({ kind: 'low' }) : null,
                    // Beside Google organic's, as the mockup draws it (AT-005).
                    sub:
                      organic.sessions > 0
                        ? t('engagedVsOrganic', {
                            rate: formatShare(organic.engagedSessions, organic.sessions)!,
                          })
                        : t('engagedSub', { engaged: aiEngagedSessions, sessions: aiSessions }),
                  },
            )}
          />
        )}
        {gate('keyEvents', keyEvents) ?? (
          <MetricCard
            {...keyEvents}
            {...fromGa((totals) => {
              const { aiSessions, aiKeyEvents, aiKeyEventSessions, aiRevenue, organic } = totals;
              // Rows synced before the session key event rate have key events
              // but no count of the sessions holding them: no rate until the
              // history is re-read.
              const rateKnown = aiKeyEventSessions > 0 || aiKeyEvents === 0;
              const rate = rateKnown ? formatShare(aiKeyEventSessions, aiSessions) : null;
              const ratio = organicRatio(
                {
                  sessions: aiSessions,
                  keyEvents: aiKeyEvents,
                  keyEventSessions: aiKeyEventSessions,
                },
                organic,
              );
              // None in a short range is usual: the card offers the month (spec §3.2).
              const noneYet = aiKeyEvents === 0 && isShortRange(preset);
              return {
                value: formatNumber(aiKeyEvents),
                // With a rate on show — few sessions: it's chance (§5.4); enough
                // on both sides: against Google organic's (AT-005).
                delta:
                  noneYet || rate === null
                    ? null
                    : aiSessions < LOW_SAMPLE_VISITS
                      ? delta({ kind: 'low' })
                      : ratio === null
                        ? null
                        : {
                            text: t('vsOrganic', { ratio: formatRatio(ratio) }),
                            tone: ratio > 1.05 ? 'good' : ratio < 0.95 ? 'bad' : 'neutral',
                          },
                sub: noneYet ? (
                  <>
                    {t('keyEventsNone', { range: preset })} ·{' '}
                    <SubAction onClick={() => onRangeChange('30d')}>{t('see30d')}</SubAction>
                  </>
                ) : rate === null ? (
                  t('keyEventsSub', { sessions: aiSessions })
                ) : aiRevenue > 0 ? (
                  // Purchase revenue, when the property reports it (AT-005).
                  t('keyEventRateRevenue', { rate, revenue: formatNumber(Math.round(aiRevenue)) })
                ) : (
                  t('keyEventRate', { rate })
                ),
              };
            })}
          />
        )}
        {gate('googleClicks', clicks) ?? <MetricCard {...clicks} {...clicksBody()} />}
      </div>
    </div>
  );
}
