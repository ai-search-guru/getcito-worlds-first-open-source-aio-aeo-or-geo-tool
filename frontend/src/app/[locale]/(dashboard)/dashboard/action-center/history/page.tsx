'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, History as HistoryIcon, Search, X } from 'lucide-react';
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
import { useBrandStore } from '@/state/useBrandStore';
import { getActionHistory } from '@/lib/actions/actionHistory';
import { getActionScorecard } from '@/lib/actions/actionScorecard';
import type { ScorecardRow } from '@/lib/action-center/scorecard';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { actionTexts } from '@/lib/action-center/display';
import {
  HISTORY_PAGE_SIZE,
  HISTORY_SORTS,
  HISTORY_STATUSES,
  compareHistory,
  summarize,
  type ActionHistoryItem,
  type HistorySort,
} from '@/lib/action-center/history';
import {
  ACTION_CATEGORIES,
  type ActionCategory,
  type ActionStatus,
} from '@/lib/action-center/registry';
import { PRIORITY_LEVELS, type PriorityLevel } from '@/lib/action-center/priority';
import { SIGNAL_SOURCES, type SignalSource } from '@/lib/signals/registry';
import { ActionCenterTabs } from '@/components/action-center/ActionCenterTabs';
import { HistoryTable } from '@/components/action-center/HistoryTable';
import { HistoryDrawer } from '@/components/action-center/HistoryDrawer';
import { ScorecardTable } from '@/components/action-center/ScorecardTable';
import { cn } from '@/lib/utils';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;
type RangePreset = keyof typeof RANGE_DAYS;
const RANGE_PRESETS = Object.keys(RANGE_DAYS) as RangePreset[];

/** The list of actions, or the scorecard of what each kind did (learning B3). */
const VIEWS = ['actions', 'scorecard'] as const;
type HistoryView = (typeof VIEWS)[number];

/**
 * The range each view starts on until one is picked. An action's final
 * reading comes 30 days after it closed (learning B1), so the scorecard
 * over 30 days would hold mostly readings so far.
 */
const DEFAULT_RANGE: Record<HistoryView, RangePreset> = { actions: '30d', scorecard: '90d' };

/**
 * History: what was done, and what it moved.
 *
 * Reads the same actions the Actions tab triages, but from the far end — an
 * action appears here once it has run its course. Every column except Result
 * comes from a recorded row; Result says what has been measured, which is
 * nothing yet, because no pass re-reads an action's metrics after it closes.
 * See lib/action-center/history.
 */
