'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import {
  deleteTopic,
  getPromptCountByTopic,
  getTopicsOverview,
  type TopicOverviewRow,
} from '@/lib/actions/topic';
import { TOPIC_NAME_CHARS } from '@/lib/topicNames';
import { readUrlParam, writeUrlParams } from '@/lib/urlState';
import { customUtcWindow } from '@/lib/topicTrend';
import type { PromptRange, PromptRangePreset } from '@/config/promptOptions';
import { TopicSuggestionsCard } from './_TopicSuggestionsCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createTopic } from '@/lib/actions/topic';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Loader2, Plus } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Flame,
  Layers,
  Minus,
  MoreHorizontal,
  RotateCw,
  Settings2,
  Tag,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { formatRelative } from '@/lib/formatRelative';
import { formatNumber } from '@/lib/format';
import { exportFileName } from '@/lib/white-label/exportName';
import { compareNullsLast, type SortDir } from './promptSort';

// ─── Helpers ─────────────────────────────────────────────────────────────

function visibilityBarColor(score: number) {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  if (score >= 25) return 'bg-orange-500';
  return 'bg-rose-500';
}

function visibilityTextColor(score: number) {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  if (score >= 25) return 'text-orange-600 dark:text-orange-400';
  return 'text-rose-600 dark:text-rose-400';
}

const TOPIC_EXPORT_HEADERS = [
  'topic',
  'prompt_count',
  'visibility_rate',
  'visible_prompts',
  'active_prompts',
  'visibility_change',
  'total_mentions',
  'total_citations',
  'share_of_voice',
  'top_competitor',
  'top_competitor_sov',
  'last_run_at',
];

// ─── Sparkline ───────────────────────────────────────────────────────────

