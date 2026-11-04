'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useFailureToast } from '@/hooks/useFailureToast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Lightbulb,
  Zap,
  Send,
  Check,
  BarChart3,
  Search,
  X,
  Settings2,
  Trash2,
  Download,
  Plus,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import type { ChatPageFilter } from '@/lib/chat/pageContext';
import { useAssetTypeLabel } from '@/hooks/useAssetTypeLabel';
import {
  generateOpportunitiesOnDemand,
  getGenerationJobStatus,
  getContentUsage,
  getOpportunities,
  getOpportunityPrompts,
  getOpportunityTopics,
  type OpportunityPrompt,
  type OpportunityTopic,
  updateOpportunityStatus,
  sendToWebhook,
  bulkSendToWebhook,
  bulkUpdateStatus,
  bulkDeleteOpportunities,
} from '@/lib/actions/content';
import type { ContentOpportunity, ContentOpportunityStatus } from '@/types';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { NewContentDialog, type DialogPreset } from '@/components/content/NewContentDialog';
import { getOpportunityDrafts } from '@/lib/actions/contentDrafts';
import { getPlanPriorities, setPlanRowPriority } from '@/lib/actions/contentPlan';
import { OpportunityRowMenu } from '@/components/content/OpportunityRowMenu';
import { WriteThisDialog } from '@/components/content/WriteThisDialog';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { bulkSendNotes } from '@/lib/content/bulkSend';
import { contentEditorPath } from '@/lib/content/drafts';
import { canWriteOpportunity, opportunityStart } from '@/lib/content/opportunityStart';
import { siteTypeOf } from '@/lib/content/pageTypes';
import { WebhookSettingsDialog } from './_WebhookSettings';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { OpportunityDetail } from '@/components/content/OpportunityDetail';
import { ContentUsageCard } from '@/components/content/ContentUsageCard';
import { hasContentQuota, onDemandMax, type ContentUsage } from '@/lib/contentUsage';
import { isNoPlan } from '@/lib/billing/noPlan';
import { suggestedBounds, suggestedDate, type SuggestedRange } from '@/lib/suggestedDate';
import {
  DEFAULT_OPPORTUNITY_SORT,
  OPPORTUNITY_SORTS,
  opportunityScope,
  type OpportunitySort,
} from '@/lib/content/opportunityList';
import {
  NewOpportunitiesDialog,
  type NewOpportunitiesInput,
} from '@/components/content/NewOpportunitiesDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadingDots } from '@/components/ui/loading-dots';
import { PAGE_SIZE, TablePager, usePagination } from '@/components/TablePager';
import { toCsv } from '@/lib/csv';
import { readUrlChoice, writeUrlParams } from '@/lib/urlState';
import { exportFileName } from '@/lib/white-label/exportName';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const GENERATION_STORAGE_KEY = 'aeo:content-generation';

// Filters and sort kept in the URL (#897); defaults are left out of it.
const STATUS_VALUES = [
  'all',
  'new',
  'reviewed',
  'sent',
  'in_progress',
  'done',
  'dismissed',
  'archived',
] as const;
const IMPACT_VALUES = ['all', 'high', 'medium', 'low'] as const;
const TYPE_VALUES = ['all', 'owned', 'earned'] as const;
const SOURCE_VALUES = ['all', 'system', 'manual', 'prompt', 'action'] as const;
const SUGGESTED_VALUES = ['all', 'month', 'last30', 'custom'] as const;
const URL_DEFAULTS = {
  status: 'all',
  impact: 'all',
  type: 'all',
  source: 'all',
  suggested: 'all',
  from: '',
  to: '',
  sort: DEFAULT_OPPORTUNITY_SORT,
};

/** When the list was last opened, per brand: rows suggested since get a dot. */
const LAST_VISIT_KEY = 'aeo:content-last-visit:';

/**
 * The visit before this one, read once per brand per page load and cached,
 * so running the effect twice (React's development mode does) doesn't read
 * back the visit it just recorded.
 */
const visitBefore = new Map<string, number | null>();
function previousVisit(brandId: string): number | null {
  if (!visitBefore.has(brandId)) {
    let previous: number | null = null;
    try {
      const key = LAST_VISIT_KEY + brandId;
      previous = Number(localStorage.getItem(key)) || null;
      localStorage.setItem(key, String(Date.now()));
    } catch {}
    visitBefore.set(brandId, previous);
  }
  return visitBefore.get(brandId) ?? null;
}

/** Used when the month's usage couldn't be read; the server still caps it. */
const FALLBACK_REQUEST_MAX = 3;

const OPPORTUNITY_EXPORT_HEADERS = [
  'title',
  'type',
  'impact',
  'score',
  'status',
  'related_prompt',
  'suggested_at',
];
// The export pages through the filtered list; the cap keeps a runaway brand
// from pinning the browser.
const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_ROWS = 10_000;
const GENERATION_TIMEOUT_MS = 3 * 60 * 1000;

interface GenerationJob {
  brandId: string;
  jobId: string;
  startedAt: number;
  /** How many a "+ New" request asked for: the placeholder rows shown meanwhile. */
  count?: number;
}

function saveGenerationJob(job: GenerationJob) {
  try {
    localStorage.setItem(GENERATION_STORAGE_KEY, JSON.stringify(job));
  } catch {}
}

function loadGenerationJob(): GenerationJob | null {
  try {
    const raw = localStorage.getItem(GENERATION_STORAGE_KEY);
    if (!raw) return null;
    const job = JSON.parse(raw) as GenerationJob;
    if (Date.now() - job.startedAt > GENERATION_TIMEOUT_MS) {
      localStorage.removeItem(GENERATION_STORAGE_KEY);
      return null;
    }
    return job;
  } catch {
    return null;
  }
}

function clearGenerationJob() {
  try {
    localStorage.removeItem(GENERATION_STORAGE_KEY);
  } catch {}
}

const IMPACT_COLORS: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  medium: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  reviewed: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  sent: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  in_progress: 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400',
  done: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  dismissed: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-500 dark:text-zinc-400',
  archived: 'border-zinc-500/30 bg-zinc-500/5 text-zinc-500 dark:text-zinc-400',
};

function KpiCard({
  title,
  icon: Icon,
  value,
  sub,
  className,
}: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

/** When it was suggested, relative for a week, with the full date on hover. */
function SuggestedCell({
  createdAt,
  locale,
  isNew,
  newLabel,
}: {
  createdAt: string;
  locale: string;
  isNew: boolean;
  newLabel: string;
}) {
  const { label, full } = suggestedDate(createdAt, locale);
  return (
    <span className="inline-flex items-center gap-1.5" title={full}>
      {isNew && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
          role="img"
          aria-label={newLabel}
          title={newLabel}
        />
      )}
      {label}
    </span>
  );
}

