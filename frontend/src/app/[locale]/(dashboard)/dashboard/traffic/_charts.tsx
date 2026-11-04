'use client';

import { useRef, useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getPlatformName, type PlatformSurface } from '@/lib/trafficPlatforms';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { TrafficTrendPoint } from '@/lib/actions/traffic';
import type { GoogleTrendPoint } from '@/lib/trafficGoogleTrend';

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

// ─── Platform colors ─────────────────────────────────────────────────────────
//
// Keys are the AI source list's (`backend/src/lib/ai-sources.json`), which the
// tracking snippet and the Analytics sync both store: every key there needs a
// color here and a name in `@/lib/traffic-platforms`, otherwise it renders as
// a grey raw hostname (trafficPlatforms.test.ts checks). The other ChatGPT
// hosts are kept for rows from before the list (AT-004), and `unknown` for
// rows that predate #288 (null source_platform).
//
// In the brand's colors rather than shades of one violet: the most common
// engine in ink (the theme's primary, black on light and near-white on dark),
// the others in warm, earthy tones that read on both themes and apart from
// one another.

const PLATFORM_COLORS: Record<string, string> = {
  'chatgpt.com': 'var(--primary)',
  'chat.openai.com': 'var(--primary)',
  'search.chatgpt.com': 'var(--primary)',
  'perplexity.ai': '#3f6f68',
  'claude.ai': '#c2603f',
  'gemini.google.com': '#c9973b',
  'copilot.microsoft.com': '#5f7f9a',
  'you.com': '#7a8450',
  'phind.com': '#c9b79c',
  'meta.ai': '#8c5e73',
  'poe.com': '#9a4a2e',
  'labs.google': '#d4b26a',
  'bing.com': '#6b8a99',
  'grok.com': '#a08c74',
  'deepseek.com': '#4f6f8f',
  unknown: '#a8a29a',
};

export function getColor(platform: string): string {
  return PLATFORM_COLORS[platform] ?? '#a8a29a';
}

/**
 * Options of the platform filter, with an empty-valued "all" option first. Base UI's Select can only
 * show the label of the picked option in its trigger when it is given the options as `items`;
 * without them the trigger shows the raw value, the platform's domain (for example `chatgpt.com`).
 */
export function getPlatformFilterItems(
  platforms: string[],
  allLabel: string,
): { value: string; label: string }[] {
  return [
    { value: '', label: allLabel },
    ...platforms.map((platform) => ({ value: platform, label: getPlatformName(platform) })),
  ];
}

/**
 * A trend bucket's label. A day reads "Oct 12", in UTC because the day
 * buckets are UTC days. An hour (the 24-hour range, AT-017) reads "13:00" on
 * the axis and "Oct 17, 13:00" in the tooltip, in the member's own time zone.
 * English like the rest of the UI, not the browser's language (F7).
 */
export function formatTrafficBucketDate(
  value: string,
  { withDay = false, timeZone }: { withDay?: boolean; timeZone?: string } = {},
): string {
  const date = new Date(value);
  if (!value.includes('T')) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  const hour = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  if (!withDay) return hour;
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })}, ${hour}`;
}

// ─── Custom Tooltips ──────────────────────────────────────────────────────────

export function AreaTooltip({
  active,
  payload,
  label,
  analyticsDays,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  /** Days whose visits came from Google Analytics rather than the snippet (AT-004). */
  analyticsDays?: Set<string>;
}) {
  const t = useTranslations('traffic.trend');
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">
        {label ? formatTrafficBucketDate(label, { withDay: true }) : ''}
        {label && analyticsDays?.has(label) && (
          <span className="font-normal text-muted-foreground"> · {t('fromAnalytics')}</span>
        )}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{getPlatformName(entry.name)}:</span>
          <span className="font-medium text-foreground">{formatNumber(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload: { color: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: entry.payload.color }}
        />
        <span className="text-muted-foreground">{entry.name}:</span>
        <span className="font-medium text-foreground">{entry.value}%</span>
      </div>
    </div>
  );
}

// ─── Bar List ─────────────────────────────────────────────────────────────────

function BarList({
  data,
}: {
  /** `sub`: a surface's bar, under its platform's (ChatGPT Shopping, #1283). */
  data: { key: string; name: string; value: number; color: string; sub?: boolean; tip?: string }[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="w-full space-y-2">
      {data.map((item) => (
        <div key={item.key} className="flex items-center gap-2 text-xs">
          <span
            className={cn('w-20 shrink-0 text-muted-foreground truncate', item.sub && 'pl-3')}
            title={item.tip}
          >
            {item.name}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.round((item.value / max) * 100)}%`,
                backgroundColor: item.color,
              }}
            />
          </div>
          <span className="w-8 text-right font-medium tabular-nums text-foreground">
            {item.value}%
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Exported Charts ──────────────────────────────────────────────────────────

