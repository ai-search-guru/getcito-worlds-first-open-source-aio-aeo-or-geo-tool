'use client';

import { useEffect, useState, useCallback, useMemo, useTransition, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Sparkles,
  Plus,
  ListPlus,
  X,
  RefreshCw,
  Loader2,
  TrendingUp,
  Tag,
  AlertTriangle,
  SearchCheck,
  Shield,
  Radar,
  Search as SearchIcon,
  Trash2,
  BarChart3,
  Clock,
  ShoppingBag,
} from 'lucide-react';
import { Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { guessedVolumeEstimate } from '@/lib/volumeEstimate';
import {
  EstimateNoteTooltip,
  EstimateRange,
  createEstimateNoteHandle,
} from '@/components/prompts/VolumeEstimate';
import { readUrlChoice } from '@/lib/urlState';
import {
  getPromptSuggestions,
  refreshPromptSuggestions,
  acceptSuggestion,
  dismissSuggestion,
  dismissSuggestions,
  trackSuggestions,
  type PromptSuggestion,
} from '@/lib/actions/promptSuggestions';
import type { PlanId } from '@/config/plans';
import { priceText } from '@/lib/shopping/price';
import {
  catalogSourceData,
  fromYourData,
  gaSourceData,
  gscSourceData,
  type GaSuggestionSourceData,
  type GscSuggestionBadge,
} from '@/lib/promptSuggestionSource';
import type { SuggestionSourceStates } from '@/lib/actions/integrations';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useUserRole } from '@/hooks/useUserRole';
import { readWithOneRetry, type ReadFailure } from '@/lib/apiFailure';
import { NO_TOPICS, isNoTopics } from '@/lib/topicsRequired';
import { useFailureToast } from '@/hooks/useFailureToast';
import type { PromptAddFailureCode } from '@/lib/actions/prompt';
import { useTopicFirstDialog } from '@/components/prompts/TopicFirst';
import { SuggestionsLoadError } from './_SuggestionsLoadError';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Analytics evidence, in the customer's own numbers (#705). A blind spot is
 * argued from money, momentum from the engines already sending visitors —
 * showing the wrong one would make a true statement about the wrong thing.
 */
function gaEvidence(d: GaSuggestionSourceData): { label: string; tooltip: string } {
  if (d.kind === 'ai_momentum') {
    const engines = d.aiPlatforms.length ? d.aiPlatforms.join(', ') : 'AI assistants';
    return {
      label: `AI traffic · ${formatNumber(d.aiSessions)} sessions`,
      tooltip: `${engines} already sent ${formatNumber(d.aiSessions)} visits to ${d.landingPage} in the last 28 days. That topic is demonstrably answerable by an AI engine and you are already a candidate source for it — tracking a prompt around it turns an accident into a measured position.`,
    };
  }
  const earns =
    d.revenue > 0
      ? `${formatNumber(d.revenue)} in revenue`
      : `${formatNumber(d.keyEvents)} conversions`;
  return {
    label: `#${d.rank} by ${d.revenue > 0 ? 'revenue' : 'conversions'}`,
    tooltip: `${d.landingPage} produced ${earns} from ${formatNumber(d.sessions)} sessions in the last 28 days, and nothing you track would surface it in an AI answer. Anyone asking an assistant about this has no way to find you.`,
  };
}

const GSC_BADGES: Record<GscSuggestionBadge, { label: string; tooltip: string }> = {
  protect_traffic: {
    label: 'Protect traffic',
    tooltip:
      'This query drives real clicks to your site today. People increasingly ask AI assistants the same questions — track it so AI answers don\u2019t erode traffic you already earn.',
  },
  capture_demand: {
    label: 'Capture demand',
    tooltip:
      'People search this heavily on Google and you appear in results, but almost nobody clicks through. Being cited in AI answers is a second chance to capture this proven demand.',
  },
  low_competition: {
    label: 'Low competition',
    tooltip:
      'Advertiser competition on this term is low \u2014 becoming the answer AI assistants cite is a cheap win here.',
  },
};

/**
 * Portal-based hover/focus tooltip (same pattern as the Insights InfoTip) —
 * native title attributes are delayed and unreliable, which read as broken.
 */
