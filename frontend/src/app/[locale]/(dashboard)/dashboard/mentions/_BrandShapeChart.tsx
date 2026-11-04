'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from 'recharts';
import { numberFormat } from '@/lib/numberFormat';

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

const HEIGHT = 280;

export interface ShapeSeries {
  key: string;
  name: string;
  color: string;
}

/**
 * "Brand shape" (MS-09): each brand's share of the responses naming it, on the attributes
 * that tell them apart, one outline per brand. The axis ends at the next ten
 * above the highest share, so a low-share set still fills the chart.
 */
export function BrandShapeChart({
  data,
  series,
}: {
  /** One row per attribute: { attribute, [series key]: share } */
  data: Record<string, string | number | null>[];
  series: ShapeSeries[];
}) {
  const f = numberFormat(useLocale());
  const top = Math.max(10, ...data.flatMap((row) => series.map((s) => Number(row[s.key] ?? 0))));
  const domainTop = Math.min(100, Math.ceil(top / 10) * 10);

  return (
    <ChartContainer height={HEIGHT}>
      {(width) => (
        <RadarChart width={width} height={HEIGHT} data={data} outerRadius="72%">
          <PolarGrid className="stroke-border" />
          {/* No axis line: the grid draws the outline, and the class's fill would cover the shapes. */}
          <PolarAngleAxis
            dataKey="attribute"
            tick={{ fontSize: 11 }}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <PolarRadiusAxis domain={[0, domainTop]} tick={false} axisLine={false} />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
                  <p className="mb-1 font-medium text-foreground">{label}</p>
                  {payload.map((entry) => (
                    <div key={String(entry.dataKey)} className="flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: String(entry.color) }}
                      />
                      <span className="text-muted-foreground">{entry.name}:</span>
                      <span className="font-medium text-foreground tabular-nums">
                        {typeof entry.value === 'number' ? f.percent(entry.value, 0) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {series.map((s) => (
            <Radar
              key={s.key}
              name={s.name}
              dataKey={s.key}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.12}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </RadarChart>
      )}
    </ChartContainer>
  );
}
