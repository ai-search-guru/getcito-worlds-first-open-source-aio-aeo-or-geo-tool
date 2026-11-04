'use client';

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// Ink, the theme's primary, as Mentions' trend draws it: black on light,
// near-white on dark. A second series is grey and dashed, told apart by
// lightness and line, not by hue.
const INK = 'var(--primary)';
const SECOND = 'var(--muted-foreground)';

const AXIS_TICK = {
  fill: 'var(--muted-foreground)',
  fontSize: 11,
} as const;

const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  fontSize: '0.75rem',
  color: 'var(--foreground)',
} as const;

type PlatformCardRateChartViewProps = {
  width: number;
  data: Array<{
    platform: string;
    rate: number;
  }>;
  /** The series' name, as its tooltip shows it (the page's translation). */
  label: string;
};

export function PlatformCardRateChartView({ width, data, label }: PlatformCardRateChartViewProps) {
  return (
    <BarChart
      width={width}
      height={220}
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
    >
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

      <XAxis dataKey="platform" stroke="var(--border)" tick={AXIS_TICK} tickLine={false} />

      <YAxis stroke="var(--border)" tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />

      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />

      <Bar dataKey="rate" name={label} fill={INK} radius={[4, 4, 0, 0]} />
    </BarChart>
  );
}

type ShoppingTrendChartViewProps = {
  width: number;
  data: Array<{
    date: string;
    ownCards: number;
    totalCards: number;
  }>;
  /** The two series' names, as the legend and tooltip show them (the page's translations). */
  labels: { own: string; all: string };
};

export function ShoppingTrendChartView({ width, data, labels }: ShoppingTrendChartViewProps) {
  return (
    <ComposedChart
      width={width}
      height={220}
      data={data}
      margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
    >
      <defs>
        <linearGradient id="shoppingTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={INK} stopOpacity={0.18} />
          <stop offset="95%" stopColor={INK} stopOpacity={0} />
        </linearGradient>
      </defs>

      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

      <XAxis
        dataKey="date"
        stroke="var(--border)"
        tick={AXIS_TICK}
        tickLine={false}
        tickFormatter={(v: string) => v.slice(5)}
      />

      <YAxis stroke="var(--border)" tick={AXIS_TICK} tickLine={false} axisLine={false} />

      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--border)' }} />

      <Legend
        wrapperStyle={{
          fontSize: 11,
          color: 'var(--muted-foreground)',
        }}
      />

      <Area
        type="monotone"
        dataKey="ownCards"
        name={labels.own}
        legendType="plainline"
        stroke={INK}
        strokeWidth={2}
        fill="url(#shoppingTrendFill)"
        dot={false}
        activeDot={{ r: 4 }}
      />

      <Line
        type="monotone"
        dataKey="totalCards"
        name={labels.all}
        // The legend draws its icon with the series' dash (plainline), so the two read apart.
        legendType="plainline"
        stroke={SECOND}
        strokeWidth={2}
        strokeDasharray="4 3"
        dot={false}
        activeDot={{ r: 4 }}
      />
    </ComposedChart>
  );
}
