'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import type { sentimentSplit } from '@/lib/mentionsOverview';

type Split = NonNullable<ReturnType<typeof sentimentSplit>>;

/** Each tone's colour, in both themes; neutral stays grey and is never dropped. */
const TONE_FILL = {
  positive: 'bg-emerald-500 dark:bg-emerald-400',
  neutral: 'bg-muted-foreground/30',
  negative: 'bg-red-500 dark:bg-red-400',
} as const;

const TONES = ['positive', 'neutral', 'negative'] as const;

/** The mentions' tone as one bar: positive, neutral, negative (spec §6). */
export function SentimentSplitBar({ split, className }: { split: Split; className?: string }) {
  const t = useTranslations('mentions.overview.kpi');
  const f = numberFormat(useLocale());
  return (
    <div
      role="img"
      aria-label={t('splitLabel', {
        positive: f.percent(split.positive, 0),
        neutral: f.percent(split.neutral, 0),
        negative: f.percent(split.negative, 0),
      })}
      className={cn('flex h-1.5 overflow-hidden rounded-full bg-muted', className)}
    >
      {TONES.map((tone) => (
        <span
          key={tone}
          className={cn('h-full', TONE_FILL[tone])}
          style={{ width: `${split[tone]}%` }}
        />
      ))}
    </div>
  );
}

/** The bar's legend: each tone's share, then n, the mentions behind them. */
export function SentimentLegend({ split }: { split: Split }) {
  const t = useTranslations('mentions.overview.sentiment');
  const f = numberFormat(useLocale());
  return (
    <span className="inline-flex items-center gap-2.5">
      {TONES.map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1" title={t(tone)}>
          <span aria-hidden className={cn('h-2 w-2 rounded-[2px]', TONE_FILL[tone])} />
          <span className="sr-only">{t(tone)}</span>
          {f.percent(split[tone], 0)}
        </span>
      ))}
      <span>n={f.number(split.n)}</span>
    </span>
  );
}
