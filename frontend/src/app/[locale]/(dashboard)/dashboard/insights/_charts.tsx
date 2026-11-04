'use client';

import { useRef, useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
} from 'recharts';
import type {
  ProviderComparisonRow,
  VisibilityTrendPoint,
  VisibilityRateTrendData,
  VisibilityRateTrendEntity,
  SoVByPlatform,
} from '@/lib/actions/tracking';
import { getSiteIconUrl } from '@/lib/siteIcon';
import { trendAxisTop, type TrendLine, type TrendMarker } from '@/lib/insightsTrend';
import { numberFormat } from '@/lib/numberFormat';
import { formatNumber } from '@/lib/format';
import { dayLabel } from './kpiFormat';

// ─── Adaptive Y-axis ─────────────────────────────────────────────────────────
// Visibility scores are theoretically 0–100 but realistic values for most
// brands cluster in the 5–30 band. Pinning the Y-axis to 100 makes bars look
// uniformly stubby and kills the perceived difference between, say, 8 and 22.
// We rescale upward with 30% headroom, but snap to a "nice" tick value so
// gridlines stay clean — and keep a minimum ceiling of 20 so very low values
// don't look absurdly zoomed (a 3-point chart shouldn't fill the canvas).

const NICE_YMAX_STEPS = [20, 25, 30, 40, 50, 60, 80, 100] as const;

function niceVisibilityYMax(values: number[]): number {
  if (values.length === 0) return 20;
  const actualMax = Math.max(0, ...values);
  if (actualMax <= 0) return 20;
  const target = actualMax * 1.3;
  for (const step of NICE_YMAX_STEPS) if (target <= step) return step;
  return 100;
}

// ─── Auto-sizing wrapper ─────────────────────────────────────────────────────
// Replaces ResponsiveContainer which has issues with React 19

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

// ─── Custom Tooltips ──────────────────────────────────────────────────────────

function AreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground capitalize">{entry.name}:</span>
          <span className="font-medium text-foreground">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Exported Charts ──────────────────────────────────────────────────────────

export function TrendChart({ data }: { data: VisibilityTrendPoint[] }) {
  const hasCompetitors = data.some((d) => d.competitors !== null);
  // Adaptive Y ceiling (see niceVisibilityYMax): a fixed 0–100 axis flattens
  // realistic low-single-digit visibility averages into a floor-hugging line.
  const yMax = niceVisibilityYMax(
    data.flatMap((d) => [d.score, ...(d.competitors !== null ? [d.competitors] : [])]),
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[192px] text-sm text-muted-foreground">
        No trend data available yet
      </div>
    );
  }

  return (
    <ChartContainer height={192}>
      {(width) => (
        <AreaChart
          width={width}
          height={192}
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradScore" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.2} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradCompetitors" x1="0" y1="0" x2="0" y2="1">
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
            domain={[0, yMax]}
          />
          <Tooltip content={<AreaTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Area
            type="monotone"
            dataKey="score"
            name="Your Brand"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#gradScore)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          {hasCompetitors && (
            <Area
              type="monotone"
              dataKey="competitors"
              name="Avg. Competitor"
              stroke="#94a3b8"
              strokeWidth={2}
              fill="url(#gradCompetitors)"
              dot={false}
              activeDot={{ r: 4 }}
              strokeDasharray="4 4"
            />
          )}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

// ─── Visibility Rate trend (one line per brand, logo at the line's end) ──────

/** Circle-clipped logo rendered on a line's last data point. */
function LogoDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  lastIndex: number;
  color: string;
  logoUrl: string;
  entityKey: string;
  dimmed?: boolean;
}) {
  const { cx, cy, index, lastIndex, color, logoUrl, entityKey, dimmed } = props;
  if (index !== lastIndex || cx == null || cy == null) return <g />;
  const r = 11;
  const clipId = `rate-trend-logo-${entityKey}`;
  return (
    <g opacity={dimmed ? 0.25 : 1}>
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r - 2.5} />
        </clipPath>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="#ffffff" stroke={color} strokeWidth={2} />
      <image
        href={logoUrl}
        x={cx - (r - 2.5)}
        y={cy - (r - 2.5)}
        width={(r - 2.5) * 2}
        height={(r - 2.5) * 2}
        clipPath={`url(#${clipId})`}
        preserveAspectRatio="xMidYMid slice"
      />
    </g>
  );
}

