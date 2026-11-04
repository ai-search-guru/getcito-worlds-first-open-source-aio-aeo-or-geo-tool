'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { OWN_BRAND_COLOR } from '@/lib/insightsTrend';
import { formatMonthDay, formatNumber } from '@/lib/format';
import { COMPETITOR_COLOR, type TimelineWeek } from '@/lib/competitorTimeline';
const HEIGHT = 220;

/** The chart's width follows its box. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A week's events, as a badge on its line: how many pages were first cited or changed. */
function WeekBadge({
  viewBox,
  glyph,
  title,
}: {
  viewBox?: { x?: number; y?: number };
  glyph: string;
  title: string;
}) {
  if (viewBox?.x == null || viewBox.y == null) return <g />;
  return (
    <g>
      <title>{title}</title>
      <circle
        cx={viewBox.x}
        cy={viewBox.y + 9}
        r={8}
        className="fill-background stroke-muted-foreground/50"
      />
      <text
        x={viewBox.x}
        y={viewBox.y + 12.5}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        className="fill-muted-foreground"
      >
        {glyph}
      </text>
    </g>
  );
}

/**
 * The answers mentioning the brand and the competitor each week, and a
 * marker on each week something happened to the competitor's pages.
 */
export function CompetitorTimelineChart({
  weeks,
  marks,
  brandName,
  competitorName,
}: {
  weeks: TimelineWeek[];
  marks: { week: string; firstCited: number; changed: number }[];
  brandName: string;
  competitorName: string;
}) {
  const t = useTranslations('competitors.timeline');
  const [ref, width] = useWidth();
  const label = (week: string) => formatMonthDay(`${week}T00:00:00Z`, 'UTC');

  return (
    <div ref={ref} style={{ width: '100%', height: HEIGHT }}>
      {width > 0 && (
        <LineChart
          width={width}
          height={HEIGHT}
          data={weeks}
          margin={{ top: 4, right: 16, left: -24, bottom: 0 }}
        >
          <XAxis
            dataKey="week"
            tickFormatter={label}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload, label: week }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as TimelineWeek | undefined;
              if (!row) return null;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium text-foreground">
                    {t('weekOf', { date: label(String(week)) })}
                  </p>
                  {[
                    { name: competitorName, value: row.competitor, color: COMPETITOR_COLOR },
                    { name: brandName, value: row.brand, color: OWN_BRAND_COLOR },
                  ].map((line) => (
                    <div key={line.name} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: line.color }}
                      />
                      <span className="text-muted-foreground">{line.name}:</span>
                      <span className="font-medium text-foreground">
                        {t('mentions', { count: line.value })}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {marks.map((mark) => (
            <ReferenceLine
              key={mark.week}
              x={mark.week}
              className="stroke-muted-foreground/40"
              strokeDasharray="2 3"
              label={
                <WeekBadge
                  glyph={String(mark.firstCited + mark.changed)}
                  title={[
                    mark.firstCited > 0 ? t('firstCitedBadge', { count: mark.firstCited }) : null,
                    mark.changed > 0 ? t('changedBadge', { count: mark.changed }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              }
            />
          ))}
          <Line
            type="monotone"
            dataKey="brand"
            stroke={OWN_BRAND_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="competitor"
            stroke={COMPETITOR_COLOR}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      )}
    </div>
  );
}
