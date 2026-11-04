'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { numberFormat } from '@/lib/numberFormat';
import { LOW_SAMPLE_ANSWERS } from '@/lib/insightsSummary';
import { dayLabel } from './kpiFormat';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { setPinnedCompetitors } from '@/lib/actions/brand';
import type { VisibilityRateTrendData } from '@/lib/actions/tracking';
import {
  MAX_PINNED_COMPETITORS,
  trendLines,
  trendMarkers,
  type TrendMarker,
  type TrendMarkerData,
} from '@/lib/insightsTrend';

const VisibilityRateTrendChart = dynamic(
  () => import('./_charts').then((m) => m.VisibilityRateTrendChart),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full" /> },
);

/**
 * The visibility trend card (VIS-007), as in the v2 mockup: the score over
 * the range, your line and the pinned competitors (chips to highlight them,
 * "Pin" to choose up to five, saved on the brand), the Action Center goal,
 * and markers for the days prompts were added.
 */
export function TrendCard({
  brandId,
  data,
  markers,
  rangeLabel,
  answers,
  onPinnedChange,
  className,
}: {
  brandId: string;
  data: VisibilityRateTrendData | null;
  /** Null on the 24h view and when the read failed: no markers, no goal. */
  markers: TrendMarkerData | null;
  /** "last 30 days", "all time", … */
  rangeLabel: string;
  /** The period's answers: under 20 the headline is a low sample (VIS-005). */
  answers?: number;
  onPinnedChange: (pinned: string[]) => void;
  className?: string;
}) {
  const t = useTranslations('insights.trend');
  const locale = useLocale();
  const f = numberFormat(locale);
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): pinning opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!data || data.points.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="flex h-[360px] items-center justify-center text-sm text-muted-foreground">
          {t('noData')}
        </CardContent>
      </Card>
    );
  }

  const lines = trendLines(data.entities, data.points, data.pinned);
  const competitors = data.entities.filter((e) => !e.isOwnBrand);
  // The menu edits the lines in view: without pins, the strongest four count
  // as checked, so pinning starts from what the chart shows.
  const onChart = lines.filter((l) => !l.isOwnBrand).map((l) => l.key);

  const togglePin = async (key: string) => {
    const next = onChart.includes(key) ? onChart.filter((k) => k !== key) : [...onChart, key];
    if (saving || next.length === 0 || next.length > MAX_PINNED_COMPETITORS) return;
    const previous = data.pinned;
    onPinnedChange(next);
    setSaving(true);
    try {
      onPinnedChange(await setPinnedCompetitors(brandId, next));
    } catch {
      onPinnedChange(previous);
      toast.error(t('pinFailed'));
    } finally {
      setSaving(false);
    }
  };

  const describe = (m: TrendMarker) =>
    t('promptsAdded', { count: m.count, date: dayLabel(m.day, locale) });
  // Every marker is listed below the chart; only those with a point are drawn on it.
  const placed = markers
    ? trendMarkers(markers, data.points).map((m) => ({
        ...m,
        glyph: '+',
        title: describe(m),
      }))
    : [];
  const goal =
    markers?.goal != null
      ? { value: markers.goal, label: t('goal', { value: f.number(markers.goal) }) }
      : null;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-3xl font-bold tabular-nums">{f.number(data.summary.rate)}</div>
            <div className="text-xs text-muted-foreground">
              {t('subtitle', { range: rangeLabel })}
              {answers !== undefined && answers < LOW_SAMPLE_ANSWERS && (
                <> · {t('lowSample', { count: answers })}</>
              )}
            </div>
          </div>
          <ul className="flex flex-wrap items-center gap-1.5">
            {lines.map((line) => (
              <li
                key={line.key}
                tabIndex={0}
                className="inline-flex h-[26px] cursor-default items-center gap-1.5 rounded-full border px-2.5 text-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ opacity: hoveredKey !== null && hoveredKey !== line.key ? 0.4 : 1 }}
                onMouseEnter={() => setHoveredKey(line.key)}
                onMouseLeave={() => setHoveredKey(null)}
                onFocus={() => setHoveredKey(line.key)}
                onBlur={() => setHoveredKey(null)}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: line.color }}
                  aria-hidden
                />
                <span className={cn(line.isOwnBrand && 'font-medium')}>{line.name}</span>
              </li>
            ))}
            {canManage && competitors.length > 0 && (
              <li>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={saving}
                    title={t('pinTitle')}
                    className="inline-flex h-[26px] items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" aria-hidden />
                    {t('pin')}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 min-w-52 overflow-y-auto">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>{t('pinMenu')}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {competitors.map((c) => {
                        const checked = onChart.includes(c.key);
                        return (
                          <DropdownMenuCheckboxItem
                            key={c.key}
                            checked={checked}
                            disabled={
                              saving ||
                              // At most five, and at least one: an empty list
                              // would bring back the automatic four.
                              (checked
                                ? onChart.length === 1
                                : onChart.length >= MAX_PINNED_COMPETITORS)
                            }
                            onCheckedChange={guard(() => togglePin(c.key), {
                              action: tActions('pinCompetitors'),
                            })}
                          >
                            {c.name}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1 text-xs text-muted-foreground">{t('pinLimit')}</div>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )}
          </ul>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <VisibilityRateTrendChart
          data={data}
          lines={lines}
          markers={placed.filter(
            (m): m is (typeof placed)[number] & { date: string } => m.date !== null,
          )}
          goal={goal}
          hoveredKey={hoveredKey}
          onHover={setHoveredKey}
        />
        {(placed.length > 0 || goal) && (
          <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11.5px] text-muted-foreground">
            {placed.map((m) => (
              <li key={`${m.kind}-${m.day}`} className="flex items-center gap-1.5">
                <span className="font-semibold text-foreground/70" aria-hidden>
                  {m.glyph}
                </span>
                {m.title}
              </li>
            ))}
            {goal && (
              <li className="flex items-center gap-1.5">
                <span className="tracking-tighter text-green-600 dark:text-green-500" aria-hidden>
                  - - -
                </span>
                {t('goalLegend')}
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
