'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowUpDown,
  CircleDot,
  Download,
  ListChecks,
  Loader2,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { useBrandStore } from '@/state/useBrandStore';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import type { ChatPageFilter } from '@/lib/chat/pageContext';
import { useUserRole } from '@/hooks/useUserRole';
import { onFirstRunFinished, useFirstRun } from '@/hooks/useFirstRun';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import type { Brand } from '@/types';
import {
  deleteAction,
  getActions,
  getActionsAffected,
  keepActionRelevant,
  updateActionStatus,
  type ActionItem,
} from '@/lib/actions/actionCenter';
import { listBrandMembers, type TeamMember } from '@/lib/actions/team';
import {
  getGettingStarted,
  skipGettingStarted,
  startGettingStarted,
} from '@/lib/actions/gettingStarted';
import type { GettingStartedStatus, GettingStartedStep } from '@/lib/getting-started/steps';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import {
  ACTION_CATEGORIES,
  ACTION_SORTS,
  ACTION_STATUSES,
  FROM_PRODUCTS_KINDS,
  OPEN_ACTION_STATUSES,
  type ActionCategory,
  type ActionDismissReason,
  type ActionSort,
  type ActionStatus,
} from '@/lib/action-center/registry';
import {
  actionContextTags,
  actionTexts,
  assigneeLabel,
  memberLabel,
} from '@/lib/action-center/display';
import {
  PRIORITY_LEVELS,
  comparePriority,
  highestPriorityLevel,
  isStale,
  topActionIds,
  type PriorityLevel,
} from '@/lib/action-center/priority';
import { ActionCenterTabs } from '@/components/action-center/ActionCenterTabs';
import { ActionTable } from '@/components/action-center/ActionTable';
import { ActionDrawer } from '@/components/action-center/ActionDrawer';
import {
  GettingStartedTable,
  arrivingStep,
  readyWhenKey,
} from '@/components/getting-started/GettingStartedTable';
import { GettingStartedSummaryCard } from '@/components/getting-started/SummaryCard';
import { GettingStartedStepCard } from '@/components/getting-started/StepCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { BYTE_ORDER_MARK, actionListCsv } from '@/lib/action-center/export';
import { saveBlob } from '@/lib/download';
import { exportFileName } from '@/lib/white-label/exportName';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const isOpen = (action: ActionItem) => OPEN_ACTION_STATUSES.includes(action.status);

/** The Status filter: a status, or Stale (New with no one on it for a month, 00432). */
type StatusChoice = ActionStatus | 'all' | 'stale';
const STATUS_CHOICES: StatusChoice[] = ['all', ...ACTION_STATUSES, 'stale'];

/**
 * What each summary card counts, one predicate per card.
 *
 * The cards used to be numbers with no way back to the rows behind them: "At
 * Risk 2" above a table of three, and nothing saying which two — At Risk spans
 * Recover *and* Fix, which neither the card nor the category badges admitted.
 * Clicking a card now narrows the table to exactly what it counted, and since
 * the count and the filter read the same predicate they cannot disagree.
 */
const CARD_FILTERS = {
  atRisk: (action: ActionItem) =>
    isOpen(action) && (action.category === 'recover' || action.category === 'fix'),
  opportunities: (action: ActionItem) => isOpen(action) && action.category === 'growth',
  inProgress: (action: ActionItem) => action.status === 'in_progress',
} as const;

/** Top Actions is the five highest-priority open actions (AC-006), not a predicate. */
type CardFocus = keyof typeof CARD_FILTERS | 'top';

/**
 * Getting started (AC-ALT2 §4) is a category of its own while a brand runs
 * it: its steps, not generated actions, so it lists them in its own table.
 */
const GETTING_STARTED = 'getting_started';
type CategoryChoice = ActionCategory | 'all' | typeof GETTING_STARTED;

/**
 * How long after the first run finishes the list is read once more: the
 * brand's first signal pass starts when the run stamps, and writes the first
 * actions within a minute or so.
 */
const FIRST_SIGNALS_MS = 90_000;

/** URL params that ask for the actions themselves, not Getting started. */
const ACTIONS_PARAMS = [
  'category',
  'action',
  'priority',
  'status',
  'assignee',
  'q',
  'sort',
  'from',
];

