'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * Spec returned by the `render_chart` agent tool. The schema in
 * `frontend/src/lib/agent/tools.ts` validates the shape; this component
 * trusts that contract and renders without re-validating.
 *
 * - line / bar charts use `xKey` + `series`
 * - pie charts use `valueKey` + `labelKey`
 */
export interface AgentChartSpec {
  type: 'line' | 'bar' | 'pie';
  title?: string;
  data: Array<Record<string, string | number>>;
  xKey?: string;
  series?: Array<{ key: string; label: string; color?: string }>;
  valueKey?: string;
  labelKey?: string;
}

export interface AgentAuditSpec {
  url: string;
  totalScore: number | null;
  categoryScores: Record<string, unknown>;
  recommendations: unknown[];
  signalsEvaluated: number | null;
  signalsTotal: number | null;
}

// Palette pulled from globals.css (`--chart-1` … `--chart-5`). Wraps
// around for charts with more than 5 series — fine in practice because
// the agent rarely emits beyond that, and even if it does the wrap is
// readable enough.
const CHART_COLORS = [
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-1)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

const CHART_HEIGHT = 260;

/**
 * Auto-sizing wrapper. ResponsiveContainer from recharts has known
 * issues under React 19 (the dashboard `_charts.tsx` files all roll the
 * same ResizeObserver replacement) so we mirror that pattern here.
 */
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

// All theme tokens in globals.css ship as full `oklch(...)` values, so
// we reference them directly with `var(--…)`. Wrapping in `hsl(var(--…))`
// produces invalid CSS and the browser falls back to default black,
// which is unreadable in dark mode.
const AXIS_TICK = { fill: 'var(--muted-foreground)', fontSize: 11 } as const;
const TOOLTIP_STYLE = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '0.5rem',
  fontSize: '0.75rem',
  color: 'var(--foreground)',
} as const;

export function AgentChart({ spec }: { spec: AgentChartSpec }) {
  return (
    <div className="my-3 rounded-lg border bg-card p-4">
      {spec.title && <p className="mb-3 text-xs font-medium text-foreground/80">{spec.title}</p>}
      <ChartContainer height={CHART_HEIGHT}>{(width) => renderChart(spec, width)}</ChartContainer>
    </div>
  );
}

function renderChart(spec: AgentChartSpec, width: number) {
  if (spec.type === 'pie') return renderPie(spec, width);
  if (spec.type === 'bar') return renderBar(spec, width);
  return renderLine(spec, width);
}

function renderLine(spec: AgentChartSpec, width: number) {
  const xKey = spec.xKey ?? 'x';
  const series = spec.series ?? [];
  return (
    <LineChart
      width={width}
      height={CHART_HEIGHT}
      data={spec.data}
      margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
    >
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={xKey} stroke="var(--border)" tick={AXIS_TICK} tickLine={false} />
      <YAxis stroke="var(--border)" tick={AXIS_TICK} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'var(--border)' }} />
      {series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
      )}
      {series.map((s, i) => (
        <Line
          key={`${i}-${s.key}`}
          type="monotone"
          dataKey={s.key}
          name={s.label}
          stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      ))}
    </LineChart>
  );
}

function renderBar(spec: AgentChartSpec, width: number) {
  const xKey = spec.xKey ?? 'x';
  const series = spec.series ?? [];
  return (
    <BarChart
      width={width}
      height={CHART_HEIGHT}
      data={spec.data}
      margin={{ top: 8, right: 16, bottom: 0, left: -8 }}
    >
      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey={xKey} stroke="var(--border)" tick={AXIS_TICK} tickLine={false} />
      <YAxis stroke="var(--border)" tick={AXIS_TICK} tickLine={false} axisLine={false} />
      <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)', opacity: 0.3 }} />
      {series.length > 1 && (
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
      )}
      {series.map((s, i) => (
        <Bar
          key={`${i}-${s.key}`}
          dataKey={s.key}
          name={s.label}
          fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
          radius={[4, 4, 0, 0]}
        />
      ))}
    </BarChart>
  );
}

function renderPie(spec: AgentChartSpec, width: number) {
  const valueKey = spec.valueKey ?? 'value';
  const labelKey = spec.labelKey ?? 'label';
  const radius = Math.min(width, CHART_HEIGHT) / 2 - 24;
  return (
    <PieChart width={width} height={CHART_HEIGHT}>
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Legend wrapperStyle={{ fontSize: 11, color: 'var(--muted-foreground)' }} />
      <Pie
        data={spec.data}
        dataKey={valueKey}
        nameKey={labelKey}
        cx="50%"
        cy="50%"
        outerRadius={radius}
        innerRadius={radius * 0.55}
        paddingAngle={2}
      >
        {spec.data.map((_, i) => (
          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
        ))}
      </Pie>
    </PieChart>
  );
}