function HoverTip({ content, children }: { content: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.bottom + 6 });
  }
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        tabIndex={0}
        className="inline-flex cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => {
          if (e.key === 'Escape') hide();
        }}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y, transform: 'translateX(-50%)' }}
            className="pointer-events-none fixed z-[9999] w-64 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Where a suggestion came from, as badges (#659).
 *
 * Every suggestion is phrased by our own generation step, so `GetCito Agents`
 * is always present; a data source badge joins it when the suggestion was
 * mined from the brand's own Search Console or Analytics, or drawn from its
 * catalog (ECOM-003), rather than from the model alone. Two badges is the
 * honest reading — the data and the phrasing come from different places.
 */
function SourceBadges({ suggestion }: { suggestion: PromptSuggestion }) {
  const tCatalog = useTranslations('prompts.suggestions.catalog');
  const gsc = gscSourceData(suggestion);
  const ga = gaSourceData(suggestion);
  const catalog = catalogSourceData(suggestion);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {gsc && (
        <HoverTip
          content={`From your Google Search Console data — the query "${gsc.query}" got ${formatNumber(gsc.impressions)} impressions in the last 28 days.`}
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <SearchCheck className="h-3.5 w-3.5 text-blue-500" />
            Google Search Console
          </Badge>
        </HoverTip>
      )}
      {/* Only when the row actually carries DataForSEO's contribution: the
          competition index it returned for that query. A badge on a row it
          never touched would be decoration claiming to be provenance. */}
      {gsc?.competitionIndex != null && (
        <HoverTip
          content={`DataForSEO scored advertiser competition for this query at ${gsc.competitionIndex}/100.`}
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <Radar className="h-3.5 w-3.5 text-violet-500" />
            DataForSEO
          </Badge>
        </HoverTip>
      )}
      {ga && (
        <HoverTip
          content={`From your Google Analytics — derived from ${ga.pageTitle ? `"${ga.pageTitle}" (${ga.landingPage})` : ga.landingPage}, read from the page itself rather than from its URL or product name.`}
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <BarChart3 className="h-3.5 w-3.5 text-amber-500" />
            Google Analytics (GA4)
          </Badge>
        </HoverTip>
      )}
      {catalog && (
        <HoverTip
          content={
            catalog.priceUnder !== null
              ? tCatalog('tooltipPrice', {
                  category: catalog.category,
                  products: catalog.products,
                  price: priceText(catalog.priceUnder, catalog.currency),
                })
              : tCatalog('tooltip', { category: catalog.category, products: catalog.products })
          }
        >
          <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
            <ShoppingBag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {tCatalog('badge')}
          </Badge>
        </HoverTip>
      )}
      <HoverTip content="Phrased by GetCito from your brand, the prompts you already track, and the competitors cited in your AI answers.">
        <Badge variant="outline" className="gap-1.5 bg-card text-xs font-normal">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          GetCito Agents
        </Badge>
      </HoverTip>
    </div>
  );
}

/** Which data source a row carries, for the source filter. */
type SourceFilter = 'all' | 'data' | 'gsc' | 'ga' | 'shopping' | 'agents';

const SOURCE_FILTERS: SourceFilter[] = ['all', 'data', 'gsc', 'ga', 'shopping', 'agents'];

// Shopping's label is translated (prompts.suggestions.catalog.filter).
const SOURCE_FILTER_LABELS: Record<Exclude<SourceFilter, 'shopping'>, string> = {
  all: 'All sources',
  // Either Google source: Getting started's high-value prompts step links here
  // with ?source=data.
  data: 'From your data',
  gsc: 'Google Search Console',
  ga: 'Google Analytics (GA4)',
  agents: 'GetCito Agents only',
};

function isMeasuredSuggestion(s: PromptSuggestion): boolean {
  return s.source === 'gsc' || s.source === 'ga';
}

interface Props {
  brandId: string;
  onAccepted?: () => void;
  /** "Add a topic" on a brand without one: the page's Topics tab, with Add Topic open. */
  onAddTopic?: () => void;
  /** Connected sources and whether their data has landed; null when unknown. */
  sourceStates: SuggestionSourceStates | null;
  /** The organization's plan, for the prompt limit note's wording; absent while unknown. */
  planId?: PlanId;
  /** Where to go for more prompts (upgrade or contact us), shown in the prompt limit note. */
  limitActions?: React.ReactNode;
}

/** The most suggestions trackSuggestions takes in one call. */
const TRACK_BATCH = 25;

const SOURCE_NAMES = { gsc: 'Search Console', ga: 'Analytics' } as const;

