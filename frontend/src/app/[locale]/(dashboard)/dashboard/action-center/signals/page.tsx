'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertCircle,
  Download,
  Info,
  Minus,
  Radar,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useBrandStore } from '@/state/useBrandStore';
import type { Brand } from '@/types';
import {
  getSignals,
  getSignalsSummary,
  updateSignalStatus,
  type Signal,
  type SignalsSummary,
} from '@/lib/actions/signals';
import {
  SIGNAL_CATEGORIES,
  SIGNAL_IMPACTS,
  SIGNAL_SOURCES,
  SIGNAL_STATUSES,
  type SignalCategory,
  type SignalImpact,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';
import { signalAffected, signalTexts } from '@/lib/signals/display';
import { isOnPlatform, locationName, platformName } from '@/lib/signals/names';
import { groupSignals } from '@/lib/signals/group';
import { getAIProviderDisplayName, type AIProviderKey } from '@/components/AiProviderAvatar';
import { ActionCenterTabs } from '@/components/action-center/ActionCenterTabs';
import { isSuperseded, SignalTable } from '@/components/action-center/SignalTable';
import { SignalDrawer } from '@/components/action-center/SignalDrawer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { exportFileName } from '@/lib/white-label/exportName';
import type { KpiTrendPoint } from '@/lib/actions/kpis';
import { signalChangeTone, signedPercent, type SignalMetric } from '@/lib/signals/metrics';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { useUpgradeGate } from '@/components/context/upgradeGate';

const SIGNAL_EXPORT_HEADERS = [
  'title',
  'category',
  'impact',
  'status',
  'sources',
  'platforms',
  'locations',
  'detected',
  'last_detected',
];

// The engines the Platform filter can name, in the order it lists them.
const PLATFORM_FILTERS: readonly AIProviderKey[] = [
  'openai',
  'googleAio',
  'googleAiMode',
  'google',
  'perplexity',
  'copilot',
  'anthropic',
  'xai',
  'meta',
];

const KpiSparkline = dynamic(() => import('@/components/action-center/KpiSparkline'), {
  ssr: false,
  loading: () => <Skeleton className="h-8 w-[110px]" />,
});

type SignalDatePreset = '7d' | '30d' | '90d';
const DATE_PRESETS: readonly SignalDatePreset[] = ['7d', '30d', '90d'];
const PRESET_DAYS: Record<SignalDatePreset, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 86_400_000;

function utcDay(offset = 0): string {
  return new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
}

export default function ActionCenterSignalsPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.signalsPage');

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </HeaderWithAiUsage>
      <ActionCenterTabs />
      {brand ? (
        <SignalsContent key={brand.id} brand={brand} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      )}
    </div>
  );
}

function SignalsContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.signalsPage');
  // A read-only workspace (plan not active): a signal's status, from its row,
  // group or drawer, opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const common = useTranslations('common');
  const tTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.signalCategories');

  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [summary, setSummary] = useState<SignalsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [datePreset, setDatePreset] = useState<SignalDatePreset>('30d');
  const [category, setCategory] = useState<SignalCategory | 'all'>('all');
  const [impact, setImpact] = useState<SignalImpact | 'all'>('all');
  const [status, setStatus] = useState<SignalStatus | 'all'>('all');
  const [source, setSource] = useState<SignalSource | 'all'>('all');
  const [platform, setPlatform] = useState<AIProviderKey | 'all'>('all');
  const [search, setSearch] = useState('');

  // Filters and search live in the URL (#896) so a refresh keeps them and a
  // filtered view can be shared. Read after mount, before the first load.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    setDatePreset(readUrlChoice('range', DATE_PRESETS, '30d'));
    setCategory(
      readUrlChoice<SignalCategory | 'all'>('category', ['all', ...SIGNAL_CATEGORIES], 'all'),
    );
    setImpact(readUrlChoice<SignalImpact | 'all'>('impact', ['all', ...SIGNAL_IMPACTS], 'all'));
    setStatus(readUrlChoice<SignalStatus | 'all'>('status', ['all', ...SIGNAL_STATUSES], 'all'));
    setSource(readUrlChoice<SignalSource | 'all'>('source', ['all', ...SIGNAL_SOURCES], 'all'));
    setPlatform(
      readUrlChoice<AIProviderKey | 'all'>('platform', ['all', ...PLATFORM_FILTERS], 'all'),
    );
    setSearch(readUrlParam('q'));
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (!urlRead) return;
    // Debounced, so typing in search doesn't rewrite the URL on every key.
    const timer = setTimeout(
      () =>
        writeUrlParams(
          { range: datePreset, category, impact, status, source, platform, q: search.trim() },
          {
            range: '30d',
            category: 'all',
            impact: 'all',
            status: 'all',
            source: 'all',
            platform: 'all',
          },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [urlRead, datePreset, category, impact, status, source, platform, search]);

  const [selected, setSelected] = useState<Signal | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  // The open drawer lives in the URL (?signal=<id>), mirroring the Actions
  // page: back from a prompt page — or a refresh — restores it, and the
  // action drawer's evidence links land here with the drawer already open.
  const selectSignal = (signal: Signal | null) => {
    setSelected(signal);
    const params = new URLSearchParams(window.location.search);
    if (signal) params.set('signal', signal.id);
    else params.delete('signal');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  };

  const windowDays = PRESET_DAYS[datePreset];
  const dayFrom = utcDay(windowDays - 1);
  const dayTo = utcDay();

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const [rows, sums] = await Promise.all([
        getSignals(brand.id, { dayFrom, dayTo }),
        getSignalsSummary(brand.id, dayFrom, dayTo),
      ]);
      setSignals(rows);
      setSummary(sums);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id, dayFrom, dayTo]);

  useEffect(() => {
    if (urlRead) void load();
  }, [load, urlRead]);

  // Restore the drawer named by the URL once the list is in. Read via
  // window.location rather than useSearchParams to keep the page out of a
  // Suspense boundary; the param stays while the drawer is open.
  useEffect(() => {
    if (!signals) return;
    const signalId = new URLSearchParams(window.location.search).get('signal');
    if (!signalId) return;
    const match = signals.find((signal) => signal.id === signalId);
    if (match) setSelected(match);
  }, [signals]);

  // Category/impact/status/source/search all narrow client-side: the whole
  // window is already loaded (per-brand signal counts are tens), and search
  // must match the composed titles, which only exist here.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (signals ?? []).filter((signal) => {
      if (category !== 'all' && signal.category !== category) return false;
      if (impact !== 'all' && signal.impact !== impact) return false;
      if (status !== 'all' && signal.status !== status) return false;
      if (source !== 'all' && !signal.source.includes(source)) return false;
      if (platform !== 'all' && !isOnPlatform(signal.where.platforms, platform)) return false;
      if (needle) {
        const texts = signalTexts(signal, tTexts);
        const affected = signalAffected(signal, t);
        const where = [
          ...signal.where.platforms.map(platformName),
          ...signal.where.regions.map(locationName),
        ].join(' ');
        const haystack =
          `${texts.title} ${texts.description} ${affected.detail ?? ''} ${where}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [signals, category, impact, status, source, platform, search, tTexts, t]);

  // Only the engines this window's signals are about, plus a picked one that
  // has none, so the filter never offers an empty choice it can't explain.
  const platformOptions = useMemo(
    () =>
      PLATFORM_FILTERS.filter(
        (family) =>
          family === platform ||
          (signals ?? []).some((signal) => isOnPlatform(signal.where.platforms, family)),
      ).map((family) => ({ value: family, label: getAIProviderDisplayName(family) })),
    [signals, platform],
  );

  const handleExportCsv = useCallback(async () => {
    if (visible.length === 0) return;

    const rows = visible.map((signal) => ({
      title: signalTexts(signal, tTexts).title,
      category: tCategories(signal.category),
      impact: t(`impact.${signal.impact}`),
      status: isSuperseded(signal) ? t('superseded') : t(`status.${signal.status}`),
      sources: signal.source.map((item) => t(`sources.${item}`)).join(', '),
      platforms: signal.where.platforms.map(platformName).join(', '),
      locations: signal.where.regions.map(locationName).join(', '),
      detected: signal.detectedAt,
      last_detected: signal.lastDetectedAt,
    }));

    const csv = toCsv(rows, SIGNAL_EXPORT_HEADERS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const slug = brand.slug ?? 'brand';

    link.href = url;
    link.download = await exportFileName(`${slug}_signals_${date}.csv`);
    link.click();

    URL.revokeObjectURL(url);
  }, [brand.slug, visible, tTexts, tCategories, t]);

  // The list shows copies of one finding as one row, and the counts follow.
  const groups = useMemo(() => groupSignals(visible), [visible]);
  const allGroups = useMemo(() => groupSignals(signals ?? []), [signals]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<SignalCategory, number>();
    for (const { signals: members } of allGroups) {
      const category = members[0].category;
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [allGroups]);

  // One sparkline series per card, over the window's days (capped at 30
  // points so 90d stays legible at sparkline size).
  const sparkSeries = useCallback(
    (byDay: Record<string, number>): KpiTrendPoint[] => {
      const points = Math.min(windowDays, 30);
      return Array.from({ length: points }, (_, i) => {
        const day = utcDay(points - 1 - i);
        return { date: day, value: byDay[day] ?? 0 };
      });
    },
    [windowDays],
  );

  // "vs Aug 20 – Aug 26" — the previous equal-length window, spelled out
  // like the mockup rather than as a relative phrase.
  const prevRangeLabel = useMemo(() => {
    const fmt = (day: string) =>
      new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    return `${fmt(utcDay(windowDays * 2 - 1))} – ${fmt(utcDay(windowDays))}`;
  }, [windowDays]);

  const countsNote =
    allGroups.length < (signals?.length ?? 0) ? t('grouped.countsNote') : undefined;

  const hasActiveFilters =
    category !== 'all' ||
    impact !== 'all' ||
    status !== 'all' ||
    source !== 'all' ||
    platform !== 'all' ||
    search !== '';

  const clearFilters = () => {
    setCategory('all');
    setImpact('all');
    setStatus('all');
    setSource('all');
    setPlatform('all');
    setSearch('');
  };

  // One signal from its drawer or row, or every copy a group's menu applies to.
  const handleStatusChange = async (targets: Signal[], nextStatus: SignalStatus) => {
    const ids = new Set(targets.map((signal) => signal.id));
    const withBusy = (on: boolean) =>
      setBusyIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (on) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    withBusy(true);
    try {
      await updateSignalStatus(brand.id, [...ids], nextStatus);
      const patch = (s: Signal) =>
        ids.has(s.id)
          ? {
              ...s,
              status: nextStatus,
              resolvedAt: nextStatus === 'resolved' ? new Date().toISOString() : null,
            }
          : s;
      setSignals((prev) => (prev ?? []).map(patch));
      setSelected((prev) => (prev && ids.has(prev.id) ? patch(prev) : prev));
    } catch {
      toast.error(t('statusChangeFailed'));
    } finally {
      withBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          {t('error.retry')}
        </Button>
      </div>
    );
  }

  if (!signals?.length && !hasActiveFilters) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <Radar className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            metric="total"
            label={t('cards.total')}
            population={t('cards.totalPopulation', { days: windowDays })}
            value={summary.total}
            prev={summary.prevTotal}
            rangeLabel={prevRangeLabel}
            spark={sparkSeries(summary.byDayActive)}
            note={countsNote}
          />
          <SummaryCard
            metric="important"
            label={t('cards.important')}
            population={t('cards.importantPopulation', { days: windowDays })}
            value={summary.important}
            prev={summary.prevImportant}
            rangeLabel={prevRangeLabel}
            spark={sparkSeries(summary.byDayImportant)}
            note={countsNote}
          />
          <SummaryCard
            metric="new"
            label={t('cards.new')}
            population={t('cards.newPopulation', { days: windowDays })}
            value={summary.newCount}
            prev={summary.prevNew}
            rangeLabel={prevRangeLabel}
            spark={sparkSeries(summary.byDayNew)}
            note={countsNote}
          />
          <SummaryCard
            metric="resolved"
            label={t('cards.resolved')}
            population={t('cards.resolvedPopulation', { days: windowDays })}
            value={summary.resolved}
            prev={summary.prevResolved}
            rangeLabel={prevRangeLabel}
            spark={sparkSeries(summary.byDayResolved)}
            note={countsNote}
          />
          <AvgImpactCard summary={summary} days={windowDays} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryPill
            label={t('allSignals')}
            count={allGroups.length}
            isActive={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {SIGNAL_CATEGORIES.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) => (
            <CategoryPill
              key={key}
              label={tCategories(key)}
              count={categoryCounts.get(key) ?? 0}
              isActive={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
          {countsNote && (
            <span className="flex items-center text-muted-foreground" title={countsNote}>
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{countsNote}</span>
            </span>
          )}
        </div>
        <div
          className="flex h-8 overflow-hidden rounded-md border"
          role="group"
          aria-label={t('table.detected')}
        >
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setDatePreset(preset)}
              aria-pressed={datePreset === preset}
              className={cn(
                'px-3 text-xs font-medium transition-colors',
                datePreset === preset
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-foreground hover:bg-muted',
              )}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label={t('filters.impact')}
          value={impact}
          onChange={(v) => setImpact(v as SignalImpact | 'all')}
          options={SIGNAL_IMPACTS.map((v) => ({ value: v, label: t(`impact.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.status')}
          value={status}
          onChange={(v) => setStatus(v as SignalStatus | 'all')}
          options={SIGNAL_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.source')}
          value={source}
          onChange={(v) => setSource(v as SignalSource | 'all')}
          options={SIGNAL_SOURCES.map((v) => ({ value: v, label: t(`sources.${v}`) }))}
          allLabel={t('filters.all')}
        />
        <FilterSelect
          label={t('filters.platform')}
          value={platform}
          onChange={(v) => setPlatform(v as AIProviderKey | 'all')}
          options={platformOptions}
          allLabel={t('filters.all')}
        />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('filters.search')}
            className="h-8 w-56 pl-8 text-xs"
          />
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" />
            {t('filters.clear')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto gap-2 text-xs"
          onClick={handleExportCsv}
          disabled={visible.length === 0}
        >
          <Download className="h-3.5 w-3.5" />
          {common('exportCsv')}
        </Button>
      </div>

      {visible.length > 0 ? (
        <SignalTable
          groups={groups}
          onSelect={selectSignal}
          onStatusChange={guard(
            (targets: Signal[], next: SignalStatus) => void handleStatusChange(targets, next),
            { action: tActions('changeSignalStatus') },
          )}
          busyIds={busyIds}
          selectedId={selected?.id ?? null}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        </div>
      )}

      <SignalDrawer
        brandId={brand.id}
        signal={selected}
        onOpenChange={(open) => {
          if (!open) selectSignal(null);
        }}
        onStatusChange={guard(
          (signal: Signal, next: SignalStatus) => void handleStatusChange([signal], next),
          { action: tActions('changeSignalStatus') },
        )}
        isBusy={selected ? busyIds.has(selected.id) : false}
      />
    </div>
  );
}

