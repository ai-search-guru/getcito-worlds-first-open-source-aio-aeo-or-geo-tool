'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { useFailureToast } from '@/hooks/useFailureToast';
import { useSearchParams } from 'next/navigation';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { PROMPTS_BASE, sectionFor, sectionFromPath } from '@/lib/promptsRoutes';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const PlatformVolumeChart = dynamic(() => import('./_charts').then((m) => m.PlatformVolumeChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});
import { QueryFanoutTab } from './_FanoutTab';
// The Topics tab loads as its own chunk, only when it is shown, so it
// adds nothing to the other tabs' first load.
const TopicsTab = dynamic(() => import('./_TopicsTab').then((m) => m.TopicsTab), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});
import {
  PromptUsageCards,
  countByStatus,
  locationQuotaFromUsage,
  matchesStatusFilter,
  newFirst,
  promptStatus,
  usePromptUsage,
  type PromptStatus,
  type PromptStatusFilter,
} from './_UsageCards';
import { INTENT_LABELS, INTENT_COLORS } from '@/config/intentLabels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CompetitionBars } from '@/components/ui/competition-bars';
import { WorkStatusBadge } from '@/components/prompts/WorkStatus';
import { BulkImportPrompts } from '@/components/prompts/BulkImportPrompts';
import { AddTopicLink, TopicFirstNotice } from '@/components/prompts/TopicFirst';
import { isNoTopics } from '@/lib/topicsRequired';
import { promptKey } from '@/lib/promptImport';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setPromptWorkStatus, type PromptWorkStatus } from '@/lib/actions/promptWorkflow';
import {
  TrendingUp,
  Search,
  AlertCircle,
  BarChart3,
  Layers,
  Eye,
  HelpCircle,
  Loader2,
  RefreshCw,
  Pencil,
  Plus,
  Settings2,
  Download,
  ChevronUp,
  ChevronDown,
  Trash2,
  X,
  ListChecks,
  Sparkles,
  ArrowUp,
  ArrowDown,
  MoreHorizontal,
  Pause,
  Play,
  Lightbulb,
  FilePlus,
  FileText,
  RotateCw,
} from 'lucide-react';
import { NewContentDialog, type DialogPreset } from '@/components/content/NewContentDialog';
import { getDraftForPrompt } from '@/lib/actions/contentDrafts';
import { contentEditorPath } from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/pageTypes';
import { cn } from '@/lib/utils';
import {
  compareLateness,
  opensPositionsPanel,
  positionCellKind,
  type PlatformDot,
  type PlatformDotState,
  type PromptPerformance,
  type PromptPositionCell,
} from '@/lib/promptPositionSummary';
import { mentionRateLabel } from '@/lib/promptImprove';
import { useBrandStore } from '@/state/useBrandStore';
import { useFirstRun } from '@/hooks/useFirstRun';
import { FirstRunEmptyState } from '@/components/first-run/FirstRunEmptyState';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import { rangeChipLabel } from '@/lib/chat/pageContext';
import {
  startPromptVolumeAnalysis,
  getVolumeAnalysisStatus,
  refreshVolumes,
  type VolumeQuota,
  type VolumeErrorCode,
} from '@/lib/actions/volumes';
import {
  deletePrompt,
  deletePrompts,
  getPromptsPageData,
  importPrompts,
  setPromptActive,
  setPromptsActive,
  updatePrompt,
  type LocationQuota,
} from '@/lib/actions/prompt';
import { Checkbox } from '@/components/ui/checkbox';
import { useUserRole } from '@/hooks/useUserRole';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { isNoPlan } from '@/lib/billing/noPlan';
import {
  MODEL_GROUPS,
  ALL_MODELS,
  SCRAPER_GROUPS,
  ALL_SCRAPERS,
  PROMPT_RANGE_PRESETS,
  DEFAULT_PROMPT_RANGE_PRESET,
  isPromptRangePreset,
  promptRangeLabel,
  resolvePromptRange,
  type PromptRangePreset,
} from '@/config/promptOptions';
import { DateRangeFilter } from '@/components/filters/DateRangeFilter';
import { getBrandFilterOptions } from '@/lib/actions/tracking';
import { formatRegionDisplay, isValidLocation, locationCode, regionLabel } from '@/lib/region';
import { SuggestionsTab } from './_SuggestionsTab';
import { PLANS } from '@/config/plans';
import { getPromptUsage, isPromptLimitReached } from '@/lib/promptUsage';
import { getTopics } from '@/lib/actions/topic';
import type { PromptVisibilitySummary } from '@/lib/actions/tracking';
import { aggregatePromptVolumeClusters } from '@/lib/promptVolumeClusters';
import {
  OPPORTUNITY_HIGH_VOLUME,
  OPPORTUNITY_MIN_VOLUME,
  opportunityLevel,
} from '@/lib/promptVolumeOpportunity';
import type { PromptVolume, Prompt, Topic } from '@/types';
import { toast } from 'sonner';
import {
  getContentUsage,
  getGenerationJobStatus,
  getOpenSuggestionForPrompt,
  suggestContentForPrompt,
} from '@/lib/actions/content';
import { hasContentQuota, type ContentUsage } from '@/lib/contentUsage';
import { suggestForPrompt } from '@/lib/contentJob';
import {
  allSelected,
  bulkSuggestBlock,
  bulkSuggestSummary,
  deleteInBatches,
  PROMPT_DELETE_BATCH,
  runInTurn,
  toggleAll,
} from '@/lib/promptBulkActions';
import { toCsv } from '@/lib/csv';
import { formatRelative } from '@/lib/formatRelative';
import {
  compareNullsLast,
  comparePromptSortRows,
  isAllPromptsSortKey,
  type AllPromptsSortKey,
  type SortDir,
} from './promptSort';
import { BulkActionBar } from './_BulkActionBar';
import { ColumnsPanel } from './_ColumnsPanel';
import { PromptLimitActions } from './_PromptLimitActions';
import {
  LocationMatrix,
  LocationPending,
  clearLocationMatrixCache,
  loadLocationMatrix,
} from './_LocationMatrix';
import { AddLocationsDialog, type AddLocationsPreset } from './_AddLocationsDialog';
import { getPromptTableViews, type PromptTableViews } from '@/lib/actions/promptTableViews';
import {
  effectiveView,
  parseLocationColumn,
  pendingColumn,
  visibleColumns,
  type PromptColumnId,
} from '@/lib/promptTableColumns';
import {
  awaitsFirstAnswers,
  matrixLocations,
  metricValue,
  type PromptLocationMatrix,
} from '@/lib/promptLocationMatrix';
import { readUrlChoice } from '@/lib/urlState';
import { promptsTableState } from './tableState';
import { formatCompactNumber, formatDate, formatNumber } from '@/lib/format';
import {
  AI_ADOPTION_RATE,
  averageEstimate,
  promptVolumeEstimate,
  sumEstimates,
  type VolumeEstimate,
} from '@/lib/volumeEstimate';
import {
  EstimateBadge,
  EstimateNoteTooltip,
  EstimateRange,
  createEstimateNoteHandle,
} from '@/components/prompts/VolumeEstimate';
import { usePagination, TablePager } from '@/components/TablePager';
import { PromptPositionsSheet } from '@/components/prompts/PromptPositionsSheet';
import {
  ClampedText,
  ClampedTextTooltip,
  createClampedTextHandle,
} from '@/components/prompts/ClampedText';
import {
  panelRangeFromTable,
  parsePositionsRange,
  positionsUrlParams,
  type PositionsRange,
} from '@/lib/positionsRange';
import { viewerTimeZone } from '@/lib/timeZone';
import { exportFileName } from '@/lib/white-label/exportName';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

// ─── Info Tooltip ─────────────────────────────────────────────────────────────