function joinNames(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

/**
 * What to tell the reader about their own data sources, if anything:
 *  - `waiting`: a mapped source whose first sync has not landed yet, so
 *    nothing it knows can be in the list.
 *  - `ready`: the data has landed since these suggestions were generated, and
 *    none of them came from it — generating again would use it.
 * A source whose data predates the list but contributed nothing is left
 * alone: the list already had its chance at it (thin data, or all covered).
 */
function sourceNotice(
  states: SuggestionSourceStates | null,
  suggestions: PromptSuggestion[],
): { kind: 'waiting' | 'ready'; names: string[] } | null {
  if (!states) return null;
  const latestGenerated = Math.max(0, ...suggestions.map((s) => Date.parse(s.generatedAt)));
  const waiting: string[] = [];
  const ready: string[] = [];
  for (const key of ['gsc', 'ga'] as const) {
    const state = states[key];
    if (!state.configured || !state.connected || !state.mapped) continue;
    if (!state.firstDataAt) {
      waiting.push(SOURCE_NAMES[key]);
    } else if (
      suggestions.length > 0 &&
      latestGenerated < Date.parse(state.firstDataAt) &&
      !suggestions.some((s) => s.source === key)
    ) {
      ready.push(SOURCE_NAMES[key]);
    }
  }
  if (ready.length > 0) return { kind: 'ready', names: ready };
  if (waiting.length > 0) return { kind: 'waiting', names: waiting };
  return null;
}

export function SuggestionsCard({
  brandId,
  onAccepted,
  onAddTopic,
  sourceStates,
  planId,
  limitActions,
}: Props) {
  const t = useTranslations('prompts.suggestions');
  // A read-only workspace (plan not active): generating, adding and
  // dismissing open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Adding a prompt is for admins and managers; dismissing a suggestion is
  // open to analysts too, as the server and the table's update rule allow.
  const { role, canManage } = useUserRole();
  const canDismiss = canManage || role === 'analyst';
  // Generating suggestions costs AI: admins and managers start it.
  const tManagers = useTranslations('managersOnly');
  // One method note for the list's volume ranges (PROMPT-013).
  const volumeNote = useMemo(() => createEstimateNoteHandle(), []);
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ReadFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  // A link can open the list on a source (?source=data).
  useEffect(() => {
    setSourceFilter(readUrlChoice<SourceFilter>('source', SOURCE_FILTERS, 'all'));
  }, []);
  const [search, setSearch] = useState('');
  const [clearing, setClearing] = useState(false);
  // Clear All asks first: how many it dismisses, and how many of them come
  // from Search Console or Analytics (hidden for 30 days once dismissed).
  const [confirmClear, setConfirmClear] = useState(false);
  const [adding, setAdding] = useState(false);
  // What Add All left behind when the plan's prompt limit stopped it.
  const [limitNote, setLimitNote] = useState<{ added: number; left: number } | null>(null);
  const [, startTransition] = useTransition();
  // A brand with no topic yet: generating or adding asks for one first.
  const topicFirst = useTopicFirstDialog({ onAddTopic });
  // A failed generation in plain words, with the one thing to do (or the upgrade dialog).
  const failureToast = useFailureToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Once more by itself when the API didn't answer, as while it restarts.
    const read = await readWithOneRetry(() => getPromptSuggestions(brandId));
    if (read.ok) {
      setSuggestions(read.suggestions);
      setLoaded(true);
    } else {
      setError(read);
    }
    setLoading(false);
  }, [brandId]);

  useEffect(() => {
    setLoaded(false);
    setSuggestions([]);
    setError(null);
    setLimitNote(null);
  }, [brandId]);

  // Fetching on mount is safe here because this component only mounts when
  // the Suggestions tab is open — the tab click is the user asking for it.
  // It must not move back above a tab boundary: as an always-mounted card its
  // request became the first entry in Next's serialised server-action queue,
  // and every hiccup in it stalled the prompt table's own fetch behind it.
  useEffect(() => {
    if (!loaded && !loading) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, brandId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await refreshPromptSuggestions(brandId);
      if (!fresh.ok) {
        if (fresh.failure === NO_TOPICS) topicFirst.show();
        else failureToast(fresh.failure);
        return;
      }
      setSuggestions(fresh.suggestions);
      setLoaded(true);
      setError(null);
      toast.success('Suggestions refreshed');
    } catch {
      // The request to Next itself failed: production hides why.
      failureToast('failed');
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suggestions.filter((s) => {
      if (sourceFilter === 'data' && !fromYourData(s)) return false;
      if (sourceFilter === 'gsc' && !gscSourceData(s)) return false;
      if (sourceFilter === 'ga' && !gaSourceData(s)) return false;
      if (sourceFilter === 'shopping' && !catalogSourceData(s)) return false;
      if (sourceFilter === 'agents' && (fromYourData(s) || catalogSourceData(s))) return false;
      if (!q) return true;
      return (
        s.suggestedText.toLowerCase().includes(q) ||
        (s.topicName ?? '').toLowerCase().includes(q) ||
        (s.reason ?? '').toLowerCase().includes(q)
      );
    });
  }, [suggestions, sourceFilter, search]);

  // Shopping is offered once the catalog gave a suggestion (ECOM-003), or a link asked for it.
  const filters = SOURCE_FILTERS.filter(
    (key) =>
      key !== 'shopping' ||
      sourceFilter === 'shopping' ||
      suggestions.some((s) => catalogSourceData(s) !== null),
  );
  const filterLabel = (key: SourceFilter) =>
    key === 'shopping' ? t('catalog.filter') : SOURCE_FILTER_LABELS[key];

  const notice = useMemo(
    () => sourceNotice(sourceStates, suggestions),
    [sourceStates, suggestions],
  );

  /**
   * Dismiss every suggestion listed, after the confirmation: each one as
   * one by one would, so Search Console and Analytics ones stay hidden for
   * 30 days. They leave the list at once; the ones that couldn't be
   * dismissed come back.
   */
  const handleClearAll = async () => {
    setConfirmClear(false);
    const doomed = visible;
    if (doomed.length === 0) return;
    setClearing(true);
    const ids = new Set(doomed.map((d) => d.id));
    setSuggestions((prev) => prev.filter((x) => !ids.has(x.id)));
    try {
      const result = await dismissSuggestions([...ids]);
      if (!result.ok) {
        setSuggestions((prev) => [...prev, ...doomed]);
        toast.error(t('clearAllFailed'));
      } else if (result.failed.length > 0) {
        const failed = new Set(result.failed);
        setSuggestions((prev) => [...prev, ...doomed.filter((d) => failed.has(d.id))]);
        toast.error(t('clearAllPartial', { count: failed.size }));
      }
    } finally {
      setClearing(false);
    }
  };
  const measuredToClear = visible.filter(isMeasuredSuggestion).length;

  /**
   * Track every suggestion on screen, in batches trackSuggestions takes. Each
   * prompt passes the same plan check as a single add, so a run stops where
   * the plan's prompt limit is reached: what was added leaves the list, the
   * rest stay and the note says how to make room for them.
   */
  const handleAddAll = async () => {
    const ids = visible.map((s) => s.id);
    if (ids.length === 0) return;
    setAdding(true);
    setLimitNote(null);
    const added: string[] = [];
    const gone: string[] = [];
    let failure: { error: string; code?: PromptAddFailureCode } | null = null;
    try {
      for (let i = 0; i < ids.length && !failure; i += TRACK_BATCH) {
        const result = await trackSuggestions(ids.slice(i, i + TRACK_BATCH));
        added.push(...result.trackedIds);
        // Accepted or dismissed elsewhere: they leave the list too.
        gone.push(...result.skippedIds);
        if (result.error) failure = { error: result.error, code: result.code };
      }
    } catch (err) {
      failure = { error: err instanceof Error ? err.message : t('addAllFailed') };
    }

    const leaving = new Set([...added, ...gone]);
    if (leaving.size > 0) setSuggestions((prev) => prev.filter((x) => !leaving.has(x.id)));
    if (added.length > 0) {
      onAccepted?.();
      toast.success(t('addAllDone', { count: added.length }));
    }
    if (failure?.code === 'plan_limit') {
      setLimitNote({ added: added.length, left: ids.length - leaving.size });
    } else if (isNoTopics(failure)) {
      topicFirst.show();
    } else if (failure) {
      toast.error(failure.error);
    } else if (added.length === 0) {
      toast.info(t('addAllHandled'));
    }
    setAdding(false);
  };

  const handleAccept = (s: PromptSuggestion) => {
    setPendingId(s.id);
    startTransition(async () => {
      try {
        const result = await acceptSuggestion(s.id);
        if ('error' in result) {
          if (isNoTopics(result)) topicFirst.show();
          else toast.error(result.error);
          return;
        }
        setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
        onAccepted?.();
        toast.success('Prompt added to your tracked list');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add');
      } finally {
        setPendingId(null);
      }
    });
  };

  const handleDismiss = (s: PromptSuggestion) => {
    setPendingId(s.id);
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    dismissSuggestion(s.id)
      .catch(() => {
        // Roll back on failure
        setSuggestions((prev) => [...prev, s]);
        toast.error('Failed to dismiss');
      })
      .finally(() => setPendingId(null));
  };

  return (
    <Card id="prompt-opportunities">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Prompt Suggestions</CardTitle>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                loaded &&
                suggestions.length > 0 && (
                  <Badge variant="secondary" className="text-xs tabular-nums">
                    {suggestions.length}
                  </Badge>
                )
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              AI-driven suggestions based on your data and industry trends.
            </p>
          </div>

          {loaded && suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={sourceFilter}
                onValueChange={(v) => setSourceFilter((v as SourceFilter) ?? 'all')}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue placeholder="All sources">
                    {(value) => filterLabel((value as SourceFilter) ?? 'all')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {filters.map((key) => (
                    <SelectItem key={key} value={key}>
                      {filterLabel(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative w-52">
                <SearchIcon className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search prompts…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 pl-8 text-xs"
                />
              </div>

              {canManage && (
                <Button
                  onClick={guard(handleRefresh, { action: tActions('suggestPrompts') })}
                  disabled={refreshing}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {refreshing ? 'Generating…' : 'New'}
                </Button>
              )}

              {canManage && (
                <Button
                  onClick={guard(handleAddAll, { action: tActions('addPrompts') })}
                  disabled={adding || clearing || visible.length === 0}
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  title={t('addAllTitle')}
                >
                  {adding ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ListPlus className="h-3.5 w-3.5" />
                  )}
                  {adding ? t('addingAll') : t('addAll')}
                </Button>
              )}

              {canDismiss && (
                <Button
                  onClick={guard(() => setConfirmClear(true), {
                    action: tActions('dismissSuggestions'),
                  })}
                  disabled={clearing || adding || visible.length === 0}
                  size="sm"
                  variant="outline"
                  className="gap-2 text-muted-foreground"
                  title="Dismiss every suggestion listed below"
                >
                  {clearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Clear All
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('clearAllConfirm.title')}</DialogTitle>
            <DialogDescription>
              {t('clearAllConfirm.body', { count: visible.length })}
            </DialogDescription>
          </DialogHeader>
          {measuredToClear > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('clearAllConfirm.measured', { count: measuredToClear })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {t('clearAllConfirm.cancel')}
            </Button>
            <Button onClick={() => void handleClearAll()}>{t('clearAllConfirm.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CardContent>
        {limitNote && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <div className="min-w-0 flex-1 space-y-2.5 text-sm">
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  {t('limitTitle', { count: limitNote.left })}
                </p>
                <p className="text-amber-800/80 dark:text-amber-300/80">
                  {t('limitBody', {
                    added: limitNote.added,
                    count: limitNote.left,
                    plan: planId ?? 'unknown',
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/dashboard/prompts/tracked"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  {t('openTracked')}
                </Link>
                {limitActions}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="-my-1 h-7 w-7 shrink-0 text-amber-800/80 dark:text-amber-300/80"
              onClick={() => setLimitNote(null)}
              aria-label={t('closeLimitNote')}
              title={t('closeLimitNote')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {loaded && !loading && !error && notice && (
          <div
            className={cn(
              'mb-4 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between',
              notice.kind === 'ready' ? 'border-primary/30 bg-primary/5' : 'bg-muted/30',
            )}
          >
            <div className="flex items-start gap-2.5">
              {notice.kind === 'ready' ? (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <p className={notice.kind === 'ready' ? '' : 'text-muted-foreground'}>
                {notice.kind === 'ready'
                  ? `Your ${joinNames(notice.names)} data is ready. These suggestions were generated before it arrived — generate new ones to include it.`
                  : `${joinNames(notice.names)} is connected and its first sync is in progress. Suggestions from it will be available once it finishes, usually within a few minutes.`}
              </p>
            </div>
            {notice.kind === 'ready' && canManage && (
              <Button
                onClick={guard(handleRefresh, { action: tActions('suggestPrompts') })}
                disabled={refreshing}
                size="sm"
                className="shrink-0 gap-2"
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {refreshing ? 'Generating…' : 'Generate new suggestions'}
              </Button>
            )}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <SuggestionsLoadError failure={error} onRetry={load} />
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium mb-1">No suggestions right now</p>
            {canManage ? (
              <>
                <p className="text-xs text-muted-foreground mb-3 max-w-sm">
                  Click refresh to generate new prompt ideas tailored to your brand and competitor
                  activity.
                </p>
                <Button
                  onClick={guard(handleRefresh, { action: tActions('suggestPrompts') })}
                  disabled={refreshing}
                  size="sm"
                  className="gap-2"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Generate Suggestions
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground max-w-sm">
                {tManagers('suggestPrompts')}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {/* Column headings, so the source column reads as a column rather
                than as loose badges beside the text. */}
            <div className="hidden gap-3 px-3 text-xs text-muted-foreground sm:grid sm:grid-cols-[2.25rem_1fr_18rem_5rem]">
              <span />
              <span>Prompt</span>
              <span>Source</span>
              <span />
            </div>

            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No suggestions match this filter.
              </p>
            ) : (
              <ul className="space-y-2">
                {visible.map((s, index) => {
                  const busy = pendingId === s.id;
                  const gsc = gscSourceData(s);
                  const ga = gaSourceData(s);
                  return (
                    <li
                      key={s.id}
                      className="grid items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/30 sm:grid-cols-[2.25rem_1fr_18rem_5rem]"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>

                      <div className="min-w-0 space-y-1.5">
                        <p className="text-sm font-medium leading-snug">{s.suggestedText}</p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {s.topicName && (
                            <Badge variant="outline" className="gap-1 text-xs font-normal">
                              <Tag className="h-3 w-3" />
                              {s.topicName}
                            </Badge>
                          )}
                          {/* Measured rows carry real figures — showing the
                              modelled estimate beside measured data reads as a
                              contradiction. */}
                          {gsc ? (
                            <Badge
                              variant="outline"
                              className="gap-1 text-xs font-normal tabular-nums"
                            >
                              <TrendingUp className="h-3 w-3" />
                              {formatNumber(gsc.impressions)} impr/mo
                            </Badge>
                          ) : ga ? (
                            <HoverTip content={gaEvidence(ga).tooltip}>
                              <Badge
                                variant="outline"
                                className="gap-1 text-xs font-normal tabular-nums"
                              >
                                <TrendingUp className="h-3 w-3" />
                                {gaEvidence(ga).label}
                              </Badge>
                            </HoverTip>
                          ) : (
                            s.estVolume != null &&
                            s.estVolume > 0 && (
                              <Badge
                                variant="outline"
                                className="gap-1 text-xs font-normal tabular-nums"
                              >
                                <TrendingUp className="h-3 w-3" />
                                {/* An AI's guess: a range, always low confidence (PROMPT-013). */}
                                <EstimateRange
                                  estimate={guessedVolumeEstimate(s.estVolume, s.generatedAt)}
                                  handle={volumeNote}
                                  perMonth
                                />
                              </Badge>
                            )
                          )}
                          {gsc?.badge && (
                            <HoverTip content={GSC_BADGES[gsc.badge].tooltip}>
                              <Badge variant="outline" className="text-xs font-normal">
                                {GSC_BADGES[gsc.badge].label}
                              </Badge>
                            </HoverTip>
                          )}
                        </div>
                        {s.reason && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {s.reason}
                          </p>
                        )}
                      </div>

                      <SourceBadges suggestion={s} />

                      <div className="flex items-center justify-end gap-1">
                        {canManage && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="h-8 w-8"
                            onClick={guard(() => handleAccept(s), {
                              action: tActions('addPrompts'),
                            })}
                            disabled={busy}
                            title="Add to tracked prompts"
                            aria-label="Add to tracked prompts"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {canDismiss && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={guard(() => handleDismiss(s), {
                              action: tActions('dismissSuggestions'),
                            })}
                            disabled={busy}
                            title="Dismiss suggestion"
                            aria-label="Dismiss suggestion"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <EstimateNoteTooltip handle={volumeNote} />
        {topicFirst.dialog}
      </CardContent>
    </Card>
  );
}