/**
 * What an opportunity was built for, as a tag before its description: a
 * group of related prompts in a topic (cluster opportunities, #857) in
 * violet, or a single prompt (the older generator) in grey. Violet keeps it
 * apart from the impact and status colours on the same row.
 */
function OpportunityScope({ opp }: { opp: ContentOpportunity }) {
  const t = useTranslations('content.scope');
  const scope = opportunityScope(opp);
  const group = scope.kind === 'group';
  const label =
    scope.kind === 'group'
      ? scope.topic
        ? t('group', { topic: scope.topic, count: scope.count })
        : t('groupNoTopic', { count: scope.count })
      : scope.kind === 'action'
        ? scope.actionNo !== null
          ? t('action', { ref: `AC-${scope.actionNo}` })
          : t('actionNoRef')
        : t('single');
  return (
    <span
      className={cn(
        'mr-1.5 inline-flex items-center rounded px-1.5 py-px align-middle text-[11px] font-medium leading-4 ring-1 ring-inset',
        group
          ? 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900'
          : 'bg-muted text-foreground/80 ring-border',
      )}
      title={group ? t('groupHint') : scope.kind === 'action' ? t('actionHint') : t('singleHint')}
    >
      {label}
    </span>
  );
}

const ALL_PROMPTS = '__all__';

interface PromptFilterItem {
  value: string;
  label: string;
  /** Opportunities for this prompt; null on the "All prompts" row. */
  count: number | null;
}