function Sparkline({ points }: { points: number[] }) {
  if (!points.length) return null;
  const width = 80;
  const height = 24;
  const max = Math.max(...points, 1);
  const min = Math.min(...points);
  const range = max - min || 1;
  const step = width / Math.max(points.length - 1, 1);

  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = height - ((p - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const last = points[points.length - 1];
  const first = points[0];
  const trendUp = last >= first;

  return (
    <svg width={width} height={height} className="inline-block">
      <path
        d={path}
        fill="none"
        strokeWidth={1.5}
        className={trendUp ? 'stroke-emerald-500' : 'stroke-rose-500'}
      />
    </svg>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'warning';
}) {
  const toneClasses: Record<string, string> = {
    neutral: 'text-foreground',
    positive: 'text-emerald-600 dark:text-emerald-400',
    negative: 'text-rose-600 dark:text-rose-400',
    warning: 'text-amber-600 dark:text-amber-400',
  };
  return (
    <Card>
      <CardContent className="pt-6 pb-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={cn('text-2xl font-semibold tabular-nums', toneClasses[tone])}>{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Sortable leaderboard columns ─────────────────────────────────────────

type TopicSortKey = 'prompts' | 'visibility' | 'sov' | 'mentions' | 'citations' | 'lastRun';

/**
 * Clickable header that toggles asc⇄desc for its column and marks the active
 * sort with a chevron. Mirrors the Prompts page's SortableHead (#597).
 */
function SortableHead({
  children,
  className,
  sortKey,
  activeSort,
  dir,
  onSort,
}: {
  children: React.ReactNode;
  className?: string;
  sortKey: TopicSortKey;
  activeSort: TopicSortKey;
  dir: SortDir;
  onSort: (key: TopicSortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${typeof children === 'string' ? children : sortKey}`}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        {active &&
          (dir === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          ))}
      </button>
    </TableHead>
  );
}

// ─── Row menu ────────────────────────────────────────────────────────────

/** How long a deleted topic can be put back; it is deleted for real after. */
const DELETE_UNDO_MS = 10_000;

/** A leaderboard row's "…" menu, for admins and managers. */
function TopicRowMenu({ name, onDelete }: { name: string; onDelete: () => void }) {
  const t = useTranslations('topics.rowMenu');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={t('label', { name })}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          {t('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Tab ─────────────────────────────────────────────────────────────────

/**
 * The Prompts page's Topics tab: the topic leaderboard, over the
 * page's date range (Location doesn't apply). Loaded only when the tab is
 * shown, as its own chunk, so it costs the other tabs nothing.
 */
export function TopicsTab({
  actionsSlot,
  range,
  rangePreset,
  customFrom,
  customTo,
  onLoaded,
  openAddTopic: addTopicRequested = false,
  onAddTopicOpened,
}: {
  /**
   * The Prompts page's place for a tab's buttons, beside the tabs: Add Topic,
   * Export CSV and Manage topics go there in the order and size the Prompts
   * tab's Add prompt, Export CSV and Manage prompts have. Null until mounted.
   */
  actionsSlot: HTMLElement | null;
  /** The page's range resolved; null for a custom range with no dates yet. */
  range: PromptRange | null;
  rangePreset: PromptRangePreset;
  customFrom: string;
  customTo: string;
  /** Called once the first read has finished, so the page can load the rest. */
  onLoaded?: () => void;
  /**
   * The page asks for Add Topic: "Add a topic" in Add prompt, Suggestions or
   * Query Fan-out on a brand without topics switched to this tab. It opens
   * once, and `onAddTopicOpened` hands the request back.
   */
  openAddTopic?: boolean;
  onAddTopicOpened?: () => void;
}) {
  const t = useTranslations('topics');
  const common = useTranslations('common');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore(
    (s) => s.brands.find((brand) => brand.id === s.activeBrandId) ?? null,
  );
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): Add Topic opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const [loadedTopics, setTopics] = useState<TopicOverviewRow[]>([]);
  const [unassignedPromptCount, setUnassignedPromptCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState(false);
  const openAddTopic = guard(() => setOpen(true), { action: tActions('addTopics') });
  const tDelete = useTranslations('topics.delete');
  // The topic whose delete is being confirmed, and the prompts each topic
  // holds, paused ones too, read as its dialog opens ('failed' if they
  // couldn't be). Deleting moves all of them to no topic, not only the active
  // ones the Prompts column counts.
  const [confirmDelete, setConfirmDelete] = useState<TopicOverviewRow | null>(null);
  // Kept apart from the topic, so the dialog's text stays while it closes.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteCounts, setDeleteCounts] = useState<Record<string, number | 'failed'>>({});
  // Topics deleted from the row menu, hidden at once and deleted for real
  // after the Undo window, as the Prompts tab deletes prompts (PROMPT-006):
  // an Undo inside it changes nothing in the database. A deleted topic stays
  // in the set, so a read that started before the delete can't show it again.
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set());
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const topics = useMemo(
    () => loadedTopics.filter((topic) => !pendingDeletes.has(topic.id)),
    [loadedTopics, pendingDeletes],
  );
  // Default matches the previous hard-coded order (#597): visibility descending.
  const [sortKey, setSortKey] = useState<TopicSortKey>('visibility');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // Only the latest request may fill the table: a slow 90-day read must not
  // land after the 24-hour one picked since.
  const requestRef = useRef(0);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  const handleSort = useCallback(
    (key: TopicSortKey) => {
      setSortDir((prevDir) => (sortKey === key && prevDir === 'desc' ? 'asc' : 'desc'));
      setSortKey(key);
    },
    [sortKey],
  );

  const loadData = useCallback(async () => {
    if (!activeBrandId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    if (!range) return;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const window =
        rangePreset === 'custom'
          ? customUtcWindow(customFrom, customTo, range)
          : { from: range.from, to: range.to };
      const data = await getTopicsOverview(activeBrandId, window);
      if (request !== requestRef.current) return;
      setTopics(data.topics);
      setUnassignedPromptCount(data.unassignedPromptCount);
    } catch (err) {
      if (request !== requestRef.current) return;
      console.error('Failed to load topics overview', err);
      setError(err instanceof Error ? err.message : t('loadError'));
      toast.error(t('loadError'));
    } finally {
      if (request === requestRef.current) setLoading(false);
      onLoadedRef.current?.();
    }
  }, [activeBrandId, range, rangePreset, customFrom, customTo, t]);

  // "Add a topic" from a prompt flow on a brand without one (?new=1) opens
  // Add Topic once: closed, it doesn't open again on a reload. Read-only, it
  // opens the upgrade dialog, as the button does. Before the first read, so
  // the URL is rewritten while no server action is in flight.
  useEffect(() => {
    if (readUrlParam('new') !== '1') return;
    writeUrlParams({ new: null });
    if (canManage) openAddTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read of the URL after mount
  }, []);

  // The same asked for by the page, from one of its own tabs.
  useEffect(() => {
    if (!addTopicRequested) return;
    onAddTopicOpened?.();
    if (canManage) openAddTopic();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [addTopicRequested]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // A delete lands after its Undo window, and reads the tab again with the
  // range picked by then.
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  // A pending delete still lands if the tab unmounts inside the window
  // (switching tabs); only an Undo or closing the page stops it.
  useEffect(() => {
    const timers = deleteTimers.current;
    return () => {
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        deleteTopic(id).catch((err) => console.error('Failed to delete the topic', err));
      }
      timers.clear();
    };
  }, []);

  const sortedTopics = useMemo(() => {
    const valueOf = (row: TopicOverviewRow): number | null => {
      switch (sortKey) {
        case 'prompts':
          return row.promptCount;
        case 'visibility':
          return row.visibilityRate;
        case 'sov':
          return row.shareOfVoice;
        case 'mentions':
          return row.totalMentions;
        case 'citations':
          return row.totalCitations;
        case 'lastRun':
          return row.lastRunAt ? new Date(row.lastRunAt).getTime() : null;
      }
    };
    return [...topics].sort((a, b) => compareNullsLast(valueOf(a), valueOf(b), sortDir));
  }, [topics, sortKey, sortDir]);

  const kpis = useMemo(() => {
    if (topics.length === 0) return null;
    const withData = topics.filter((t) => t.visibilityRate > 0);
    if (withData.length === 0) {
      return {
        total: topics.length,
        best: null as TopicOverviewRow | null,
        weakest: null as TopicOverviewRow | null,
        gainer: null as TopicOverviewRow | null,
      };
    }
    const best = [...withData].sort((a, b) => b.visibilityRate - a.visibilityRate)[0];
    const weakest = [...withData].sort((a, b) => a.visibilityRate - b.visibilityRate)[0];
    const withChange = topics.filter((t) => t.visibilityChange !== null);
    const gainer = withChange.length
      ? [...withChange].sort((a, b) => (b.visibilityChange ?? 0) - (a.visibilityChange ?? 0))[0]
      : null;

    return {
      total: topics.length,
      best,
      weakest,
      gainer,
    };
  }, [topics]);

  const canExport = !loading && topics.length > 0;

  const handleExportCsv = useCallback(async () => {
    if (!canExport) return;

    const rows = topics.map((t) => ({
      topic: t.name,
      prompt_count: t.promptCount,
      visibility_rate: t.visibilityRate,
      visible_prompts: t.visiblePrompts,
      active_prompts: t.activePrompts,
      visibility_change: t.visibilityChange ?? '',
      total_mentions: t.totalMentions,
      total_citations: t.totalCitations,
      share_of_voice: t.shareOfVoice,
      top_competitor: t.topCompetitor?.name ?? '',
      top_competitor_sov: t.topCompetitor?.sov ?? '',
      last_run_at: t.lastRunAt ?? '',
    }));

    const csv = toCsv(rows, TOPIC_EXPORT_HEADERS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const slug = activeBrand?.slug ?? 'brand';

    link.href = url;
    link.download = await exportFileName(`${slug}_topics_${rangePreset}_${date}.csv`);
    link.click();

    URL.revokeObjectURL(url);
  }, [activeBrand?.slug, canExport, rangePreset, topics]);

  if (!activeBrandId) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <Tag className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 text-base font-semibold">{t('noBrandTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('noBrandBody')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleAddTopic = async () => {
    if (isAdding) return;
    const name = newName.trim();
    if (!name) return;
    // A topic waiting out its Undo window still exists.
    if (loadedTopics.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast.error(t('topicAlreadyExists'));
      return;
    }
    setIsAdding(true);
    try {
      const added = await createTopic(activeBrandId, name);
      await loadData();
      setNewName('');
      setOpen(false);
      toast.success(t('topicAdded', { name: added.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failedToAddTopic'));
    } finally {
      setIsAdding(false);
    }
  };

  const askDelete = (topic: TopicOverviewRow) => {
    setConfirmDelete(topic);
    setConfirmOpen(true);
    setDeleteCounts((counts) => {
      const next = { ...counts };
      delete next[topic.id];
      return next;
    });
    getPromptCountByTopic(activeBrandId, topic.id).then(
      (count) => setDeleteCounts((counts) => ({ ...counts, [topic.id]: count })),
      () => setDeleteCounts((counts) => ({ ...counts, [topic.id]: 'failed' })),
    );
  };

  const restoreTopic = (id: string) =>
    setPendingDeletes((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });

  const runDelete = async (topic: TopicOverviewRow) => {
    try {
      await deleteTopic(topic.id);
    } catch (err) {
      console.error('Failed to delete the topic', err);
      restoreTopic(topic.id);
      toast.error(tDelete('failed', { name: topic.name }));
      return;
    }
    // Its prompts now count as prompts without a topic.
    await loadDataRef.current();
  };

  const undoDelete = (id: string) => {
    const timer = deleteTimers.current.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    deleteTimers.current.delete(id);
    restoreTopic(id);
  };

  const deleteWithUndo = (topic: TopicOverviewRow) => {
    setPendingDeletes((set) => new Set(set).add(topic.id));
    const timer = setTimeout(() => {
      deleteTimers.current.delete(topic.id);
      void runDelete(topic);
    }, DELETE_UNDO_MS);
    deleteTimers.current.set(topic.id, timer);
    toast(tDelete('deleted'), {
      description: topic.name,
      duration: DELETE_UNDO_MS,
      action: { label: tDelete('undo'), onClick: () => undoDelete(topic.id) },
    });
  };

  const deleteCount = confirmDelete ? deleteCounts[confirmDelete.id] : undefined;

  return (
    <div className="space-y-6">
      {actionsSlot &&
        createPortal(
          <>
            {canManage && (
              <Button type="button" size="sm" className="gap-2" onClick={openAddTopic}>
                <Plus className="h-4 w-4" />
                {t('addTopic')}
              </Button>
            )}
            <span title={!canExport ? t('exportHint') : undefined}>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleExportCsv}
                disabled={!canExport}
              >
                <Download className="h-4 w-4" />
                {common('exportCsv')}
              </Button>
            </span>
            <Link
              href={`/dashboard/brands/${activeBrandId}/topics`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <Settings2 className="h-4 w-4" />
              {t('manageTopics')}
            </Link>
          </>,
          actionsSlot,
        )}
      {canManage && (
        <Dialog
          open={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) {
              setNewName('');
            }
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t('addTopic')}</DialogTitle>
              <DialogDescription>{t('addTopicDescription')}</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Industry, Comparison..."
                maxLength={TOPIC_NAME_CHARS}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && handleAddTopic()}
                className="flex-1"
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{common('cancel')}</DialogClose>
              <Button
                variant="default"
                onClick={handleAddTopic}
                disabled={isAdding || !newName.trim()}
                className="gap-1.5 shrink-0"
              >
                {isAdding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {t('addTopic')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {canManage && (
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="break-words text-base">
                {tDelete('title', { name: confirmDelete?.name ?? '' })}
              </DialogTitle>
              <DialogDescription className="break-words">
                {deleteCount === undefined
                  ? tDelete('counting')
                  : deleteCount === 'failed'
                    ? tDelete('promptsKept')
                    : tDelete('prompts', { count: deleteCount })}{' '}
                {tDelete('undoHint')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>{tDelete('keep')}</DialogClose>
              <Button
                variant="destructive"
                disabled={deleteCount === undefined}
                onClick={() => {
                  if (confirmDelete) deleteWithUndo(confirmDelete);
                  setConfirmOpen(false);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {tDelete('confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* KPIs */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px]" />
          ))}
        </div>
      ) : kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            icon={Layers}
            label={t('kpi.trackedTopics')}
            value={kpis.total}
            sub={
              unassignedPromptCount > 0
                ? t('kpi.unassignedPrompts', { count: unassignedPromptCount })
                : t('kpi.allCategorised')
            }
          />
          <KpiCard
            icon={Trophy}
            label={t('kpi.bestPerformer')}
            value={kpis.best ? kpis.best.visibilityRate : '—'}
            sub={kpis.best?.name ?? t('kpi.noDataYet')}
            tone="positive"
          />
          <KpiCard
            icon={TrendingDown}
            label={t('kpi.biggestGap')}
            value={kpis.weakest ? kpis.weakest.visibilityRate : '—'}
            sub={kpis.weakest?.name ?? t('kpi.noDataYet')}
            tone="warning"
          />
          <KpiCard
            icon={Flame}
            label={t('kpi.topMover')}
            value={
              kpis.gainer && kpis.gainer.visibilityChange !== null
                ? t('ptsChange', {
                    value: `${kpis.gainer.visibilityChange > 0 ? '+' : ''}${kpis.gainer.visibilityChange.toFixed(1)}`,
                  })
                : '—'
            }
            sub={kpis.gainer?.name ?? t('kpi.notEnoughData')}
            tone={
              kpis.gainer?.visibilityChange && kpis.gainer.visibilityChange >= 0
                ? 'positive'
                : 'negative'
            }
          />
        </div>
      ) : null}

      {/* Topic Suggestions (#463) — collapsed strip by default; loads its
          persisted rows only when expanded and never generates on page load. */}
      <TopicSuggestionsCard brandId={activeBrandId} canManage={canManage} onAccepted={loadData} />

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t('leaderboardTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('leaderboardHint')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : error ? (
            <div className="py-14 text-center text-sm">
              <AlertCircle className="mx-auto h-9 w-9 text-destructive/60" />
              <p className="mt-2 font-medium">{t('loadError')}</p>
              <Button
                className="mt-4 gap-2"
                size="sm"
                variant="outline"
                onClick={() => void loadData()}
              >
                <RotateCw className="h-4 w-4" />
                {common('retry')}
              </Button>
            </div>
          ) : topics.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              <Tag className="mx-auto h-9 w-9 text-muted-foreground/40" />
              <p className="mt-2">{t('emptyTitle')}</p>
              <p className="text-xs">{t('emptyBody')}</p>
              {canManage && (
                <Button className="mt-4" onClick={openAddTopic}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('addTopic')}
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('columns.topic')}</TableHead>
                  <SortableHead
                    className="text-right"
                    sortKey="prompts"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.prompts')}
                  </SortableHead>
                  <SortableHead
                    sortKey="visibility"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.visibility')}
                  </SortableHead>
                  <SortableHead
                    className="text-right"
                    sortKey="sov"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.sov')}
                  </SortableHead>
                  <SortableHead
                    className="text-right"
                    sortKey="mentions"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.mentions')}
                  </SortableHead>
                  <SortableHead
                    className="text-right"
                    sortKey="citations"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.citations')}
                  </SortableHead>
                  <TableHead>{t('columns.trend')}</TableHead>
                  <TableHead>{t('columns.topCompetitor')}</TableHead>
                  <SortableHead
                    className="text-right"
                    sortKey="lastRun"
                    activeSort={sortKey}
                    dir={sortDir}
                    onSort={handleSort}
                  >
                    {t('columns.lastRun')}
                  </SortableHead>
                  <TableHead className="pr-6 text-right w-[40px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTopics.map((topic) => (
                  <TableRow key={topic.id} className="group hover:bg-muted/50">
                    <TableCell className="pl-6 font-medium text-sm">
                      <Link
                        href={`/dashboard/prompts/topics/${topic.id}`}
                        className="hover:underline"
                      >
                        {topic.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {topic.promptCount}
                    </TableCell>
                    <TableCell className="min-w-[160px]">
                      {topic.activePrompts > 0 ? (
                        <div
                          className="flex items-center gap-2"
                          title={t('appearedIn', {
                            visible: topic.visiblePrompts,
                            active: topic.activePrompts,
                          })}
                        >
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums w-11',
                              visibilityTextColor(topic.visibilityRate),
                            )}
                          >
                            {topic.visibilityRate}
                          </span>
                          <div className="h-1.5 flex-1 max-w-[90px] rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                visibilityBarColor(topic.visibilityRate),
                              )}
                              style={{
                                width: `${Math.min(100, topic.visibilityRate)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {topic.shareOfVoice > 0 ? `${topic.shareOfVoice}%` : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatNumber(topic.totalMentions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {formatNumber(topic.totalCitations)}
                    </TableCell>
                    <TableCell>
                      {/* Under two days there is no line, only the change. */}
                      {topic.trendSparkline.some((v) => v > 0) ||
                      topic.visibilityChange !== null ? (
                        <div className="flex items-center gap-2">
                          {topic.trendSparkline.some((v) => v > 0) && (
                            <Sparkline points={topic.trendSparkline} />
                          )}
                          {topic.visibilityChange !== null && topic.visibilityChange !== 0 && (
                            <span
                              className={cn(
                                'text-xs font-medium tabular-nums',
                                topic.visibilityChange > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-rose-600 dark:text-rose-400',
                              )}
                            >
                              {topic.visibilityChange > 0 ? (
                                <TrendingUp className="h-3 w-3 inline mr-0.5" />
                              ) : (
                                <TrendingDown className="h-3 w-3 inline mr-0.5" />
                              )}
                              {t('ptsChange', {
                                value: Math.abs(topic.visibilityChange).toFixed(1),
                              })}
                            </span>
                          )}
                          {topic.visibilityChange === 0 && (
                            <Minus className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {topic.topCompetitor ? (
                        <Badge variant="outline" className="text-[10px]">
                          {topic.topCompetitor.name} · {topic.topCompetitor.sov}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {formatRelative(topic.lastRunAt, common)}
                    </TableCell>
                    {/* The menu's own padding stands in for the cell's, so the
                        table still fits at 1024px. */}
                    <TableCell className={cn('text-right', canManage ? 'pr-3' : 'pr-6')}>
                      <div className="flex items-center justify-end">
                        <Link
                          href={`/dashboard/prompts/topics/${topic.id}`}
                          className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity"
                          aria-label={t('openDetails')}
                        >
                          <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        </Link>
                        {canManage && (
                          <TopicRowMenu
                            name={topic.name}
                            onDelete={guard(() => askDelete(topic), {
                              action: tActions('deleteTopics'),
                            })}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