export default function ActionCenterHistoryPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const brandId = brand?.id ?? null;
  const t = useTranslations('actionCenter.historyPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTypes = useTranslations('actionCenter.actionCategories');
  const tActions = useTranslations('actionCenter.actionsPage');
  const tSources = useTranslations('actionCenter.signalsPage.sources');

  const [items, setItems] = useState<ActionHistoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [view, setView] = useState<HistoryView>('actions');
  // Null until one is picked: the view's own default.
  const [pickedRange, setRange] = useState<RangePreset | null>(null);
  const range = pickedRange ?? DEFAULT_RANGE[view];
  const [status, setStatus] = useState<ActionStatus | 'all'>('all');
  const [type, setType] = useState<ActionCategory | 'all'>('all');
  const [priority, setPriority] = useState<PriorityLevel | 'all'>('all');
  const [source, setSource] = useState<SignalSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<HistorySort>('newest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ActionHistoryItem | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardRow[] | null>(null);
  const [scorecardFailed, setScorecardFailed] = useState(false);

  // Filters, sort and search live in the URL (#896) so a refresh keeps them
  // and a filtered view can be shared. Read after mount, before the first load.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    setView(readUrlChoice('view', VIEWS, 'actions'));
    const urlRange = readUrlParam('range');
    setRange(RANGE_PRESETS.find((preset) => preset === urlRange) ?? null);
    setStatus(readUrlChoice<ActionStatus | 'all'>('status', ['all', ...HISTORY_STATUSES], 'all'));
    setType(readUrlChoice<ActionCategory | 'all'>('type', ['all', ...ACTION_CATEGORIES], 'all'));
    setPriority(
      readUrlChoice<PriorityLevel | 'all'>('priority', ['all', ...PRIORITY_LEVELS], 'all'),
    );
    setSource(readUrlChoice<SignalSource | 'all'>('source', ['all', ...SIGNAL_SOURCES], 'all'));
    setSort(readUrlChoice('sort', HISTORY_SORTS, 'newest'));
    setSearch(readUrlParam('q'));
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (!urlRead) return;
    // Debounced, so typing in search doesn't rewrite the URL on every key.
    const timer = setTimeout(
      () =>
        writeUrlParams(
          { view, range, status, type, priority, source, sort, q: search.trim() },
          {
            view: 'actions',
            range: DEFAULT_RANGE[view],
            status: 'all',
            type: 'all',
            priority: 'all',
            source: 'all',
            sort: 'newest',
          },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [urlRead, view, range, status, type, priority, source, sort, search]);

  const load = useCallback(async () => {
    if (!brandId) {
      setItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const days = RANGE_DAYS[range];
      const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
      setItems(await getActionHistory(brandId, { from }));
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brandId, range]);

  useEffect(() => {
    if (urlRead) void load();
  }, [load, urlRead]);

  // The scorecard is read only when it's shown, over the same range.
  const loadScorecard = useCallback(async () => {
    if (!brandId) return;
    setScorecard(null);
    setScorecardFailed(false);
    try {
      const days = RANGE_DAYS[range];
      const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : undefined;
      setScorecard(await getActionScorecard(brandId, { from }));
    } catch {
      setScorecardFailed(true);
    }
  }, [brandId, range]);

  useEffect(() => {
    if (urlRead && view === 'scorecard') void loadScorecard();
  }, [loadScorecard, urlRead, view]);

  // Any narrowing puts the reader back on page 1; staying on page 4 of a list
  // that now has one page shows nothing and looks like a failure.
  useEffect(() => {
    setPage(1);
  }, [status, type, priority, source, search, sort, range]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (items ?? []).filter((item) => {
      if (status !== 'all' && item.status !== status) return false;
      if (type !== 'all' && item.type !== type) return false;
      if (priority !== 'all' && item.priorityLevel !== priority) return false;
      if (source !== 'all' && !item.sources.includes(source)) return false;
      if (needle) {
        // Titles are composed from i18n templates rather than stored, so the
        // search has to run against what the row actually renders.
        const texts = actionTexts(
          { kind: item.kind, payload: item.payload } as Parameters<typeof actionTexts>[0],
          tTexts,
        );
        const haystack = `${texts.title} ${texts.description} AC-${item.actionNo}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return rows.sort(compareHistory(sort));
  }, [items, status, type, priority, source, search, sort, tTexts]);

  // The scorecard hides the filters, so its cards count the whole range.
  const summary = useMemo(
    () => summarize(view === 'scorecard' ? (items ?? []) : filtered),
    [view, items, filtered],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / HISTORY_PAGE_SIZE));
  const visible = filtered.slice((page - 1) * HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE);

  const hasActiveFilters =
    status !== 'all' || type !== 'all' || priority !== 'all' || source !== 'all' || search !== '';

  const clearFilters = () => {
    setStatus('all');
    setType('all');
    setPriority('all');
    setSource('all');
    setSearch('');
  };

  const header = (
    <HeaderWithAiUsage>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
    </HeaderWithAiUsage>
  );

  if (!brandId) {
    return (
      <div className="space-y-6">
        {header}
        <ActionCenterTabs />
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <h2 className="font-semibold">{t('noBrand.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <ActionCenterTabs />

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </div>
      ) : loadFailed ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
          <Button variant="outline" className="mt-4" onClick={() => void load()}>
            {t('error.retry')}
          </Button>
        </div>
      ) : !items?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <HistoryIcon className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <SummaryCard
              label={t('cards.total')}
              value={summary.totalActions}
              sub={t('cards.totalSub')}
            />
            <SummaryCard
              label={t('cards.completed')}
              value={summary.completed}
              sub={t('cards.ofTotal', { percent: summary.completedPercent })}
            />
            <SummaryCard
              label={t('cards.inProgress')}
              value={summary.inProgress}
              sub={t('cards.ofTotal', { percent: summary.inProgressPercent })}
            />
            <SummaryCard
              label={t('cards.noImprovement')}
              value={summary.noImprovement}
              sub={t('cards.ofTotal', { percent: summary.noImprovementPercent })}
            />
            <SummaryCard
              label={t('cards.dismissed')}
              value={summary.dismissed}
              sub={t('cards.ofTotal', { percent: summary.dismissedPercent })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border">
              {VIEWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  onClick={() => setView(option)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    view === option
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {t(`view.${option}`)}
                </button>
              ))}
            </div>
            <div className="inline-flex overflow-hidden rounded-md border">
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setRange(preset)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    range === preset
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {t(`range.${preset}`)}
                </button>
              ))}
            </div>
            {view === 'actions' && (
              <>
                <FilterSelect
                  label={t('filters.status')}
                  value={status}
                  onChange={(v) => setStatus(v as ActionStatus | 'all')}
                  options={HISTORY_STATUSES.map((v) => ({ value: v, label: t(`status.${v}`) }))}
                  allLabel={t('filters.all')}
                />
                <FilterSelect
                  label={t('filters.type')}
                  value={type}
                  onChange={(v) => setType(v as ActionCategory | 'all')}
                  options={ACTION_CATEGORIES.map((v) => ({ value: v, label: tTypes(v) }))}
                  allLabel={t('filters.all')}
                />
                <FilterSelect
                  label={t('filters.priority')}
                  value={priority}
                  onChange={(v) => setPriority(v as PriorityLevel | 'all')}
                  options={PRIORITY_LEVELS.map((v) => ({
                    value: v,
                    label: tActions(`priority.levels.${v}`),
                  }))}
                  allLabel={t('filters.all')}
                />
                <FilterSelect
                  label={t('filters.source')}
                  value={source}
                  onChange={(v) => setSource(v as SignalSource | 'all')}
                  options={SIGNAL_SOURCES.map((v) => ({ value: v, label: tSources(v) }))}
                  allLabel={t('filters.all')}
                />
                <FilterSelect
                  label={t('filters.sort')}
                  value={sort}
                  onChange={(v) => setSort((v === 'all' ? 'newest' : v) as HistorySort)}
                  options={HISTORY_SORTS.map((v) => ({ value: v, label: t(`sort.${v}`) }))}
                  allLabel={t('sort.newest')}
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
              </>
            )}
          </div>

          {view === 'scorecard' ? (
            scorecardFailed ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
                <h2 className="font-semibold">{t('scorecard.error')}</h2>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 text-xs"
                  onClick={() => void loadScorecard()}
                >
                  {t('scorecard.retry')}
                </Button>
              </div>
            ) : scorecard ? (
              <ScorecardTable rows={scorecard} />
            ) : (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            )
          ) : visible.length > 0 ? (
            <>
              <HistoryTable
                items={visible}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {t('pagination.showing', {
                    from: (page - 1) * HISTORY_PAGE_SIZE + 1,
                    to: Math.min(page * HISTORY_PAGE_SIZE, filtered.length),
                    total: filtered.length,
                  })}
                </span>
                {pageCount > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={page === 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t('pagination.previous')}
                    </Button>
                    <span className="px-2 tabular-nums">
                      {t('pagination.page', { page, pageCount })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={page === pageCount}
                      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                    >
                      {t('pagination.next')}
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
              <h2 className="font-semibold">{t('noMatch.title')}</h2>
              <Button variant="outline" size="sm" className="mt-4 text-xs" onClick={clearFilters}>
                {t('noMatch.clear')}
              </Button>
            </div>
          )}
        </>
      )}

      <HistoryDrawer
        brandId={brandId}
        item={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function SummaryCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
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
