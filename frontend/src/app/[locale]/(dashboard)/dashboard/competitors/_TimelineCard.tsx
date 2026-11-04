'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { OWN_BRAND_COLOR } from '@/lib/insightsTrend';
import { formatDate } from '@/lib/format';
import {
  COMPETITOR_COLOR,
  eventWeeks,
  type CompetitorPageEvent,
  type CompetitorTimeline,
} from '@/lib/competitorTimeline';

const CompetitorTimelineChart = dynamic(
  () => import('./_TimelineChart').then((m) => m.CompetitorTimelineChart),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full" /> },
);

/** Events listed before "Show all". */
const EVENTS_SHOWN = 8;

function EventRow({ event }: { event: CompetitorPageEvent }) {
  const t = useTranslations('competitors.timeline');
  const shown = event.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const names = (checks: { label: string }[]) => checks.map((c) => c.label).join(', ');
  const detail =
    event.kind === 'first_cited'
      ? event.answers !== null
        ? t('firstCitedAnswers', { count: event.answers })
        : null
      : [
          event.gained.length > 0 ? t('gained', { checks: names(event.gained) }) : null,
          event.lost.length > 0 ? t('lost', { checks: names(event.lost) }) : null,
        ]
          .filter(Boolean)
          .join(' · ') || t('changedWords');
  return (
    <li className="flex flex-col gap-0.5 border-b py-2 text-xs last:border-b-0 sm:flex-row sm:gap-3">
      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
        {formatDate(event.at)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">
          {t(event.kind === 'first_cited' ? 'firstCited' : 'changed')}
        </span>{' '}
        <a
          href={event.url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {shown}
          <ArrowUpRight className="ml-0.5 inline h-3 w-3" />
        </a>
        {detail && <span className="block text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );
}

/**
 * A competitor's pages over time (learning C3), under its head-to-head:
 * the answers mentioning it and the brand each week, a marker on the weeks
 * its pages were first cited or changed, and those events, newest first.
 */
export function CompetitorTimelineCard({
  timeline,
  brandName,
  competitorName,
}: {
  /** Null while it loads; 'failed' when it couldn't be read. */
  timeline: CompetitorTimeline | null | 'failed';
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors.timeline');
  const [all, setAll] = useState(false);
  const events = timeline && timeline !== 'failed' ? timeline.events : [];
  const shown = all ? events : events.slice(0, EVENTS_SHOWN);

  return (
    <Card>
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-muted-foreground" />
          {t('title', { competitor: competitorName })}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t('lead', { competitor: competitorName, brand: brandName })}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {timeline === null ? (
          <Skeleton className="h-[220px] w-full" />
        ) : timeline === 'failed' ? (
          <p role="status" className="text-xs text-muted-foreground">
            {t('loadError')}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {[
                { name: competitorName, color: COMPETITOR_COLOR },
                { name: brandName, color: OWN_BRAND_COLOR },
              ].map((line) => (
                <span key={line.name} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  {line.name}
                </span>
              ))}
            </div>
            <CompetitorTimelineChart
              weeks={timeline.weeks}
              marks={eventWeeks(timeline.events, timeline.weeks)}
              brandName={brandName}
              competitorName={competitorName}
            />
            <div>
              <p className="mb-1 text-xs font-medium">{t('events')}</p>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('noEvents', { competitor: competitorName })}
                </p>
              ) : (
                <ul>
                  {shown.map((event) => (
                    <EventRow key={`${event.kind}-${event.url}-${event.at}`} event={event} />
                  ))}
                </ul>
              )}
              {!all && events.length > EVENTS_SHOWN && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 h-7 px-2 text-xs"
                  onClick={() => setAll(true)}
                >
                  {t('showAll', { count: events.length })}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">{t('note')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
