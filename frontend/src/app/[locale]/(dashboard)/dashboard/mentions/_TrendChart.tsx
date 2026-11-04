'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Area, AreaChart, CartesianGrid, ReferenceLine, Tooltip, XAxis, YAxis } from 'recharts';
import { numberFormat } from '@/lib/numberFormat';
import { LOW_SAMPLE_MENTIONS, type MentionTrendDay } from '@/lib/mentionsOverview';
import { dayLabel, signedValue } from '../insights/kpiFormat';

export type TrendMetric = 'mentions' | 'rate' | 'net';

// Measured with a ResizeObserver (same approach as insights/_charts.tsx).
function ChartContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width)}
    </div>
  );
}

const HEIGHT = 220;
// Ink, the theme's primary: black on light, near-white on dark.
const STROKE = 'var(--primary)';

/**
 * The Overview's trend (MS-06): one metric per day over the window. A day
 * without responses has no rate and a day without mentions no net sentiment;
 * the line joins over them. Each point's tooltip gives its n, marked "Low
 * sample" under 20.
 */
export function MentionTrendChart({
  days,
  metric,
}: {
  days: MentionTrendDay[];
  metric: TrendMetric;
}) {
  const t = useTranslations('mentions.overview.trend');
  const locale = useLocale();
  const f = numberFormat(locale);
  // Mentions are every time a response names the brand, as Total mentions
  // (and Insights) count them; the rates keep their own field.
  const key = metric === 'mentions' ? 'occurrences' : metric;
  const value = (n: number) =>
    metric === 'net'
      ? signedValue(Math.round(n), locale)
      : metric === 'rate'
        ? f.percent(n, 1)
        : f.number(n);

  return (
    <ChartContainer height={HEIGHT}>
      {(width) => (
        <AreaChart
          width={width}
          height={HEIGHT}
          data={days}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <defs>
            <linearGradient id="mentionsTrendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={STROKE} stopOpacity={0.18} />
              <stop offset="95%" stopColor={STROKE} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(day: string) => dayLabel(day, locale)}
            minTickGap={24}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            // A rate's axis ends at the next ten above its peak, never past 100.
            domain={
              metric === 'net'
                ? [-100, 100]
                : metric === 'rate'
                  ? [0, (max: number) => Math.min(100, Math.ceil(max / 10) * 10 || 10)]
                  : [0, 'auto']
            }
            ticks={metric === 'net' ? [-100, -50, 0, 50, 100] : undefined}
            allowDecimals={false}
            tickFormatter={(v: number) =>
              metric === 'net'
                ? signedValue(v, locale)
                : metric === 'rate'
                  ? f.percent(v, 0)
                  : f.number(v)
            }
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          {metric === 'net' && <ReferenceLine y={0} className="stroke-muted-foreground/40" />}
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const d = active ? (payload?.[0]?.payload as MentionTrendDay | undefined) : undefined;
              if (!d) return null;
              const v = d[key];
              // A rate is taken over the day's responses, net sentiment over its mentions.
              const n = metric === 'net' ? d.mentions : d.answers;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium text-foreground">{dayLabel(d.day, locale)}</p>
                  <p className="font-medium text-foreground tabular-nums">
                    {v === null ? '—' : value(v)}
                  </p>
                  <p className="text-muted-foreground">
                    {metric === 'net'
                      ? t('tooltipMentions', { count: n })
                      : t('tooltipResponses', { count: n })}
                    {metric !== 'mentions' && n > 0 && n < LOW_SAMPLE_MENTIONS && (
                      <> · {t('lowSample')}</>
                    )}
                  </p>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey={key}
            stroke={STROKE}
            strokeWidth={2}
            fill={metric === 'net' ? 'none' : 'url(#mentionsTrendFill)'}
            connectNulls
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </AreaChart>
      )}
    </ChartContainer>
  );
}
