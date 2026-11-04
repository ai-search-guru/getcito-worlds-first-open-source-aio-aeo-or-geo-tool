'use client';

import { useEffect, useRef, useState } from 'react';
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

export type TrendDatum = { date: string; score: number };

// Chart color follows the same score bands as the rest of Site Audit
// (green ≥70 / amber 40–69 / red <40). Driven by the overall (latest) score.
function scoreHex(score: number | null): string {
  if (score === null) return '#6366f1';
  if (score >= 0.7) return '#16a34a'; // green-600
  if (score >= 0.4) return '#f59e0b'; // amber-500
  return '#dc2626'; // red-600
}

// Width-tracking wrapper — ResponsiveContainer has React 19 quirks, so we
// measure with a ResizeObserver (same approach as insights/_charts.tsx).
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

function ScoreTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <p>
        Score: <span className="font-medium">{payload[0].value}</span>/100
      </p>
    </div>
  );
}

export function ScoreTrendChart({ data, score }: { data: TrendDatum[]; score: number | null }) {
  const color = scoreHex(score);
  return (
    <ChartContainer height={200}>
      {(width) => (
        <AreaChart
          width={width}
          height={200}
          data={data}
          margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
        >
          <defs>
            <linearGradient id="auditScoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<ScoreTooltip />} />
          <Area
            type="monotone"
            dataKey="score"
            stroke={color}
            strokeWidth={2}
            fill="url(#auditScoreGrad)"
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      )}
    </ChartContainer>
  );
}