function InfoTip({ content }: { content: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className="inline-flex items-center cursor-help"
      >
        <HelpCircle className="h-3 w-3 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
      </span>
      {pos &&
        createPortal(
          <div
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

function ColHead({
  children,
  tooltip,
  className,
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        <InfoTip content={tooltip} />
      </span>
    </TableHead>
  );
}

// ─── Sortable column header (All Prompts) ─────────────────────────────────────

/**
 * Clickable header that toggles asc⇄desc for its column and marks the active
 * sort with a chevron. The InfoTip lives outside the button so hovering /
 * clicking the help icon doesn't trigger a sort.
 */
function SortableHead({
  children,
  tooltip,
  className,
  sortKey,
  activeSort,
  dir,
  onSort,
}: {
  children: React.ReactNode;
  tooltip: string;
  className?: string;
  sortKey: AllPromptsSortKey;
  activeSort: AllPromptsSortKey | null;
  dir: SortDir;
  onSort: (key: AllPromptsSortKey) => void;
}) {
  const active = activeSort === sortKey;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-1">
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
        <InfoTip content={tooltip} />
      </span>
    </TableHead>
  );
}

/**
 * CSV headers. The window-scoped columns carry the selected range in their
 * name (`runs_7d`, `runs_90d`, `runs_24h`, `runs_custom`) rather than a
 * hardcoded `_30d`, so an export taken at a different range can't be misread
 * as 30-day data. At the default range the header row is byte-identical to
 * what it has always been.
 */
const promptExportHeaders = (suffix: string) => [
  'text',
  'topic_id',
  'category',
  'platforms',
  'models',
  'regions',
  'is_active',
  'created_at',
  'est_ai_volume',
  // PROMPT-013: the AI volume is an estimate; these say how sure it is.
  'volume_type',
  'volume_confidence',
  'est_ai_volume_low',
  'est_ai_volume_high',
  'volume_date',
  'total_google_volume',
  'intent',
  `ai_visibility_score_${suffix}`,
  `visibility_rate_${suffix}`,
  `visible_runs_${suffix}`,
  `avg_visibility_${suffix}`,
  `total_mentions_${suffix}`,
  `total_citations_${suffix}`,
  `runs_${suffix}`,
  'last_run_at',
];

const PROMPT_EXPORT_HINT = 'No prompts yet - add prompts first.';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TABS = ['all', 'topics', 'fanout', 'insights'] as const;

/**
 * The window a tab opens on. Query Fan-out opens on 7 days: one day of
 * answers holds few searches, and an engine that only some answers search
 * with looks absent in it.
 */
function defaultRangeFor(tab: string): PromptRangePreset {
  return tab === 'fanout' ? '7d' : DEFAULT_PROMPT_RANGE_PRESET;
}
type TabId = (typeof VALID_TABS)[number];

/**
 * Whether a tab reads the Location filter: only All Prompts' table does.
 * Topics and Query Fan-out read every location and Insights' volumes carry
 * none, so the filter and Chat's location chip are left off there.
 */
function tabUsesLocation(tab: TabId): boolean {
  return tab === 'all';
}

const PROMPT_VIEWS = ['tracked', 'suggestions'] as const;
type PromptsView = (typeof PROMPT_VIEWS)[number];

function visibilityColorClass(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 40) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function visibilityBarClass(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * Plan- and brand-scoped engine lists shared by the Add / Edit prompt dialogs.
 * Shopping tracking is opt-in per brand (#155): the engine is hidden entirely
 * when the pref is off. The write actions strip it server-side too.
 */
function useAllowedEngines(shoppingEnabled: boolean) {
  const { planId, allowedModelIds: planAllowedModelIds } = usePlanContext();

  const allowedScraperIds = useMemo(() => {
    const allowed = PLANS[planId].limits.allowedScrapers;
    const ids = allowed ? [...allowed] : ALL_SCRAPERS.map((s) => s.id);
    return shoppingEnabled ? ids : ids.filter((id) => id !== 'chatgpt-shopping');
  }, [planId, shoppingEnabled]);
  const allowedModelIds = useMemo(
    () => planAllowedModelIds ?? ALL_MODELS.map((m) => m.id),
    [planAllowedModelIds],
  );
  const visibleScrapers = useMemo(
    () => ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id)),
    [allowedScraperIds],
  );
  const visibleModels = useMemo(
    () => ALL_MODELS.filter((m) => allowedModelIds.includes(m.id)),
    [allowedModelIds],
  );

  return { allowedScraperIds, allowedModelIds, visibleScrapers, visibleModels };
}

/**
 * Shared form body of the Add / Edit prompt dialogs (#460, #484): text input,
 * topic select and the grouped Platform & Models picker with badge chips.
 * Both dialogs must present the same fields — keep them here so the two
 * can't drift apart.
 */
function PromptFormFields({
  text,
  onTextChange,
  onSubmit,
  category,
  onCategoryChange,
  topics,
  scrapers,
  models,
  setScrapers,
  setModels,
  visibleScrapers,
  visibleModels,
  saving,
  autoFocus,
}: {
  text: string;
  onTextChange: (value: string) => void;
  onSubmit: () => void;
  category: string;
  onCategoryChange: (value: string) => void;
  topics: Topic[];
  scrapers: string[];
  models: string[];
  setScrapers: React.Dispatch<React.SetStateAction<string[]>>;
  setModels: React.Dispatch<React.SetStateAction<string[]>>;
  visibleScrapers: typeof ALL_SCRAPERS;
  visibleModels: typeof ALL_MODELS;
  saving: boolean;
  autoFocus?: boolean;
}) {
  return (
    <>
      <Input
        autoFocus={autoFocus}
        placeholder="e.g. Best project management tools for startups"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        disabled={saving}
      />

      {/* Topic */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Topic</label>
        {topics.length > 0 ? (
          <Select value={category || null} onValueChange={(v) => v && onCategoryChange(String(v))}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a topic" />
            </SelectTrigger>
            <SelectContent>
              {topics.map((topic) => (
                <SelectItem key={topic.id} value={topic.name}>
                  {topic.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-xs text-muted-foreground py-2">
            No topics defined yet. Add topics in brand settings.
          </p>
        )}
      </div>

      {/* Platform & Models — combined select, same as brands/[id]/prompts */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Platform & Models
        </label>
        <Select
          value="__placeholder__"
          onValueChange={(v) => {
            if (!v || v === '__placeholder__') return;
            const id = String(v);
            if (visibleModels.some((m) => m.id === id) && !models.includes(id)) {
              setModels((prev) => [...prev, id]);
            } else if (visibleScrapers.some((s) => s.id === id) && !scrapers.includes(id)) {
              setScrapers((prev) => [...prev, id]);
            }
          }}
        >
          <SelectTrigger className="w-full">
            <span className="truncate text-muted-foreground">
              {models.length + scrapers.length > 0
                ? `${models.length + scrapers.length} selected`
                : 'Select platform & models'}
            </span>
          </SelectTrigger>
          <SelectContent>
            {SCRAPER_GROUPS.map((group) => {
              const groupScrapers = group.scrapers.filter((s) =>
                visibleScrapers.some((vs) => vs.id === s.id),
              );
              if (groupScrapers.length === 0) return null;
              return (
                <div key={group.provider}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    {group.provider} (Scraper)
                  </div>
                  {groupScrapers.map((s) => (
                    <SelectItem key={s.id} value={s.id} disabled={scrapers.includes(s.id)}>
                      <div>
                        <div>{s.label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{s.id}</div>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              );
            })}
            {MODEL_GROUPS.map((group) => {
              const groupModels = group.models.filter((m) =>
                visibleModels.some((vm) => vm.id === m.id),
              );
              if (groupModels.length === 0) return null;
              return (
                <div key={group.provider}>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    {group.provider} (API)
                  </div>
                  {groupModels.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={models.includes(m.id)}>
                      <div>
                        <div>{m.label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{m.id}</div>
                      </div>
                    </SelectItem>
                  ))}
                </div>
              );
            })}
          </SelectContent>
        </Select>
        {(models.length > 0 || scrapers.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {scrapers.map((id) => {
              const s = ALL_SCRAPERS.find((as_) => as_.id === id);
              return (
                <Badge key={id} variant="outline" className="gap-1 text-xs">
                  {s?.label ?? id}
                  <button
                    type="button"
                    onClick={() => setScrapers((p) => p.filter((i) => i !== id))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
            {models.map((id) => {
              const m = ALL_MODELS.find((am) => am.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1 text-xs">
                  {m?.label ?? id}
                  <button type="button" onClick={() => setModels((p) => p.filter((i) => i !== id))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/** The brand's tracking location, as new prompts get it (addPromptToSet). */
function brandLocation(region: string | undefined, state: string | undefined): string {
  const country = region ?? 'US';
  const candidate = locationCode(country, state ?? null);
  return isValidLocation(candidate) ? candidate : country;
}

// ─── Tracked prompt limit (PROMPT-009) ────────────────────────────────────────

/**
 * Quick-add dialog for the active brand (#460). Same mechanism as the Add
 * Prompt card on brands/[id]/prompts: topic select + the grouped
 * Platform & Models picker (plan-filtered, shopping hidden unless the brand
 * opted in), all allowed engines selected by default. Plan-limit and other
 * user-facing failures come back as a value and render inside the dialog
 * instead of the masked production digest (#427).
 */
function AddPromptDialog({
  brandId,
  shoppingEnabled,
  locationQuota,
  existingTexts,
  defaultRegion,
  open,
  onClose,
  onAdded,
  onAddTopic,
}: {
  brandId: string;
  shoppingEnabled: boolean;
  /** Texts the brand already tracks, for Bulk import's duplicate check. */
  existingTexts: string[];
  /** The brand's location, for Bulk import rows that name none. */
  defaultRegion: string;
  /** When the plan limit is already reached, the dialog explains it instead of the form. */
  locationQuota: LocationQuota | null;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  /** "Add a topic" on a brand without one: the page's Topics tab, with Add Topic open. */
  onAddTopic: () => void;
}) {
  const limitReached =
    !!locationQuota &&
    isPromptLimitReached(getPromptUsage(locationQuota.used, locationQuota.maxPrompts));
  const { allowedScraperIds, allowedModelIds, visibleScrapers, visibleModels } =
    useAllowedEngines(shoppingEnabled);
  const tCommon = useTranslations('common');

  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [scrapers, setScrapers] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  // The brand has no topic yet: the dialog asks for one instead of the form.
  const [noTopics, setNoTopics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'single' | 'bulk'>('single');
  // Prompts queued with "Add to list", not saved yet: each keeps the topic and
  // engines chosen when it was queued.
  const [staged, setStaged] = useState<
    { key: string; text: string; category: string; platforms: string[]; models: string[] }[]
  >([]);

  // Reset to a fresh form on every open: all allowed engines pre-selected
  // (matching the brand page's defaults) and topics fetched lazily — the
  // dialog must cost zero requests until it is actually opened.
  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
    setNoTopics(false);
    setMode('single');
    setStaged([]);
    setScrapers(allowedScraperIds);
    setModels(allowedModelIds);
    let cancelled = false;
    // Read on every open, so a topic added on the Topics tab counts on return.
    getTopics(brandId)
      .then((t) => {
        if (cancelled) return;
        setTopics(t);
        setNoTopics(t.length === 0);
        setCategory((prev) => prev || (t[0]?.name ?? ''));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, brandId]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const enginesChosen = scrapers.length > 0 || models.length > 0;
  const takenKeys = new Set([...existingTexts, ...staged.map((s) => s.text)].map(promptKey));

  /** Queue the typed prompt below the form and clear the field for the next one. */
  const addToList = () => {
    const value = text.trim().replace(/\s+/g, ' ');
    if (!value || !enginesChosen || saving) return;
    if (takenKeys.has(promptKey(value))) {
      setError('This prompt is already tracked or in the list.');
      return;
    }
    setStaged((list) => [
      ...list,
      { key: `${Date.now()}-${list.length}`, text: value, category, platforms: scrapers, models },
    ]);
    setText('');
    setError(null);
  };

  // What a save writes: the list, plus a typed prompt not queued yet.
  const typed = text.trim().replace(/\s+/g, ' ');
  const typedCounts = !!typed && enginesChosen && !takenKeys.has(promptKey(typed));
  const toSave = [
    ...staged,
    ...(typedCounts ? [{ key: 'typed', text: typed, category, platforms: scrapers, models }] : []),
  ];

  /**
   * Save the list in one locked call (the same path as Bulk import, so the
   * plan limit holds the same way), then close or stay open for more.
   */
  const handleSave = async (closeAfter: boolean) => {
    if (toSave.length === 0 || saving) return;
    if (typed && !typedCounts && staged.length === 0) {
      setError('This prompt is already tracked or in the list.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await importPrompts(
        brandId,
        toSave.map((s, idx) => ({
          idx,
          text: s.text,
          topic: s.category || null,
          platforms: s.platforms,
          models: s.models,
          regions: [defaultRegion],
        })),
      );
      if ('error' in result) {
        if (isNoTopics(result)) setNoTopics(true);
        else setError(result.error);
        return;
      }
      const added = result.importedIdx.length;
      const skipped = toSave.length - added;
      if (added === 0) {
        setError(
          'Nothing was added: your plan limit is reached, or these prompts are already tracked.',
        );
        return;
      }
      toast.success(
        `${added} prompt${added === 1 ? '' : 's'} added${skipped ? ` · ${skipped} not added (plan limit or duplicate)` : ''}`,
        {
          description: result.analysisStarted
            ? 'Analyzing them now.'
            : 'They will be picked up by the next tracking run.',
        },
      );
      setStaged([]);
      setText('');
      if (closeAfter) onClose();
      onAdded();
    } catch {
      setError('Failed to add prompts. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className={cn(
          'max-h-[85vh] overflow-y-auto',
          mode === 'bulk' && !limitReached ? 'sm:max-w-3xl' : 'sm:max-w-md',
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus className="h-4 w-4" />
            Add Prompt
          </DialogTitle>
          <DialogDescription>
            Track a new prompt for this brand across the selected platforms.
          </DialogDescription>
        </DialogHeader>
        {limitReached && locationQuota ? (
          <>
            <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900/50 dark:bg-red-950/30">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
              <div className="space-y-1">
                <p className="font-medium text-red-900 dark:text-red-200">
                  You&apos;ve reached your prompt limit
                </p>
                <p className="text-red-800/80 dark:text-red-300/80">
                  Your {locationQuota.planName} plan tracks up to {locationQuota.maxPrompts} active
                  prompt locations and {locationQuota.used} are in use. Each prompt counts once per
                  location it targets; paused prompts don&apos;t count. Pause or remove prompts or
                  locations to free a slot, or{' '}
                  {locationQuota.planId === 'starter' ? 'upgrade your plan' : 'contact us'} to track
                  more.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Close
              </Button>
              <PromptLimitActions planId={locationQuota.planId} />
            </DialogFooter>
          </>
        ) : noTopics ? (
          <>
            <TopicFirstNotice />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                {tCommon('cancel')}
              </Button>
              <AddTopicLink onAddTopic={onAddTopic} />
            </DialogFooter>
          </>
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'single' | 'bulk')}>
            <TabsList>
              <TabsTrigger value="single">Single</TabsTrigger>
              <TabsTrigger value="bulk">Bulk import</TabsTrigger>
            </TabsList>
            <TabsContent value="single" className="mt-3 space-y-4">
              <div className="space-y-3">
                <PromptFormFields
                  autoFocus
                  text={text}
                  onTextChange={(value) => {
                    setText(value);
                    if (error) setError(null);
                  }}
                  onSubmit={addToList}
                  category={category}
                  onCategoryChange={setCategory}
                  topics={topics}
                  scrapers={scrapers}
                  models={models}
                  setScrapers={setScrapers}
                  setModels={setModels}
                  visibleScrapers={visibleScrapers}
                  visibleModels={visibleModels}
                  saving={saving}
                />

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addToList}
                  disabled={saving || !text.trim() || !enginesChosen}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add to list
                </Button>

                {error && <p className="text-xs text-red-500">{error}</p>}

                {staged.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Ready to save ({staged.length})
                    </p>
                    <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                      {staged.map((s) => (
                        <li key={s.key} className="flex items-start gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="break-words">{s.text}</p>
                            {s.category && (
                              <p className="text-xs text-muted-foreground">{s.category}</p>
                            )}
                          </div>
                          <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Remove "${s.text}" from the list`}
                            disabled={saving}
                            onClick={() =>
                              setStaged((list) => list.filter((item) => item.key !== s.key))
                            }
                          >
                            <X />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleSave(false)}
                  disabled={saving || toSave.length === 0}
                >
                  Save &amp; add more
                </Button>
                <Button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={saving || toSave.length === 0}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      {toSave.length > 1 ? `Save ${toSave.length} & close` : 'Save & close'}
                    </>
                  )}
                </Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="bulk" className="mt-3">
              <BulkImportPrompts
                brandId={brandId}
                existingTexts={existingTexts}
                defaults={{ platforms: scrapers, models }}
                defaultRegion={defaultRegion}
                quota={locationQuota}
                limitActions={
                  locationQuota ? <PromptLimitActions planId={locationQuota.planId} /> : null
                }
                onImported={() => {
                  onClose();
                  onAdded();
                }}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit/delete-in-place dialog for a row on the All Prompts tab (#484) — the
 * sibling of AddPromptDialog, sharing its form body. Saving goes through the
 * existing updatePrompt (topic resolution, plan filtering and shopping
 * stripping happen server-side); editing keeps the prompt id so its tracking
 * history stays attached. Delete sits behind an inline confirm step because
 * prompt_results cascade — the prompt's history goes with it.
 */
function EditPromptDialog({
  prompt,
  brandId,
  shoppingEnabled,
  onClose,
  onChanged,
}: {
  /** The prompt being edited; null keeps the dialog closed. */
  prompt: Prompt | null;
  brandId: string;
  shoppingEnabled: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { allowedScraperIds, allowedModelIds, visibleScrapers, visibleModels } =
    useAllowedEngines(shoppingEnabled);

  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [scrapers, setScrapers] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [isActive, setIsActive] = useState(true);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const promptId = prompt?.id;

  // Seed the form from the clicked prompt on every open. Selections are
  // intersected with the allowed lists so the chips only show engines the
  // picker could re-add; anything outside the plan (or a disabled shopping
  // engine) would be stripped server-side on save anyway. Topics are fetched
  // lazily — the dialog costs zero requests until it is actually opened.
  useEffect(() => {
    if (!prompt) return;
    setText(prompt.text);
    setCategory(prompt.category ?? '');
    setScrapers(prompt.platforms.filter((id) => allowedScraperIds.includes(id)));
    setModels(prompt.models.filter((id) => allowedModelIds.includes(id)));
    setIsActive(prompt.isActive);
    setError(null);
    setConfirmingDelete(false);
    let cancelled = false;
    getTopics(brandId)
      .then((t) => {
        if (!cancelled) setTopics(t);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId, brandId]);

  const busy = saving || deleting;

  const handleClose = () => {
    if (busy) return;
    onClose();
  };

  const handleSave = async () => {
    if (!prompt || !text.trim() || (scrapers.length === 0 && models.length === 0) || busy) return;
    setSaving(true);
    setError(null);
    let activeChanged = false;
    try {
      // Pausing or resuming goes first and on its own: resuming needs a free
      // slot on the plan, and a refusal has to reach the dialog as a message.
      if (isActive !== prompt.isActive) {
        const result = await setPromptActive(prompt.id, isActive);
        if ('error' in result) {
          setError(
            result.code === 'plan_limit'
              ? result.error
              : 'Failed to update prompt. Please try again.',
          );
          return;
        }
        activeChanged = true;
      }
      await updatePrompt(prompt.id, {
        text: text.trim(),
        category: category || undefined,
        platforms: scrapers,
        models,
      });
      onClose();
      toast.success('Prompt updated.');
      onChanged();
    } catch {
      setError('Failed to update prompt. Please try again.');
      // The pause or resume already went through; show it in the table.
      if (activeChanged) onChanged();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!prompt || busy) return;
    setDeleting(true);
    setError(null);
    try {
      await deletePrompt(prompt.id);
      onClose();
      toast.success('Prompt deleted.');
      onChanged();
    } catch {
      setError('Failed to delete prompt. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={prompt !== null} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" />
            Edit Prompt
          </DialogTitle>
          <DialogDescription>
            Changes apply from the next tracking run; past results stay attached to this prompt.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <PromptFormFields
            text={text}
            onTextChange={(value) => {
              setText(value);
              if (error) setError(null);
            }}
            onSubmit={handleSave}
            category={category}
            onCategoryChange={setCategory}
            topics={topics}
            scrapers={scrapers}
            models={models}
            setScrapers={setScrapers}
            setModels={setModels}
            visibleScrapers={visibleScrapers}
            visibleModels={visibleModels}
            saving={busy}
          />

          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={isActive}
              onCheckedChange={(v) => setIsActive(v === true)}
              disabled={busy}
            />
            <span>Active — included in tracking runs</span>
          </label>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          {confirmingDelete ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-red-500">Delete this prompt and its tracking history?</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                >
                  Keep it
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                className="text-red-500 hover:text-red-600 sm:mr-auto"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
              <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={busy || !text.trim() || (scrapers.length === 0 && models.length === 0)}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  'Save changes'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KpiCard({
  title,
  icon: Icon,
  value,
  sub,
  subPositive,
}: {
  title: string;
  icon: React.ElementType;
  value: React.ReactNode;
  sub: React.ReactNode;
  subPositive?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </CardTitle>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        <p
          className={cn(
            'text-xs mt-1 flex items-center gap-0.5',
            subPositive ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
          )}
        >
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * A volume run is polled, not awaited — the server keeps going regardless. At
 * the measured 6.4s per prompt a ten-second tick still shows steady movement,
 * without turning a quarter-hour run into hundreds of round-trips.
 */
const VOLUME_POLL_MS = 10_000;

/**
 * Ceiling on how long the page keeps watching. At the measured 6.4s median per
 * prompt a 1000-prompt brand runs well past this; the run itself is unaffected,
 * the page just stops narrating it and shows what has landed.
 */
const VOLUME_WATCH_MS = 30 * 60_000;

/**
 * Wording for the closed set of failure codes. Server text never reaches a
 * customer: it names batch sizes, upstream APIs and Postgres columns, none of
 * which mean anything to the person reading the toast.
 */
function volumeErrorMessage(code: VolumeErrorCode, fallback: string): string {
  switch (code) {
    case 'quota_exceeded':
      return 'Monthly volume analysis limit reached. Upgrade your plan for more.';
    case 'plan_limit':
      return 'Volume analysis is not part of your current plan.';
    default:
      return fallback;
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PromptsPage() {
  const [search, setSearch] = useState('');
  const [volumes, setVolumes] = useState<PromptVolume[]>([]);
  const [allPrompts, setAllPrompts] = useState<Prompt[]>([]);
  const [visibility, setVisibility] = useState<Record<string, PromptVisibilitySummary>>({});
  const [positions, setPositions] = useState<Record<string, PromptPositionCell>>({});
  const [loading, setLoading] = useState(true);
  // The last read failed: the table says so, rather than that there are no prompts.
  const [loadFailed, setLoadFailed] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  // Bumped whenever a run is superseded or the brand changes, so a poll that is
  // still in flight cannot write progress for a brand no longer on screen.
  const analysisGenRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [quota, setQuota] = useState<VolumeQuota | null>(null);
  const [addPromptOpen, setAddPromptOpen] = useState(false);
  // "Add a topic" was asked for on a tab: the Topics tab opens Add Topic once it shows.
  const [addTopicPending, setAddTopicPending] = useState(false);
  // Where a tab's own buttons go: beside the tabs, as the Prompts tab's do.
  const [headerActions, setHeaderActions] = useState<HTMLDivElement | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): adding, editing and the volume
  // runs open the upgrade dialog instead.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const tReadOnly = useTranslations('readOnly');
  const failureToast = useFailureToast();
  const openAddPrompt = guard(() => setAddPromptOpen(true), { action: tActions('addPrompts') });

  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  // The brand's first run while it goes on: the table's answers are still coming.
  const firstRun = useFirstRun();
  const tCommon = useTranslations('common');
  const tNav = useTranslations('nav');
  const tPrompts = useTranslations('prompts');
  const tVolumes = useTranslations('prompts.volumeInsights');
  const tChat = useTranslations('chatPanel.suggest');
  const tChatRange = useTranslations('chatPanel.range');
  // One method note per table: these tables list every analyzed prompt.
  const volumeTableNote = useMemo(() => createEstimateNoteHandle(), []);
  const opportunityTableNote = useMemo(() => createEstimateNoteHandle(), []);
  const activeBrand = useBrandStore(
    (s) => s.brands.find((brand) => brand.id === s.activeBrandId) ?? null,
  );
  // The usage cards (PROMPT-012) load on their own; `usageVersion` refetches
  // them after a change to the brand's prompts or locations. The Add Prompt
  // dialog and bulk import bound themselves by the same numbers.
  const [usageVersion, setUsageVersion] = useState(0);
  const { state: usageState, retry: retryUsage } = usePromptUsage(activeBrandId, usageVersion);
  const usage = usageState.status === 'ready' ? usageState.usage : null;
  const locationQuota = useMemo(() => (usage ? locationQuotaFromUsage(usage) : null), [usage]);
  const [statusFilter, setStatusFilter] = useState<PromptStatusFilter>('tracked');
  const searchParams = useSearchParams();
  // On /dashboard/prompts/{tracked,suggestions,topics,fan-outs,insights} the route
  // names the view (PROMPT-001); ?tab= / ?view= are the older links' shape.
  const section = sectionFromPath(usePathname());

  const initialTab: TabId = (() => {
    if (section) return section.tab;
    const raw = searchParams.get('tab');
    if ((VALID_TABS as readonly string[]).includes(raw ?? '')) return raw as TabId;
    return 'all';
  })();
  const [tab, setTab] = useState<TabId>(initialTab);
  // Opened on Topics, the page holds back what only the other tabs show (the
  // table, its locations, the volume run's status) until the topics are in or
  // another tab is opened: server actions queue one behind another, and the
  // table's read would otherwise make the topics wait. Once wanted, it stays.
  const [promptDataWanted, setPromptDataWanted] = useState(initialTab !== 'topics');

  // The Prompts tab holds two views of the same roster: what is tracked, and
  // what could be. A sub-tab rather than a fourth top-level tab, because the
  // date range, the Add prompt action and the export all belong to both.
  const initialView: PromptsView = (() => {
    if (section) return section.view;
    const raw = searchParams.get('view');
    if ((PROMPT_VIEWS as readonly string[]).includes(raw ?? '')) return raw as PromptsView;
    // Links written before the split point at the suggestions card's anchor.
    if (typeof window !== 'undefined' && window.location.hash === '#prompt-opportunities') {
      return 'suggestions';
    }
    return 'tracked';
  })();
  const [view, setView] = useState<PromptsView>(initialView);

  const initialRange: PromptRangePreset = (() => {
    const raw = searchParams.get('range');
    // Older links carry a bare day count (`range=7`); keep them working rather
    // than silently dropping them back to the default.
    if (isPromptRangePreset(raw)) return raw;
    if (raw && isPromptRangePreset(`${raw}d`)) return `${raw}d` as PromptRangePreset;
    return defaultRangeFor(initialTab);
  })();
  const [rangePreset, setRangePreset] = useState<PromptRangePreset>(initialRange);
  // Which tracked location the health columns describe. Empty = every
  // location blended, which is what the table has always shown (#691).
  // In the URL like the range, so it survives moving between the Prompts
  // routes from the sidebar (PROMPT-001).
  const [regionFilter, setRegionFilter] = useState(() => searchParams.get('region') ?? '');
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') ?? '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') ?? '');

  // A custom range only becomes a real window once a bound is entered; until
  // then the resolver's clamp would silently mean "the last 90 days", which is
  // not what an empty form is asking for.
  const range = useMemo(
    () =>
      rangePreset === 'custom' && !customFrom && !customTo
        ? null
        : resolvePromptRange(rangePreset, { from: customFrom, to: customTo }),
    [rangePreset, customFrom, customTo],
  );
  const rangeLabel = promptRangeLabel(rangePreset);
  // The Positions panel reads the window the table's columns were computed
  // over. An empty custom range loads the table's 30-day default, so the
  // panel follows it there too.
  const positionsWindow = useMemo(() => range ?? resolvePromptRange('30d'), [range]);

  // Keep the URL in sync with the active tab so deep links / refreshes land
  // back on the same view. Shallow history update on purpose: the tab is pure
  // client state, and `router.replace` here fired an RSC round-trip whose
  // prefetch render 500s server-side — the never-completing navigation then
  // blocked Next's server-action queue, so the page's data fetch never even
  // dispatched (the "prompts table spins forever" bug). replaceState updates
  // the URL with no server request; Next's router syncs with the History API.
  //
  // The tab and view live in the path (PROMPT-001): /dashboard/prompts/tracked,
  // /suggestions, /topics, /fan-outs, /insights — the routes the sidebar's
  // Prompts submenu links to, so the sidebar and these tabs always agree. The
  // path is rewritten in place under any locale prefix.
  const writeUrl = useCallback(
    (next: {
      tab: TabId;
      view: PromptsView;
      rangePreset: PromptRangePreset;
      customFrom: string;
      customTo: string;
      regionFilter: string;
    }) => {
      // The default range stays out of the URL so shared links keep their
      // existing shape unless the user actually picked a different window.
      const want: Record<string, string | null> = {
        range: next.rangePreset === defaultRangeFor(next.tab) ? null : next.rangePreset,
        from: next.rangePreset === 'custom' && next.customFrom ? next.customFrom : null,
        to: next.rangePreset === 'custom' && next.customTo ? next.customTo : null,
        region: next.regionFilter || null,
        tab: null,
        view: null,
      };
      const { pathname, search, hash } = window.location;
      const at = pathname.indexOf(PROMPTS_BASE);
      const wantPath = `${at > 0 ? pathname.slice(0, at) : ''}${sectionFor(next.tab, next.view).href}`;
      const params = new URLSearchParams(search);
      if (pathname === wantPath && Object.entries(want).every(([k, v]) => params.get(k) === v)) {
        return;
      }
      for (const [k, v] of Object.entries(want)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      const query = params.toString();
      // Keep the hash: deep links like #prompt-opportunities must keep their anchor.
      window.history.replaceState(null, '', `${wantPath}${query ? `?${query}` : ''}${hash}`);
    },
    [],
  );
  useEffect(() => {
    writeUrl({ tab, view, rangePreset, customFrom, customTo, regionFilter });
  }, [tab, view, rangePreset, customFrom, customTo, regionFilter, searchParams, writeUrl]);

  /**
   * Move to another tab or list view, writing its route first.
   *
   * Next routes a replaceState through its action queue (a "restore"), and in
   * Next 16 a restore that lands while a server action is in flight leaves
   * the queue pointing at the discarded action: actions queued after it never
   * run, and the table spins forever. The tab about to show fires its own
   * server actions as it mounts, before the effect above would rewrite the
   * route, so the route is written here, on an idle queue, ahead of them.
   */
  const showSection = useCallback(
    (nextTab: TabId, nextView: PromptsView) => {
      // A window still on this tab's default wasn't picked by the user, so it
      // follows the next tab's own (Query Fan-out opens on 7 days).
      const nextRange =
        rangePreset === defaultRangeFor(tab) ? defaultRangeFor(nextTab) : rangePreset;
      writeUrl({
        tab: nextTab,
        view: nextView,
        rangePreset: nextRange,
        customFrom,
        customTo,
        regionFilter,
      });
      setRangePreset(nextRange);
      setView(nextView);
      setTab(nextTab);
      if (nextTab !== 'topics') setPromptDataWanted(true);
    },
    [tab, rangePreset, customFrom, customTo, regionFilter, writeUrl],
  );

  /**
   * "Add a topic" from Add prompt, Suggestions or Query Fan-out on a brand
   * without topics: the Topics tab, with Add Topic open, in place. A link to
   * /dashboard/prompts/topics?new=1 would change the address alone: the page
   * reads its tab from the route only when it opens. Back on the tab, the
   * flow reads the topics again.
   */
  const addTopicInPlace = useCallback(() => {
    setAddPromptOpen(false);
    setAddTopicPending(true);
    showSection('topics', view);
  }, [showSection, view]);

  // Deep link from the Insights Recommendations row (#459): the target card
  // only exists once the Insights tab's volume data has rendered, so a bare
  // anchor never scrolls on its own — re-apply the hash after loading ends.
  useEffect(() => {
    if (tab !== 'insights' || loading) return;
    if (window.location.hash === '#topic-opportunities') {
      document.getElementById('topic-opportunities')?.scrollIntoView();
    }
  }, [tab, loading]);

  const loadData = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!activeBrandId) {
        if (isCancelled?.()) return;
        setVolumes([]);
        setAllPrompts([]);
        setVisibility({});
        setPositions({});
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadFailed(false);
      try {
        // One consolidated server action: Next.js queues client-fired server
        // actions sequentially, so the old three separate calls cost their
        // SUM on a cold load — the main culprit behind the slow first paint.
        const page = await getPromptsPageData(activeBrandId, {
          days: range?.days,
          from: range?.from,
          to: range?.to,
          region: regionFilter || undefined,
        });
        if (isCancelled?.()) return;
        setVolumes(page.volumes);
        if (page.quota) setQuota(page.quota);
        const prompts = page.promptSets.flatMap((ps) => ps.prompts);
        setAllPrompts(prompts);
        setVisibility(page.visibility);
        setPositions(page.positions);
        // A read-only workspace's volumes are refused (402): their columns
        // stay empty, without a warning that something broke.
        if (page.volumesDegraded && !isLocked) {
          toast.warning('Volume data is temporarily unavailable — showing prompts without it.');
        }
        if (page.visibilityDegraded) toast.warning(tPrompts('visibilityDegraded'));
      } catch (err) {
        if (isCancelled?.()) return;
        console.error('Failed to load prompt data:', err);
        setLoadFailed(true);
        toast.error('Failed to load prompt data');
      } finally {
        if (!isCancelled?.()) setLoading(false);
      }
    },
    [activeBrandId, range, regionFilter, tPrompts, isLocked],
  );

  useEffect(() => {
    if (!promptDataWanted) return undefined;
    let cancelled = false;
    loadData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadData, promptDataWanted]);

  // After prompts are added, paused, resumed, deleted or retargeted: reload
  // the table and the usage cards together, and read the locations' figures
  // (PROMPT-015b) anew.
  const reloadAfterChange = useCallback(() => {
    clearLocationMatrixCache();
    setUsageVersion((v) => v + 1);
    return loadData();
  }, [loadData]);

  // Locations the brand has actually produced results in — the same
  // whole-brand list the Visibility page offers, so the two pages never
  // disagree about where this brand is tracked. A brand tracked in one place
  // gets no control at all: a filter with a single option is noise.
  useEffect(() => {
    if (!activeBrandId) {
      setAvailableRegions([]);
      return;
    }
    if (!promptDataWanted) return;
    let cancelled = false;
    getBrandFilterOptions(activeBrandId)
      .then((options) => {
        if (cancelled) return;
        setAvailableRegions([...options.regions].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, promptDataWanted]);

  // A location that stops producing results must not keep filtering the
  // table to nothing — fall back to the blended view.
  useEffect(() => {
    if (regionFilter && availableRegions.length > 0 && !availableRegions.includes(regionFilter)) {
      setRegionFilter('');
    }
  }, [availableRegions, regionFilter]);

  // loadData changes identity whenever the date range does. The watch below
  // must not restart for that, so it reaches the current one through a ref.
  const loadDataRef = useRef(loadData);
  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  /**
   * Follow a run that is already going.
   *
   * Progress is the server's own count of prompts it has finished with, not
   * rows on disk: batching writes every row in one go at the end, so a row
   * count reads 0 for the whole wait and then jumps straight to the total.
   *
   * Only a status that says the run has stopped counts as finished. Giving up
   * on the watch — deadline reached, status unreadable — says nothing about the
   * run, and claiming otherwise would send someone off with a half-filled table
   * believing it was complete.
   */
  const watchVolumeAnalysis = useCallback(async (brandId: string, gen: number) => {
    let finished = false;
    const deadline = Date.now() + VOLUME_WATCH_MS;

    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, VOLUME_POLL_MS));
      if (analysisGenRef.current !== gen) return { finished: false, superseded: true };

      const status = await getVolumeAnalysisStatus(brandId);
      if (analysisGenRef.current !== gen) return { finished: false, superseded: true };

      if (!status) break;
      setAnalysisProgress(status.done === null ? null : { done: status.done, total: status.total });
      if (!status.running) {
        finished = true;
        break;
      }
      if (Date.now() > deadline) break;
    }

    return { finished, superseded: false };
  }, []);

  /**
   * A run outlives the page that started it, so on arrival — a reload, a tab
   * reopened, a return to this brand — the page has to ask whether one is
   * already going. Without this it offers the Analyze button again while the
   * work is still in flight, which reads as though nothing were happening.
   *
   * Leaving the brand ends the watch. The run itself carries on; only this
   * page's narration of it stops.
   */
  useEffect(() => {
    if (!activeBrandId || !promptDataWanted) return undefined;

    const brandId = activeBrandId;
    const gen = ++analysisGenRef.current;

    (async () => {
      const status = await getVolumeAnalysisStatus(brandId);
      if (analysisGenRef.current !== gen || !status?.running) return;

      setAnalyzing(true);
      setAnalysisProgress(status.done === null ? null : { done: status.done, total: status.total });

      const { finished, superseded } = await watchVolumeAnalysis(brandId, gen);
      if (superseded || analysisGenRef.current !== gen) return;

      setAnalyzing(false);
      setAnalysisProgress(null);
      if (finished) {
        await loadDataRef.current();
        toast.success('Volume analysis finished.');
      }
    })();

    return () => {
      analysisGenRef.current += 1;
      setAnalyzing(false);
      setAnalysisProgress(null);
    };
  }, [activeBrandId, promptDataWanted, watchVolumeAnalysis]);

  /**
   * Start a run, then follow it to the end.
   *
   * The work outlives the request that starts it: every prompt costs an LLM
   * call plus a DataForSEO call and they run in order, which measures at a 6.4s
   * median — about eleven minutes for a 100-prompt brand. Holding the request
   * open for that would be cut by the platform long before the run finished,
   * and the old shape sent the prompts inline and was refused outright past 50
   * of them. So the server answers as soon as the work is queued and
   * this polls its count; each prompt is saved on its own row as it lands, so
   * whatever finished is kept even if this page goes away.
   */
  const runVolumeAnalysis = async (force: boolean) => {
    if (!activeBrandId) return;

    if (!allPrompts.some((p) => p.isActive)) {
      toast.error('No active prompts to analyze. Add prompts to a brand first.');
      return;
    }

    const gen = ++analysisGenRef.current;
    setAnalyzing(true);
    setAnalysisProgress(null);

    try {
      const started = await startPromptVolumeAnalysis(activeBrandId, force);

      if (!started.ok) {
        // The plan ended meanwhile: the upgrade dialog, not "not in your plan".
        if (started.code === 'subscription_inactive') {
          failureToast('subscription');
        } else {
          toast.error(
            volumeErrorMessage(
              started.code,
              'Volume analysis could not be started. Please try again.',
            ),
          );
        }
        return;
      }

      if (!started.running && started.started === 0) {
        toast.success('Every active prompt already has volume data.');
        return;
      }

      if (started.remaining !== undefined && quota) {
        setQuota({
          ...quota,
          remaining: started.remaining,
          used: quota.limit === -1 ? 0 : quota.limit - started.remaining,
        });
      }

      toast.success(
        started.started > 0
          ? `Analyzing ${started.started} prompt${started.started === 1 ? '' : 's'} — this keeps running in the background.`
          : 'Volume analysis is already running for this brand.',
      );

      const { finished, superseded } = await watchVolumeAnalysis(activeBrandId, gen);
      if (superseded) return;

      await loadData();
      if (analysisGenRef.current === gen) {
        toast.success(
          finished
            ? 'Volume analysis finished.'
            : 'Still analyzing in the background — reopen this page later for the rest.',
        );
      }
    } catch (err) {
      console.error('Volume analysis failed:', err);
      toast.error('Volume analysis could not be started. Please try again.');
    } finally {
      if (analysisGenRef.current === gen) {
        setAnalyzing(false);
        setAnalysisProgress(null);
      }
    }
  };

  const handleAnalyzeNew = guard(() => runVolumeAnalysis(false), {
    action: tActions('analyzePrompts'),
  });

  const handleRefreshVolumes = async () => {
    if (!activeBrandId || volumes.length === 0) return;

    setRefreshing(true);
    try {
      const result = await refreshVolumes(activeBrandId);
      if (!result.ok) {
        if (result.code === 'subscription_inactive') {
          failureToast('subscription');
        } else {
          toast.error(
            volumeErrorMessage(result.code, 'Volumes could not be refreshed. Please try again.'),
          );
        }
        return;
      }
      if (result.remaining !== undefined && quota) {
        setQuota({
          ...quota,
          remaining: result.remaining,
          used: quota.limit === -1 ? 0 : quota.limit - result.remaining,
        });
      }
      toast.success(`Refreshed volumes for ${result.refreshed} prompts`);
      await loadData();
    } catch (err: unknown) {
      console.error('Volume refresh failed:', err);
      toast.error('Volumes could not be refreshed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleReanalyzeAll = guard(() => runVolumeAnalysis(true), {
    action: tActions('analyzePrompts'),
  });

  // Each volume as an estimate: a range and how sure it is (PROMPT-013).
  const estimateByPromptId = useMemo(() => {
    const m = new Map<string, VolumeEstimate>();
    for (const v of volumes) m.set(v.promptId, promptVolumeEstimate(v));
    return m;
  }, [volumes]);
  const totalGoogleVol = volumes.reduce((s, v) => s + v.totalGoogleVolume, 0);
  const totalAiVol = volumes.reduce((s, v) => s + v.estAiVolume, 0);
  const totalEstimate = sumEstimates(volumes.map((v) => estimateByPromptId.get(v.promptId)!));
  const averagePerPrompt = averageEstimate(totalEstimate);
  // The rate the volumes were estimated with, as the AI Adoption Rate card
  // and the Prompt Volumes caption both say it.
  const adoptionRate = `${((volumes[0]?.aiVolumeMultiplier ?? AI_ADOPTION_RATE) * 100).toFixed(0)}%`;
  const estimateOf = (v: PromptVolume) => estimateByPromptId.get(v.promptId)!;
  // High Opportunity Prompts: a low-confidence estimate isn't listed on its own.
  const opportunityRows = volumes
    .filter((v) => opportunityLevel(v.estAiVolume, estimateOf(v).confidence))
    .sort((a, b) => b.estAiVolume - a.estAiVolume);
  // Distinct keywords: prompts share many, as Similar Topics counts them.
  const totalKeywords = new Set(
    volumes.flatMap((v) => v.keywords.map((k) => k.trim().toLowerCase())),
  ).size;

  const filtered = volumes.filter(
    (v) =>
      v.promptText.toLowerCase().includes(search.toLowerCase()) ||
      v.intent.toLowerCase().includes(search.toLowerCase()),
  );

  // Without an active plan the quota reads 0 of 0: not used up. The analyses
  // stay clickable, and open the plan dialog.
  const noPlan = isNoPlan(quota, isLocked);
  const quotaExhausted = !noPlan && quota !== null && quota.limit !== -1 && quota.remaining <= 0;

  // Reads "Analyzing 32/100..." once the first poll lands, so a run measured in
  // minutes shows movement instead of an indefinite spinner. A count is only
  // shown while it is one: a server that does not report live progress leaves
  // it out rather than parking on 0/100, which says less than no number at all.
  const analyzingLabel = analysisProgress
    ? `Analyzing ${analysisProgress.done}/${analysisProgress.total}...`
    : 'Analyzing...';

  // Join prompts with their volume + visibility summaries once, reused by the
  // All Prompts table.
  const volumeByPromptId = useMemo(() => {
    const m = new Map<string, PromptVolume>();
    for (const v of volumes) m.set(v.promptId, v);
    return m;
  }, [volumes]);

  // Active prompts that have no volume row yet — their Volume/Competition cells
  // render blank. Drives the "unanalyzed keywords" banner + one-click Analyze.
  const unanalyzedCount = useMemo(
    () => allPrompts.filter((p) => p.isActive && !volumeByPromptId.has(p.id)).length,
    [allPrompts, volumeByPromptId],
  );

  const canExport = !loading && allPrompts.length > 0;

  const handleExportCsv = useCallback(async () => {
    if (!canExport) return;

    const rangeSuffix = rangePreset;
    const rows = allPrompts.map((p) => ({
      text: p.text,
      topic_id: p.topicId ?? '',
      category: p.category ?? '',
      platforms: p.platforms.join(', '),
      models: p.models.join(', '),
      regions: p.regions.join(', '),
      is_active: p.isActive,
      created_at: p.createdAt,
      est_ai_volume: volumeByPromptId.get(p.id)?.estAiVolume ?? '',
      volume_type: estimateByPromptId.has(p.id) ? 'estimate' : '',
      volume_confidence: estimateByPromptId.get(p.id)?.confidence ?? '',
      est_ai_volume_low: estimateByPromptId.get(p.id)?.low ?? '',
      est_ai_volume_high: estimateByPromptId.get(p.id)?.high ?? '',
      volume_date: volumeByPromptId.get(p.id)?.fetchedAt ?? '',
      total_google_volume: volumeByPromptId.get(p.id)?.totalGoogleVolume ?? '',
      intent: volumeByPromptId.get(p.id)?.intent ?? '',
      [`ai_visibility_score_${rangeSuffix}`]: visibility[p.id]?.score ?? '',
      [`visibility_rate_${rangeSuffix}`]: visibility[p.id]?.visibilityRate ?? '',
      [`visible_runs_${rangeSuffix}`]: visibility[p.id]?.visibleRuns ?? '',
      [`avg_visibility_${rangeSuffix}`]: visibility[p.id]?.avgVisibility ?? '',
      [`total_mentions_${rangeSuffix}`]: visibility[p.id]?.totalMentions ?? '',
      [`total_citations_${rangeSuffix}`]: visibility[p.id]?.totalCitations ?? '',
      [`runs_${rangeSuffix}`]: visibility[p.id]?.runs ?? '',
      last_run_at: visibility[p.id]?.lastRunAt ?? '',
    }));

    const csv = toCsv(rows, promptExportHeaders(rangeSuffix));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    const slug = activeBrand?.slug ?? 'brand';

    link.href = url;
    link.download = await exportFileName(`${slug}_prompts_${date}.csv`);
    link.click();

    URL.revokeObjectURL(url);
  }, [
    activeBrand?.slug,
    canExport,
    allPrompts,
    visibility,
    volumeByPromptId,
    estimateByPromptId,
    rangePreset,
  ]);

  // Chat's side panel sees the page (W1-08): its range, its location where
  // the tab reads one, and a tracked prompt the brand doesn't show up for
  // (the one asked most).
  const unseen = allPrompts
    .filter((prompt) => (visibility[prompt.id]?.runs ?? 0) > 0)
    .filter((prompt) => visibility[prompt.id].visibleRuns === 0)
    .sort((a, b) => visibility[b.id].runs - visibility[a.id].runs)[0];
  useChatPageContext(
    activeBrandId
      ? {
          dateRange: {
            from: rangePreset === 'custom' ? customFrom : rangePreset,
            to: rangePreset === 'custom' ? customTo : null,
            label: rangeChipLabel(rangePreset, { from: customFrom, to: customTo }, (key, values) =>
              tChatRange(key, values),
            ),
          },
          filters:
            regionFilter && tabUsesLocation(tab)
              ? [{ key: 'region', label: formatRegionDisplay(regionFilter), value: regionFilter }]
              : [],
          suggestions: [
            ...(unseen ? [tChat('promptUnseen', { prompt: unseen.text })] : []),
            tChat('promptsNext'),
            tChat('actions'),
          ],
        }
      : null,
  );

  if (!activeBrandId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Select a brand to view prompts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <HeaderWithAiUsage>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Prompts</h1>
            <p className="text-muted-foreground text-sm">
              Manage every tracked prompt and review estimated AI demand
            </p>
          </div>
        </div>
      </HeaderWithAiUsage>

      <Tabs value={tab} onValueChange={(v) => showSection(v as TabId, view)}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <TabsList>
            <TabsTrigger value="all">Prompts</TabsTrigger>
            <TabsTrigger value="topics">{tNav('topics')}</TabsTrigger>
            <TabsTrigger value="fanout">Query Fan-out</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            {/* A tab's own buttons, portalled in (Topics). `contents` keeps
                them in this row's flex and gap. */}
            <div ref={setHeaderActions} className="contents" />
            {tab === 'all' && canManage && (
              <Button type="button" size="sm" className="gap-2" onClick={openAddPrompt}>
                <Plus className="h-4 w-4" />
                Add prompt
              </Button>
            )}
            {tab === 'all' && (
              <span title={!canExport ? PROMPT_EXPORT_HINT : undefined}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={handleExportCsv}
                  disabled={!canExport}
                >
                  <Download className="h-4 w-4" />
                  {tCommon('exportCsv')}
                </Button>
              </span>
            )}

            {/* Topics has Manage topics in its place. */}
            {tab !== 'topics' && (
              <Link
                href={`/dashboard/brands/${activeBrandId}/prompts`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <Settings2 className="h-4 w-4" />
                Manage prompts
              </Link>
            )}
          </div>
        </div>

        {/* Tracked vs suggested: two views of the same roster. A segmented
            control rather than a second Tabs, so it reads as a filter on
            this panel and not as another level of page navigation. It sits
            above the filter bar so the controls go from general to specific:
            which area, which list, then which period. It looks like the tabs
            above it (the muted track, the selected item a card), so the
            selected item reads the same in both. */}
        {tab === 'all' && (
          <div
            className={cn(tabsListVariants(), 'mt-4 h-8')}
            role="tablist"
            aria-label="Prompt view"
          >
            {(
              [
                { id: 'tracked' as const, label: 'Tracked Prompts', Icon: ListChecks },
                { id: 'suggestions' as const, label: 'Prompt Suggestions', Icon: Sparkles },
              ] satisfies { id: PromptsView; label: string; Icon: typeof ListChecks }[]
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => showSection(tab, id)}
                className={cn(
                  'flex h-[calc(100%-1px)] items-center gap-2 rounded-md border border-transparent px-2.5 text-sm font-medium transition-all',
                  view === id
                    ? 'bg-card text-foreground shadow-sm dark:border-input dark:bg-input/30'
                    : 'text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Filter bar — same shape and position as Visibility and Citations
            (#713). It sits outside the tab panels because the range governs
            All Prompts, Topics and Query Fan-out. Location doesn't apply to
            Topics or Query Fan-out (it reads every location), so it is left
            off there.
            Hidden on Insights: that tab shows keyword volume estimates, which
            carry no date dimension, so a range there would be a control that
            changes nothing. */}
        {tab !== 'insights' && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <DateRangeFilter
              value={rangePreset}
              presets={PROMPT_RANGE_PRESETS}
              onChange={setRangePreset}
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />

            {availableRegions.length > 1 && tabUsesLocation(tab) && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Location
                </label>
                <Select
                  value={regionFilter || null}
                  onValueChange={(v) => setRegionFilter(!v || v === '__all__' ? '' : String(v))}
                >
                  <SelectTrigger className="h-8 w-48 text-xs">
                    <SelectValue placeholder="All Locations">
                      {(value) =>
                        value && value !== '__all__'
                          ? formatRegionDisplay(String(value))
                          : 'All Locations'
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All Locations</SelectItem>
                    {availableRegions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {formatRegionDisplay(r)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* ─── All Prompts tab ─────────────────────────────────────────── */}
        <TabsContent value="all" className="mt-4 space-y-4">
          {view === 'suggestions' ? (
            activeBrandId && (
              <>
                <SuggestionsTab
                  brandId={activeBrandId}
                  onAccepted={reloadAfterChange}
                  onAddTopic={addTopicInPlace}
                  planId={locationQuota?.planId}
                  limitActions={
                    locationQuota ? <PromptLimitActions planId={locationQuota.planId} /> : null
                  }
                />
              </>
            )
          ) : (
            <>
              {activeBrandId && (
                <PromptUsageCards
                  state={usageState}
                  brandName={activeBrand?.name}
                  readOnly={!canManage}
                  prompts={allPrompts}
                  filter={statusFilter}
                  onFilter={setStatusFilter}
                  onRetry={retryUsage}
                />
              )}
              {!loading && unanalyzedCount > 0 && (
                <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/30">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                    <div className="text-sm">
                      <p className="font-medium text-amber-900 dark:text-amber-200">
                        {unanalyzedCount} prompt{unanalyzedCount === 1 ? '' : 's'} haven&apos;t been
                        analyzed yet
                      </p>
                      <p className="text-amber-800/80 dark:text-amber-300/80">
                        {quotaExhausted
                          ? 'Their Volume & Competition stay empty until analyzed — but your monthly volume analysis limit is reached. Upgrade your plan to analyze more.'
                          : 'Run volume analysis to fill in their Volume & Competition.'}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={handleAnalyzeNew}
                    disabled={analyzing || quotaExhausted}
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {analyzingLabel}
                      </>
                    ) : (
                      <>
                        <BarChart3 className="mr-2 h-4 w-4" />
                        Analyze {unanalyzedCount} prompt{unanalyzedCount === 1 ? '' : 's'}
                      </>
                    )}
                  </Button>
                </div>
              )}
              {firstRun && allPrompts.length > 0 && <FirstRunEmptyState run={firstRun} />}
              <AllPromptsTab
                loading={loading}
                failed={loadFailed}
                onRetry={() => void loadData()}
                prompts={allPrompts}
                activeBrandId={activeBrandId}
                volumeByPromptId={volumeByPromptId}
                estimateByPromptId={estimateByPromptId}
                visibility={visibility}
                positions={positions}
                rangeLabel={rangeLabel}
                positionsWindow={positionsWindow}
                positionsPreset={range ? rangePreset : '30d'}
                regionFilter={regionFilter}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                onAddPrompt={canManage ? openAddPrompt : undefined}
                onEditPrompt={
                  canManage
                    ? guard((prompt: Prompt) => setEditingPrompt(prompt), {
                        action: tActions('editPrompts'),
                      })
                    : undefined
                }
                onChanged={reloadAfterChange}
              />
            </>
          )}
        </TabsContent>

        {/* ─── Topics tab ───────────────────────────────────────────────── */}
        <TabsContent value="topics" className="mt-4">
          {tab === 'topics' && (
            <TopicsTab
              actionsSlot={headerActions}
              range={range}
              rangePreset={rangePreset}
              customFrom={customFrom}
              customTo={customTo}
              onLoaded={() => setPromptDataWanted(true)}
              openAddTopic={addTopicPending}
              onAddTopicOpened={() => setAddTopicPending(false)}
            />
          )}
        </TabsContent>

        {/* ─── Query Fan-out tab ───────────────────────────────────────── */}
        <TabsContent value="fanout" className="mt-4">
          {activeBrandId && (
            <QueryFanoutTab
              brandId={activeBrandId}
              range={range}
              rangeLabel={rangeLabel}
              onTracked={reloadAfterChange}
              onAddTopic={addTopicInPlace}
            />
          )}
        </TabsContent>

        {/* ─── Insights tab ────────────────────────────────────────────── */}
        <TabsContent value="insights" className="mt-4">
          {/* Action toolbar */}
          <div className="flex items-center justify-end gap-2 flex-wrap mb-4">
            {quota && quota.limit !== -1 && (
              <span
                className={cn(
                  'text-xs tabular-nums',
                  quotaExhausted ? 'text-red-500' : 'text-muted-foreground',
                )}
              >
                {noPlan ? tReadOnly('noPlan') : `${quota.remaining}/${quota.limit} analyses left`}
              </span>
            )}
            {volumes.length > 0 && (
              <>
                <Button
                  onClick={guard(handleRefreshVolumes, { action: tActions('refreshVolumes') })}
                  disabled={refreshing || analyzing || loading || quotaExhausted}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {refreshing ? 'Refreshing...' : 'Refresh Volumes'}
                </Button>
                <Button
                  onClick={handleReanalyzeAll}
                  disabled={analyzing || refreshing || loading || quotaExhausted}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  {analyzing ? analyzingLabel : 'Re-analyze Keywords'}
                </Button>
              </>
            )}
            {volumes.length > 0 &&
              allPrompts.filter((p) => p.isActive && !volumes.find((v) => v.promptId === p.id))
                .length > 0 && (
                <Button
                  onClick={handleAnalyzeNew}
                  disabled={analyzing || refreshing || loading || quotaExhausted}
                  size="sm"
                  className="gap-2"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BarChart3 className="h-4 w-4" />
                  )}
                  {analyzing ? analyzingLabel : 'Analyze New Prompts'}
                </Button>
              )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : volumes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
                <BarChart3 className="h-12 w-12 text-muted-foreground/40" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">No volume data yet</p>
                  <p className="text-xs text-muted-foreground">
                    {allPrompts.length > 0
                      ? 'Click "Analyze Volumes" to fetch search volume data for your prompts.'
                      : 'Add prompts to your brand first, then analyze their volumes.'}
                  </p>
                </div>
                {allPrompts.length > 0 && (
                  <>
                    <Button
                      onClick={handleAnalyzeNew}
                      disabled={analyzing || quotaExhausted}
                      size="sm"
                      className="gap-2"
                    >
                      {analyzing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <BarChart3 className="h-4 w-4" />
                      )}
                      {analyzing ? analyzingLabel : 'Analyze Volumes'}
                    </Button>
                    {quotaExhausted && (
                      <p className="text-xs text-red-500">
                        Monthly analysis limit reached. Resets when your subscription renews.
                      </p>
                    )}
                    {quota && quota.limit !== -1 && !quotaExhausted && (
                      <p className="text-xs text-muted-foreground">
                        {noPlan
                          ? tReadOnly('noPlan')
                          : `${quota.remaining}/${quota.limit} analyses remaining this month`}
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {/* KPI Cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KpiCard
                  title="Prompts Analyzed"
                  icon={Layers}
                  value={volumes.length}
                  sub={`across ${totalKeywords} keywords`}
                />
                <KpiCard
                  title={tVolumes('totalTitle')}
                  icon={BarChart3}
                  value={
                    // The range, then its Estimate badge beneath (PROMPT-013 mockup).
                    <span className="flex flex-col items-start gap-1">
                      <EstimateRange estimate={totalEstimate} kind="total" className="text-2xl" />
                      <EstimateBadge estimate={totalEstimate} kind="total" />
                    </span>
                  }
                  sub={tVolumes('totalSub', { google: formatCompactNumber(totalGoogleVol) })}
                />
                <KpiCard
                  title="AI Adoption Rate"
                  icon={TrendingUp}
                  value={adoptionRate}
                  sub="of Google search volume"
                />
                <KpiCard
                  title={tVolumes('averageTitle')}
                  icon={BarChart3}
                  value={
                    <span className="flex flex-col items-start gap-1">
                      <EstimateRange
                        estimate={averagePerPrompt}
                        kind="average"
                        className="text-2xl"
                      />
                      <EstimateBadge estimate={averagePerPrompt} kind="average" />
                    </span>
                  }
                  sub={tVolumes('averageSub')}
                />
              </div>

              {/* Charts row */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    {/* The chart splits the total estimate: the same badge and note as its card. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-sm font-medium">Prompt Volumes</CardTitle>
                      {totalAiVol > 0 && <EstimateBadge estimate={totalEstimate} kind="total" />}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {tVolumes('chartCaption', { rate: adoptionRate })}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <PlatformVolumeChart totalVolume={totalAiVol} totalRange={totalEstimate} />
                  </CardContent>
                </Card>

                <Card id="topic-opportunities">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-sm font-medium">Similar Topics</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          Most-searched keyword clusters across all prompts
                        </p>
                      </div>
                      <Link
                        href="/dashboard/prompts/similar-topics"
                        className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline"
                      >
                        See all
                      </Link>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <SimilarTopicsList volumes={volumes} />
                  </CardContent>
                </Card>
              </div>

              {/* Prompt Volume Table */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <CardTitle className="text-sm font-medium">Prompt Volumes</CardTitle>
                    <div className="relative w-60">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search prompts…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Prompt</TableHead>

                        <ColHead className="text-right" tooltip={tVolumes('googleTip')}>
                          {tVolumes('googleColumn')}
                        </ColHead>
                        <ColHead className="text-right" tooltip={tVolumes('aiTip')}>
                          {tVolumes('aiColumn')}
                        </ColHead>
                        <ColHead
                          className="text-center"
                          tooltip="The search intent detected by AI analysis. Different intents indicate how users frame their queries."
                        >
                          Intent
                        </ColHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((row) => (
                        <TableRow key={row.id} className="hover:bg-muted/50">
                          <TableCell className="pl-6 font-medium text-sm max-w-[280px]">
                            <span className="line-clamp-1">{row.promptText}</span>
                          </TableCell>

                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {formatNumber(row.totalGoogleVolume)}
                          </TableCell>
                          <TableCell className="text-right">
                            <EstimateRange
                              estimate={estimateOf(row)}
                              handle={volumeTableNote}
                              className="text-sm font-semibold"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-xs whitespace-nowrap',
                                INTENT_COLORS[row.intent] || '',
                              )}
                            >
                              {INTENT_LABELS[row.intent] || row.intent}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <EstimateNoteTooltip handle={volumeTableNote} />
                  {filtered.length === 0 && (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No prompts match your search.
                    </div>
                  )}
                  <div className="px-6 py-2 border-t">
                    <p className="text-xs text-muted-foreground">{tVolumes('footnote')}</p>
                  </div>
                </CardContent>
              </Card>

              {/* High Opportunity Prompts */}
              {opportunityRows.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-emerald-500" />
                      <CardTitle className="text-sm font-medium">
                        High Opportunity Prompts
                      </CardTitle>
                      <span className="text-xs text-muted-foreground ml-1">
                        Prompts with highest estimated AI search demand
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Prompt</TableHead>
                          <ColHead
                            className="text-right"
                            tooltip={tVolumes('opportunityVolumeTip')}
                          >
                            Est. AI Volume
                          </ColHead>
                          <ColHead className="text-center" tooltip="The detected search intent.">
                            Intent
                          </ColHead>
                          <ColHead
                            className="text-right pr-6"
                            tooltip={tVolumes('opportunityLevelTip', {
                              high: formatCompactNumber(OPPORTUNITY_HIGH_VOLUME),
                              min: formatCompactNumber(OPPORTUNITY_MIN_VOLUME),
                            })}
                          >
                            Opportunity
                          </ColHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {opportunityRows.map((row) => (
                          <TableRow key={row.id} className="hover:bg-muted/50">
                            <TableCell className="pl-6 font-medium text-sm">
                              {row.promptText}
                            </TableCell>
                            <TableCell className="text-right">
                              <EstimateRange
                                estimate={estimateOf(row)}
                                handle={opportunityTableNote}
                                className="text-sm font-semibold"
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge
                                variant="outline"
                                className={cn('text-xs', INTENT_COLORS[row.intent] || '')}
                              >
                                {INTENT_LABELS[row.intent] || row.intent}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  opportunityLevel(row.estAiVolume, estimateOf(row).confidence) ===
                                    'high'
                                    ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                                    : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                                )}
                              >
                                {opportunityLevel(row.estAiVolume, estimateOf(row).confidence) ===
                                'high'
                                  ? 'High'
                                  : 'Medium'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <EstimateNoteTooltip handle={opportunityTableNote} />
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {activeBrandId && (
        <AddPromptDialog
          brandId={activeBrandId}
          shoppingEnabled={!!activeBrand?.shoppingModeEnabled}
          locationQuota={locationQuota}
          existingTexts={allPrompts.map((p) => p.text)}
          defaultRegion={brandLocation(activeBrand?.region, activeBrand?.state)}
          open={addPromptOpen}
          onClose={() => setAddPromptOpen(false)}
          onAdded={reloadAfterChange}
          onAddTopic={addTopicInPlace}
        />
      )}

      {activeBrandId && (
        <EditPromptDialog
          prompt={editingPrompt}
          brandId={activeBrandId}
          shoppingEnabled={!!activeBrand?.shoppingModeEnabled}
          onClose={() => setEditingPrompt(null)}
          onChanged={reloadAfterChange}
        />
      )}
    </div>
  );
}

// ─── Positions cell (All Prompts) ─────────────────────────────────────────────

/**
 * Average position with its trend against the previous period; hovering it
 * lists each platform, the detail behind the Performance filter. A
 * prompt that was tracked but never named reads "Not mentioned", not the "—"
 * of a prompt with no answers.
 */
function PositionValue({
  cell,
  vis,
}: {
  cell: PromptPositionCell | undefined;
  vis: PromptVisibilitySummary | undefined;
}) {
  const t = useTranslations('prompts.positions');
  const kind = positionCellKind(cell, vis);
  if (kind === 'notMentioned' || kind === 'citedOnly') {
    return (
      <span
        className="text-xs text-muted-foreground"
        title={
          kind === 'citedOnly'
            ? t('citedOnlyTitle', { cited: vis?.citationAnswers ?? 0, count: vis?.runs ?? 0 })
            : t('notMentionedTitle', { count: vis?.runs ?? 0 })
        }
      >
        {t(kind)}
      </span>
    );
  }
  if (!cell || cell.avg === null) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const delta = cell.delta;
  const breakdown = cell.dots.map((d) => `${d.label}: ${dotDetail(d)}`).join('\n');
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" title={breakdown}>
      <span className="text-sm font-semibold">#{cell.avg.toFixed(1)}</span>
      {delta !== null && delta !== 0 && (
        <span
          className={cn(
            'inline-flex items-center text-[10px] font-medium',
            delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
          )}
        >
          {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(delta).toFixed(1)}
        </span>
      )}
    </span>
  );
}

const DOT_LABEL: Record<PlatformDotState, string> = {
  early: 'named early',
  late: 'named further down',
  mentioned: 'mentioned, position unknown',
  missing: 'not mentioned',
  no_runs: 'no runs',
};

/** Like the Improve tab, "not mentioned" says how often it was. */
function dotDetail(d: PlatformDot): string {
  if (d.state === 'missing') return `${DOT_LABEL.missing} · ${mentionRateLabel(d)}`;
  return `${DOT_LABEL[d.state]}${d.avg !== null ? ` (#${d.avg.toFixed(1)})` : ''}`;
}

/** How long a row deleted from its menu can be restored (PROMPT-006). */
const DELETE_UNDO_MS = 10_000;

/** The server calls behind "Suggest content" (PROMPT-006). */
const SUGGEST_CALLS = { start: suggestContentForPrompt, getStatus: getGenerationJobStatus };

/**
 * The row's ⋯ menu (PROMPT-006): Edit, pause or resume tracking, open the
 * Positions panel on Improve, suggest content, and Delete behind a
 * confirmation. Base UI's menu opens from mouse and keyboard and closes on
 * Esc and outside clicks.
 */
function RowActionsMenu({
  prompt,
  brandId,
  onEdit,
  onToggleActive,
  onImprove,
  onSuggestContent,
  onOpenSuggestion,
  suggesting,
  noPlan,
  suggestDisabledReason,
  onCreateContent,
  onDelete,
}: {
  prompt: Prompt;
  brandId: string;
  onEdit: () => void;
  onToggleActive: () => void;
  onImprove: () => void;
  /** One content opportunity for this prompt (PROMPT-006). */
  onSuggestContent: () => void;
  /** Opens one of the prompt's content opportunities. */
  onOpenSuggestion: (opportunityId: string) => void;
  /** A suggestion for this prompt is being written. */
  suggesting: boolean;
  /** No active plan (read-only): Suggest content opens the plan dialog; a written suggestion still opens. */
  noPlan: boolean;
  /** Why Suggest content can't run now (the month's quota is used up, or a bulk run is going). */
  suggestDisabledReason: string | null;
  /** Opens New content › Start for a new page for this prompt. */
  onCreateContent: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('prompts.content');
  const router = useRouter();
  // With the month's quota used up, or without an active plan, a prompt that
  // already has a suggestion can still open it, which costs nothing; the menu
  // asks as it opens.
  const [openSuggestionId, setOpenSuggestionId] = useState<string | null>(null);
  const canOpenSuggestion = suggestDisabledReason !== null || noPlan;
  // A draft already being written for the prompt opens instead of a second
  // one; undefined while the menu asks.
  const [draftId, setDraftId] = useState<string | null | undefined>(undefined);
  const lookUp = (open: boolean) => {
    if (!open) return;
    setDraftId(undefined);
    getDraftForPrompt(brandId, prompt.id).then(setDraftId, () => setDraftId(null));
    if (!canOpenSuggestion) return;
    getOpenSuggestionForPrompt(prompt.id).then(setOpenSuggestionId, () =>
      setOpenSuggestionId(null),
    );
  };

  return (
    <DropdownMenu onOpenChange={lookUp}>
      <DropdownMenuTrigger
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Actions for ${prompt.text}`}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem className="gap-2" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={onToggleActive}>
          {prompt.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {prompt.isActive ? 'Pause tracking' : 'Resume tracking'}
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={onImprove}>
          <TrendingUp className="h-3.5 w-3.5" />
          Improve position…
        </DropdownMenuItem>
        {canOpenSuggestion && openSuggestionId ? (
          <DropdownMenuItem className="gap-2" onClick={() => onOpenSuggestion(openSuggestionId)}>
            <Lightbulb className="h-3.5 w-3.5" />
            Open content suggestion
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="gap-2"
            onClick={onSuggestContent}
            disabled={suggesting || suggestDisabledReason !== null}
          >
            {suggesting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Lightbulb className="h-3.5 w-3.5" />
            )}
            <span className="flex flex-col">
              <span>{suggesting ? 'Writing a suggestion…' : 'Suggest content'}</span>
              {suggestDisabledReason && (
                <span className="text-[11px] text-muted-foreground">{suggestDisabledReason}</span>
              )}
            </span>
          </DropdownMenuItem>
        )}
        {draftId ? (
          <DropdownMenuItem
            className="gap-2"
            onClick={() => router.push(contentEditorPath(draftId))}
          >
            <FileText className="h-3.5 w-3.5" />
            {t('openDraft')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            className="gap-2"
            onClick={onCreateContent}
            disabled={draftId === undefined}
          >
            {draftId === undefined ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FilePlus className="h-3.5 w-3.5" />
            )}
            {t('create')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="gap-2 text-red-600 focus:text-red-600 dark:text-red-400"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── All Prompts Tab ──────────────────────────────────────────────────────────

/** The Status badge: New is amber, so a prompt added today stands out. */
const STATUS_BADGE: Record<PromptStatus, string> = {
  active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  new: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  paused: 'border-muted-foreground/20 text-muted-foreground',
};

const STATUS_FILTERS: PromptStatusFilter[] = ['tracked', 'active', 'new', 'paused', 'all'];

type PerformanceFilter = 'all' | PromptPerformance;

const PERFORMANCE_FILTERS: PerformanceFilter[] = ['all', 'best', 'good', 'late', 'missing'];

/** Late and Missing order the table furthest behind first (see compareLateness). */
const isBehind = (filter: PerformanceFilter) => filter === 'late' || filter === 'missing';

const WORK_FILTER_LABELS: Record<string, string> = {
  all: 'All work',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  none: 'No status',
};

function AllPromptsTab({
  loading,
  failed,
  onRetry,
  prompts: allRows,
  activeBrandId,
  volumeByPromptId,
  estimateByPromptId,
  visibility,
  positions,
  rangeLabel,
  positionsWindow,
  positionsPreset,
  regionFilter,
  statusFilter,
  onStatusFilterChange,
  onAddPrompt,
  onEditPrompt,
  onChanged,
}: {
  loading: boolean;
  /** The last read failed: say so and offer to read again, never "No prompts yet". */
  failed: boolean;
  onRetry: () => void;
  prompts: Prompt[];
  activeBrandId: string;
  volumeByPromptId: Map<string, PromptVolume>;
  /** Each volume as an estimate, keyed like volumeByPromptId (PROMPT-013). */
  estimateByPromptId: Map<string, VolumeEstimate>;
  visibility: Record<string, PromptVisibilitySummary>;
  /** The Positions column per prompt id. */
  positions: Record<string, PromptPositionCell>;
  /** Selected window, so the column tooltips describe the data on screen. */
  rangeLabel: string;
  /** Bounds the table's columns were computed over, for the Positions panel. */
  positionsWindow: { from: string; to?: string };
  positionsPreset: PromptRangePreset;
  /** Selected location; empty means every location. */
  regionFilter: string;
  /** Which rows show, set by the usage cards above (PROMPT-012) or the Status filter. */
  statusFilter: PromptStatusFilter;
  onStatusFilterChange: (filter: PromptStatusFilter) => void;
  /** Opens the Add Prompt dialog; undefined when the user can't write (member role). */
  onAddPrompt?: () => void;
  /** Opens the Edit Prompt dialog for a row; undefined hides the row menu (member role). */
  onEditPrompt?: (prompt: Prompt) => void;
  /** Reloads the page data after a row is paused, resumed or deleted from its menu. */
  onChanged: () => void;
}) {
  const tCommon = useTranslations('common');
  const failureToast = useFailureToast();
  const tPrompts = useTranslations('prompts');
  // One tooltip for every prompt and topic the table cuts short.
  const fullText = useMemo(() => createClampedTextHandle(), []);
  const volumeNote = useMemo(() => createEstimateNoteHandle(), []);
  const tUsage = useTranslations('prompts.usage');
  const format = useFormatter();
  const tDelete = useTranslations('prompts.bulkDelete');
  const tPerformance = useTranslations('prompts.performance');
  const tStatus = useTranslations('prompts.status');
  const tColumns = useTranslations('prompts.columns');
  const tTips = useTranslations('prompts.columns.tips');
  const now = useNow({ updateInterval: 60_000 }).getTime();
  // A read-only workspace (plan not active): the row menu's and the bulk
  // bar's actions open the upgrade dialog instead.
  const { guard, isLocked } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const { canManage } = useUserRole();
  const brandName = useBrandStore(
    (st) => st.brands.find((b) => b.id === activeBrandId)?.name ?? '',
  );
  // The columns shown and their order (PROMPT-015a): the person's view, else
  // the brand's shared one, else today's. Today's until read.
  const [columnViews, setColumnViews] = useState<{
    brandId: string;
    views: PromptTableViews;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPromptTableViews(activeBrandId)
      .then((views) => {
        if (!cancelled) setColumnViews({ brandId: activeBrandId, views });
      })
      .catch((err) => console.error('Failed to read the Tracked Prompts columns:', err));
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);
  const tableViews =
    columnViews?.brandId === activeBrandId ? columnViews.views : { mine: null, brand: null };
  const columns = visibleColumns(effectiveView(tableViews.mine, tableViews.brand));
  const tLocations = useTranslations('prompts.locations');
  const tMetrics = useTranslations('prompts.locations.metrics');
  // Table, or the Locations view (PROMPT-015b), kept in the URL (?layout=locations).
  const [layout, setLayout] = useState<'table' | 'locations'>('table');
  useEffect(() => {
    setLayout(readUrlChoice('layout', ['table', 'locations'] as const, 'table'));
  }, []);
  const prefetchLocations = () => {
    const regions = matrixLocations(filtered);
    if (layout === 'table' && regions.length) {
      loadLocationMatrix(activeBrandId, positionsWindow, regions).catch(() => {});
    }
  };
  const changeLayout = (next: 'table' | 'locations') => {
    setLayout(next);
    const params = new URLSearchParams(window.location.search);
    if (next === 'table') params.delete('layout');
    else params.set('layout', next);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };
  // The locations the prompts track, for the Locations view and location columns.
  const trackedLocations = useMemo(() => matrixLocations(allRows), [allRows]);
  // Location columns in the Table view read their figures, once per location shown.
  const columnRegions = [
    ...new Set(columns.map((id) => parseLocationColumn(id)?.region).filter(Boolean)),
  ] as string[];
  const columnMatrixKey = `${activeBrandId}:${positionsWindow.from}:${positionsWindow.to ?? ''}:${columnRegions.join(',')}`;
  const [columnMatrix, setColumnMatrix] = useState<{
    key: string;
    matrix: PromptLocationMatrix;
  } | null>(null);
  useEffect(() => {
    if (layout !== 'table' || !columnRegions.length) return;
    let cancelled = false;
    loadLocationMatrix(activeBrandId, positionsWindow, columnRegions)
      .then((matrix) => {
        if (!cancelled) setColumnMatrix({ key: columnMatrixKey, matrix });
      })
      .catch((err) => console.error('Failed to read the location columns:', err));
    return () => {
      cancelled = true;
    };
    // `columnRegions` and the window are in the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, columnMatrixKey]);
  const locationMatrix = columnMatrix?.key === columnMatrixKey ? columnMatrix.matrix : null;
  // Rows deleted from the row menu or the bulk bar, hidden at once and
  // deleted for real after the Undo window (PROMPT-006). There is no soft
  // delete for prompts — a delete drops their history — so the delay is the
  // undo: closing the page inside the window simply leaves the prompts in place.
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set());
  // One entry per delete, keyed by its first prompt, with every prompt it hides.
  const deleteTimers = useRef(
    new Map<string, { ids: string[]; timer: ReturnType<typeof setTimeout> }>(),
  );
  const [confirmDelete, setConfirmDelete] = useState<Prompt[] | null>(null);
  const [positionsTab, setPositionsTab] = useState<'platforms' | 'improve'>('platforms');
  // New content › Start for a prompt, from its row menu or its Improve tab.
  const [contentPreset, setContentPreset] = useState<DialogPreset | null>(null);
  // Bumped when Start sends a draft to the Agent or the Team and the panel
  // stays open, so its content step looks for that draft again.
  const [contentSent, setContentSent] = useState(0);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const prompts = useMemo(
    () => allRows.filter((p) => !pendingDeletes.has(p.id)),
    [allRows, pendingDeletes],
  );

  const restoreRows = useCallback((ids: string[]) => {
    setPendingDeletes((set) => {
      const next = new Set(set);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  // Past its Undo window a delete runs a few prompts per call
  // (deleteInBatches), so no statement outlives the timeout on big brands.
  // Deletes queue behind each other, one call at a time, and the bulk bar
  // shows how far the running one has got.
  const deleteQueue = useRef<Promise<void>>(Promise.resolve());
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const runDelete = useCallback(
    async (ids: string[]) => {
      setDeleteProgress({ done: 0, total: ids.length });
      const result = await deleteInBatches(ids, deletePrompts, (done) =>
        setDeleteProgress({ done, total: ids.length }),
      );
      // Prompts still there (a call failed, or RLS left them out) come back
      // into view; the ones deleted before a failure stay deleted.
      const kept = result.keptIds.length;
      if (kept > 0) restoreRows(result.keptIds);
      if (result.failed && result.deletedIds.length === 0) {
        toast.error(tDelete('failed', { count: ids.length }));
        return;
      }
      if (result.failed) {
        toast.error(tDelete('stopped', { deleted: result.deletedIds.length, total: ids.length }), {
          description: tDelete('stoppedDescription', { kept }),
        });
      } else if (kept > 0) {
        toast.error(tDelete('notDeleted', { kept, total: ids.length }));
      }
      onChanged();
    },
    [onChanged, restoreRows, tDelete],
  );

  const queueDelete = useCallback(
    (ids: string[]) => {
      const run: Promise<void> = deleteQueue.current
        .then(() => runDelete(ids))
        .catch(() => undefined)
        .then(() => {
          if (deleteQueue.current === run) setDeleteProgress(null);
        });
      deleteQueue.current = run;
    },
    [runDelete],
  );

  const undoDelete = useCallback(
    (key: string) => {
      const pending = deleteTimers.current.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      deleteTimers.current.delete(key);
      restoreRows(pending.ids);
    },
    [restoreRows],
  );

  const deleteWithUndo = useCallback(
    (list: Prompt[]) => {
      if (list.length === 0) return;
      const ids = list.map((p) => p.id);
      const key = ids[0];
      setPendingDeletes((set) => new Set([...set, ...ids]));
      const timer = setTimeout(() => {
        deleteTimers.current.delete(key);
        queueDelete(ids);
      }, DELETE_UNDO_MS);
      deleteTimers.current.set(key, { ids, timer });
      toast(ids.length === 1 ? 'Prompt deleted' : `${ids.length} prompts deleted`, {
        description: ids.length === 1 ? list[0].text : undefined,
        duration: DELETE_UNDO_MS,
        action: { label: 'Undo', onClick: () => undoDelete(key) },
      });
    },
    [queueDelete, undoDelete],
  );

  // A pending delete still lands if the table unmounts inside the window
  // (switching tabs, changing brand), in the same batches, after any delete
  // already running; only an Undo or closing the page stops it.
  useEffect(() => {
    const timers = deleteTimers.current;
    const queue = deleteQueue;
    return () => {
      for (const { ids, timer } of timers.values()) {
        clearTimeout(timer);
        queue.current = queue.current
          .then(() => deleteInBatches(ids, deletePrompts))
          .then(
            () => undefined,
            () => undefined,
          );
      }
      timers.clear();
    };
  }, []);

  const toggleActive = useCallback(
    async (prompt: Prompt) => {
      try {
        const result = await setPromptActive(prompt.id, !prompt.isActive);
        if ('error' in result) {
          // Resuming needs a free slot on the plan; the message says how many.
          toast.error(
            result.code === 'plan_limit'
              ? 'Not enough room to resume'
              : 'Failed to update the prompt.',
            { description: result.code === 'plan_limit' ? result.error : prompt.text },
          );
          return;
        }
        toast.success(prompt.isActive ? 'Tracking paused' : 'Tracking resumed', {
          description: prompt.text,
        });
        onChanged();
      } catch {
        toast.error('Failed to update the prompt.');
      }
    },
    [onChanged],
  );

  // Bulk Pause / Resume: one write for the selected prompts that change.
  const [bulkBusy, setBulkBusy] = useState(false);
  const setActiveFor = useCallback(
    async (list: Prompt[], isActive: boolean) => {
      const ids = list.filter((p) => p.isActive !== isActive).map((p) => p.id);
      if (ids.length === 0) return;
      setBulkBusy(true);
      const verb = isActive ? 'resume' : 'pause';
      try {
        const result = await setPromptsActive(ids, isActive).catch(() => ({
          error: 'unreachable',
        }));
        if ('error' in result) {
          // Resuming needs free slots on the plan; the message says how many.
          const planLimit = 'code' in result && result.code === 'plan_limit';
          toast.error(
            planLimit ? 'Not enough room to resume' : `Failed to ${verb} the prompts.`,
            planLimit ? { description: result.error } : undefined,
          );
          return;
        }
        if (result.updated > 0) {
          toast.success(
            `Tracking ${isActive ? 'resumed' : 'paused'} for ${result.updated} prompt${result.updated === 1 ? '' : 's'}`,
          );
        }
        if (result.updated < ids.length) {
          toast.error(`${ids.length - result.updated} of ${ids.length} couldn't be ${verb}d.`);
        }
        onChanged();
      } finally {
        setBulkBusy(false);
      }
    },
    [onChanged],
  );

  // "Suggest content" (PROMPT-006): one content opportunity for a prompt,
  // against the month's content quota. The quota is read up front so the
  // menu can say when nothing is left; the server enforces it either way.
  const router = useRouter();
  const [contentUsage, setContentUsage] = useState<ContentUsage | null>(null);
  // The quota couldn't be read; the bulk bar falls back to the smallest cap.
  const [contentUsageFailed, setContentUsageFailed] = useState(false);
  const [usageVersion, setUsageVersion] = useState(0);
  const [suggestingIds, setSuggestingIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getContentUsage().then(
      (usage) => {
        if (cancelled) return;
        setContentUsage(usage);
        setContentUsageFailed(false);
      },
      () => {
        if (cancelled) return;
        setContentUsage(null);
        setContentUsageFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, usageVersion]);
  const hasOpportunityLimit =
    hasContentQuota(contentUsage) && contentUsage.opportunities.limit !== -1;
  // Without an active plan the quota reads 0 of 0: Suggest content stays
  // clickable, and opens the plan dialog.
  const contentNoPlan = isNoPlan(contentUsage, isLocked);
  const suggestDisabledReason =
    hasOpportunityLimit && !contentNoPlan && contentUsage.opportunities.remaining <= 0
      ? contentUsage.periodEnd
        ? `Limit reached · resets ${new Date(contentUsage.periodEnd).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC',
          })}`
        : 'Monthly limit reached'
      : null;

  const openOpportunity = useCallback(
    (id: string) => router.push(`/dashboard/content?opportunity=${id}`),
    [router],
  );
  const markSuggesting = useCallback((ids: string[], on: boolean) => {
    setSuggestingIds((set) => {
      const next = new Set(set);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const suggestContent = useCallback(
    async (prompt: Prompt) => {
      // Only a plan with a monthly limit has a quota to say was left alone.
      const quotaUntouched = hasOpportunityLimit
        ? 'Nothing was used from your monthly content quota.'
        : undefined;
      markSuggesting([prompt.id], true);
      const toastId = toast.loading('Writing a content suggestion…', {
        description: prompt.text,
      });
      const outcome = await suggestForPrompt(prompt.id, SUGGEST_CALLS);
      markSuggesting([prompt.id], false);
      setUsageVersion((v) => v + 1);
      switch (outcome.kind) {
        case 'created':
          toast.success('Content suggestion created', {
            id: toastId,
            description: prompt.text,
            duration: 10_000,
            action: { label: 'Open', onClick: () => openOpportunity(outcome.opportunityId) },
          });
          break;
        case 'existing':
          // CONTENT-004: an open suggestion already answers this prompt.
          toast.info('This prompt already has a content suggestion', {
            id: toastId,
            description: prompt.text,
            duration: 10_000,
            action: {
              label: 'Open existing',
              onClick: () => openOpportunity(outcome.opportunityId),
            },
          });
          break;
        case 'limited':
          toast.error('Monthly content limit reached.', { id: toastId, description: prompt.text });
          break;
        case 'nothing':
          toast.info("Couldn't write a suggestion for this prompt yet", {
            id: toastId,
            // Not grouped with other prompts yet, or no answers to go on.
            description: [
              'It needs tracked answers and a prompt group first; both come with its next tracking run.',
              quotaUntouched,
            ]
              .filter(Boolean)
              .join(' '),
          });
          break;
        case 'failed':
          // A reason the API gave, in plain words (BUG-001); else what went wrong.
          if (outcome.failure && outcome.failure !== 'failed') {
            failureToast(outcome.failure, { id: toastId, description: prompt.text });
            break;
          }
          toast.error("Couldn't write a content suggestion", {
            id: toastId,
            description: [outcome.message, quotaUntouched].filter(Boolean).join(' ') || undefined,
          });
          break;
        case 'timeout':
          toast.info('Still writing the content suggestion', {
            id: toastId,
            description: 'It will appear in Content when it is done.',
          });
          break;
      }
    },
    [failureToast, hasOpportunityLimit, markSuggesting, openOpportunity],
  );

  // Bulk "Suggest content": one prompt after another (runInTurn), so a
  // prompt whose group got a suggestion a moment ago is answered by that one,
  // at no cost.
  const [bulkSuggesting, setBulkSuggesting] = useState(false);
  const suggestFor = useCallback(
    async (list: Prompt[]) => {
      if (list.length === 0) return;
      setBulkSuggesting(true);
      markSuggesting(
        list.map((p) => p.id),
        true,
      );
      const toastId = toast.loading(`Writing content suggestions… 1 of ${list.length}`, {
        description: list[0].text,
      });
      const tally = await runInTurn(list, async (prompt, i) => {
        if (i > 0) {
          toast.loading(`Writing content suggestions… ${i + 1} of ${list.length}`, {
            id: toastId,
            description: prompt.text,
          });
        }
        const outcome = await suggestForPrompt(prompt.id, SUGGEST_CALLS);
        markSuggesting([prompt.id], false);
        return outcome;
      });
      markSuggesting(
        list.map((p) => p.id),
        false,
      );
      setBulkSuggesting(false);
      setUsageVersion((v) => v + 1);

      const summary = bulkSuggestSummary(tally);
      const opened = tally.created.length > 0 ? tally.created : tally.existing;
      toast[summary.tone](summary.title, {
        id: toastId,
        description: summary.description,
        duration: 10_000,
        action:
          opened.length === 1
            ? {
                label: tally.created.length > 0 ? 'Open' : 'Open existing',
                onClick: () => openOpportunity(opened[0]),
              }
            : opened.length > 1
              ? { label: 'Open Content', onClick: () => router.push('/dashboard/content') }
              : undefined,
      });
    },
    [markSuggesting, openOpportunity, router],
  );
  const [search, setSearch] = useState('');
  const [workFilter, setWorkFilter] = useState<'all' | 'none' | PromptWorkStatus>('all');
  // Where the brand stands in each prompt's answers: Best, Good, Late, Missing.
  const [performanceFilter, setPerformanceFilter] = useState<PerformanceFilter>('all');
  // Optimistic per-row status overrides — the prompts prop belongs to the
  // parent's load cycle; a full reload for a one-column change would flash
  // the whole table.
  const [statusOverrides, setStatusOverrides] = useState<Map<string, PromptWorkStatus | null>>(
    new Map(),
  );
  const searchParams = useSearchParams();
  // The row whose Positions panel is open, and the panel's own range. They
  // live here, beside the table, so closing the panel leaves search, sort,
  // page and scroll as they were. Both are mirrored to the URL
  // (?positions=<id>&positionsRange=7d) so an open panel can be shared.
  const [positionsId, setPositionsId] = useState<string | null>(() =>
    searchParams.get('positions'),
  );
  const [positionsRange, setPositionsRange] = useState<PositionsRange>(() =>
    parsePositionsRange(searchParams, positionsPreset),
  );
  const panelWindow = useMemo(
    () =>
      resolvePromptRange(positionsRange.preset, {
        from: positionsRange.from,
        to: positionsRange.to,
      }),
    [positionsRange],
  );
  // A brand switch or reload that drops the prompt must not leave its panel up.
  const openPositions = useMemo(() => {
    const p = positionsId ? prompts.find((row) => row.id === positionsId) : undefined;
    return p ? { id: p.id, text: p.text } : null;
  }, [positionsId, prompts]);
  // Adjust-state-during-render (as in usePagination): clear the id once the
  // list has loaded without it, so the URL drops it too.
  if (!loading && positionsId && !openPositions) setPositionsId(null);

  // The panel opens on the table's window; changing it there only moves the panel.
  // Track in more locations (PROMPT-015c), or stop tracking in some: from the
  // Locations view, a cell, a column's menu or the bulk bar. Each opener is
  // guarded, so a read-only workspace gets the upgrade dialog, not this one.
  const [addLocations, setAddLocations] = useState<{
    open: boolean;
    preset: AddLocationsPreset | null;
  }>({ open: false, preset: null });
  // A Locations view cell opens the panel on its location (PROMPT-015b).
  const [panelRegion, setPanelRegion] = useState<string | null>(null);
  const openPositionsPanel = useCallback(
    (
      promptId: string,
      tab: 'platforms' | 'improve' = 'platforms',
      region: string | null = null,
    ) => {
      setPanelRegion(region);
      setPositionsTab(tab);
      setPositionsRange(panelRangeFromTable(positionsPreset, positionsWindow, viewerTimeZone()));
      setPositionsId(promptId);
    },
    [positionsPreset, positionsWindow],
  );

  // Shallow URL sync, same reasoning as the page's tab sync. Reads the live
  // location rather than `searchParams`, which can lag a sibling effect's
  // replaceState in the same commit and would drop its params.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const want = positionsUrlParams(positionsId, positionsRange);
    if (Object.entries(want).every(([k, v]) => params.get(k) === v)) return;
    for (const [k, v] of Object.entries(want)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    window.history.replaceState(null, '', `?${params.toString()}${window.location.hash}`);
  }, [positionsId, positionsRange]);

  const statusOf = useCallback(
    (p: Prompt) => (statusOverrides.has(p.id) ? statusOverrides.get(p.id)! : p.workStatus),
    [statusOverrides],
  );

  const handleStatusChange = useCallback(
    (prompt: Prompt, status: PromptWorkStatus | null) => {
      const previous = statusOverrides.has(prompt.id)
        ? statusOverrides.get(prompt.id)!
        : prompt.workStatus;
      setStatusOverrides((prev) => new Map(prev).set(prompt.id, status));
      setPromptWorkStatus(prompt.id, status).catch(() => {
        setStatusOverrides((prev) => new Map(prev).set(prompt.id, previous));
        toast.error('Failed to update status');
      });
    },
    [statusOverrides],
  );

  const rawSort = searchParams.get('sort');
  const activeSort: AllPromptsSortKey = isAllPromptsSortKey(rawSort) ? rawSort : 'visibility';
  const dir: SortDir = searchParams.get('dir') === 'asc' ? 'asc' : 'desc';
  // With Late or Missing picked and no column, the furthest behind come first
  // (see compareLateness).
  const latenessOrder = isBehind(performanceFilter) && !isAllPromptsSortKey(rawSort);

  // Click a header to sort: a new column starts at desc ("show me the extremes");
  // re-clicking the active column toggles desc⇄asc. Persisted to the URL so the
  // sort survives reloads and is shareable (matches the existing `tab` sync).
  // Shallow history update — same reasoning as the tab sync: pure client
  // state must not trigger an RSC round-trip that can block the action queue.
  const handleSort = useCallback(
    (key: AllPromptsSortKey) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      // Position is best when lowest, so it starts at asc (#1 first). Under the
      // furthest-behind order no column is active, so any header starts afresh.
      const nextDir: SortDir =
        activeSort === key && !latenessOrder
          ? dir === 'desc'
            ? 'asc'
            : 'desc'
          : key === 'position'
            ? 'asc'
            : 'desc';
      params.set('tab', 'all');
      params.set('sort', key);
      params.set('dir', nextDir);
      window.history.replaceState(null, '', `?${params.toString()}`);
    },
    [searchParams, activeSort, dir, latenessOrder],
  );

  // Picking Late or Missing sets a picked column aside, so the furthest behind
  // lead; leaving them brings that column back, unless a header was clicked
  // in between, which then stays.
  const setAsideSort = useRef<{ sort: string; dir: string | null } | null>(null);
  // Read and set at pick time, so a quick second pick sees the first.
  const performanceNow = useRef(performanceFilter);
  const changePerformance = useCallback((next: PerformanceFilter) => {
    const wasBehind = isBehind(performanceNow.current);
    performanceNow.current = next;
    setPerformanceFilter(next);
    if (wasBehind === isBehind(next)) return;
    const turningOn = isBehind(next);
    const params = new URLSearchParams(window.location.search);
    const sort = params.get('sort');
    if (turningOn && sort) {
      setAsideSort.current = { sort, dir: params.get('dir') };
      params.delete('sort');
      params.delete('dir');
      window.history.replaceState(null, '', `?${params.toString()}`);
    } else if (!turningOn && !sort && setAsideSort.current) {
      params.set('sort', setAsideSort.current.sort);
      if (setAsideSort.current.dir) params.set('dir', setAsideSort.current.dir);
      window.history.replaceState(null, '', `?${params.toString()}`);
    }
    if (!turningOn) setAsideSort.current = null;
  }, []);

  // Search, prompt status and work status first: the Performance counts are
  // out of these.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = [...prompts];
    if (q) {
      list = list.filter(
        (p) => p.text.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q),
      );
    }
    list = list.filter((p) => matchesStatusFilter(p, statusFilter, now));
    if (workFilter !== 'all') {
      list = list.filter((p) =>
        workFilter === 'none' ? statusOf(p) === null : statusOf(p) === workFilter,
      );
    }
    return list;
  }, [prompts, search, statusFilter, workFilter, statusOf, now]);

  const performanceCounts = useMemo(() => {
    const counts: Record<PerformanceFilter, number> = {
      all: searched.length,
      best: 0,
      good: 0,
      late: 0,
      missing: 0,
    };
    for (const p of searched) {
      const performance = positions[p.id]?.performance;
      if (performance) counts[performance] += 1;
    }
    return counts;
  }, [searched, positions]);
  // The menu's options, each with its count, as the old "Late or missing · N" read.
  const performanceItems = PERFORMANCE_FILTERS.map((value) => ({
    value,
    label:
      value === 'all'
        ? tPerformance('all')
        : tPerformance('option', {
            label: tPerformance(value),
            count: format.number(performanceCounts[value]),
          }),
  }));

  const filtered = useMemo(() => {
    const list =
      performanceFilter === 'all'
        ? [...searched]
        : searched.filter((p) => positions[p.id]?.performance === performanceFilter);
    if (latenessOrder) {
      // Equally far behind: the more visible prompt first, as the table opens.
      const score = (p: Prompt) => visibility[p.id]?.score ?? 0;
      return list.sort(
        (a, b) =>
          compareLateness(positions[a.id], positions[b.id]) ||
          compareNullsLast(score(a), score(b), 'desc'),
      );
    }

    const rowOf = (p: Prompt) => {
      const volume = volumeByPromptId.get(p.id);
      return {
        createdAt: p.createdAt,
        visibility: visibility[p.id],
        position: positions[p.id],
        volume: volume && {
          estAiVolume: volume.estAiVolume,
          confidence: estimateByPromptId.get(p.id)?.confidence,
        },
      };
    };

    const sorted = list.sort((a, b) => comparePromptSortRows(activeSort, rowOf(a), rowOf(b), dir));
    // Until a column is picked, prompts added within the last day lead: Track
    // on Insights opens this table to show them.
    return isAllPromptsSortKey(rawSort) ? sorted : newFirst(sorted, now);
  }, [
    searched,
    performanceFilter,
    latenessOrder,
    rawSort,
    activeSort,
    dir,
    visibility,
    positions,
    volumeByPromptId,
    estimateByPromptId,
    now,
  ]);

  // Pagination for the main prompt list.  resetKey encodes every variable that
  // changes the visible row set (search text, sort column, sort direction, work
  // status filter) so usePagination jumps back to page 0 automatically when
  // any filter or sort changes — satisfying the issue's acceptance criteria.
  const promptsResetKey = `${search}::${statusFilter}::${workFilter}::${performanceFilter}::${activeSort}::${dir}`;
  // From every row, pending deletes included, so the title agrees with the
  // usage cards until a delete actually lands after its Undo window.
  const statusCounts = useMemo(() => countByStatus(allRows, now), [allRows, now]);
  const promptsPager = usePagination(filtered.length, promptsResetKey);

  // Rows ticked for the bulk action bar. Only rows on screen can be ticked,
  // so the selection starts over whenever the rows on screen change.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionKey = [
    activeBrandId,
    promptsResetKey,
    promptsPager.page,
    regionFilter,
    positionsWindow.from,
    positionsWindow.to ?? '',
  ].join('::');
  const [prevSelectionKey, setPrevSelectionKey] = useState(selectionKey);
  if (prevSelectionKey !== selectionKey) {
    setPrevSelectionKey(selectionKey);
    setSelectedIds(new Set());
  }
  const toggleRow = useCallback((id: string, on: boolean) => {
    setSelectedIds((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const state = promptsTableState({ loading, failed, rows: prompts.length });
  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <Card>
        <CardContent className="py-14 text-center text-sm">
          <AlertCircle className="mx-auto h-9 w-9 text-destructive/60" />
          <p className="mt-2 font-medium">{tPrompts('loadError')}</p>
          <Button className="mt-4 gap-2" size="sm" variant="outline" onClick={onRetry}>
            <RotateCw className="h-4 w-4" />
            {tCommon('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === 'empty') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <Layers className="h-12 w-12 text-muted-foreground/40" />
          <div className="text-center space-y-1">
            <p className="text-sm font-medium">No prompts yet</p>
            <p className="text-xs text-muted-foreground">
              Add prompts to your brand to start tracking their AI visibility.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onAddPrompt && (
              <Button size="sm" className="gap-2" onClick={onAddPrompt}>
                <Plus className="h-4 w-4" />
                Add prompt
              </Button>
            )}
            <Link href={`/dashboard/brands/${activeBrandId}/prompts`}>
              <Button size="sm" variant={onAddPrompt ? 'outline' : 'default'} className="gap-2">
                <Pencil className="h-4 w-4" />
                Manage prompts
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  const pageRows = filtered.slice(promptsPager.start, promptsPager.end);
  const pageIds = pageRows.map((p) => p.id);
  const selectedPrompts = pageRows.filter((p) => selectedIds.has(p.id));
  // A delete that fits in one call is over before the bar could say so.
  const showDeleteProgress = deleteProgress !== null && deleteProgress.total > PROMPT_DELETE_BATCH;

  // The columns, by id, in today's order; the view picks and orders them (PROMPT-015a).
  const headCells: Record<PromptColumnId, React.ReactNode> = {
    topic: <TableHead key="topic">Topic</TableHead>,
    status: (
      <ColHead key="status" className="text-center" tooltip={tTips('status')}>
        Status
      </ColHead>
    ),
    work: (
      <ColHead key="work" className="text-center" tooltip={tTips('work')}>
        Work
      </ColHead>
    ),
    visibility: (
      <SortableHead
        key="visibility"
        className="text-right"
        tooltip={tTips('visibility', { range: rangeLabel })}
        sortKey="visibility"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Visibility
      </SortableHead>
    ),
    mentions: (
      <SortableHead
        key="mentions"
        className="text-right"
        tooltip={tTips('mentions', { range: rangeLabel })}
        sortKey="mentions"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Mentions
      </SortableHead>
    ),
    citations: (
      <SortableHead
        key="citations"
        className="text-right"
        tooltip={tTips('citations', { range: rangeLabel })}
        sortKey="citations"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Citations
      </SortableHead>
    ),
    positions: (
      <SortableHead
        key="positions"
        className="pl-8"
        tooltip={tTips('positions', { range: rangeLabel })}
        sortKey="position"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Positions
      </SortableHead>
    ),
    volume: (
      <SortableHead
        key="volume"
        className="text-right"
        tooltip={tTips('volume')}
        sortKey="volume"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Volume
      </SortableHead>
    ),
    competition: (
      <ColHead key="competition" className="text-center" tooltip={tTips('competition')}>
        Competition
      </ColHead>
    ),
    runs: (
      <SortableHead
        key="runs"
        className="text-right"
        tooltip={tTips('runs', { range: rangeLabel })}
        sortKey="runs"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Runs
      </SortableHead>
    ),
    added: (
      <SortableHead
        key="added"
        className="text-right"
        tooltip={tTips('added')}
        sortKey="added"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        {tColumns('added')}
      </SortableHead>
    ),
    lastRun: (
      <SortableHead
        key="lastRun"
        className="text-right"
        tooltip={tTips('lastRun')}
        sortKey="lastRun"
        activeSort={latenessOrder ? null : activeSort}
        dir={dir}
        onSort={handleSort}
      >
        Last run
      </SortableHead>
    ),
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <CardTitle className="text-sm font-medium">
              {tUsage(`table.${statusFilter}`, {
                count: format.number(statusCounts[statusFilter]),
              })}
            </CardTitle>
            {statusFilter !== 'all' && (
              <span className="text-xs text-muted-foreground">
                {tUsage('table.filtered')} ·{' '}
                <button
                  type="button"
                  onClick={() => onStatusFilterChange('all')}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {tUsage('table.showAll', { count: format.number(statusCounts.all) })}
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={tLocations('view')}
              className="inline-flex gap-0.5 rounded-full bg-muted p-0.5"
            >
              {(['table', 'locations'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  onClick={() => changeLayout(l)}
                  // Read ahead, so the Locations view opens on its data.
                  onPointerEnter={l === 'locations' ? prefetchLocations : undefined}
                  onFocus={l === 'locations' ? prefetchLocations : undefined}
                  className={cn(
                    'h-7 rounded-full px-3 text-xs transition-colors',
                    layout === l
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tLocations(l)}
                </button>
              ))}
            </div>
            <Select
              value={statusFilter}
              onValueChange={(v) => onStatusFilterChange((v as PromptStatusFilter | null) ?? 'all')}
              items={STATUS_FILTERS.map((value) => ({ value, label: tStatus(value) }))}
            >
              <SelectTrigger className="h-8 w-32 text-xs" aria-label={tStatus('label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {tStatus(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={workFilter}
              onValueChange={(v) => setWorkFilter((v as typeof workFilter) ?? 'all')}
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="All work">
                  {(value) => WORK_FILTER_LABELS[(value as string) ?? 'all'] ?? 'All work'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All work</SelectItem>
                <SelectItem value="todo">To do</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="done">Done</SelectItem>
                <SelectItem value="none">No status</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={performanceFilter}
              onValueChange={(v) => changePerformance((v as PerformanceFilter | null) ?? 'all')}
              items={performanceItems}
            >
              <SelectTrigger
                className="h-8 w-36 text-xs"
                aria-label={tPerformance('label')}
                title={tPerformance('title')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {performanceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search prompts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
            {layout === 'table' && (
              <ColumnsPanel
                brandId={activeBrandId}
                brandName={brandName}
                canManage={canManage}
                views={tableViews}
                onViewsChange={(views) => setColumnViews({ brandId: activeBrandId, views })}
                locations={trackedLocations}
              />
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {onEditPrompt && (selectedPrompts.length > 0 || showDeleteProgress) && (
          <BulkActionBar
            count={selectedPrompts.length}
            activeCount={selectedPrompts.filter((p) => p.isActive).length}
            busy={bulkBusy || bulkSuggesting}
            suggesting={bulkSuggesting}
            suggestBlockedReason={
              suggestDisabledReason ??
              (!bulkSuggesting && suggestingIds.size > 0
                ? 'Wait for the suggestion being written'
                : bulkSuggestBlock(selectedPrompts.length, contentUsage, {
                    unavailable: contentUsageFailed,
                    isLocked,
                  }))
            }
            deleting={showDeleteProgress ? deleteProgress : null}
            onPause={guard(() => void setActiveFor(selectedPrompts, false), {
              action: tActions('pausePrompts'),
            })}
            onResume={guard(() => void setActiveFor(selectedPrompts, true), {
              action: tActions('resumePrompts'),
            })}
            onSuggestContent={guard(() => void suggestFor(selectedPrompts), {
              action: tActions('suggestContent'),
            })}
            onAddLocations={guard(() => setAddLocations({ open: true, preset: { mode: 'add' } }), {
              action: tActions('changeLocations'),
            })}
            onRemoveLocations={guard(
              () => setAddLocations({ open: true, preset: { mode: 'remove' } }),
              { action: tActions('removeLocations') },
            )}
            onDelete={guard(() => setConfirmDelete(selectedPrompts), {
              action: tActions('deletePrompts'),
            })}
            onClear={() => setSelectedIds(new Set())}
          />
        )}
        {layout === 'locations' ? (
          <LocationMatrix
            brandId={activeBrandId}
            rows={filtered}
            pageRows={pageRows}
            window={positionsWindow}
            onOpenCell={(promptId, region) => openPositionsPanel(promptId, 'platforms', region)}
            onTrack={
              onEditPrompt
                ? guard(
                    (prompt: Prompt, region: string) =>
                      setAddLocations({
                        open: true,
                        preset: { promptId: prompt.id, locations: [region] },
                      }),
                    { action: tActions('changeLocations') },
                  )
                : undefined
            }
            onStopTracking={
              onEditPrompt
                ? guard(
                    (prompt: Prompt | null, region: string) =>
                      setAddLocations({
                        open: true,
                        preset: { mode: 'remove', promptId: prompt?.id, locations: [region] },
                      }),
                    { action: tActions('removeLocations') },
                  )
                : undefined
            }
            onAddLocations={
              onEditPrompt
                ? guard(() => setAddLocations({ open: true, preset: null }), {
                    action: tActions('changeLocations'),
                  })
                : undefined
            }
          />
        ) : (
          <Table stickyHeader stickyFirstColumn>
            {latenessOrder && (
              <TableCaption className="sr-only">{tPerformance('order')}</TableCaption>
            )}
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">
                  {onEditPrompt ? (
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={allSelected(pageIds, selectedIds)}
                        onCheckedChange={() => setSelectedIds(toggleAll(pageIds, selectedIds))}
                        aria-label="Select every prompt on this page"
                      />
                      Prompt
                    </div>
                  ) : (
                    'Prompt'
                  )}
                </TableHead>
                {columns.map((id) => {
                  const loc = parseLocationColumn(id);
                  return loc ? (
                    <TableHead key={id} className="bg-muted/40 text-right">
                      <span className="block text-xs font-medium">{tMetrics(loc.metric)}</span>
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        {regionLabel(loc.region)}
                      </span>
                    </TableHead>
                  ) : (
                    headCells[id as PromptColumnId]
                  );
                })}
                {onEditPrompt && (
                  <TableHead className="text-right pr-6 w-[60px]">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((p) => {
                const vol = volumeByPromptId.get(p.id);
                const vis = visibility[p.id];
                const status = promptStatus(p, now);
                // With no answers (in a location column, or at all), it waits for
                // its first ones only while it's new, or answered elsewhere (a
                // location just added); otherwise a dash.
                const awaiting = awaitsFirstAnswers(
                  p,
                  Boolean(vis) ||
                    Object.values(locationMatrix?.[p.id] ?? {}).some((c) => c.runs > 0),
                  now,
                );
                // No answers in the window yet: when they come, or why not, said
                // once in the first answer column shown, the others a dash.
                const pendingAt = pendingColumn(p, {
                  hasAnswers: Boolean(vis),
                  region: regionFilter,
                  columns,
                });
                const noAnswers = (id: PromptColumnId) =>
                  pendingAt === id ? (
                    <LocationPending
                      prompt={p}
                      region={regionFilter || undefined}
                      window={positionsWindow}
                      awaiting={awaiting}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  );
                const cells: Record<PromptColumnId, React.ReactNode> = {
                  topic: (
                    <TableCell key="topic">
                      {p.category?.trim() ? (
                        <ClampedText
                          handle={fullText}
                          text={p.category}
                          render={
                            <span className="text-xs text-muted-foreground truncate inline-block max-w-[140px] align-middle" />
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground inline-block align-middle">
                          —
                        </span>
                      )}
                    </TableCell>
                  ),
                  status: (
                    <TableCell key="status" className="text-center">
                      <Badge
                        variant="outline"
                        className={cn('text-xs', STATUS_BADGE[status])}
                        title={status === 'new' ? tStatus('newHint') : undefined}
                      >
                        {tStatus(status)}
                      </Badge>
                    </TableCell>
                  ),
                  work: (
                    <TableCell key="work" className="text-center">
                      <div className="inline-flex flex-col items-center gap-0.5">
                        <WorkStatusBadge
                          status={statusOf(p)}
                          onChange={
                            onEditPrompt
                              ? guard((s: PromptWorkStatus | null) => handleStatusChange(p, s), {
                                  action: tActions('setWorkStatus'),
                                })
                              : undefined
                          }
                        />
                        {p.targetUrlCount > 0 && (
                          <span
                            className={cn(
                              'text-[10px] tabular-nums',
                              p.citedUrlCount > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-muted-foreground',
                            )}
                            title={`${p.citedUrlCount} of ${p.targetUrlCount} target URLs cited in AI answers`}
                          >
                            {p.citedUrlCount}/{p.targetUrlCount} cited
                          </span>
                        )}
                      </div>
                    </TableCell>
                  ),
                  visibility: (
                    <TableCell key="visibility" className="text-right">
                      {vis ? (
                        <div
                          className="inline-flex items-center gap-2 justify-end min-w-[110px]"
                          title={`Mentioned in ${vis.mentionAnswers} of ${vis.runs} answers (${rangeLabel}) · cited in ${vis.citationAnswers}${
                            vis.positionFactor !== null
                              ? ` · position factor ${vis.positionFactor.toFixed(2)}`
                              : ''
                          } · coverage ${vis.visibilityRate}% (${vis.visibleRuns}/${vis.runs} runs)`}
                        >
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums',
                              visibilityColorClass(vis.score ?? 0),
                            )}
                          >
                            {vis.score ?? 0}
                          </span>
                          <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full',
                                visibilityBarClass(vis.score ?? 0),
                              )}
                              style={{
                                width: `${Math.min(100, Math.max(0, vis.score ?? 0))}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        noAnswers('visibility')
                      )}
                    </TableCell>
                  ),
                  mentions: (
                    <TableCell key="mentions" className="text-right tabular-nums text-sm">
                      {vis ? formatNumber(vis.totalMentions) : noAnswers('mentions')}
                    </TableCell>
                  ),
                  citations: (
                    <TableCell key="citations" className="text-right tabular-nums text-sm">
                      {vis ? formatNumber(vis.totalCitations) : noAnswers('citations')}
                    </TableCell>
                  ),
                  positions: (
                    <TableCell key="positions" className="pl-8">
                      {/* Fixed widths so the value, dots and See line up on every row. */}
                      <div className="inline-flex items-center gap-2">
                        <div className="w-[5.5rem] whitespace-nowrap">
                          {pendingAt === 'positions' ? (
                            noAnswers('positions')
                          ) : (
                            <PositionValue cell={positions[p.id]} vis={vis} />
                          )}
                        </div>
                        <div className="w-6">
                          {/* Whenever it has answers: a prompt never named is the one to open. */}
                          {opensPositionsPanel(vis) && (
                            <Button
                              type="button"
                              size="icon-xs"
                              variant="outline"
                              aria-label={`View positions for ${p.text}`}
                              title="See positions"
                              onClick={() => openPositionsPanel(p.id)}
                            >
                              <BarChart3 />
                            </Button>
                          )}
                        </div>
                      </div>
                    </TableCell>
                  ),
                  volume: (
                    <TableCell key="volume" className="text-right">
                      {vol ? (
                        <EstimateRange
                          estimate={estimateByPromptId.get(p.id)!}
                          handle={volumeNote}
                          className="text-sm font-semibold"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ),
                  competition: (
                    <TableCell key="competition" className="text-center">
                      <div className="flex justify-center">
                        <CompetitionBars
                          index={vol?.competitionIndex ?? null}
                          label={vol?.competition ?? null}
                        />
                      </div>
                    </TableCell>
                  ),
                  runs: (
                    <TableCell key="runs" className="text-right tabular-nums text-sm">
                      {vis ? formatNumber(vis.runs) : noAnswers('runs')}
                    </TableCell>
                  ),
                  added: (
                    <TableCell
                      key="added"
                      className="text-right text-xs whitespace-nowrap text-muted-foreground"
                      title={new Date(p.createdAt).toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    >
                      {formatDate(p.createdAt)}
                    </TableCell>
                  ),
                  lastRun: (
                    <TableCell key="lastRun" className="text-right text-xs text-muted-foreground">
                      {pendingAt === 'lastRun'
                        ? noAnswers('lastRun')
                        : formatRelative(vis?.lastRunAt, tCommon)}
                    </TableCell>
                  ),
                };
                return (
                  <TableRow key={p.id} className="hover:bg-muted/50">
                    <TableCell className="pl-6 font-medium text-sm max-w-[320px]">
                      <div className="flex items-start gap-3">
                        {onEditPrompt && (
                          <Checkbox
                            className="mt-0.5"
                            checked={selectedIds.has(p.id)}
                            onCheckedChange={(v) => toggleRow(p.id, v === true)}
                            aria-label={`Select ${p.text}`}
                          />
                        )}
                        <ClampedText
                          handle={fullText}
                          text={p.text}
                          render={
                            <Link
                              href={`/dashboard/prompts/${p.id}`}
                              className="line-clamp-2 transition-colors hover:text-primary hover:underline"
                            />
                          }
                        />
                        <AskAboutThis
                          reference={{ type: 'prompt', id: p.id, label: p.text }}
                          className="-mt-0.5 shrink-0"
                        />
                      </div>
                    </TableCell>
                    {columns.map((id) => {
                      const loc = parseLocationColumn(id);
                      if (!loc) return cells[id as PromptColumnId];
                      const located = locationMatrix?.[p.id]?.[loc.region];
                      const value = metricValue(located, loc.metric);
                      // Tracked there, no answers yet: when they'll come, or why not.
                      const pending =
                        locationMatrix !== null &&
                        p.regions.includes(loc.region) &&
                        (!located || located.runs === 0);
                      return (
                        <TableCell
                          key={id}
                          className="bg-muted/20 text-right text-sm font-semibold tabular-nums"
                        >
                          {pending ? (
                            <LocationPending
                              prompt={p}
                              region={loc.region}
                              window={positionsWindow}
                              awaiting={awaiting}
                              className="font-normal"
                            />
                          ) : value === null ? (
                            <span className="text-xs font-normal text-muted-foreground">—</span>
                          ) : loc.metric === 'position' ? (
                            `#${value.toFixed(1)}`
                          ) : (
                            formatNumber(Math.round(value))
                          )}
                        </TableCell>
                      );
                    })}
                    {onEditPrompt && (
                      <TableCell className="text-right pr-6">
                        <RowActionsMenu
                          prompt={p}
                          brandId={activeBrandId}
                          onEdit={() => onEditPrompt(p)}
                          onToggleActive={guard(() => void toggleActive(p), {
                            action: tActions(p.isActive ? 'pausePrompts' : 'resumePrompts'),
                          })}
                          onImprove={() => openPositionsPanel(p.id, 'improve')}
                          onSuggestContent={guard(() => void suggestContent(p), {
                            action: tActions('suggestContent'),
                          })}
                          onOpenSuggestion={openOpportunity}
                          suggesting={suggestingIds.has(p.id)}
                          noPlan={contentNoPlan}
                          suggestDisabledReason={
                            suggestDisabledReason ??
                            (bulkSuggesting ? 'Wait for the selected prompts' : null)
                          }
                          onCreateContent={guard(
                            () =>
                              setContentPreset({
                                kind: 'prompt',
                                id: p.id,
                                text: p.text,
                                method: 'create',
                              }),
                            { action: tActions('createContent') },
                          )}
                          onDelete={guard(() => setConfirmDelete([p]), {
                            action: tActions('deletePrompts'),
                          })}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <ClampedTextTooltip handle={fullText} />
        <EstimateNoteTooltip handle={volumeNote} />
        <TablePager
          page={promptsPager.page}
          totalPages={promptsPager.totalPages}
          total={filtered.length}
          start={promptsPager.start}
          end={promptsPager.end}
          onPage={promptsPager.setPage}
        />
        {filtered.length === 0 &&
          (performanceFilter !== 'all' && searched.length > 0 ? (
            // Rows are there, just none in this group: lead back to them.
            <div className="py-10 text-center text-sm text-muted-foreground">
              {tPerformance('none', { label: tPerformance(performanceFilter) })}{' '}
              <button
                type="button"
                onClick={() => changePerformance('all')}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {tPerformance('showAll')}
              </button>
            </div>
          ) : statusFilter === 'all' ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No prompts match your search.
            </div>
          ) : (
            // The table opens on Tracked: a brand whose prompts are all paused
            // must not look empty with no way back.
            <div className="py-10 text-center text-sm text-muted-foreground">
              {tUsage(`table.none.${statusFilter}`)}{' '}
              <button
                type="button"
                onClick={() => onStatusFilterChange('all')}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {tUsage('table.showAll', { count: format.number(statusCounts.all) })}
              </button>
            </div>
          ))}
      </CardContent>
      {onEditPrompt && (
        <AddLocationsDialog
          open={addLocations.open}
          onOpenChange={(open) => setAddLocations((prev) => ({ ...prev, open }))}
          brandId={activeBrandId}
          prompts={filtered}
          selectedIds={selectedIds}
          preset={addLocations.preset}
          onDone={() => {
            // The prompts' locations changed: read the matrix again.
            clearLocationMatrixCache();
            onChanged();
          }}
        />
      )}
      <PromptPositionsSheet
        prompt={openPositions}
        range={positionsRange}
        window={panelWindow}
        onRangeChange={setPositionsRange}
        region={panelRegion ?? regionFilter}
        initialTab={positionsTab}
        // Escape and a click outside belong to Start while it is open over the
        // panel: they close Start, and the panel stays.
        onClose={() => contentPreset === null && setPositionsId(null)}
        brandId={activeBrandId}
        onStartContent={setContentPreset}
        contentSent={contentSent}
      />
      <NewContentDialog
        open={contentPreset !== null}
        onOpenChange={(open) => !open && setContentPreset(null)}
        brandId={activeBrandId}
        siteType={siteTypeOf(activeBrand ?? {})}
        preset={contentPreset}
        onSent={() => setContentSent((n) => n + 1)}
      />
      <Dialog open={confirmDelete !== null} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {confirmDelete && confirmDelete.length > 1
                ? `Delete ${confirmDelete.length} prompts and their history?`
                : 'Delete prompt and its history?'}
            </DialogTitle>
            <DialogDescription className="break-words">
              {confirmDelete && confirmDelete.length > 1 ? (
                <>These prompts and their tracking results will be removed.</>
              ) : (
                <>
                  &ldquo;{confirmDelete?.[0]?.text}&rdquo; and its tracking results will be removed.
                </>
              )}{' '}
              You can undo for 10 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)}>
              {confirmDelete && confirmDelete.length > 1 ? 'Keep them' : 'Keep it'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                if (confirmDelete) {
                  deleteWithUndo(confirmDelete);
                  setSelectedIds((set) => {
                    const next = new Set(set);
                    for (const p of confirmDelete) next.delete(p.id);
                    return next;
                  });
                }
                setConfirmDelete(null);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Similar Topics List ──────────────────────────────────────────────────────

/**
 * Aggregates related keyword clusters across all prompts. Keywords can appear
 * in multiple prompts (e.g. "most reliable luxury cars"), so we sum their
 * volumes and keep a unique row per normalised keyword to avoid duplicate
 * React keys and double-counted totals.
 */
function SimilarTopicsList({ volumes }: { volumes: PromptVolume[] }) {
  const sorted = aggregatePromptVolumeClusters(volumes).slice(0, 8);

  const maxVol = sorted[0]?.volume || 1;

  return (
    <div className="w-full space-y-2">
      {sorted.map((item) => {
        const key = item.keyword.trim().toLowerCase();
        return (
          <div key={key} className="flex items-center gap-2 text-xs">
            <span
              className="w-32 shrink-0 text-muted-foreground truncate"
              title={`${item.keyword}${item.occurrences > 1 ? ` (in ${item.occurrences} prompts)` : ''}`}
            >
              {item.keyword}
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground/60 transition-all"
                style={{ width: `${(item.volume / maxVol) * 100}%` }}
              />
            </div>
            <span className="w-12 text-right font-medium tabular-nums text-foreground">
              {formatCompactNumber(item.volume)}
            </span>
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">No keyword data yet</p>
      )}
    </div>
  );
}