/** A marker's badge at the foot of its dashed line: "+" prompts added, "A" action sent. */
function MarkerBadge({
  viewBox,
  glyph,
  title,
  stack,
}: {
  viewBox?: { x?: number; y?: number; height?: number };
  glyph: string;
  title: string;
  /** Badges on the same day stack upwards. */
  stack: number;
}) {
  if (viewBox?.x == null || viewBox.y == null || viewBox.height == null) return <g />;
  const cx = viewBox.x;
  const cy = viewBox.y + viewBox.height - 9 - stack * 20;
  return (
    <g>
      <title>{title}</title>
      <circle cx={cx} cy={cy} r={8} className="fill-background stroke-muted-foreground/50" />
      <text
        x={cx}
        y={cy + 3.5}
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

/** The goal line's label, left-aligned above it: the right end is where the lines' logos sit. */
function GoalLabel({ viewBox, text }: { viewBox?: { x?: number; y?: number }; text: string }) {
  if (viewBox?.x == null || viewBox.y == null) return <g />;
  return (
    <text
      x={viewBox.x + 4}
      y={viewBox.y - 4}
      fontSize={10}
      className="fill-green-600 dark:fill-green-500"
    >
      {text}
    </text>
  );
}

/**
 * The visibility trend (VIS-007): the given lines (yours and the pinned or
 * strongest competitors, colored by the caller), the Action Center goal as a
 * dashed line, and a dashed marker per day prompts were added or actions
 * sent. Hover state lives with the caller, so its chips highlight lines too.
 */
export function VisibilityRateTrendChart({
  data,
  lines,
  markers,
  goal,
  hoveredKey,
  onHover,
}: {
  data: VisibilityRateTrendData;
  lines: TrendLine<VisibilityRateTrendEntity>[];
  /** Markers placed on a point (`date` set). */
  markers: (TrendMarker & { date: string; glyph: string; title: string })[];
  goal: { value: number; label: string } | null;
  hoveredKey: string | null;
  onHover: (key: string | null) => void;
}) {
  const { points } = data;
  const locale = useLocale();
  const f = numberFormat(locale);
  // The points' `date` stays the key markers are placed by; what the axis and
  // tooltip print is the day in the UI's locale (VIS-005).
  const labelOf = new Map(points.map((p) => [p.date, dayLabel(p.day, locale)]));
  const shown = lines.map((line) => ({
    ...line,
    logoUrl: line.logoUrl ?? (line.domain ? getSiteIconUrl(line.domain, 64) : ''),
  }));

  const chartData = points.map((p) => ({ date: p.date, ...p.values }));
  const lastIndex = points.length - 1;

  // Y axis ticks run 5, 15, 25, … and the top one sits just above the
  // highest score in view, the goal included (a 60 peak → axis ends at 65),
  // so the lines use the full canvas instead of being squashed under an
  // always-100 scale.
  const yTop = trendAxisTop(
    shown.flatMap((e) => points.map((p) => p.values[e.key] ?? 0)),
    goal?.value ?? null,
  );
  const yTicks: number[] = [];
  for (let tick = 5; tick <= yTop; tick += 10) yTicks.push(tick);

  // Badges on the same day stack, so a prompt and an action marker don't overlap.
  const stackOf = (i: number) =>
    markers.slice(0, i).filter((m) => m.date === markers[i].date).length;

  return (
    <ChartContainer height={320}>
      {(width) => (
        <LineChart
          width={width}
          height={320}
          data={chartData}
          margin={{ top: 8, right: 26, left: -24, bottom: 0 }}
        >
          <XAxis
            dataKey="date"
            tickFormatter={(date: string) => labelOf.get(date) ?? date}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <YAxis
            domain={[0, yTop]}
            ticks={yTicks}
            tickFormatter={(v: number) => f.number(v)}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
          />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const ordered = [...payload].sort(
                (a, b) => ((b.value as number) ?? 0) - ((a.value as number) ?? 0),
              );
              return (
                <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
                  <p className="font-medium text-foreground mb-1">
                    {labelOf.get(String(label)) ?? label}
                  </p>
                  {ordered.map((entry) => {
                    const entity = shown.find((e) => e.key === entry.dataKey);
                    if (!entity) return null;
                    return (
                      <div key={entity.key} className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: entity.color }}
                        />
                        <span className="text-muted-foreground">{entity.name}:</span>
                        <span className="font-medium text-foreground">
                          {typeof entry.value === 'number' ? f.number(entry.value) : entry.value}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            }}
          />
          {goal && (
            <ReferenceLine
              y={goal.value}
              className="stroke-green-600 dark:stroke-green-500"
              strokeDasharray="4 4"
              label={<GoalLabel text={goal.label} />}
            />
          )}
          {markers.map((m, i) => (
            <ReferenceLine
              key={`${m.kind}-${m.day}`}
              x={m.date}
              className="stroke-muted-foreground/40"
              strokeDasharray="2 3"
              label={<MarkerBadge glyph={m.glyph} title={m.title} stack={stackOf(i)} />}
            />
          ))}
          {/* Render order = z-order: lines are drawn lowest-rate first so
              when end-of-line logos overlap, the higher rate sits on top.
              A hovered line always wins. */}
          {[...shown]
            .sort((a, b) => {
              if (a.key === hoveredKey) return 1;
              if (b.key === hoveredKey) return -1;
              return (
                (points[lastIndex]?.values[a.key] ?? 0) - (points[lastIndex]?.values[b.key] ?? 0)
              );
            })
            .map((entity) => {
              const dimmed = hoveredKey !== null && hoveredKey !== entity.key;
              return (
                <Line
                  key={entity.key}
                  type="monotone"
                  dataKey={entity.key}
                  stroke={entity.color}
                  strokeOpacity={dimmed ? 0.15 : 1}
                  strokeWidth={entity.key === hoveredKey ? 3 : entity.isOwnBrand ? 2.5 : 1.5}
                  isAnimationActive={false}
                  onMouseEnter={() => onHover(entity.key)}
                  onMouseLeave={() => onHover(null)}
                  dot={
                    <LogoDot
                      lastIndex={lastIndex}
                      color={entity.color}
                      logoUrl={entity.logoUrl}
                      entityKey={entity.key}
                      dimmed={dimmed}
                    />
                  }
                  activeDot={{ r: 3 }}
                />
              );
            })}
        </LineChart>
      )}
    </ChartContainer>
  );
}

// ─── Share of Voice Charts ───────────────────────────────────────────────────

export function ShareOfVoicePlatformChart({
  data,
  overallSov,
}: {
  data: SoVByPlatform[];
  overallSov: number;
}) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] text-sm text-muted-foreground">
        No share of voice data available
      </div>
    );
  }

  const palette = [
    '#6366f1',
    '#8b5cf6',
    '#3b82f6',
    '#22c55e',
    '#f97316',
    '#f59e0b',
    '#06b6d4',
    '#ec4899',
  ];

  const chartData = data.map((d, index) => ({
    ...d,
    fill: palette[index % palette.length],
    voiceMentions: d.brandMentions + d.competitorMentions,
  }));
  const totalVoiceMentions = chartData.reduce((sum, d) => sum + d.voiceMentions, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <div className="text-4xl font-bold tabular-nums">{overallSov}%</div>
        <div className="text-xs text-muted-foreground mt-0.5">Overall Share of Voice</div>
      </div>

      <ChartContainer height={200}>
        {(width) => {
          const size = Math.min(width, 220);
          return (
            <PieChart width={width} height={200}>
              <Pie
                data={chartData}
                cx={width / 2}
                cy={100}
                innerRadius={size * 0.28}
                outerRadius={size * 0.44}
                paddingAngle={2}
                dataKey="voiceMentions"
                nameKey="provider"
              >
                {chartData.map((entry) => (
                  <Cell key={entry.provider} fill={entry.fill} stroke="none" />
                ))}
              </Pie>
              <Tooltip
                isAnimationActive={false}
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const p = payload[0].payload as SoVByPlatform & {
                    fill: string;
                    voiceMentions: number;
                  };
                  const platformShare =
                    totalVoiceMentions > 0 ? (p.voiceMentions / totalVoiceMentions) * 100 : 0;
                  return (
                    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm max-w-[240px]">
                      <div className="font-medium">{p.provider}</div>
                      <div className="text-muted-foreground">
                        Your share of voice:{' '}
                        <span className="font-medium text-foreground">{p.sov.toFixed(1)}%</span> —
                        your brand accounts for {formatNumber(p.brandMentions)} of the{' '}
                        {formatNumber(p.voiceMentions)} brand + competitor mentions here
                      </div>
                      <div className="mt-1 text-muted-foreground">
                        {platformShare.toFixed(1)}% of all tracked mentions happened on {p.provider}{' '}
                        (slice size)
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          );
        }}
      </ChartContainer>

      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {chartData.map((d) => (
          <li key={d.provider} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: d.fill }}
              aria-hidden
            />
            <span className="truncate text-foreground">{d.provider}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{d.sov.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