export function ReferralTrendChart({
  data,
  analyticsDays,
}: {
  data: TrafficTrendPoint[];
  /** Days filled from Google Analytics, named in the tooltip (AT-004). */
  analyticsDays?: string[];
}) {
  if (!data.length) return null;
  const fromAnalytics = new Set(analyticsDays);

  // Extract platform keys (everything except 'date')
  const platformKeys = Object.keys(data[0]).filter((k) => k !== 'date');

  return (
    <ChartContainer height={220}>
      {(width) => (
        <AreaChart
          width={width}
          height={220}
          data={data}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <defs>
            {platformKeys.map((key) => (
              <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={getColor(key)} stopOpacity={0.15} />
                <stop offset="95%" stopColor={getColor(key)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            tickFormatter={(v: string) => formatTrafficBucketDate(v)}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            allowDecimals={false}
          />
          <Tooltip content={<AreaTooltip analyticsDays={fromAnalytics} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value: string) => getPlatformName(value)}
          />
          {platformKeys.map((key) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              name={key}
              stroke={getColor(key)}
              strokeWidth={2}
              fill={`url(#grad-${key})`}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </AreaChart>
      )}
    </ChartContainer>
  );
}

// ─── AI visits vs Google clicks (AT-008) ─────────────────────────────────────

/** The AI line in ink, as the top engine, Google's in its green, markers in amber. */
const AI_LINE = 'var(--primary)';
const GOOGLE_LINE = '#34a853';
const MARKER = '#f59e0b';
const BASELINE = '#94a3b8';

function GoogleTrendTooltip({
  active,
  payload,
  label,
  googleUntil,
  hasGoogle,
}: {
  active?: boolean;
  payload?: { payload: GoogleTrendPoint }[];
  label?: string;
  googleUntil: string | null;
  hasGoogle: boolean;
}) {
  const t = useTranslations('traffic.trend.google');
  if (!active || !payload?.length || !label) return null;
  const point = payload[0].payload;
  const line = (color: string, name: string, value: string) => (
    <div className="flex items-center gap-2">
      <span
        className="inline-block h-2 w-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{name}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
  const indexed = (count: number, index: number | null) =>
    index === null
      ? formatNumber(count)
      : t('withIndex', { count: formatNumber(count), index: formatNumber(index) });
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md text-xs">
      <p className="font-medium text-foreground mb-1">
        {formatTrafficBucketDate(label, { withDay: true })}
      </p>
      {line(AI_LINE, t('aiLine'), indexed(point.visits, point.ai))}
      {hasGoogle &&
        line(
          GOOGLE_LINE,
          t('googleLine'),
          point.clicks === null
            ? googleUntil && point.date > googleUntil
              ? t('notReported')
              : t('noData')
            : indexed(point.clicks, point.google),
        )}
      {point.actions > 0 && (
        <p className="mt-1 text-muted-foreground">{t('actions', { count: point.actions })}</p>
      )}
      {point.prompts > 0 && (
        <p className="text-muted-foreground">{t('prompts', { count: point.prompts })}</p>
      )}
    </div>
  );
}

/**
 * AI visits and Google organic clicks, each indexed to 100 on its first day
 * with any (spec §3.3), with a dashed amber line on each day actions entered
 * the Action Center or prompts were added.
 */
export function GoogleTrendChart({
  points,
  googleUntil,
}: {
  points: GoogleTrendPoint[];
  /** Google's latest reported day, when the range runs past it. */
  googleUntil: string | null;
}) {
  const t = useTranslations('traffic.trend.google');
  if (!points.length) return null;
  const markerDays = points.filter((p) => p.actions > 0 || p.prompts > 0).map((p) => p.date);
  // Without Google's days (no Search Console) the legend shows the AI line alone.
  const hasGoogle = points.some((p) => p.google !== null);

  return (
    <ChartContainer height={220}>
      {(width) => (
        <LineChart
          width={width}
          height={220}
          data={points}
          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            tickFormatter={(v: string) => formatTrafficBucketDate(v)}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            className="fill-muted-foreground"
            allowDecimals={false}
          />
          <ReferenceLine y={100} stroke={BASELINE} strokeDasharray="2 4" />
          {markerDays.map((day) => (
            <ReferenceLine key={day} x={day} stroke={MARKER} strokeDasharray="3 3" />
          ))}
          <Tooltip
            content={<GoogleTrendTooltip googleUntil={googleUntil} hasGoogle={hasGoogle} />}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value: string) => (value === 'ai' ? t('aiLine') : t('googleLine'))}
          />
          <Line
            type="monotone"
            dataKey="ai"
            name="ai"
            stroke={AI_LINE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
          {hasGoogle && (
            <Line
              type="monotone"
              dataKey="google"
              name="google"
              stroke={GOOGLE_LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3 }}
            />
          )}
        </LineChart>
      )}
    </ChartContainer>
  );
}

export function PlatformBreakdownChart({
  data,
}: {
  data: {
    platform: string;
    visits: number;
    surfaces?: { surface: PlatformSurface; visits: number }[];
  }[];
}) {
  const t = useTranslations('traffic.platforms');
  const [hovered, setHovered] = useState<string | null>(null);

  const total = data.reduce((s, d) => s + d.visits, 0) || 1;
  const share = (visits: number) => Math.round((visits / total) * 100);
  const pieData = data
    .filter((d) => d.visits > 0)
    .map((d) => ({
      name: getPlatformName(d.platform),
      value: share(d.visits),
      color: getColor(d.platform),
    }));
  // The bars add each platform's surfaces under it. They're part of its
  // slice, so the pie leaves them out.
  const bars = data
    .filter((d) => d.visits > 0)
    .flatMap((d) => {
      const name = getPlatformName(d.platform);
      const color = getColor(d.platform);
      return [
        { key: d.platform, name, value: share(d.visits), color },
        ...(d.surfaces ?? []).map((s) => ({
          key: `${d.platform}|${s.surface}`,
          name: t(`surfaces.${s.surface}`),
          value: share(s.visits),
          color,
          sub: true,
          tip: t(`surfaceTips.${s.surface}`, { platform: name }),
        })),
      ];
    });

  if (!pieData.length) return null;

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      <ChartContainer height={140}>
        {(width) => {
          const size = Math.min(width, 140);
          return (
            <PieChart width={width} height={140}>
              <Pie
                data={pieData}
                cx={width / 2}
                cy={70}
                innerRadius={size * 0.27}
                outerRadius={size * 0.43}
                paddingAngle={2}
                dataKey="value"
                onMouseEnter={(_, index) => setHovered(pieData[index].name)}
                onMouseLeave={() => setHovered(null)}
              >
                {pieData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    opacity={hovered === null || hovered === entry.name ? 1 : 0.4}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieTooltip />} />
            </PieChart>
          );
        }}
      </ChartContainer>
      <BarList data={bars} />
    </div>
  );
}