export default function ActionCenterActionsPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const brands = useBrandStore((s) => s.brands);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);
  const t = useTranslations('actionCenter.actionsPage');

  // A link to an action on another brand (Chat's Open in Actions, actions/[id]) names
  // its brand: switch to it once, when it's one of the person's, so its drawer opens.
  // A brand picked afterwards stays picked.
  const brandFromUrl = useRef(false);
  useEffect(() => {
    if (brandFromUrl.current || brands.length === 0) return;
    brandFromUrl.current = true;
    const named = new URLSearchParams(window.location.search).get('brand');
    if (named && brands.some((b) => b.id === named)) setActiveBrand(named);
  }, [brands, setActiveBrand]);

  return (
    <div className="space-y-6">
      {brand ? (
        <ActionsContent key={brand.id} brand={brand} />
      ) : (
        <>
          <ActionsHeader />
          <ActionCenterTabs />
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <h2 className="text-lg font-semibold">{t('noBrand.title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('noBrand.description')}</p>
          </div>
        </>
      )}
    </div>
  );
}

/** The page's title, with Getting started's Start or Skip on the right. */
function ActionsHeader({ action }: { action?: React.ReactNode }) {
  const t = useTranslations('actionCenter.actionsPage');
  return (
    <HeaderWithAiUsage>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {action}
      </div>
    </HeaderWithAiUsage>
  );
}

function ActionsContent({ brand }: { brand: Brand }) {
  const t = useTranslations('actionCenter.actionsPage');
  const common = useTranslations('common');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tChat = useTranslations('chatPanel.suggest');
  const tStarted = useTranslations('actionCenter.gettingStarted');

  const [actions, setActions] = useState<ActionItem[] | null>(null);
  // Null for a brand that doesn't run Getting started, or when it can't be
  // read: the page is then exactly as without it.
  const [gettingStarted, setGettingStarted] = useState<GettingStartedStatus | null>(null);
  // The step whose card is open.
  const [stepKey, setStepKey] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [category, setCategory] = useState<CategoryChoice>('all');
  // "From Products" (ECOM-013): only what Product Visibility sent, beside the category.
  const [fromProducts, setFromProducts] = useState(false);
  const [priority, setPriority] = useState<PriorityLevel | 'all'>('all');
  const [status, setStatus] = useState<StatusChoice>('all');
  const [assignee, setAssignee] = useState<string>('all');
  const [sort, setSort] = useState<ActionSort>('priority');
  const [search, setSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const { canManage } = useUserRole();
  // Rows with a menu change in flight.
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  // False once this brand's view is gone, so an export still reading doesn't
  // download the previous brand's file after a switch.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [focus, setFocus] = useState<CardFocus | null>(null);

  // Filters, sort and search live in the URL (#896) so a refresh keeps them
  // and a filtered view can be shared. Read after mount; defaults stay out.
  const [urlRead, setUrlRead] = useState(false);
  // A category from the URL is kept, and so is a link to an action or a
  // filtered list (Create action, a signal, the history drawer, an export):
  // the actions were asked for. Without any, Getting started opens first.
  const categoryChosen = useRef(false);
  useEffect(() => {
    categoryChosen.current = ACTIONS_PARAMS.some((name) => readUrlParam(name) !== '');
    setCategory(
      readUrlChoice<CategoryChoice>(
        'category',
        ['all', ...ACTION_CATEGORIES, GETTING_STARTED],
        'all',
      ),
    );
    setPriority(
      readUrlChoice<PriorityLevel | 'all'>('priority', ['all', ...PRIORITY_LEVELS], 'all'),
    );
    setStatus(readUrlChoice<StatusChoice>('status', STATUS_CHOICES, 'all'));
    setAssignee(readUrlParam('assignee') || 'all');
    setSort(readUrlChoice<ActionSort>('sort', ACTION_SORTS, 'priority'));
    setSearch(readUrlParam('q'));
    setFromProducts(readUrlParam('from') === 'products');
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (!urlRead) return;
    // Debounced, so typing in search doesn't rewrite the URL on every key.
    const timer = setTimeout(
      () =>
        writeUrlParams(
          {
            category,
            priority,
            status,
            assignee,
            sort,
            q: search.trim(),
            from: fromProducts ? 'products' : 'all',
          },
          {
            category: 'all',
            priority: 'all',
            status: 'all',
            assignee: 'all',
            sort: 'priority',
            from: 'all',
          },
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [urlRead, category, priority, status, assignee, sort, search, fromProducts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The open drawer lives in the URL (?action=<id>) so that coming BACK from
  // a signal's page — or refreshing — restores it. replaceState, not push:
  // opening and closing the drawer must not grow the history stack.
  const selectAction = (id: string | null) => {
    setSelectedId(id);
    const params = new URLSearchParams(window.location.search);
    if (id) params.set('action', id);
    else params.delete('action');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
  };

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      // Together, so the page doesn't show its empty state and then the steps.
      const [list, started] = await Promise.all([
        getActions(brand.id),
        getGettingStarted(brand.id).catch(() => null),
      ]);
      setActions(list);
      if (started) setGettingStarted(started);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [brand.id]);

  const startedActive = gettingStarted?.active ?? false;

  // Getting started opens first while it runs, unless the URL named a category.
  useEffect(() => {
    if (!urlRead || !gettingStarted || categoryChosen.current) return;
    categoryChosen.current = true;
    if (gettingStarted.active) setCategory(GETTING_STARTED);
  }, [urlRead, gettingStarted]);
  useEffect(() => {
    if (gettingStarted && !gettingStarted.active && category === GETTING_STARTED) {
      setCategory('all');
    }
  }, [gettingStarted, category]);

  const refreshSteps = useCallback(() => {
    getGettingStarted(brand.id)
      .then((started) => {
        if (started && mounted.current) setGettingStarted(started);
      })
      .catch(() => {});
  }, [brand.id]);

  // A step is done in another tab (its page opens in one): read the steps
  // again when this tab is back in front.
  useEffect(() => {
    if (!startedActive) return;
    // focus and visibilitychange both fire on the way back: read once.
    let last = 0;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 1_000) return;
      last = Date.now();
      refreshSteps();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [startedActive, refreshSteps]);

  // The brand's first tracking run while it goes on (the line under the
  // tabs reads the same): the steps ready now come first, and the ones it
  // brings the data for say how far it is.
  const firstRun = useFirstRun();

  // Once it's done, the steps it unlocked and the first actions: read again
  // now, and once more when the first signal pass has had time to write them.
  useEffect(() => {
    let later: ReturnType<typeof setTimeout> | undefined;
    const stop = onFirstRunFinished((finished) => {
      if (finished !== brand.id) return;
      void load();
      clearTimeout(later);
      later = setTimeout(() => void load(), FIRST_SIGNALS_MS);
    });
    return () => {
      stop();
      clearTimeout(later);
    };
  }, [brand.id, load]);

  // A step opens its card; one still waiting for its data says when it
  // opens, unless the first run is bringing it (its card says how far).
  const openStep = (step: GettingStartedStep) => {
    if (step.state === 'waiting' && !arrivingStep(step, firstRun)) {
      toast(tStarted('opensWhenReady', { when: tStarted(`readyWhen.${readyWhenKey(step)}`) }));
      return;
    }
    setStepKey(step.key);
  };
  const closeStep = useCallback(() => setStepKey(null), []);

  // A change made in the drawer, shown in its row at once: reading the whole
  // list again after each one held the drawer for seconds.
  const patchAction = useCallback((id: string, patch: Partial<ActionItem>) => {
    setActions((prev) =>
      prev ? prev.map((action) => (action.id === id ? { ...action, ...patch } : action)) : prev,
    );
  }, []);

  useEffect(() => {
    void load();
    // The people who can see this brand: the drawer assigns only them.
    listBrandMembers(brand.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [load, brand.id]);

  // An assignee from the URL who is no longer on the team falls back to all.
  useEffect(() => {
    if (members.length === 0 || assignee === 'all' || assignee === 'unassigned') return;
    if (!members.some((m) => m.userId === assignee)) setAssignee('all');
  }, [members, assignee]);

  // Restore the drawer named by the URL once the list is in.
  useEffect(() => {
    if (!actions) return;
    const id = new URLSearchParams(window.location.search).get('action');
    if (id && actions.some((action) => action.id === id)) setSelectedId(id);
  }, [actions]);

  // The row menu: set a status or delete, without the drawer, then read the
  // list again.
  const runRowChange = async (action: ActionItem, change: () => Promise<void>, done: string) => {
    setBusyIds((prev) => new Set(prev).add(action.id));
    try {
      await change();
      toast.success(done);
    } catch {
      toast.error(t('updateFailed'));
    } finally {
      await load();
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(action.id);
        return next;
      });
    }
  };
  const changeStatus = (
    action: ActionItem,
    next: ActionStatus,
    reason: ActionDismissReason | null = null,
  ) =>
    void runRowChange(
      action,
      () => updateActionStatus(brand.id, action.id, next, reason),
      t('rowMenu.statusChanged', { status: t(`status.${next}`) }),
    );
  const keepAction = (action: ActionItem) =>
    void runRowChange(action, () => keepActionRelevant(brand.id, action.id), t('stale.kept'));
  const removeAction = (action: ActionItem) => {
    if (selectedId === action.id) selectAction(null);
    void runRowChange(action, () => deleteAction(action.id), t('rowMenu.deleted'));
  };

  const selected = useMemo(
    () => (actions ?? []).find((action) => action.id === selectedId) ?? null,
    [actions, selectedId],
  );

  // The card and its filter read one set, so they cannot disagree.
  const topIds = useMemo(() => topActionIds(actions ?? []), [actions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = (actions ?? []).filter((action) => {
      if (focus === 'top' ? !topIds.has(action.id) : focus && !CARD_FILTERS[focus](action))
        return false;
      // Getting started's steps aren't actions: with its table not shown, all.
      if (category !== 'all' && category !== GETTING_STARTED && action.category !== category)
        return false;
      if (fromProducts && !FROM_PRODUCTS_KINDS.includes(action.kind)) return false;
      if (priority !== 'all' && action.priorityLevel !== priority) return false;
      if (status === 'stale' ? !isStale(action) : status !== 'all' && action.status !== status)
        return false;
      if (assignee !== 'all') {
        if (assignee === 'unassigned' ? action.assignee !== null : action.assignee?.id !== assignee)
          return false;
      }
      if (needle) {
        const texts = actionTexts(action, tTexts);
        const tags = actionContextTags(action, t).join(' ');
        if (!`${texts.title} ${texts.description} ${tags}`.toLowerCase().includes(needle))
          return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'newest':
          return b.createdAt.localeCompare(a.createdAt);
        case 'due_date':
          return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
        case 'updated':
          return b.updatedAt.localeCompare(a.updatedAt);
        default:
          return comparePriority(a, b);
      }
    });
  }, [
    actions,
    topIds,
    focus,
    category,
    fromProducts,
    priority,
    status,
    assignee,
    search,
    sort,
    tTexts,
    t,
  ]);

  const handleExportCsv = useCallback(async () => {
    if (visible.length === 0) return;

    setIsExporting(true);
    let affected: Awaited<ReturnType<typeof getActionsAffected>>;
    try {
      // What each action's Affected tab lists (AC-005), read for the export only.
      affected = await getActionsAffected(
        brand.id,
        visible.map((action) => action.id),
      );
    } catch {
      if (mounted.current) toast.error(t('export.exportFailed'));
      return;
    } finally {
      setIsExporting(false);
    }
    if (!mounted.current) return;

    const csv = actionListCsv(
      visible.map((action) => ({
        number: action.actionNo,
        priorityScore: action.priorityScore,
        priorityLevel: action.priorityLevel ? t(`priority.levels.${action.priorityLevel}`) : '',
        title: actionTexts(action, tTexts).title,
        category: tCategories(action.category),
        status: t(`status.${action.status}`),
        assignee: action.assignee ? (assigneeLabel(action.assignee) ?? '') : '',
        dueDate: action.dueDate ?? '',
        tasksDone: action.taskCompleted,
        tasksTotal: action.taskTotal,
        signalCount: action.signalCount,
        affected: affected[action.id],
        created: action.createdAt,
      })),
    );
    const date = new Date().toISOString().slice(0, 10);
    const slug = brand.slug ?? 'brand';
    saveBlob(
      new Blob([BYTE_ORDER_MARK, csv], { type: 'text/csv;charset=utf-8;' }),
      await exportFileName(`${slug}_actions_${date}.csv`),
    );
  }, [brand.id, brand.slug, visible, tTexts, tCategories, t]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<ActionCategory, number>();
    for (const action of actions ?? []) {
      counts.set(action.category, (counts.get(action.category) ?? 0) + 1);
    }
    return counts;
  }, [actions]);
  const fromProductsCount = useMemo(
    () => (actions ?? []).filter((action) => FROM_PRODUCTS_KINDS.includes(action.kind)).length,
    [actions],
  );

  const summary = useMemo(() => {
    const all = actions ?? [];
    const open = all.filter(isOpen);
    return {
      top: topIds.size,
      atRisk: all.filter(CARD_FILTERS.atRisk).length,
      opportunities: all.filter(CARD_FILTERS.opportunities).length,
      inProgress: all.filter(CARD_FILTERS.inProgress).length,
      highest: highestPriorityLevel(open.map((action) => action.priorityLevel)),
    };
  }, [actions, topIds]);

  const hasActiveFilters =
    focus !== null ||
    category !== 'all' ||
    priority !== 'all' ||
    status !== 'all' ||
    assignee !== 'all' ||
    search !== '';

  const clearFilters = () => {
    setFocus(null);
    setCategory('all');
    setPriority('all');
    setStatus('all');
    setAssignee('all');
    setSearch('');
  };

  const showSteps = startedActive && gettingStarted !== null && category === GETTING_STARTED;
  const openCard = showSteps ? gettingStarted.steps.find((s) => s.key === stepKey) : undefined;

  // Getting started's Start and Skip (AC-ALT2 §5), for admins and managers:
  // the people who can set the steps up. Start shows while it isn't running
  // and the brand's setup is incomplete, or after a skip.
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [switching, setSwitching] = useState(false);
  // A read-only workspace (plan not active): Start and Skip open the upgrade
  // dialog instead (Skip without its question), and a new brand's question
  // doesn't open by itself: Start stays in the header for it.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // The new brand's question, once answered or closed, stays closed for
  // this visit, even when the answer couldn't be saved or read back: it
  // never traps anyone on the page.
  const [askClosed, setAskClosed] = useState(false);
  const switchGettingStarted = async (
    change: (brandId: string) => Promise<void>,
    done: (started: GettingStartedStatus | null) => string,
    failed: string,
  ) => {
    setSwitching(true);
    setAskClosed(true);
    try {
      await change(brand.id);
      const started = await getGettingStarted(brand.id).catch(() => null);
      if (!mounted.current) return;
      if (started) setGettingStarted(started);
      setStepKey(null);
      setFocus(null);
      setCategory(started?.active ? GETTING_STARTED : 'all');
      toast.success(done(started));
    } catch {
      toast.error(failed);
    } finally {
      setSwitching(false);
    }
  };
  const start = (message: (started: GettingStartedStatus | null) => string) =>
    void switchGettingStarted(startGettingStarted, message, tStarted('start.failed'));
  const skip = (message: string) =>
    void switchGettingStarted(skipGettingStarted, () => message, tStarted('skip.failed'));

  const headerAction =
    !canManage || !gettingStarted ? null : startedActive ? (
      <Button
        variant="outline"
        disabled={switching}
        onClick={guard(() => setConfirmingSkip(true), { action: tActions('skipGettingStarted') })}
      >
        {tStarted('skip.button')}
      </Button>
    ) : // A new brand's question, once closed, leaves Start in its place.
    (
        gettingStarted.asking
          ? askClosed || isLocked
          : gettingStarted.needsSetup || gettingStarted.skipped
      ) ? (
      <div className="flex flex-col items-end gap-1">
        <Button
          disabled={switching}
          onClick={guard(() => start((s) => tStarted('start.started', { count: s?.done ?? 0 })), {
            action: tActions('startGettingStarted'),
          })}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {tStarted('start.button')}
        </Button>
        <span className="text-xs text-muted-foreground">{tStarted('start.hint')}</span>
      </div>
    ) : null;

  // Header and tabs above every state of the page, with the dialogs; with a
  // step's card open, the page makes room for it on wide screens.
  const frame = (body: React.ReactNode) => (
    <div className={cn('space-y-6', openCard && 'min-[1300px]:pr-[440px]')}>
      <ActionsHeader action={headerAction} />
      <ActionCenterTabs />
      {body}

      <Dialog open={confirmingSkip} onOpenChange={setConfirmingSkip}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{tStarted('skip.title')}</DialogTitle>
            <DialogDescription>{tStarted('skip.body')}</DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">{tStarted('skip.later')}</p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmingSkip(false);
                skip(tStarted('skip.done'));
              }}
            >
              {tStarted('skip.confirm')}
            </Button>
            <Button onClick={() => setConfirmingSkip(false)}>{tStarted('skip.keep')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A brand added beside others asks before running it. */}
      <Dialog
        open={canManage && Boolean(gettingStarted?.asking) && !askClosed && !isLocked}
        onOpenChange={(open) => {
          if (!open) setAskClosed(true);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tStarted('secondBrand.title', { brand: brand.name })}</DialogTitle>
            <DialogDescription>{tStarted('secondBrand.body')}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>{tStarted('secondBrand.runLine', { brand: brand.name })}</li>
            <li>{tStarted('secondBrand.skipLine')}</li>
          </ul>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => skip(tStarted('secondBrand.skipped', { brand: brand.name }))}
            >
              {tStarted('secondBrand.skip')}
            </Button>
            <Button onClick={() => start(() => tStarted('secondBrand.ran', { brand: brand.name }))}>
              {tStarted('secondBrand.run')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // Chat's side panel sees the page (W1-08): its filters, the top action,
  // and the actions in view to ask about.
  // The first of the Top actions, as the card ranks them: the list comes unordered.
  const topAction = (actions ?? [])
    .filter((action) => topIds.has(action.id))
    .sort(comparePriority)[0];
  const pageFilters: ChatPageFilter[] =
    category !== 'all' && category !== GETTING_STARTED
      ? [{ key: 'category', label: tCategories(category), value: category }]
      : [];
  if (priority !== 'all') {
    pageFilters.push({
      key: 'priority',
      label: t(`priority.levels.${priority}`),
      value: priority,
    });
  }
  if (status !== 'all')
    pageFilters.push({ key: 'status', label: t(`status.${status}`), value: status });
  useChatPageContext({
    pageName: t('title'),
    filters: pageFilters,
    suggestions: [
      ...(topAction ? [tChat('actionHow', { title: actionTexts(topAction, tTexts).title })] : []),
      tChat('actionsImpact'),
      tChat('actionsWeek'),
    ],
    referenceables: visible.slice(0, 5).map((action) => ({
      type: 'task' as const,
      id: action.id,
      label: actionTexts(action, tTexts).title,
    })),
  });

  if (isLoading) {
    return frame(
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>,
    );
  }

  if (loadFailed) {
    return frame(
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('error.title')}</h2>
        <Button variant="outline" className="mt-4" onClick={() => void load()}>
          {t('error.retry')}
        </Button>
      </div>,
    );
  }

  if (!actions?.length && !startedActive) {
    return frame(
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <ListChecks className="h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-semibold">{t('empty.title')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
      </div>,
    );
  }

  const list = actions ?? [];
  // Before the first signals, the cards that rank actions have nothing to say.
  const noActions = list.length === 0;
  const showStepsCategory = () => {
    setFocus(null);
    setCategory(GETTING_STARTED);
  };
  // A card filters the actions, so it leaves Getting started's table.
  const toggleFocus = (card: CardFocus) => {
    if (category === GETTING_STARTED) setCategory('all');
    setFocus(focus === card ? null : card);
  };
  const rankCard = (card: 'top' | 'atRisk' | 'opportunities', value: number, sub: string) =>
    noActions
      ? { value: '—', sub: tStarted('firstSignals'), dim: true }
      : { value, sub, isActive: focus === card, onClick: () => toggleFocus(card) };

  return frame(
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {startedActive && gettingStarted && (
          <GettingStartedSummaryCard
            done={gettingStarted.done}
            total={gettingStarted.total}
            isActive={category === GETTING_STARTED}
            onClick={showStepsCategory}
          />
        )}
        {/* Each card toggles itself as the table's filter, so a count always
            has a way back to the rows it came from. */}
        <SummaryCard
          icon={CircleDot}
          label={t('cards.top')}
          {...rankCard('top', summary.top, t('cards.topSub'))}
        />
        <SummaryCard
          icon={Shield}
          label={t('cards.atRisk')}
          {...rankCard('atRisk', summary.atRisk, t('cards.atRiskSub'))}
        />
        <SummaryCard
          icon={Sparkles}
          label={t('cards.opportunities')}
          {...rankCard('opportunities', summary.opportunities, t('cards.opportunitiesSub'))}
        />
        <SummaryCard
          icon={ArrowUpDown}
          label={t('cards.inProgress')}
          value={summary.inProgress}
          sub={t('cards.inProgressSub')}
          isActive={focus === 'inProgress'}
          onClick={() => toggleFocus('inProgress')}
        />
        {/* Getting started takes the fifth place while it runs. */}
        {!startedActive && (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40">
                  <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">{t('cards.priority')}</p>
              </div>
              <p className="mt-2 text-2xl font-bold">
                {summary.highest ? t(`priority.levels.${summary.highest}`) : '—'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('cards.prioritySub')}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {startedActive && gettingStarted && (
            <CategoryPill
              label={tStarted('category')}
              count={gettingStarted.total}
              isActive={category === GETTING_STARTED}
              onClick={showStepsCategory}
            />
          )}
          <CategoryPill
            label={t('allActions')}
            count={list.length}
            isActive={category === 'all'}
            onClick={() => setCategory('all')}
          />
          {ACTION_CATEGORIES.filter((key) => (categoryCounts.get(key) ?? 0) > 0).map((key) => (
            <CategoryPill
              key={key}
              label={tCategories(key)}
              count={categoryCounts.get(key) ?? 0}
              isActive={category === key}
              onClick={() => setCategory(key)}
            />
          ))}
          {/* A chip of its own beside the categories: on or off, whatever the category.
              On from the URL, it shows with none too, to be turned off. */}
          {(fromProducts || fromProductsCount > 0) && (
            <CategoryPill
              label={t('fromProducts')}
              count={fromProductsCount}
              isActive={fromProducts}
              onClick={() => setFromProducts((on) => !on)}
            />
          )}
        </div>
        {!showSteps && (
          <Select
            value={sort}
            onValueChange={(v) => setSort((v ?? 'priority') as ActionSort)}
            items={ACTION_SORTS.map((key) => ({ value: key, label: t(`sort.${key}`) }))}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <span className="text-muted-foreground">{t('sort.label')}:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTION_SORTS.map((key) => (
                <SelectItem key={key} value={key}>
                  {t(`sort.${key}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* The filters, sort and export work on actions; Getting started's
          steps are a fixed list. */}
      {!showSteps && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            label={t('filters.priority')}
            value={priority}
            onChange={(v) => setPriority(v as PriorityLevel | 'all')}
            options={PRIORITY_LEVELS.map((v) => ({ value: v, label: t(`priority.levels.${v}`) }))}
            allLabel={t('filters.all')}
          />
          <FilterSelect
            label={t('filters.status')}
            value={status}
            onChange={(v) => setStatus(v as StatusChoice)}
            options={[...ACTION_STATUSES, 'stale' as const].map((v) => ({
              value: v,
              label: t(`status.${v}`),
            }))}
            allLabel={t('filters.all')}
          />
          <FilterSelect
            label={t('filters.assignee')}
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: 'unassigned', label: t('filters.unassigned') },
              ...members.map((member) => ({
                value: member.userId,
                label: memberLabel(member),
              })),
            ]}
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
            disabled={visible.length === 0 || isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {common('exportCsv')}
          </Button>
        </div>
      )}

      {showSteps && gettingStarted ? (
        <GettingStartedTable
          steps={gettingStarted.steps}
          members={members}
          onSelect={openStep}
          selectedKey={openCard?.key ?? null}
          showNote={noActions}
          firstRun={firstRun}
        />
      ) : visible.length > 0 ? (
        <ActionTable
          actions={visible}
          onSelect={(action) => selectAction(action.id)}
          onStatusChange={changeStatus}
          onKeep={keepAction}
          onDelete={removeAction}
          canDelete={canManage}
          busyIds={busyIds}
        />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">{t('noResults')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        </div>
      )}

      {openCard && (
        <GettingStartedStepCard
          brandId={brand.id}
          step={openCard}
          members={members}
          canManage={canManage}
          onClose={closeStep}
          onChanged={refreshSteps}
          onReady={() => {
            closeStep();
            setCategory('all');
          }}
          firstRun={firstRun}
        />
      )}

      <ActionDrawer
        brandId={brand.id}
        action={selected}
        members={members}
        onOpenChange={(open) => {
          if (!open) selectAction(null);
        }}
        onChanged={() => void load()}
        onPatched={patchAction}
      />
    </div>,
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  isActive,
  onClick,
  dim,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub: string;
  /** Omit both to render a card that only reports, like Highest Priority. */
  isActive?: boolean;
  onClick?: () => void;
  /** Faded: nothing to count yet. */
  dim?: boolean;
}) {
  return (
    <Card
      {...(onClick
        ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-pressed': isActive,
            onClick,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            },
            className: cn(
              'cursor-pointer transition-colors hover:border-foreground/30',
              isActive && 'border-foreground/60 bg-muted/40',
            ),
          }
        : { className: cn(dim && 'opacity-60') })}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border bg-muted/40">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
        </div>
        <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
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
