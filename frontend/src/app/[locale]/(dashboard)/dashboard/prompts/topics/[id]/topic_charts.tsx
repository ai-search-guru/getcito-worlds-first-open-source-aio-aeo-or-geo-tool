'use client';

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import type { VisibilityTrendPoint } from '@/lib/actions/tracking';

export function VisibilityTrendChartView({
  width,
  data,
}: {
  width: number;
  data: VisibilityTrendPoint[];
}) {
  return (
    <AreaChart
      width={width}
      height={260}
      data={data}
      margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
    >
      <defs>
        <linearGradient id="brandTopic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.25} />
          <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
        </linearGradient>

        <linearGradient id="compTopic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.15} />
          <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
        </linearGradient>
      </defs>

      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />

      <XAxis
        dataKey="date"
        tick={{ fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        className="fill-muted-foreground"
      />

      <YAxis
        tick={{ fontSize: 11 }}
        tickLine={false}
        axisLine={false}
        className="fill-muted-foreground"
        domain={[0, 100]}
        tickFormatter={(v: number) => `${v}%`}
      />

      <Tooltip
        contentStyle={{
          fontSize: 11,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'var(--popover)',
          color: 'var(--popover-foreground)',
        }}
      />

      <Area
        type="monotone"
        dataKey="competitors"
        stroke="#94a3b8"
        strokeOpacity={0.8}
        strokeWidth={1.5}
        fill="url(#compTopic)"
        name="Competitors avg"
        strokeDasharray="4 4"
        dot={false}
      />

      <Area
        type="monotone"
        dataKey="score"
        stroke="var(--chart-1)"
        strokeWidth={2}
        fill="url(#brandTopic)"
        name="Brand"
        dot={false}
        activeDot={{ r: 4 }}
      />
    </AreaChart>
  );
}