export default function ContentPage() {
  const t = useTranslations('content');
  const failureToast = useFailureToast();
  const assetTypeLabel = useAssetTypeLabel();
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrandSlug = useBrandStore((s) => s.getActiveBrand()?.slug);
  // A read-only workspace (plan not active): New, the bulk bar and the rows'
  // actions open the upgrade dialog instead; filters and Export stay open.
  const { guard, isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tManagers = useTranslations('managersOnly');
  const tChat = useTranslations('chatPanel.suggest');
  // The bulk bar's Dismiss and Delete ask first: the upgrade dialog instead.
  const confirmUnlessLocked =
    (action: string) => (open: boolean, details: { cancel: () => void }) => {
      if (!open || !isLocked) return;
      details.cancel();
      openUpgrade(action);
    };

  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [impactFilter, setImpactFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  // When it was suggested (CONTENT-002); custom takes YYYY-MM-DD bounds.
  const [suggestedRange, setSuggestedRange] = useState<SuggestedRange>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // The previous visit, read once per brand before this one is recorded.
  const [lastVisit, setLastVisit] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<string>(DEFAULT_OPPORTUNITY_SORT);
  // The prompt filter (#836) lives in the URL as ?prompt=<id> so a filtered
  // view can be linked to. It is read after mount — useSearchParams would need
  // a Suspense boundary around the page — and loading waits for it, so a
  // linked view never flashes the unfiltered list first.
  const [promptFilter, setPromptFilter] = useState('');
  const [urlRead, setUrlRead] = useState(false);
  // null until loaded for the current brand.
  const [promptOptions, setPromptOptions] = useState<OpportunityPrompt[] | null>(null);
  // Topic filter (#857): matches opportunities through their clusters.
  const [topicFilter, setTopicFilter] = useState('');
  const [topicOptions, setTopicOptions] = useState<OpportunityTopic[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);

  const [webhookOpen, setWebhookOpen] = useState(false);
  // This billing period's content usage (CONTENT-001); null hides the card.
  const [contentUsage, setContentUsage] = useState<ContentUsage | null>(null);
  // Bumped after a "+ New" run, which may use quota without changing the total.
  const [usageVersion, setUsageVersion] = useState(0);
  const [newOpen, setNewOpen] = useState(false);
  // Placeholder rows while a "+ New" request runs (CONTENT-003).
  const [pendingCount, setPendingCount] = useState(0);
  const lastRequestRef = useRef<NewOpportunitiesInput | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  const pollRef = useRef(false);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [aggregates, setAggregates] = useState({
    avgScore: 0,
    highImpactCount: 0,
    sentCount: 0,
    signalCount: 0,
  });

  // Server-side paging (#610) — the list can hold far more than one page's
  // worth of opportunities, so `total` (the exact server count) drives the
  // pager instead of the length of whatever page happens to be loaded.
  const pager = usePagination(
    total,
    `${statusFilter}|${impactFilter}|${typeFilter}|${sourceFilter}|${suggestedRange}|${customFrom}|${customTo}|${promptFilter}|${topicFilter}|${debouncedSearch}|${sortOrder}`,
  );

  // The list's filters and search, shared by the page load and the CSV export.
  const listFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (statusFilter !== 'all') filters.status = statusFilter;
    if (impactFilter !== 'all') filters.impact = impactFilter;
    if (typeFilter !== 'all') filters.type = typeFilter;
    if (sourceFilter !== 'all') filters.source = sourceFilter;
    const bounds = suggestedBounds(suggestedRange, { from: customFrom, to: customTo });
    if (bounds.from) filters.createdFrom = bounds.from;
    if (bounds.to) filters.createdTo = bounds.to;
    if (promptFilter) filters.promptId = promptFilter;
    if (topicFilter) filters.topicId = topicFilter;
    if (debouncedSearch.trim()) filters.q = debouncedSearch.trim();
    filters.sort = sortOrder;
    return filters;
  }, [
    statusFilter,
    impactFilter,
    typeFilter,
    sourceFilter,
    suggestedRange,
    customFrom,
    customTo,
    promptFilter,
    topicFilter,
    debouncedSearch,
    sortOrder,
  ]);

  const loadData = useCallback(
    async (silent = false, isCancelled?: () => boolean) => {
      if (!urlRead) return;
      if (!activeBrandId) {
        setOpportunities([]);
        setTotal(0);
        setAggregates({
          avgScore: 0,
          highImpactCount: 0,
          sentCount: 0,
          signalCount: 0,
        });
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      setSelectedIds(new Set());
      try {
        const data = await getOpportunities(activeBrandId, {
          ...listFilters,
          limit: PAGE_SIZE,
          offset: pager.start,
        });
        if (isCancelled?.()) return;
        setOpportunities(data.opportunities);
        setTotal(data.total);
        setAggregates(
          data.aggregates ?? {
            avgScore: 0,
            highImpactCount: 0,
            sentCount: 0,
            signalCount: 0,
          },
        );
        return data.total;
      } catch (err) {
        console.error('Failed to load opportunities:', err);
        toast.error(t('loadError'));
        return 0;
      } finally {
        if (!isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    [urlRead, activeBrandId, listFilters, pager.start, t],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // The open opportunity lives in the URL (?opportunity=<id>), like the
  // Action Center's drawers: a refresh or a shared link reopens it, and
  // opening one never navigates away from the filtered list.
  const [openOpportunityId, setOpenOpportunityId] = useState<string | null>(null);
  // Send to Editor from a row: Start for its opportunity.
  const router = useRouter();
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const [contentPreset, setContentPreset] = useState<DialogPreset | null>(null);
  // Write this from a row: the brief and the page in one go.
  const [writeThis, setWriteThis] = useState<ContentOpportunity | null>(null);
  // The drafts being written for the rows on screen, which open instead. A
  // failed read is not "no draft": the rows offer to check again, so Start
  // never writes a second draft for the same opportunity.
  const shownIds = opportunities.map((o) => o.id).join(',');
  const [drafts, setDrafts] = useState<{
    key: string;
    byOpportunity: Record<string, string>;
    failed: boolean;
  }>({ key: '', byOpportunity: {}, failed: false });
  const [draftsAttempt, setDraftsAttempt] = useState(0);
  useEffect(() => {
    if (!activeBrandId || !shownIds) return;
    let cancelled = false;
    getOpportunityDrafts(activeBrandId, shownIds.split(',')).then(
      (byOpportunity) => !cancelled && setDrafts({ key: shownIds, byOpportunity, failed: false }),
      () => !cancelled && setDrafts({ key: shownIds, byOpportunity: {}, failed: true }),
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, shownIds, draftsAttempt]);
  // Null until the rows' drafts are known: their button waits.
  const draftsShown = drafts.key === shownIds ? drafts : null;
  const retryDrafts = () => {
    setDrafts((d) => ({ ...d, key: '' }));
    setDraftsAttempt((n) => n + 1);
  };
  // Send to Plan: which rows are a priority in the Content plan already.
  const { canManage } = useUserRole();
  const [priorities, setPriorities] = useState<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  useEffect(() => {
    if (!activeBrandId || !shownIds || !canManage) return;
    let cancelled = false;
    getPlanPriorities(activeBrandId, shownIds.split(',')).then(
      (ids) => !cancelled && setPriorities({ key: shownIds, ids }),
      () => !cancelled && setPriorities({ key: shownIds, ids: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, shownIds, canManage]);
  const prioritiesShown = priorities.key === shownIds ? priorities.ids : null;
  // A row marked here or from the panel: its menu says Open in Plan then.
  const markPrioritized = (id: string) =>
    setPriorities((p) => (p.ids.includes(id) ? p : { ...p, ids: [...p.ids, id] }));
  const handleSendToPlan = async (id: string) => {
    if (!activeBrandId) return;
    try {
      await setPlanRowPriority(activeBrandId, `opportunity:${id}`, true);
      markPrioritized(id);
      toast.success(t('sentToPlan'), {
        action: { label: t('openPlan'), onClick: () => router.push('/dashboard/content/plan') },
      });
    } catch {
      toast.error(t('sendToPlanError'));
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPromptFilter(params.get('prompt') ?? '');
    setOpenOpportunityId(params.get('opportunity'));
    setStatusFilter(readUrlChoice('status', STATUS_VALUES, 'all'));
    setImpactFilter(readUrlChoice('impact', IMPACT_VALUES, 'all'));
    setTypeFilter(readUrlChoice('type', TYPE_VALUES, 'all'));
    setSourceFilter(readUrlChoice('source', SOURCE_VALUES, 'all'));
    setSuggestedRange(readUrlChoice('suggested', SUGGESTED_VALUES, 'all'));
    setCustomFrom(params.get('from') ?? '');
    setCustomTo(params.get('to') ?? '');
    setSortOrder(readUrlChoice('sort', OPPORTUNITY_SORTS, DEFAULT_OPPORTUNITY_SORT));
    setUrlRead(true);
  }, []);

  // Keep the filters and sort in the URL once it has been read, so a refresh
  // or a shared link restores the same view.
  useEffect(() => {
    if (!urlRead) return;
    writeUrlParams(
      {
        status: statusFilter,
        impact: impactFilter,
        type: typeFilter,
        source: sourceFilter,
        suggested: suggestedRange,
        from: suggestedRange === 'custom' ? customFrom : '',
        to: suggestedRange === 'custom' ? customTo : '',
        sort: sortOrder,
      },
      URL_DEFAULTS,
    );
  }, [
    urlRead,
    statusFilter,
    impactFilter,
    typeFilter,
    sourceFilter,
    suggestedRange,
    customFrom,
    customTo,
    sortOrder,
  ]);

  // Rows suggested since the previous visit get a dot; this visit is
  // recorded for the next one. Storage failures only lose the dots.
  useEffect(() => {
    if (!activeBrandId) return;
    setLastVisit(previousVisit(activeBrandId));
  }, [activeBrandId]);

  const selectOpportunity = useCallback((opportunityId: string | null) => {
    setOpenOpportunityId(opportunityId);
    const url = new URL(window.location.href);
    if (opportunityId) url.searchParams.set('opportunity', opportunityId);
    else url.searchParams.delete('opportunity');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const selectPrompt = useCallback((promptId: string) => {
    setPromptFilter(promptId);
    const url = new URL(window.location.href);
    if (promptId) url.searchParams.set('prompt', promptId);
    else url.searchParams.delete('prompt');
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const loadPromptOptions = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!activeBrandId) return;
      try {
        const options = await getOpportunityPrompts(activeBrandId);
        if (!isCancelled?.()) setPromptOptions(options);
      } catch {
        // The filter is a convenience; without its options it just stays hidden.
        if (!isCancelled?.()) setPromptOptions([]);
      }
    },
    [activeBrandId],
  );

  useEffect(() => {
    let cancelled = false;
    setPromptOptions(null);
    loadPromptOptions(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadPromptOptions]);

  useEffect(() => {
    let cancelled = false;
    setTopicFilter('');
    setTopicOptions([]);
    if (!activeBrandId) return;
    getOpportunityTopics(activeBrandId)
      .then((options) => !cancelled && setTopicOptions(options))
      // Like the prompt filter, it just stays hidden without its options.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  // A prompt id from another brand, or one whose prompt was deleted, would
  // filter to nothing while the picker shows "All prompts". Drop it.
  useEffect(() => {
    if (!promptFilter || promptOptions === null) return;
    if (!promptOptions.some((o) => o.promptId === promptFilter)) selectPrompt('');
  }, [promptFilter, promptOptions, selectPrompt]);

  useEffect(() => {
    let cancelled = false;

    loadData(false, () => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadData]);

  // Reloaded when the list's size changes, since that is when something may
  // have used the quota. A failure only hides the card.
  useEffect(() => {
    let cancelled = false;
    getContentUsage().then(
      (usage) => !cancelled && setContentUsage(usage),
      () => !cancelled && setContentUsage(null),
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, total, usageVersion]);

  const pollJob = useCallback(
    (jobId: string, startedAt: number) => {
      pollRef.current = true;
      setGenerating(true);

      const poll = async () => {
        while (pollRef.current) {
          await new Promise((r) => setTimeout(r, 3000));
          if (!pollRef.current) break;
          try {
            const status = await getGenerationJobStatus(jobId);

            if (status.status === 'completed') {
              pollRef.current = false;
              clearGenerationJob();
              setGenerating(false);
              setPendingCount(0);
              const generated = status.result?.generated ?? 0;
              const duplicates = status.result?.duplicates ?? 0;
              const existingId = status.result?.existingId;
              if (status.result?.limited) toast.error(t('newLimitReached'));
              // A request for one prompt that an open opportunity answers.
              else if (generated === 0 && existingId)
                toast(t('newExisting'), {
                  action: {
                    label: t('openExisting'),
                    onClick: () => selectOpportunity(existingId),
                  },
                });
              else if (generated === 0 && duplicates === 0) toast(t('newNothing'));
              else toast.success(t('newDone', { generated, duplicates }));
              loadData();
              loadPromptOptions();
              setUsageVersion((v) => v + 1);
              break;
            }

            if (status.status === 'failed' || Date.now() - startedAt > GENERATION_TIMEOUT_MS) {
              pollRef.current = false;
              clearGenerationJob();
              setGenerating(false);
              setPendingCount(0);
              // Slots it didn't use are handed back on the server; say so.
              toast.error(
                status.status === 'failed'
                  ? status.failedReason || t('generationFailed')
                  : t('generationTimedOut'),
                {
                  description: t('newRefunded'),
                  action: lastRequestRef.current
                    ? { label: t('retry'), onClick: () => retryRef.current?.() }
                    : undefined,
                },
              );
              setUsageVersion((v) => v + 1);
              break;
            }
          } catch {
            // keep polling
          }
        }
      };

      poll();
    },
    [loadData, loadPromptOptions, selectOpportunity, t],
  );
  // Restore generation state from localStorage on mount
  useEffect(() => {
    if (!activeBrandId) return;
    const saved = loadGenerationJob();
    if (!saved || saved.brandId !== activeBrandId) return;

    setPendingCount(saved.count ?? 0);
    pollJob(saved.jobId, saved.startedAt);
    return () => {
      pollRef.current = false;
    };
  }, [activeBrandId, pollJob]);

  // Every opportunity matching the filters and search, not just this page (#915).
  const handleExportCsv = async () => {
    if (!activeBrandId) return;
    setExporting(true);
    try {
      const rows: ContentOpportunity[] = [];
      for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
        const page = await getOpportunities(activeBrandId, {
          ...listFilters,
          limit: EXPORT_PAGE_SIZE,
          offset,
        });
        rows.push(...page.opportunities);
        if (page.opportunities.length < EXPORT_PAGE_SIZE) break;
      }

      const csv = toCsv(
        rows.map((o) => ({
          title: o.title,
          type: o.type,
          impact: o.impact,
          score: Math.round(o.opportunityScore),
          status: o.status,
          related_prompt: o.sourceData.promptText ?? (o.sourceData.prompts ?? []).join(' | '),
          // ISO 8601, whatever the UI language (CONTENT-002).
          suggested_at: new Date(o.createdAt).toISOString(),
        })),
        OPPORTUNITY_EXPORT_HEADERS,
      );
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = await exportFileName(
        `${activeBrandSlug ?? 'brand'}_content-opportunities_${date}.csv`,
      );
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export opportunities:', err);
      toast.error(t('exportError'));
    } finally {
      setExporting(false);
    }
  };

  // "+ New" (CONTENT-003). One idempotency key per submit, so a double click
  // or a retried request starts one job; returns whether it started.
  const handleNew = async (input: NewOpportunitiesInput): Promise<boolean> => {
    if (!activeBrandId) return false;
    lastRequestRef.current = input;
    const result = await generateOpportunitiesOnDemand({
      brandId: activeBrandId,
      ...input,
      idempotencyKey: crypto.randomUUID(),
    }).catch((err: unknown) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : t('generateError'),
      failure: 'failed' as const,
      quotaExhausted: false,
      periodEnd: null,
    }));
    if (!result.ok) {
      // The reason in plain words, never the server's bare string (BUG-001).
      if (result.quotaExhausted) toast.error(t('newLimitReached'));
      else failureToast(result.failure);
      setUsageVersion((v) => v + 1);
      return false;
    }
    const startedAt = Date.now();
    saveGenerationJob({
      brandId: activeBrandId,
      jobId: result.jobId,
      startedAt,
      count: result.count,
    });
    setPendingCount(result.count);
    pollJob(result.jobId, startedAt);
    return true;
  };
  // The failure toast's Retry sends the last request again, with a new key.
  useEffect(() => {
    retryRef.current = () => {
      if (lastRequestRef.current) void handleNew(lastRequestRef.current);
    };
  });

  const requestMax = contentUsage ? onDemandMax(contentUsage) : FALLBACK_REQUEST_MAX;
  // Without an active plan the quota reads 0 of 0: New stays clickable, and
  // opens the plan dialog.
  const limitReached =
    hasContentQuota(contentUsage) && !isNoPlan(contentUsage, isLocked) && requestMax === 0;
  const resetsOn = contentUsage?.periodEnd
    ? new Date(contentUsage.periodEnd).toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '';
  // Generating opportunities costs AI: admins and managers start it, and
  // anyone else reads who can.
  const newButton = canManage ? (
    <Button
      onClick={guard(() => setNewOpen(true), { action: tActions('generateOpportunities') })}
      disabled={generating || loading || limitReached}
      className="gap-2"
      title={limitReached ? t('newLimitTooltip', { date: resetsOn }) : undefined}
    >
      {generating ? <LoadingDots /> : <Plus className="h-4 w-4" />}
      {generating ? t('generating') : t('new')}
    </Button>
  ) : (
    <span className="text-xs text-muted-foreground">{tManagers('generateOpportunities')}</span>
  );

  const handleSendWebhook = async (id: string) => {
    setSendingId(id);
    try {
      const result = await sendToWebhook(id);
      if (result.success === false) {
        toast.error(result.error);
      } else {
        toast.success(t('sentToWorkflow'));
        await loadData(true);
      }
    } catch (err) {
      console.error('Webhook send failed:', err);
      toast.error(t('sendError'));
    } finally {
      setSendingId(null);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await updateOpportunityStatus(id, 'dismissed');
      await loadData(true);
      toast.success(t('dismissedToast'), {
        action: {
          label: t('undo'),
          onClick: async () => {
            try {
              await updateOpportunityStatus(id, 'new');
              await loadData(true);
            } catch {
              toast.error(t('undoFailed'));
            }
          },
        },
      });
    } catch (err) {
      console.error('Dismiss failed:', err);
      toast.error(t('dismissError'));
    }
  };

  const handleBulkSend = async () => {
    setBulkSending(true);
    try {
      const result = await bulkSendToWebhook(Array.from(selectedIds));
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      const notes = bulkSendNotes(result);
      if (notes.sent !== null) toast.success(t('bulkSentToast', { sent: notes.sent }));
      if (notes.failure === 'redirect') toast.error(t('bulkSendRedirect'));
      else if (notes.failure) toast.error(t('bulkSendPartialError', { failed: result.failed }));
      setSelectedIds(new Set());
      await loadData(true);
    } catch (err) {
      console.error('Bulk webhook send failed:', err);
      toast.error(t('bulkSendError'));
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkDone = async () => {
    setBulkSending(true);

    try {
      const ids = Array.from(selectedIds);
      const result = await bulkUpdateStatus(ids, 'done');
      toast.success(t('bulkDoneToast', { updated: result.updated }));
      setSelectedIds(new Set());
      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('bulkUpdateError'));
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkDismiss = async () => {
    setBulkSending(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await bulkUpdateStatus(ids, 'dismissed');
      toast.success(t('bulkDismissToast', { updated: result.updated }));
      setSelectedIds(new Set());
      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('bulkDismissError'));
    } finally {
      setBulkSending(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkSending(true);
    try {
      const ids = Array.from(selectedIds);
      const result = await bulkDeleteOpportunities(ids);
      toast.success(t('bulk.deletedToast', { count: result.deleted }));
      setSelectedIds(new Set());
      // No page reset needed: `usePagination` clamps to the last page that
      // still exists, and the narrowed `start` refetches on its own. Resetting
      // here as well would fire a second, competing load.
      await loadData(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('bulkDeleteError'));
    } finally {
      setBulkSending(false);
    }
  };

  const filtered = opportunities.filter(
    (o) =>
      o.title.toLowerCase().includes(search.toLowerCase()) ||
      (o.description || '').toLowerCase().includes(search.toLowerCase()),
  );

  // `{ value, label }` items let the Combobox filter and display on its own.
  // One prompt has nothing to narrow, so the picker only appears for two or
  // more — or while a filter is set, so it can still be cleared.
  const promptItems = useMemo<PromptFilterItem[]>(
    () => [
      { value: ALL_PROMPTS, label: tCommon('allPrompts'), count: null },
      ...(promptOptions ?? []).map((o) => ({ value: o.promptId, label: o.text, count: o.count })),
    ],
    [promptOptions, tCommon],
  );
  const showPromptFilter = (promptOptions?.length ?? 0) >= 2 || promptFilter !== '';
  const promptFilterTitle = promptItems.find((item) => item.value === promptFilter)?.label;

  /** How many of the selected rows would lose a generated brief (#731). */
  const selectedWithBrief = opportunities.filter(
    (o) => selectedIds.has(o.id) && Boolean(o.brief),
  ).length;

  // "The brand has nothing" and "this filter matched nothing" are different
  // states with different remedies, and the page used to answer both with the
  // Generate card — which hid the very controls needed to undo the filter
  // (#660). The unfiltered view is the only one whose emptiness means the
  // brand truly has no opportunities.
  const hasActiveFilters =
    statusFilter !== 'all' ||
    impactFilter !== 'all' ||
    typeFilter !== 'all' ||
    sourceFilter !== 'all' ||
    suggestedRange !== 'all' ||
    promptFilter !== '' ||
    topicFilter !== '' ||
    search.trim() !== '';

  const clearFilters = () => {
    setStatusFilter('all');
    setImpactFilter('all');
    setTypeFilter('all');
    setSourceFilter('all');
    setSuggestedRange('all');
    setCustomFrom('');
    setCustomTo('');
    selectPrompt('');
    setTopicFilter('');
    setSearch('');
  };

  // Chat's side panel sees the page (W1-08): its filters, and the
  // high-impact opportunity on top of the list.
  const pageFilters: ChatPageFilter[] = [];
  if (typeFilter !== 'all') {
    pageFilters.push({ key: 'type', label: t(`type.${typeFilter}`), value: typeFilter });
  }
  if (impactFilter !== 'all') {
    pageFilters.push({ key: 'impact', label: t(`impact.${impactFilter}`), value: impactFilter });
  }
  if (statusFilter !== 'all') {
    pageFilters.push({ key: 'status', label: t(`status.${statusFilter}`), value: statusFilter });
  }
  const topOpportunity = opportunities.find((o) => o.impact === 'high');
  useChatPageContext(
    activeBrandId
      ? {
          filters: pageFilters,
          suggestions: [
            ...(topOpportunity ? [tChat('opportunityStart', { title: topOpportunity.title })] : []),
            tChat('opportunitiesFirst'),
            tChat('actions'),
          ],
        }
      : null,
  );

  if (!activeBrandId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Select a brand to view content opportunities.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            {newButton}
            <Button
              onClick={handleExportCsv}
              disabled={exporting || loading || total === 0}
              variant="outline"
              className="gap-2"
            >
              {exporting ? <LoadingDots /> : <Download className="h-4 w-4" />}
              {tCommon('exportCsv')}
            </Button>
            <Button onClick={() => setWebhookOpen(true)} variant="outline" className="gap-2">
              <Settings2 className="h-4 w-4" />
              {t('webhook.title')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>

      {loading && opportunities.length === 0 ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <LoadingDots
            size="md"
            label={t('loadingOpportunities')}
            className="text-muted-foreground"
          />
        </div>
      ) : opportunities.length === 0 && !hasActiveFilters ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Lightbulb className="h-12 w-12 text-muted-foreground/40" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">{t('noOpportunities')}</p>
              <p className="text-xs text-muted-foreground">{t('noOpportunitiesHint')}</p>
            </div>
            {newButton}
            <p className="text-xs text-muted-foreground">{t('autoGeneratedHint')}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className={cn(
              'grid grid-cols-2 gap-4 sm:grid-cols-3',
              hasContentQuota(contentUsage) && 'xl:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]',
            )}
          >
            <ContentUsageCard
              usage={contentUsage}
              className="col-span-2 sm:col-span-3 xl:col-span-1"
            />
            <KpiCard
              title={t('kpi.total')}
              icon={Lightbulb}
              value={total}
              sub={
                aggregates.signalCount > 0
                  ? t('kpi.fromSignals', { count: aggregates.signalCount })
                  : t('kpi.shown', { count: filtered.length })
              }
            />
            <KpiCard
              title={t('kpi.highImpact')}
              icon={Zap}
              value={aggregates.highImpactCount}
              sub={t('kpi.opportunities')}
            />
            {/* Two to a row on a phone: the third takes the row's width. */}
            <KpiCard
              title={t('kpi.avgScore')}
              icon={BarChart3}
              value={aggregates.avgScore}
              sub={t('kpi.outOf100')}
              className="col-span-2 sm:col-span-1"
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              {/* The search sits on the title's line, right-aligned and larger,
                  so the filters below keep a line of their own. */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex shrink-0 items-center gap-2">
                    <CardTitle className="text-sm font-medium">{t('opportunities')}</CardTitle>
                    <Badge
                      variant="outline"
                      className="text-xs border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    >
                      {t('available', { count: total })}
                    </Badge>
                  </div>
                  <div className="relative w-full max-w-80">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder={t('filters.search')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label={t('filters.search')}
                      className="h-9 pl-9 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {(topicOptions.length >= 2 || topicFilter !== '') && (
                    <Select
                      items={[
                        { value: 'all', label: t('filters.allTopics') },
                        ...topicOptions.map((o) => ({ value: o.topicId, label: o.name })),
                      ]}
                      value={topicFilter || 'all'}
                      onValueChange={(v) => setTopicFilter(!v || v === 'all' ? '' : v)}
                    >
                      <SelectTrigger className="h-8 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      {/* Wider than the trigger, so topic names fit; the item
                          text may shrink so a longer name truncates instead of
                          running past the edge, and the count stays aligned. */}
                      <SelectContent
                        align="start"
                        alignItemWithTrigger={false}
                        className="w-auto min-w-(--anchor-width) max-w-80"
                      >
                        <SelectItem value="all">{t('filters.allTopics')}</SelectItem>
                        {topicOptions.map((o) => (
                          <SelectItem
                            key={o.topicId}
                            value={o.topicId}
                            className="[&>div]:min-w-0 [&>div]:shrink"
                          >
                            <span className="min-w-0 flex-1 truncate" title={o.name}>
                              {o.name}
                            </span>
                            <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                              {o.count}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {showPromptFilter && (
                    <Combobox
                      items={promptItems}
                      value={
                        promptItems.find((item) => item.value === (promptFilter || ALL_PROMPTS)) ??
                        null
                      }
                      onValueChange={(item: PromptFilterItem | null) =>
                        selectPrompt(!item || item.value === ALL_PROMPTS ? '' : item.value)
                      }
                    >
                      <ComboboxTrigger className="h-8 w-56 text-xs" title={promptFilterTitle}>
                        <ComboboxValue placeholder={tCommon('allPrompts')} />
                      </ComboboxTrigger>
                      <ComboboxContent>
                        <ComboboxInput placeholder={tCommon('searchPrompts')} />
                        <ComboboxList>
                          <ComboboxEmpty>{tCommon('noPromptsMatch')}</ComboboxEmpty>
                          <ComboboxCollection>
                            {(item: PromptFilterItem) => (
                              <ComboboxItem key={item.value} value={item} title={item.label}>
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                {item.count !== null && (
                                  <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                                    {item.count}
                                  </span>
                                )}
                              </ComboboxItem>
                            )}
                          </ComboboxCollection>
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                  )}
                  <Select value={typeFilter} onValueChange={(v) => v && setTypeFilter(v)}>
                    <SelectTrigger className="h-8 w-[110px] text-xs">
                      <SelectValue>
                        {(value) => (value === 'all' ? t('filters.allTypes') : t(`type.${value}`))}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      alignItemWithTrigger={false}
                      className="w-auto min-w-(--anchor-width)"
                    >
                      <SelectItem value="all">{t('filters.allTypes')}</SelectItem>
                      {(['owned', 'earned'] as const).map((type) => (
                        <SelectItem key={type} value={type}>
                          <span className="flex flex-col">
                            <span>{t(`type.${type}`)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t(`typeHint.${type}`)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={impactFilter} onValueChange={(v) => v && setImpactFilter(v)}>
                    <SelectTrigger className="h-8 w-[120px] text-xs">
                      <SelectValue>
                        {(value) =>
                          value === 'all' ? t('filters.allImpacts') : t(`impact.${value}`)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allImpacts')}</SelectItem>
                      <SelectItem value="high">{t('impact.high')}</SelectItem>
                      <SelectItem value="medium">{t('impact.medium')}</SelectItem>
                      <SelectItem value="low">{t('impact.low')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={sourceFilter} onValueChange={(v) => v && setSourceFilter(v)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={t('source.label')}>
                      <SelectValue>
                        {(value) =>
                          value === 'all'
                            ? t('filters.allSources')
                            : t(`source.${value as 'system' | 'manual' | 'prompt' | 'action'}`)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allSources')}</SelectItem>
                      {(['system', 'manual', 'prompt', 'action'] as const).map((value) => (
                        <SelectItem key={value} value={value}>
                          <span className="flex flex-col">
                            <span>{t(`source.${value}`)}</span>
                            <span className="text-[11px] text-muted-foreground">
                              {t(`sourceHint.${value}`)}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* When it was suggested and the order, in one box: the order
                      reads by the Suggested dates, newest first unless picked. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      aria-label={`${t('suggestedRange.label')}: ${t(`suggestedRange.${suggestedRange}`)}, ${t('sort.label')}: ${t(`sort.${sortOrder as OpportunitySort}`)}`}
                      className="flex h-8 w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-xs whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
                    >
                      {t(`suggestedRange.${suggestedRange}`)} ·{' '}
                      {t(`sort.${sortOrder as OpportunitySort}`)}
                      <ChevronDown className="pointer-events-none size-4 text-muted-foreground" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-44">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{t('suggestedRange.label')}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={suggestedRange}
                          onValueChange={(v) => setSuggestedRange(v as SuggestedRange)}
                        >
                          {SUGGESTED_VALUES.map((value) => (
                            <DropdownMenuRadioItem
                              key={value}
                              value={value}
                              closeOnClick
                              className="text-xs"
                            >
                              {t(`suggestedRange.${value}`)}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>{t('sort.label')}</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={sortOrder}
                          onValueChange={(v) => setSortOrder(v as string)}
                        >
                          {OPPORTUNITY_SORTS.map((value) => (
                            <DropdownMenuRadioItem
                              key={value}
                              value={value}
                              closeOnClick
                              className="text-xs"
                            >
                              {t(`sort.${value}`)}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {suggestedRange === 'custom' && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Input
                        type="date"
                        aria-label={t('suggestedRange.from')}
                        value={customFrom}
                        max={customTo || undefined}
                        onChange={(e) => setCustomFrom(e.target.value)}
                        className="h-8 w-[140px] text-xs"
                      />
                      –
                      <Input
                        type="date"
                        aria-label={t('suggestedRange.to')}
                        value={customTo}
                        min={customFrom || undefined}
                        onChange={(e) => setCustomTo(e.target.value)}
                        className="h-8 w-[140px] text-xs"
                      />
                    </span>
                  )}
                  <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
                    <SelectTrigger className="h-8 w-[130px] text-xs">
                      <SelectValue>
                        {(value) =>
                          value === 'all' ? t('filters.allStatuses') : t(`status.${value}`)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
                      <SelectItem value="new">{t('status.new')}</SelectItem>
                      <SelectItem value="reviewed">{t('status.reviewed')}</SelectItem>
                      <SelectItem value="sent">{t('status.sent')}</SelectItem>
                      <SelectItem value="in_progress">{t('status.in_progress')}</SelectItem>
                      <SelectItem value="done">{t('status.done')}</SelectItem>
                      <SelectItem value="dismissed">{t('status.dismissed')}</SelectItem>
                      <SelectItem value="archived">{t('status.archived')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2">
                <span className="text-xs text-muted-foreground">
                  {t('bulk.selected', { count: selectedIds.size })}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={guard(handleBulkSend, { action: tActions('sendToWorkflow') })}
                    disabled={bulkSending}
                  >
                    {bulkSending ? <LoadingDots /> : <Send className="h-3 w-3" />}
                    {t('bulk.sendAll')}
                  </Button>

                  {/* Bulk changes, dismissing and deleting are for admins and
                      managers, as the server and the database allow them. */}
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1.5"
                        onClick={guard(handleBulkDone, {
                          action: tActions('markOpportunitiesDone'),
                        })}
                        disabled={bulkSending}
                      >
                        <Check className="h-3 w-3" />
                        {t('status.done')}
                      </Button>

                      <Dialog onOpenChange={confirmUnlessLocked(tActions('dismissOpportunities'))}>
                        <DialogTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1.5 text-muted-foreground"
                              disabled={bulkSending}
                            />
                          }
                        >
                          <X className="h-3 w-3" />
                          {t('bulk.dismissAll')}
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-sm">
                          <DialogHeader>
                            <DialogTitle>{t('bulk.dismissAllTitle')}</DialogTitle>
                            <DialogDescription>
                              {t('bulk.dismissAllConfirm', { count: selectedIds.size })}
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>
                              {t('cancel')}
                            </DialogClose>
                            <DialogClose
                              render={<Button variant="destructive" onClick={handleBulkDismiss} />}
                            >
                              {t('bulk.dismissAll')}
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>

                      {/* Last in the row, and the only destructive-styled trigger:
                          this one does not move a row, it removes it. */}
                      <Dialog onOpenChange={confirmUnlessLocked(tActions('deleteOpportunities'))}>
                        <DialogTrigger
                          render={
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1.5 text-destructive hover:text-destructive"
                              disabled={bulkSending}
                            />
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('bulk.deleteAll')}
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-sm">
                          <DialogHeader>
                            <DialogTitle>{t('bulk.deleteAllTitle')}</DialogTitle>
                            <DialogDescription>
                              {t('bulk.deleteAllConfirm', { count: selectedIds.size })}
                              {selectedWithBrief > 0 && (
                                <span className="mt-2 block font-medium text-foreground">
                                  {t('bulk.deleteAllBriefWarning', { count: selectedWithBrief })}
                                </span>
                              )}
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <DialogClose render={<Button variant="outline" />}>
                              {t('cancel')}
                            </DialogClose>
                            <DialogClose
                              render={<Button variant="destructive" onClick={handleBulkDelete} />}
                            >
                              {t('bulk.deleteAll')}
                            </DialogClose>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </>
                  )}
                </div>
              </div>
            )}
            <CardContent className="p-0">
              {/* Below this width the table scrolls sideways rather than
                  squeezing the action titles out of sight; 1024px still fits
                  it with the sidebar open. */}
              <Table className="min-w-[720px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <Checkbox
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedIds(new Set(filtered.map((o) => o.id)));
                          } else {
                            setSelectedIds(new Set());
                          }
                        }}
                      />
                    </TableHead>
                    {/* The other columns are sized to fit their badges and buttons;
                        the action takes what is left, so nothing spills into its
                        neighbour on narrower screens. */}
                    <TableHead className="pl-6">{t('table.action')}</TableHead>
                    {/* Hidden on narrower screens, where the action column needs the room. */}
                    <TableHead className="hidden w-[112px] whitespace-nowrap xl:table-cell">
                      {t('table.suggested')}
                    </TableHead>
                    <TableHead className="w-[96px] text-center">{t('table.type')}</TableHead>
                    <TableHead className="w-[88px] text-center">{t('table.impact')}</TableHead>
                    <TableHead className="w-[72px] text-center">{t('table.score')}</TableHead>
                    <TableHead className="w-[136px] text-center">{t('table.status')}</TableHead>
                    <TableHead className="w-[96px] text-right pr-6">{t('table.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: pendingCount }, (_, i) => (
                    <TableRow key={`pending-${i}`} aria-busy="true">
                      <TableCell className="w-10 pl-4" />
                      <TableCell className="pl-6">
                        <Skeleton className="h-4 w-4/5" />
                        <Skeleton className="mt-1.5 h-3 w-3/5" />
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <Skeleton className="h-3 w-12" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Skeleton className="mx-auto h-5 w-14" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Skeleton className="mx-auto h-5 w-14" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Skeleton className="mx-auto h-4 w-6" />
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          {t('generatingRow')}
                        </Badge>
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                  {filtered.map((opp) => (
                    <TableRow key={opp.id} className="hover:bg-muted/50">
                      <TableCell className="w-10 pl-4">
                        <Checkbox
                          checked={selectedIds.has(opp.id)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedIds);
                            if (checked) next.add(opp.id);
                            else next.delete(opp.id);
                            setSelectedIds(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="pl-6 max-w-0">
                        <button
                          type="button"
                          onClick={() => selectOpportunity(opp.id)}
                          className="block w-full text-left hover:underline"
                        >
                          <p className="text-sm font-medium line-clamp-1">
                            {opp.sourceData?.reopened && opp.status === 'new' && (
                              <Badge
                                variant="outline"
                                className="mr-1.5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                              >
                                {t('newSignal')}
                              </Badge>
                            )}
                            {/* Before the title, which is clamped to one line. */}
                            {opp.sourceData?.alternativeOf && (
                              <Badge
                                variant="outline"
                                className="mr-1.5 align-middle text-[10px] font-normal text-muted-foreground"
                                title={
                                  t('alternative.of') + ' ' + opp.sourceData.alternativeOf.title
                                }
                              >
                                {t('alternative.badge')}
                              </Badge>
                            )}
                            {opp.source && opp.source !== 'system' && (
                              <Badge
                                variant="outline"
                                className="mr-1.5 align-middle text-[10px] font-normal text-muted-foreground"
                                title={t(`sourceHint.${opp.source}`)}
                              >
                                {t(`source.${opp.source}`)}
                              </Badge>
                            )}
                            {opp.title}
                          </p>
                          <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                            <OpportunityScope opp={opp} />
                            {opp.description}
                          </p>
                        </button>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground xl:table-cell">
                        <SuggestedCell
                          createdAt={opp.createdAt}
                          locale={locale}
                          isNew={lastVisit !== null && Date.parse(opp.createdAt) > lastVisit}
                          newLabel={t('newSinceVisit')}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Badge
                            variant="outline"
                            className="text-xs"
                            title={t(
                              `typeHint.${opp.type}` as 'typeHint.owned' | 'typeHint.earned',
                            )}
                          >
                            {t(`type.${opp.type}` as 'type.owned' | 'type.earned')}
                          </Badge>
                          {opp.decision && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t(`decision.${opp.decision}`)}
                            </Badge>
                          )}
                          {assetTypeLabel(opp.sourceData?.assets?.[0]?.type) && (
                            <span className="text-[11px] leading-tight text-muted-foreground">
                              {assetTypeLabel(opp.sourceData?.assets?.[0]?.type)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-xs', IMPACT_COLORS[opp.impact])}
                        >
                          {t(
                            `impact.${opp.impact}` as
                              'impact.high' | 'impact.medium' | 'impact.low',
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="tabular-nums font-semibold text-sm">
                          {Math.round(opp.opportunityScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn('text-xs whitespace-nowrap', STATUS_COLORS[opp.status])}
                        >
                          {t(`status.${opp.status}` as `status.${ContentOpportunityStatus}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <OpportunityRowMenu
                          title={opp.title}
                          editor={{
                            draftId:
                              draftsShown && !draftsShown.failed
                                ? (draftsShown.byOpportunity[opp.id] ?? null)
                                : undefined,
                            lookupFailed: draftsShown?.failed ?? false,
                            onRetry: retryDrafts,
                            canStart: canWriteOpportunity(opp),
                            onStart: guard(() => setContentPreset(opportunityStart(opp)), {
                              action: tActions('createContent'),
                            }),
                            onWriteThis: guard(() => setWriteThis(opp), {
                              action: tActions('createContent'),
                            }),
                            onOpenDraft: (draftId) => router.push(contentEditorPath(draftId)),
                          }}
                          // The Plan lists owned work still open; its marks are
                          // for admins and managers.
                          plan={
                            canManage && canWriteOpportunity(opp)
                              ? {
                                  prioritized: prioritiesShown
                                    ? prioritiesShown.includes(opp.id)
                                    : undefined,
                                  onSend: guard(() => void handleSendToPlan(opp.id), {
                                    action: tActions('prioritizeContent'),
                                  }),
                                  onOpen: () => router.push('/dashboard/content/plan'),
                                }
                              : null
                          }
                          workflow={
                            opp.status === 'new'
                              ? {
                                  sending: sendingId === opp.id,
                                  onSend: guard(() => void handleSendWebhook(opp.id), {
                                    action: tActions('sendToWorkflow'),
                                  }),
                                }
                              : null
                          }
                          pageHref={`/dashboard/content/${opp.id}`}
                          onDismiss={
                            canManage && opp.status === 'new'
                              ? guard(() => void handleDismiss(opp.id), {
                                  action: tActions('dismissOpportunities'),
                                })
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {filtered.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">{t('noResults')}</p>
                  {hasActiveFilters && (
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={clearFilters}>
                      <X className="h-3.5 w-3.5" />
                      {t('clearFilters')}
                    </Button>
                  )}
                </div>
              )}
              <TablePager
                page={pager.page}
                totalPages={pager.totalPages}
                total={total}
                start={pager.start}
                end={pager.end}
                onPage={pager.setPage}
              />
            </CardContent>
          </Card>
        </>
      )}

      {activeBrandId && (
        <NewContentDialog
          open={contentPreset !== null}
          onOpenChange={(open) => !open && setContentPreset(null)}
          brandId={activeBrandId}
          siteType={siteTypeOf(activeBrand ?? {})}
          preset={contentPreset}
        />
      )}
      <WriteThisDialog
        opportunity={writeThis}
        onOpenChange={(open) => !open && setWriteThis(null)}
        siteType={siteTypeOf(activeBrand ?? {})}
      />
      <Sheet
        open={openOpportunityId !== null}
        onOpenChange={(open) => {
          if (!open) selectOpportunity(null);
        }}
      >
        <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-4xl">
          <SheetTitle className="sr-only">{t('viewDetails')}</SheetTitle>
          <div className="flex-1 overflow-y-auto p-6">
            {openOpportunityId && (
              <OpportunityDetail
                key={openOpportunityId}
                id={openOpportunityId}
                inDrawer
                onChanged={() => loadData(true)}
                onPrioritized={markPrioritized}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      <WebhookSettingsDialog
        open={webhookOpen}
        onOpenChange={setWebhookOpen}
        brandId={activeBrandId}
      />
      <NewOpportunitiesDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        brandId={activeBrandId}
        max={requestMax}
        remaining={contentUsage?.opportunities.remaining ?? -1}
        onSubmit={handleNew}
        onOpenExisting={selectOpportunity}
      />
    </div>
  );
}
