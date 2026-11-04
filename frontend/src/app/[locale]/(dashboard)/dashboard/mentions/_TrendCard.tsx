'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { mentionTrend, type MentionsOverview } from '@/lib/mentionsOverview';
import type { TrendMetric } from './_TrendChart';

const MentionTrendChart = dynamic(() => import('./_TrendChart').then((m) => m.MentionTrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[220px] w-full" />,
});

const METRICS: TrendMetric[] = ['mentions', 'rate', 'net'];

/**
 * "Mentions & sentiment over time" (MS-06): Mentions, Mention rate or Net
 * sentiment per day. The 24h view is read from the answers, not whole days,
 * so it has no trend to draw.
 */
export function TrendCard({
  overview,
  className,
}: {
  overview: MentionsOverview;
  className?: string;
}) {
  const t = useTranslations('mentions.overview.trend');
  const [metric, setMetric] = useState<TrendMetric>('mentions');
  const days = mentionTrend(overview);
  const drawable = overview.window.source === 'days' && days.length >= 2;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1">
          <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
          <AskAboutThis reference={{ type: 'chart', id: 'mentions-trend', label: t('title') }} />
        </div>
        {drawable && (
          <div
            className="flex overflow-hidden rounded-md border"
            role="group"
            aria-label={t('metricLabel')}
          >
            {METRICS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  metric === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-foreground hover:bg-muted',
                )}
              >
                {t(m)}
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {drawable ? (
          <MentionTrendChart days={days} metric={metric} />
        ) : (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            {t('tooShort')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
