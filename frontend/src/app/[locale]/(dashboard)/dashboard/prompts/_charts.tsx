'use client';

import { useRef, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { formatCompactNumber } from '@/lib/format';
import { formatEstimateRange, scaleEstimate } from '@/lib/volumeEstimate';
import { AI_PLATFORM_SHARES } from './_platformShares';

// ─── Auto-sizing wrapper ─────────────────────────────────────────────────────

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

// ─── Exported Charts ──────────────────────────────────────────────────────────

interface PlatformVolumeItem {
  name: string;
  share: number;
  volume: number;
  color: string;
}

export function PlatformVolumeChart({
  totalVolume,
  totalRange,
}: {
  totalVolume: number;
  /** The total's estimated range (PROMPT-013): each platform shows its share of it. */
  totalRange: { low: number; high: number };
}) {
  if (totalVolume <= 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-xs text-muted-foreground">
        No volume data available
      </div>
    );
  }

  const data: PlatformVolumeItem[] = AI_PLATFORM_SHARES.map((p) => ({
    name: p.name,
    share: p.share,
    volume: Math.round(totalVolume * p.share),
    color: p.color,
  })).sort((a, b) => b.volume - a.volume);

  return (
    <ChartContainer height={220}>
      {(width) => (
        <BarChart
          width={width}
          height={220}
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 12, left: 4, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            tickFormatter={formatCompactNumber}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            width={120}
          />
          <Tooltip
            cursor={{ fill: 'color-mix(in oklab, var(--muted) 40%, transparent)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as PlatformVolumeItem;
              return (
                <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
                  <p className="font-medium text-foreground mb-0.5">{row.name}</p>
                  <p className="text-muted-foreground">
                    Est. queries:{' '}
                    <span className="font-medium text-foreground">
                      {formatEstimateRange(scaleEstimate(totalRange, row.share))}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Share:{' '}
                    <span className="font-medium text-foreground">
                      {(row.share * 100).toFixed(0)}%
                    </span>
                  </p>
                </div>
              );
            }}
          />
          <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ChartContainer>
  );
}
