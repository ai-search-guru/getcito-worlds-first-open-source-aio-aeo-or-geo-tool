'use client';

import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowUpRight,
  Eye,
  HelpCircle,
  Layers,
  Link2,
  ListOrdered,
  MessageCircle,
  PieChart,
  Quote,
  Smile,
  Target,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import { LOW_SAMPLE_ANSWERS } from '@/lib/insightsSummary';
import type {
  CompetitorComparisonData,
  CoverageKpi,
  InsightsSummary,
  ShareOfVoiceData,
  TrackedPromptsKpi,
  VisibilityRateTrendData,
} from '@/lib/actions/tracking';
import type { PromptComparison } from '@/lib/insightsSamePrompts';
import type { KpiSeriesDay } from '@/lib/insightsKpis';
import {
  lowerIsGood,
  signedChange,
  signedValue,
  TONE_TEXT,
  upIsGood,
  type Change,
  rateSamples,
  type RateSample,
} from './kpiFormat';

// ─── Info tooltip ─────────────────────────────────────────────────────────────

/** Half the tooltip's width (w-56, 224px) and an 8px margin from the window's edge. */
const INFO_TIP_HALF_WIDTH = 120;

export function InfoTip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Centred on the icon, but kept on screen: an icon by the window's edge
    // (a table's last column) would push half the tooltip past it.
    const x = Math.min(
      Math.max(r.left + r.width / 2, INFO_TIP_HALF_WIDTH),
      window.innerWidth - INFO_TIP_HALF_WIDTH,
    );
    setPos({ x, y: r.bottom + 6 });
  }

  function hide() {
    setPos(null);
  }

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        aria-label="More information"
        aria-describedby={pos ? tooltipId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
        className="inline-flex items-center cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
      </span>
      {pos &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
            className="pointer-events-none fixed z-[9999] w-56 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

// ─── Card parts ───────────────────────────────────────────────────────────────

/**
 * A daily sparkline. Days without a value are skipped; fewer than two
 * points draw nothing. Grey normally, red when the card's change is bad.
 */
function Sparkline({ values, bad }: { values: (number | null)[]; bad: boolean }) {
  const points = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (points.length < 2) return <div className="h-6" aria-hidden />;
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const last = values.length - 1 || 1;
  const coords = points
    .map(({ i, v }) => {
      const x = (i / last) * 100;
      const y = max === min ? 12 : 22 - ((v - min) / (max - min)) * 20;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className={cn(
        'h-6 w-full',
        bad ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground/50',
      )}
      aria-hidden
    >
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The plan's prompt locations as a fill bar: amber from 80%, red when full. */
function QuotaBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div
      role="img"
      aria-label={label}
      className="my-[9px] h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full',
          used >= limit ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-foreground/60',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface MetricCardProps {
  label: string;
  tooltip: string;
  icon: LucideIcon;
  value: string;
  delta?: Change | null;
  /** Beside the value, smaller: "of 36 site pages". */
  unit?: React.ReactNode;
  sub?: React.ReactNode;
  spark?: (number | null)[] | null;
  quota?: { used: number; limit: number; label: string } | null;
  /** In place of the sparkline, like Mentions' sentiment split. */
  footer?: React.ReactNode;
  onClick?: () => void;
  clickLabel?: string;
}

/** One KPI card, as in the v2 mockup: label, value with its change, a line of context, a sparkline. */
export function MetricCard({
  label,
  tooltip,
  icon: Icon,
  value,
  delta,
  unit,
  sub,
  spark,
  quota,
  footer,
  onClick,
  clickLabel,
}: MetricCardProps) {
  const clickable = typeof onClick === 'function';
  return (
    <Card
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? clickLabel : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      className={cn(
        'group flex min-w-0 flex-col gap-1.5 rounded-xl px-4 pt-3.5 pb-2.5',
        clickable &&
          'cursor-pointer transition-colors hover:border-foreground/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {/* One line, cut with an ellipsis on narrow cards; the full text on hover. */}
        <span className="truncate" title={label}>
          {label}
        </span>
        <InfoTip content={tooltip} />
        <span className="flex-1" />
        <span className="relative flex h-4 w-4 items-center justify-center">
          <Icon
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-opacity',
              clickable && 'group-hover:opacity-0',
            )}
          />
          {clickable && (
            <ArrowUpRight
              className="absolute h-4 w-4 text-foreground opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          )}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
          {value}
        </span>
        {unit && <span className="text-sm text-muted-foreground tabular-nums">{unit}</span>}
        {delta && (
          <span className={cn('text-xs font-medium tabular-nums', TONE_TEXT[delta.tone])}>
            {delta.text}
          </span>
        )}
      </div>
      <div
        className="truncate text-xs text-muted-foreground"
        title={typeof sub === 'string' ? sub : undefined}
      >
        {sub}
      </div>
      {footer ? (
        footer
      ) : quota ? (
        <QuotaBar used={quota.used} limit={quota.limit} label={quota.label} />
      ) : (
        <Sparkline values={spark ?? []} bad={delta?.tone === 'bad'} />
      )}
    </Card>
  );
}

// ─── The two rows ─────────────────────────────────────────────────────────────

interface KpiRowsProps {
  summary: InsightsSummary;
  trend: VisibilityRateTrendData | null;
  trackedPrompts: TrackedPromptsKpi | null;
  coverage: CoverageKpi | null;
  sov: ShareOfVoiceData | null;
  competitors: CompetitorComparisonData | null;
  comparison: PromptComparison | null;
  series: KpiSeriesDay[] | null;
  /** Visibility's breakdown; Mentions opens its own page. */
  onBreakdown: (metric: 'visibility') => void;
  onNavigate: (path: string) => void;
  /** The Mentions page on the same range and filters, for the Mentions and Net sentiment cards. */
  mentionsHref?: string;
}

/**
 * The Insights KPI cards (VIS-003): today's five on the first row, the new
 * rates on the second, as in the v2 mockup. Changes are against the previous
 * period; the values themselves cover every prompt in the window.
 */
export function KpiRows({
  summary,
  trend,
  trackedPrompts,
  coverage,
  sov,
  competitors,
  comparison,
  series,
  onBreakdown,
  onNavigate,
  mentionsHref = '/dashboard/mentions',
}: KpiRowsProps) {
  const t = useTranslations('insights.kpi');
  const locale = useLocale();
  const f = numberFormat(locale);
  const none = t('noData');
  const pct = (n: number | null) => (n === null ? none : f.percent(n));

  // Every rate comes with its sample size (VIS-005): in the tooltip, and
  // under 20 answers as "Low sample" on the context line, with no change
  // shown for so few answers. A card without a value has nothing to qualify.
  const samples = rateSamples(summary);
  const low = (s: RateSample) => s.count < LOW_SAMPLE_ANSWERS;
  const rateTip = (tip: string, s: RateSample) =>
    `${tip} ${t(`sampleTip.${s.of}`, { count: s.count })}`;
  const rateSub = (s: RateSample, sub: React.ReactNode, hasValue = true) =>
    hasValue && low(s) ? t('lowSample', { count: s.count }) : sub;
  const rateDelta = (s: RateSample, delta: Change | null) => (low(s) ? null : delta);

  const own = competitors?.brands.findIndex((b) => b.isOwnBrand) ?? -1;
  const visibilitySub =
    competitors && own >= 0
      ? t('rankOf', { rank: f.number(own + 1), count: f.number(competitors.brands.length) })
      : coverage
        ? t('appearedIn', {
            visible: f.number(coverage.visiblePrompts),
            active: f.number(coverage.activePrompts),
          })
        : null;
  // Under a change, what it is against; nothing without one.
  const vsPrevious = (change: number | null) => (change === null ? null : t('vsPrevious'));

  const quota =
    trackedPrompts && trackedPrompts.quotaLimit !== -1
      ? { used: trackedPrompts.quotaUsed, limit: trackedPrompts.quotaLimit }
      : null;
  const trackedSub = !trackedPrompts
    ? null
    : !quota
      ? t('unlimited', { count: trackedPrompts.quotaUsed })
      : quota.used > quota.limit
        ? // Only after a downgrade or a lowered limit: adding stops at the limit.
          t('overLimit', { count: quota.used - quota.limit })
        : quota.used === quota.limit
          ? t('limitReached')
          : t('slotsLeft', { count: quota.limit - quota.used });

  const daily = <K extends keyof KpiSeriesDay>(key: K) =>
    series ? series.map((d) => d[key] as number | null) : null;

  return (
    <section aria-label={t('sectionLabel')} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <MetricCard
          label={t('visibility')}
          tooltip={rateTip(t('visibilityTip'), samples.visibility)}
          icon={Eye}
          // No trend read: "No data", never a 0 that reads as a score.
          value={trend ? f.number(trend.summary.rate) : none}
          delta={rateDelta(samples.visibility, upIsGood(trend?.summary.change ?? null, { locale }))}
          // The rank stays beside a short mark (the count is in the tooltip):
          // the card is narrow, and the leaderboard is marked too.
          sub={
            trend && low(samples.visibility)
              ? visibilitySub
                ? `${visibilitySub} · ${t('lowSampleShort')}`
                : t('lowSample', { count: samples.visibility.count })
              : visibilitySub
          }
          spark={trend ? trend.points.map((p) => p.values.you ?? null) : null}
          onClick={() => onBreakdown('visibility')}
          clickLabel={t('viewBreakdown', { metric: t('visibility') })}
        />
        <MetricCard
          label={t('trackedPrompts')}
          tooltip={
            quota
              ? t('trackedPromptsTip', {
                  used: f.number(quota.used),
                  limit: f.number(quota.limit),
                })
              : t('trackedPromptsTipUnlimited')
          }
          icon={Layers}
          value={f.number(trackedPrompts?.activeInPeriod ?? 0)}
          delta={
            comparison && comparison.newPrompts > 0
              ? { text: signedChange(comparison.newPrompts, locale), tone: 'neutral' }
              : null
          }
          sub={trackedSub}
          quota={
            quota
              ? {
                  ...quota,
                  label: t('quotaLabel', {
                    used: f.number(quota.used),
                    limit: f.number(quota.limit),
                  }),
                }
              : null
          }
          onClick={() => onNavigate('/dashboard/prompts')}
          clickLabel={t('openPrompts')}
        />
        <MetricCard
          label={t('mentions')}
          tooltip={t('mentionsTip')}
          icon={MessageCircle}
          value={f.compact(summary.totalMentions)}
          delta={upIsGood(summary.mentionsChange, { percent: true, locale })}
          sub={vsPrevious(summary.mentionsChange)}
          spark={daily('mentions')}
          onClick={() => onNavigate(mentionsHref)}
          clickLabel={t('openMentions')}
        />
        <MetricCard
          label={t('citations')}
          tooltip={t('citationsTip')}
          icon={Quote}
          value={f.compact(summary.totalCitations)}
          delta={upIsGood(summary.citationsChange, { percent: true, locale })}
          sub={vsPrevious(summary.citationsChange)}
          spark={daily('citations')}
          onClick={() => onNavigate('/dashboard/citations')}
          clickLabel={t('openCitations')}
        />
        <MetricCard
          label={t('netSentiment')}
          tooltip={rateTip(t('netSentimentTip'), samples.netSentiment)}
          icon={Smile}
          value={summary.netSentiment === null ? none : signedValue(summary.netSentiment, locale)}
          delta={rateDelta(samples.netSentiment, upIsGood(summary.netSentimentChange, { locale }))}
          sub={rateSub(
            samples.netSentiment,
            summary.netSentiment === null
              ? null
              : t('sentimentSplit', {
                  positive: f.percent(summary.positiveSentimentPct),
                  negative: f.percent(summary.negativeSentimentPct ?? 0),
                }),
            summary.netSentiment !== null,
          )}
          spark={daily('netSentiment')}
          onClick={() => onNavigate(mentionsHref)}
          clickLabel={t('openSentiment')}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label={t('coverage')}
          tooltip={t('coverageTip')}
          icon={Target}
          value={pct(coverage?.value ?? null)}
          delta={upIsGood(coverage?.change ?? null, { locale })}
          // Coverage counts prompts, and its line already gives them.
          sub={
            coverage
              ? t('coverageSub', {
                  visible: f.number(coverage.visiblePrompts),
                  active: f.number(coverage.activePrompts),
                })
              : null
          }
          spark={daily('coverage')}
        />
        <MetricCard
          label={t('shareOfVoice')}
          tooltip={rateTip(t('shareOfVoiceTip'), samples.shareOfVoice)}
          icon={PieChart}
          value={pct(sov ? sov.overallSov : null)}
          delta={rateDelta(
            samples.shareOfVoice,
            upIsGood(sov?.overallSovChange ?? null, { locale }),
          )}
          sub={rateSub(samples.shareOfVoice, t('shareOfVoiceSub'), !!sov)}
          spark={daily('shareOfVoice')}
        />
        <MetricCard
          label={t('avgPosition')}
          tooltip={rateTip(t('avgPositionTip'), samples.avgPosition)}
          icon={ListOrdered}
          value={summary.avgPosition === null ? none : `#${f.number(summary.avgPosition)}`}
          delta={rateDelta(samples.avgPosition, lowerIsGood(summary.avgPositionChange, locale))}
          sub={rateSub(samples.avgPosition, t('avgPositionSub'), summary.avgPosition !== null)}
          spark={daily('avgPosition')}
        />
        <MetricCard
          label={t('citationRate')}
          tooltip={rateTip(t('citationRateTip'), samples.citationRate)}
          icon={Link2}
          value={pct(summary.citationRate)}
          delta={rateDelta(samples.citationRate, upIsGood(summary.citationRateChange, { locale }))}
          sub={rateSub(samples.citationRate, t('citationRateSub'), summary.citationRate !== null)}
          spark={daily('citationRate')}
        />
      </div>
    </section>
  );
}