function SummaryCard({
  metric,
  label,
  population,
  value,
  prev,
  rangeLabel,
  spark,
  note,
}: {
  metric: SignalMetric;
  label: string;
  /** What the count counts, in the selected range (AC-008). */
  population: string;
  value: number;
  prev: number;
  rangeLabel: string;
  spark: KpiTrendPoint[];
  /** Why the count may be lower than the rows behind it. */
  note?: string;
}) {
  const t = useTranslations('actionCenter.signalsPage');
  const change = prev > 0 ? Math.round(((value - prev) / prev) * 100) : null;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          {note && (
            <span title={note}>
              <Info className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">{note}</span>
            </span>
          )}
        </p>
        <div className="mt-1 flex items-end justify-between gap-2">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {spark.length > 1 && (
            <span className="text-muted-foreground/60">
              <KpiSparkline points={spark} />
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{population}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {change !== null ? (
            <>
              <span
                className={cn(
                  'flex items-center gap-0.5 font-medium',
                  signalChangeTone(metric, change) === 'positive'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-foreground/80',
                )}
              >
                {change > 0 ? (
                  <TrendingUp className="h-3 w-3" aria-hidden="true" />
                ) : change < 0 ? (
                  <TrendingDown className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Minus className="h-3 w-3" aria-hidden="true" />
                )}
                {signedPercent(change)}
              </span>
              {t('cards.vsRange', { range: rangeLabel })}
            </>
          ) : (
            t('cards.noPrev')
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function AvgImpactCard({ summary, days }: { summary: SignalsSummary; days: number }) {
  const t = useTranslations('actionCenter.signalsPage');
  const levelOf = (important: number, total: number) => {
    const ratio = total > 0 ? important / total : 0;
    return ratio >= 0.5 ? 'high' : ratio >= 0.2 ? 'medium' : 'low';
  };
  const level = levelOf(summary.important, summary.total);
  const prevLevel = levelOf(summary.prevImportant, summary.prevTotal);
  const comparison =
    summary.prevTotal === 0
      ? t('cards.noPrev')
      : level === prevLevel
        ? t('cards.impactSame', { days })
        : level === 'high' || (level === 'medium' && prevLevel === 'low')
          ? t('cards.impactHigher', { days })
          : t('cards.impactLower', { days });
  const filled = level === 'high' ? 10 : level === 'medium' ? 6 : 3;
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{t('cards.avgImpact')}</p>
        <p className="mt-1 text-2xl font-bold">{t(`impact.${level}`)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('cards.avgImpactPopulation', { days })}
        </p>
        <div className="mt-1.5 flex gap-0.5" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={cn('h-2.5 w-1 rounded-sm', i < filled ? 'bg-foreground/70' : 'bg-muted')}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{comparison}</p>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel: string;
}) {
  const items = [{ value: 'all', label: allLabel }, ...options];
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? 'all')} items={items}>
      <SelectTrigger className="h-8 w-36 text-xs">
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CategoryPill({
  label,
  count,
  isActive,
  onClick,
}: {
  label: string;
  count: number;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
        isActive
          ? 'border-foreground/20 bg-muted text-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {label}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
