'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { MetricBreakdownSheet, type BreakdownTab } from './_MetricBreakdownSheet';
import { FormulaDialog } from './_FormulaDialog';
import { useBrandStore } from '@/state/useBrandStore';
import { useFirstRun } from '@/hooks/useFirstRun';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import { largestMove, rangeChipLabel } from '@/lib/chat/pageContext';
import {
  getInsightsData,
  getTrackingWindow,
  type TrackingWindow,
  type VisibilityRateTrendData,
  triggerTrackingCheck,
  getJobStatus,
  cancelTrackingJob,
  getBrandPrompts,
  getBrandFilterOptions,
  exportPromptResults,
  type InsightsSummary,
  type TrackedPromptsKpi,
  type CompetitorComparisonData,
  type ShareOfVoiceData,
  type InsightsOpportunities,
  type TrackingJobStatus,
  type BreakdownFilters,
  type BreakdownMetric,
  type CoverageKpi,
} from '@/lib/actions/tracking';
import { getTopics } from '@/lib/actions/topic';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { isSingleModel, modelFamilies, modelFamilyValue, modelLabel } from '@/lib/modelFamilies';
import { formatRegionDisplay } from '@/lib/region';
import { mentionsHref } from '@/lib/mentionsFilters';
import type { Topic } from '@/types';
import {
  ALL_DATE_PRESETS,
  DateRangeFilter,
  type DateRangePreset,
} from '@/components/filters/DateRangeFilter';
import { getDateRange } from '@/lib/dateRange';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  BarChart3,
  CalendarX2,
  Play,
  Loader2,
  FlaskConical,
  Users,
  StopCircle,
  ArrowRight,
  Download,
  FileText,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { usePlanContext } from '@/components/context/PlanProvider';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { toast } from 'sonner';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import type { PromptComparison } from '@/lib/insightsSamePrompts';
import type { KpiSeriesDay } from '@/lib/insightsKpis';
import type { PlatformChange, PlatformTableRow } from '@/lib/insightsSummary';
import { formatWindowBound } from './kpiFormat';
import { KpiRows } from './_KpiCards';
import { SummaryLine } from './_SummaryLine';
import { PlatformTable } from './_PlatformTable';
import { Leaderboard } from './_leaderboard';
import { TrendCard } from './_TrendCard';
import { trendLines, type TrendMarkerData } from '@/lib/insightsTrend';
import { TopicHeatmap } from './_TopicHeatmap';
import { Opportunities } from './_opportunities';
import type { TopicCompetitors } from '@/lib/insightsTopics';
import { WhyChanged } from './_WhyChanged';
import type { WhyChanged as WhyChangedData } from '@/lib/insightsDrivers';

// ─── Filter Types ─────────────────────────────────────────────────────────────

// The preset vocabulary is shared with the control that renders it (#713), so
// a page cannot drift from the options it actually offers.
type DatePreset = DateRangePreset;

interface InsightsFilters {
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
  region: string;
  model: string;
  topic: string;
}

const DEFAULT_FILTERS: InsightsFilters = {
  // The last 24 hours: what the latest run found. Longer ranges are one
  // click away.
  datePreset: '24h',
  dateFrom: '',
  dateTo: '',
  region: '',
  model: '',
  topic: '',
};

/**
 * The filters as kept in the URL (#917): ?range=, plus ?from=/&to= for a
 * custom range, ?region=, ?model= and ?topic=. Defaults are left out, and an
 * unknown range falls back to the default.
 */
function filtersFromUrl(): InsightsFilters {
  const datePreset = readUrlChoice<DatePreset>(
    'range',
    ALL_DATE_PRESETS as readonly DatePreset[],
    DEFAULT_FILTERS.datePreset,
  );
  return {
    datePreset,
    dateFrom: datePreset === 'custom' ? readUrlParam('from') : '',
    dateTo: datePreset === 'custom' ? readUrlParam('to') : '',
    region: readUrlParam('region'),
    model: readUrlParam('model'),
    topic: readUrlParam('topic'),
  };
}

function writeFiltersToUrl(f: InsightsFilters) {
  const custom = f.datePreset === 'custom';
  writeUrlParams(
    {
      range: f.datePreset,
      from: custom ? f.dateFrom : null,
      to: custom ? f.dateTo : null,
      region: f.region,
      model: f.model,
      topic: f.topic,
      // Dropped from links made while "Same prompts" could be turned off.
      compare: null,
    },
    { range: DEFAULT_FILTERS.datePreset },
  );
}

const INSIGHT_EXPORT_HEADERS = [
  'created_at',
  'prompt',
  'topic',
  'platform',
  'model',
  'region',
  'mention_count',
  'citation_count',
  'visibility_score',
  'sentiment',
  'citation_urls',
  'competitor_mentions',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Run Single Prompt Dialog ─────────────────────────────────────────────────

function RunSinglePromptDialog({
  brandId,
  open,
  onClose,
  onJobStarted,
}: {
  brandId: string;
  open: boolean;
  onClose: () => void;
  onJobStarted: (jobId: string) => void;
}) {
  const [prompts, setPrompts] = useState<
    { id: string; text: string; category?: string; platforms: string[] }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getBrandPrompts(brandId)
      .then(setPrompts)
      .catch(() => toast.error('Failed to load prompts'))
      .finally(() => setLoading(false));
  }, [open, brandId]);

  const handleRun = async (promptId: string) => {
    setRunningId(promptId);
    try {
      const { jobId } = await triggerTrackingCheck(brandId, { promptId });
      onClose();
      onJobStarted(jobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run prompt');
    } finally {
      setRunningId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg max-h-[70vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4" />
            Run Single Prompt
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Pick a prompt to test. Only that prompt will run across your enabled platforms.
          </p>
        </DialogHeader>

        <div className="space-y-2 pt-2">
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}

          {!loading && prompts.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active prompts found. Add prompts in brand settings first.
            </p>
          )}

          {!loading &&
            prompts.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium line-clamp-2">{p.text}</p>
                  {p.category && (
                    <Badge variant="outline" className="text-[10px] mt-1">
                      {p.category}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0"
                  disabled={runningId !== null}
                  onClick={() => handleRun(p.id)}
                >
                  {runningId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Run
                </Button>
              </div>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

/** An AI model filter's name: its provider family's, as the filter shows it. */
function modelName(value: string): string {
  return modelLabel(value.split(',')[0]);
}

function FilterBar({
  filters,
  onChange,
  availableRegions,
  availableModels,
  availableTopics,
}: {
  filters: InsightsFilters;
  onChange: (f: InsightsFilters) => void;
  availableRegions: string[];
  availableModels: string[];
  availableTopics: Topic[];
}) {
  const t = useTranslations('common');
  const set = (patch: Partial<InsightsFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <DateRangeFilter
        value={filters.datePreset}
        presets={ALL_DATE_PRESETS as readonly DatePreset[]}
        onChange={(datePreset) => set({ datePreset })}
        from={filters.dateFrom}
        to={filters.dateTo}
        onFromChange={(dateFrom) => set({ dateFrom })}
        onToChange={(dateTo) => set({ dateTo })}
      />

      {/* Topic filter */}
      {availableTopics.length > 0 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t('topic')}
          </label>
          <Select
            value={filters.topic || null}
            onValueChange={(v) => set({ topic: !v || v === '__all__' ? '' : v })}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder={t('allTopics')}>
                {(value) =>
                  value && value !== '__all__'
                    ? (availableTopics.find((topic) => topic.id === value)?.name ?? t('allTopics'))
                    : t('allTopics')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('allTopics')}</SelectItem>
              {availableTopics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Region filter */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('region')}
        </label>
        <Select
          value={filters.region || null}
          onValueChange={(v) => set({ region: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder={t('allRegions')}>
              {(value) =>
                value && value !== '__all__' ? formatRegionDisplay(String(value)) : t('allRegions')
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allRegions')}</SelectItem>
            {availableRegions.map((r) => (
              <SelectItem key={r} value={r}>
                {formatRegionDisplay(r)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Model filter */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          {t('aiModel')}
        </label>
        <Select
          value={filters.model || null}
          onValueChange={(v) => set({ model: !v || v === '__all__' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder={t('allPlatforms')}>
              {(value) => {
                if (!value || value === '__all__') return t('allPlatforms');
                return modelName(String(value));
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('allPlatforms')}</SelectItem>
            {/* Each value is a comma-separated slug list: a provider family. */}
            {availableModels.map((m) => (
              <SelectItem key={m} value={m}>
                {modelName(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function InsightsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  onRunPrompts,
  isRunning,
  isCloud,
}: {
  onRunPrompts: () => void;
  isRunning: boolean;
  isCloud: boolean;
}) {
  const t = useTranslations('insights');
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <BarChart3 className="h-12 w-12 text-muted-foreground/40 mb-4" />
      <h2 className="text-lg font-semibold">No tracking data yet</h2>
      <p className="text-muted-foreground text-sm mt-1 max-w-md">
        Run your prompts through AI platforms to see how your brand appears in AI-generated
        responses.
      </p>
      {!isCloud && (
        <Button onClick={onRunPrompts} disabled={isRunning} className="mt-6 gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {t('runPromptsNow')}
        </Button>
      )}
    </div>
  );
}

function NoDataForPeriod({ datePreset, onReset }: { datePreset: DatePreset; onReset: () => void }) {
  const labels: Record<DatePreset, string> = {
    '24h': 'last 24 hours',
    '7d': 'last 7 days',
    '30d': 'last 30 days',
    '90d': 'last 90 days',
    all: 'selected period',
    custom: 'selected period',
  };
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <CalendarX2 className="h-10 w-10 text-muted-foreground/40 mb-3" />
      <h3 className="text-base font-semibold">No results for the {labels[datePreset]}</h3>
      <p className="text-muted-foreground text-sm mt-1 max-w-sm">
        There is tracking data available in other time periods. Try a wider range or switch to
        &quot;All time&quot;.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>
        Show all data
      </Button>
    </div>
  );
}

// ─── Tracking Progress ────────────────────────────────────────────────────────

import {
  saveTrackingJob,
  loadTrackingJob,
  clearTrackingJob,
  doneMessage,
} from '@/lib/trackingJobStore';
import { etaParts, minutesLeft, withSample, type ProgressSample } from '@/lib/trackingEta';
import { toCsv } from '@/lib/csv';
import { exportFileName } from '@/lib/white-label/exportName';
import { RunLine } from './_RunLine';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

function TrackingProgressBanner({
  jobStatus,
  pace,
  onStop,
}: {
  jobStatus: TrackingJobStatus | null;
  /** The run's progress readings while this page polls it, for the time left. */
  pace: ProgressSample[];
  onStop: () => void;
}) {
  const t = useTranslations('insights.tracking');
  if (!jobStatus) return null;

  const isActive = jobStatus.status === 'active' || jobStatus.status === 'waiting';
  if (!isActive) return null;

  const progress = jobStatus.progress;
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;
  const eta = progress ? minutesLeft(pace, progress.total) : null;
  const left = eta === null ? null : etaParts(eta);

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-medium">
            {jobStatus.status === 'waiting' ? t('queued') : t('analyzing')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onStop}
        >
          <StopCircle className="h-3.5 w-3.5" />
          {t('stop')}
        </Button>
      </div>

      {jobStatus.status === 'waiting' && (
        <p className="text-xs text-muted-foreground">{t('queuedBody')}</p>
      )}

      {jobStatus.status === 'active' && (
        <p className="text-xs text-muted-foreground">
          {/* The pace so far, once there is enough of it; the general range before. */}
          {left === null
            ? t('activeBody')
            : 'hours' in left
              ? t('activeBodyHours', left)
              : t('activeBodyMinutes', left)}
        </p>
      )}

      {progress && progress.total > 0 && (
        <>
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          {progress.promptText && (
            <p className="text-xs text-muted-foreground truncate">
              {progress.model && (
                <span className="font-medium text-foreground">
                  {PLATFORM_LABELS[progress.model] ?? progress.model}
                  {progress.region && <span> · {progress.region}</span>}
                  {' — '}
                </span>
              )}
              {progress.promptText}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Banner for runs this browser did NOT start (the daily cron, or a teammate's
 * Run All), or whose saved job this browser no longer restores: detected
 * from the tracking_runs ledger, not localStorage. The dashboard keeps
 * showing the last completed run's numbers until the active run finishes,
 * then swaps in one step. A brand's first run has none to show, and says so.
 */
function ServerRunBanner({
  run,
  firstRun,
}: {
  run: TrackingWindow['activeRun'];
  /** No completed run yet: nothing older is on the page. */
  firstRun: boolean;
}) {
  const t = useTranslations('insights.tracking');
  if (!run) return null;
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm font-medium">
          {firstRun ? t('firstRun') : run.source === 'cron' ? t('dailyRun') : t('run')}
        </span>
        <span className="text-xs text-muted-foreground">
          {firstRun ? t('firstRunBody') : t('runBody')}
        </span>
      </div>
    </div>
  );
}

// ─── No Competitors Teaser ────────────────────────────────────────────────────

/**
 * Shown in place of the Competitor Comparison section when the brand has no
 * tracked competitors yet (#507). Gives users a clear path to
 * /dashboard/competitors so the head-to-head feature is discoverable even
 * before any competitors are added.
 */
function NoCompetitorsTeaser() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/30 p-8 text-center">
      <Users className="h-8 w-8 text-muted-foreground/40" />
      <div>
        <p className="text-sm font-medium text-foreground">No competitors tracked yet</p>
        <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
          Add competitors to see how you compare in AI answers.
        </p>
      </div>
      <Link
        href="/dashboard/competitors"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Head-to-Head Comparison
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const t = useTranslations('insights');
  // The job poll's toasts read it: the loop outlives a render.
  const tRef = useRef(t);
  tRef.current = t;
  // The tracking job's pace while this page polls it ("about N min left").
  const [pace, setPace] = useState<ProgressSample[]>([]);
  const tCommon = useTranslations('common');
  const tChat = useTranslations('chatPanel.suggest');
  const tChatRange = useTranslations('chatPanel.range');
  const tPlatforms = useTranslations('insights.platforms');
  const tLeaderboard = useTranslations('insights.leaderboard');
  const router = useRouter();
  const { isCloud } = usePlanContext();
  // A read-only workspace (plan not active): Run All and Test Single Prompt
  // open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const locale = useLocale();
  const brand = useBrandStore((s) => s.getActiveBrand());
  // The brand's first run while it goes on: the run's band above says it
  // all, so no empty state under it.
  const firstRun = useFirstRun();
  const [summary, setSummary] = useState<InsightsSummary | null>(null);
  const [trackedPrompts, setTrackedPrompts] = useState<TrackedPromptsKpi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<TrackingJobStatus | null>(null);
  const [showSinglePrompt, setShowSinglePrompt] = useState(false);
  const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
  const [hasAnyData, setHasAnyData] = useState<boolean | null>(null);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([]);
  const [competitorData, setCompetitorData] = useState<CompetitorComparisonData | null>(null);
  const [rateTrend, setRateTrend] = useState<VisibilityRateTrendData | null>(null);
  const [sovData, setSovData] = useState<ShareOfVoiceData | null>(null);
  const [opportunities, setOpportunities] = useState<InsightsOpportunities | null>(null);
  const [comparison, setComparison] = useState<PromptComparison | null>(null);
  const [coverage, setCoverage] = useState<CoverageKpi | null>(null);
  const [kpiSeries, setKpiSeries] = useState<KpiSeriesDay[] | null>(null);
  const [platformChanges, setPlatformChanges] = useState<PlatformChange[] | null>(null);
  const [platforms, setPlatforms] = useState<PlatformTableRow[] | null>(null);
  const [whyChanged, setWhyChanged] = useState<WhyChangedData | null>(null);
  const [trendMarkers, setTrendMarkers] = useState<TrendMarkerData | null>(null);
  const [topicCompetitors, setTopicCompetitors] = useState<TopicCompetitors[] | null>(null);
  const [breakdownMetric, setBreakdownMetric] = useState<BreakdownMetric | null>(null);
  const [breakdownTab, setBreakdownTab] = useState<BreakdownTab | undefined>(undefined);
  // The window and filters the cards were last loaded with (the 24h view
  // anchored to its tracking run): the breakdown panel explains those exact
  // numbers rather than recomputing "now" on every render (VIS-001).
  const [loadedFilters, setLoadedFilters] = useState<BreakdownFilters>();
  const [isExporting, setIsExporting] = useState(false);
  const [cronRun, setCronRun] = useState<TrackingWindow['activeRun']>(null);
  const cronRunRef = useRef<TrackingWindow['activeRun']>(null);
  // The header's last and next run (VIS-012), from the ledger read every minute.
  const [runTimes, setRunTimes] = useState<Pick<TrackingWindow, 'lastRunAt' | 'nextRunAt'>>({
    lastRunAt: null,
    nextRunAt: null,
  });
  // Kept as is when unchanged, so the minute's read doesn't re-render the page.
  const updateRunTimes = useCallback(
    ({ lastRunAt, nextRunAt }: Pick<TrackingWindow, 'lastRunAt' | 'nextRunAt'>) =>
      setRunTimes((prev) =>
        prev.lastRunAt === lastRunAt && prev.nextRunAt === nextRunAt
          ? prev
          : { lastRunAt, nextRunAt },
      ),
    [],
  );
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // The single models already read as their family (modelFamilyValue): each
  // asks the brand's models once.
  const familyRead = useRef(new Set<string>());

  // The filters are read from the URL after mount (window isn't available
  // during the server render), and the first load waits for them.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const fromUrl = filtersFromUrl();
    filtersRef.current = fromUrl;
    setFilters(fromUrl);
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (urlRead) writeFiltersToUrl(filters);
  }, [urlRead, filters]);

  // Keyed on the id, not the brand object: the store hands out a new object
  // for the same brand, and a new loadData re-runs the load effect below.
  const brandId = brand?.id;
  const loadData = useCallback(
    async (overrideFilters?: InsightsFilters, { silent = false } = {}) => {
      if (!brandId) return;
      if (!silent) setIsLoading(true);
      try {
        let f = overrideFilters ?? filtersRef.current;
        // A model from an address can be one slug of a family (Chat's link,
        // model=chatgpt-web): it reads as its family, as the dropdown sets
        // it, so the numbers are those of picking ChatGPT there.
        if (isSingleModel(f.model) && !familyRead.current.has(f.model)) {
          familyRead.current.add(f.model);
          const asked = f.model;
          const family = await getBrandFilterOptions(brandId)
            .then((options) => modelFamilyValue(asked, modelFamilies(options.models)))
            .catch(() => asked);
          familyRead.current.add(family);
          if (family !== asked) {
            f = { ...f, model: family };
            filtersRef.current = f;
            setFilters(f);
          }
        }
        const { dateFrom, dateTo, days } = getDateRange(f.datePreset, {
          from: f.dateFrom,
          to: f.dateTo,
        });

        const filterOpts = {
          model: f.model || undefined,
          region: f.region || undefined,
          topicId: f.topic || undefined,
          dateFrom,
          dateTo,
          // Whole-day window → the aggregate actions answer from the daily
          // rollups (00066). Absent for 24h, whose anchored window above is
          // timestamp-shaped and stays on the raw path.
          days,
          // Changes compare only the prompts answered in both periods
          // (VIS-002), so adding prompts doesn't inflate them.
          samePrompts: true,
        };

        const hasFilters = Boolean(f.datePreset !== 'all' || f.model || f.region || f.topic);

        // One consolidated server action (#313). Next.js queues server actions
        // one after another, so everything the first paint needs — summary,
        // competitors, SoV, KPIs and the trend chart — runs in one
        // server-side Promise.all instead of as separate requests, and "has
        // any data" comes from a cheap count.
        // The 24h preset is anchored to the last completed tracking run
        // (00044) so the morning refresh can't flash "no results" while
        // today's run streams in; the action resolves that window itself.
        // The trend chart follows the same window as every other number.
        const insights = await getInsightsData(brandId, {
          ...filterOpts,
          checkUnfiltered: hasFilters,
          anchor24h: f.datePreset === '24h',
        });
        if (insights.trackingWindow) {
          cronRunRef.current = insights.trackingWindow.activeRun;
          setCronRun(insights.trackingWindow.activeRun);
          updateRunTimes(insights.trackingWindow);
        }
        const anchored = insights.trackingWindow?.anchored;
        setLoadedFilters({
          ...filterOpts,
          dateFrom: anchored?.dateFrom ?? filterOpts.dateFrom,
          dateTo: anchored?.dateTo ?? filterOpts.dateTo,
        });
        const trend = insights.trend;
        setRateTrend(trend && trend.points.length > 0 ? trend : null);
        setSummary(insights.summary);
        setTrackedPrompts(insights.trackedPrompts);
        setCompetitorData(insights.competitors.brands.length > 1 ? insights.competitors : null);
        setSovData(insights.sov.byPlatform.length > 0 ? insights.sov : null);
        setOpportunities(insights.opportunities);
        setComparison(insights.comparison);
        setCoverage(insights.coverage);
        setKpiSeries(insights.kpiSeries);
        setPlatformChanges(insights.platformChanges);
        setPlatforms(insights.platforms);
        setWhyChanged(insights.whyChanged);
        setTrendMarkers(insights.trendMarkers);
        setTopicCompetitors(insights.topicCompetitors);
        setHasAnyData(insights.hasAnyData);

        // Different ChatGPT versions ("gpt-5-3-mini" + "gpt-5-5") collapse
        // into one "ChatGPT" filter option, stored as `slugA,slugB` so the
        // server filters the whole family with .in() via applyModelFilter().
        setAvailableRegions([...insights.filterOptions.regions].sort((a, b) => a.localeCompare(b)));
        setAvailableModels(
          modelFamilies(insights.filterOptions.models).sort((a, b) => a.localeCompare(b)),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : '';

        // Next.js surfaces this when a server action's response stream is
        // cut because the user navigated away mid-load. The destination
        // page renders fine; the toast is pure noise. Matched
        // case-insensitively so a wording tweak between Next versions
        // doesn't reopen the issue.
        if (/unexpected response/i.test(message)) {
          console.debug('[insights] load aborted by navigation', err);
        } else if (!silent) {
          // Next.js redacts server-action error messages in production
          // builds ("An error occurred in the Server Components render…"),
          // so relaying `message` verbatim shows the user that boilerplate
          // instead of anything actionable. Anything unrecognizable gets the
          // plain fallback.
          const redacted = !message || /server components render|digest property/i.test(message);
          toast.error(redacted ? 'Failed to load insights — please try again' : message);
        } else {
          // Silent refreshes fire every ~10s while a tracking job runs; a
          // transient 5xx or network blip there shouldn't pop a red toast —
          // the next poll will retry and the user sees nothing.
          console.warn('[insights] silent refresh failed', err);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [brandId, updateRunTimes],
  );

  // A brand switch clears the brand-specific filters. Not on the first brand,
  // so filters linked in the URL survive the initial load.
  const filteredBrandRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!brand?.id) return;
    setAvailableRegions([]);
    setAvailableModels([]);
    setAvailableTopics([]);
    if (filteredBrandRef.current && filteredBrandRef.current !== brand.id) {
      const next = { ...filtersRef.current, region: '', model: '', topic: '' };
      filtersRef.current = next;
      setFilters(next);
    }
    filteredBrandRef.current = brand.id;
    getTopics(brand.id)
      .then(setAvailableTopics)
      .catch(() => {});
  }, [brand?.id]);

  useEffect(() => {
    if (urlRead) loadData();
  }, [loadData, urlRead]);

  // Watch the tracking-run ledger so server-started (cron) runs surface too:
  // the job banner below only knows about jobs this browser started via
  // localStorage, which is why users never saw anything during the daily
  // morning run. When the active run disappears (= completed), silently
  // reload so the anchored 24h window swaps to the fresh run in one step.
  // Another brand's run times never show under this one's name, even when
  // its first read fails.
  useEffect(() => {
    updateRunTimes({ lastRunAt: null, nextRunAt: null });
  }, [brand?.id, updateRunTimes]);
  useEffect(() => {
    if (!brand?.id) return;
    let cancelled = false;

    const tick = async () => {
      const win = await getTrackingWindow(brand.id).catch(() => null);
      if (cancelled || !win) return;
      const wasRunning = cronRunRef.current !== null;
      cronRunRef.current = win.activeRun;
      setCronRun(win.activeRun);
      updateRunTimes(win);
      if (wasRunning && !win.activeRun) {
        loadData(undefined, { silent: true });
      }
    };

    const id = setInterval(tick, 60_000);
    tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [brand?.id, loadData, updateRunTimes]);

  // Restore active job from localStorage or URL query param (post-payment redirect)
  const searchParams = useSearchParams();
  useEffect(() => {
    if (!brand) return;

    const urlJobId = searchParams.get('jobId');
    if (urlJobId) {
      saveTrackingJob({ jobId: urlJobId, brandId: brand.id, startedAt: Date.now() });
      setActiveJobId(urlJobId);
      setIsRunning(true);
      writeUrlParams({ jobId: null });
      return;
    }

    const saved = loadTrackingJob();
    if (saved && saved.brandId === brand.id) {
      setActiveJobId(saved.jobId);
      setIsRunning(true);
    }
  }, [brand, searchParams]);

  // Poll job status while a job is active
  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    let lastRefresh = 0;
    const poll = async () => {
      while (!cancelled) {
        try {
          const status = await getJobStatus(activeJobId);
          if (cancelled) break;
          setJobStatus(status);
          const current = status.progress?.current;
          if (current !== undefined) {
            setPace((prev) => withSample(prev, { at: Date.now(), current }));
          }

          // Refresh data every ~10s while active so new results appear progressively
          const now = Date.now();
          if (status.status === 'active' && now - lastRefresh > 10_000) {
            lastRefresh = now;
            loadData(undefined, { silent: true });
          }

          if (status.status === 'completed') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            const done = doneMessage(status.result);
            toast.success(tRef.current(`tracking.${done.key}`, 'count' in done ? done : undefined));
            loadData(undefined, { silent: true });
            break;
          }

          if (status.status === 'failed' || status.status === 'not_found') {
            clearTrackingJob();
            setActiveJobId(null);
            setIsRunning(false);
            setJobStatus(null);
            if (status.status === 'failed') {
              toast.error(
                tRef.current('tracking.failed', {
                  reason: status.failedReason ?? tRef.current('tracking.unknownError'),
                }),
              );
            }
            break;
          }
        } catch {
          // network error, keep polling
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    };

    poll();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, loadData]);

  const handleFilterChange = (newFilters: InsightsFilters) => {
    setFilters(newFilters);
    loadData(newFilters);
  };

  const handleRunPrompts = async () => {
    if (!brand) return;
    setIsRunning(true);
    try {
      const { jobId } = await triggerTrackingCheck(brand.id);
      saveTrackingJob({ jobId, brandId: brand.id, startedAt: Date.now() });
      setActiveJobId(jobId);
      setJobStatus({
        status: 'waiting',
        progress: null,
        result: null,
        failedReason: null,
      });
    } catch (err) {
      setIsRunning(false);
      toast.error(err instanceof Error ? err.message : 'Failed to trigger tracking');
    }
  };

  const runAll = guard(handleRunPrompts, { action: tActions('runPrompts') });
  const openSinglePrompt = guard(() => setShowSinglePrompt(true), {
    action: tActions('testPrompt'),
  });

  const handleStopTracking = async () => {
    if (!activeJobId) return;
    try {
      await cancelTrackingJob(activeJobId);
    } catch {}
    clearTrackingJob();
    setActiveJobId(null);
    setIsRunning(false);
    setJobStatus(null);
    toast.success('Tracking stopped');
    loadData(undefined, { silent: true });
  };

  const handleJobStarted = (jobId: string) => {
    if (!brand) return;
    setIsRunning(true);
    saveTrackingJob({ jobId, brandId: brand.id, startedAt: Date.now() });
    setActiveJobId(jobId);
    setJobStatus({
      status: 'waiting',
      progress: null,
      result: null,
      failedReason: null,
    });
  };

  const handleExportCsv = useCallback(async () => {
    if (!brand) return;
    setIsExporting(true);
    try {
      const f = filtersRef.current;
      const { dateFrom, dateTo } = getDateRange(f.datePreset, {
        from: f.dateFrom,
        to: f.dateTo,
      });
      const filterOpts = {
        model: f.model || undefined,
        region: f.region || undefined,
        topicId: f.topic || undefined,
        dateFrom,
        dateTo,
      };

      const { results: allResults, isCapped } = await exportPromptResults(brand.id, filterOpts);

      const rows: Record<string, string | number>[] = allResults.map((r) => ({
        created_at: r.createdAt,
        prompt: r.promptText,
        topic: r.topicName ?? '',
        platform: PLATFORM_LABELS[r.platform] ?? r.platform,
        model: r.modelUsed ?? '',
        region: r.region ?? '',
        mention_count: r.mentionCount,
        citation_count: r.citationCount,
        visibility_score: r.visibilityScore,
        sentiment: r.sentiment,
        citation_urls: r.citations.map((c) => c.url).join(', '),
        competitor_mentions:
          r.competitorMentions?.map((c) => `${c.name}:${c.mention_count}`).join(', ') ?? '',
      }));

      if (isCapped) {
        rows.push({
          created_at: 'WARNING',
          prompt: 'Export capped at 50,000 rows',
          topic: '',
          platform: '',
          model: '',
          region: '',
          mention_count: 0,
          citation_count: 0,
          visibility_score: 0,
          sentiment: '',
          citation_urls: '',
          competitor_mentions: '',
        });
        toast.warning('Export capped at 50,000 rows to prevent memory issues');
      }

      const csv = toCsv(rows, INSIGHT_EXPORT_HEADERS);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      const slug = brand.slug ?? 'brand';

      link.href = url;
      link.download = await exportFileName(`${slug}_insights_${date}.csv`);
      link.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  }, [brand]);

  // Chat's side panel sees the page (W1-08): its dates and filters, the
  // platform that moved most, and the tables to ask about.
  const moved = largestMove(platforms?.filter((row) => row.status === 'ok'));
  const topicName = availableTopics.find((topic) => topic.id === filters.topic)?.name;
  useChatPageContext(
    brand
      ? {
          pageName: t('title'),
          dateRange: {
            from: filters.datePreset === 'custom' ? filters.dateFrom : filters.datePreset,
            to: filters.datePreset === 'custom' ? filters.dateTo : null,
            label: rangeChipLabel(
              filters.datePreset,
              { from: filters.dateFrom, to: filters.dateTo },
              (key, values) => tChatRange(key, values),
            ),
          },
          filters: [
            {
              key: 'platform',
              label: filters.model ? modelName(filters.model) : tCommon('allPlatforms'),
              value: filters.model,
            },
            ...(filters.region
              ? [
                  {
                    key: 'region',
                    label: formatRegionDisplay(filters.region),
                    value: filters.region,
                  },
                ]
              : []),
            ...(filters.topic && topicName
              ? [{ key: 'topic', label: topicName, value: filters.topic }]
              : []),
          ],
          suggestions: [
            ...(moved
              ? [
                  tChat(moved.change < 0 ? 'visibilityDrop' : 'visibilityRise', {
                    platform: moved.name,
                  }),
                ]
              : []),
            tChat('competitorGained'),
            tChat('actions'),
          ],
          referenceables: [
            { type: 'table', id: 'visibility-by-platform', label: tPlatforms('title') },
            { type: 'table', id: 'visibility-leaderboard', label: tLeaderboard('title') },
          ],
        }
      : null,
  );

  if (!brand || (isLoading && !summary)) return <InsightsSkeleton />;

  const noResults = !summary || summary.totalResults === 0;

  // First load renders the skeleton (summary is still null); once data has
  // ever arrived, a reload from a filter change is a "refetch" — the stale
  // content stays visible under the overlay instead of flashing a skeleton.
  const isRefetching = isLoading && summary !== null;

  const trulyEmpty = noResults && !hasAnyData;

  // The localStorage-tracked job banner (with progress + Stop) wins when this
  // browser started the run; the ledger banner covers everything else.
  const localJobActive =
    jobStatus !== null && (jobStatus.status === 'active' || jobStatus.status === 'waiting');

  if (trulyEmpty) {
    return (
      <div className="space-y-6">
        <HeaderWithAiUsage>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{brand.name}</p>
          </div>
        </HeaderWithAiUsage>
        <TrackingProgressBanner jobStatus={jobStatus} pace={pace} onStop={handleStopTracking} />
        {!localJobActive && <ServerRunBanner run={cronRun} firstRun={!runTimes.lastRunAt} />}
        {!firstRun && <EmptyState onRunPrompts={runAll} isRunning={isRunning} isCloud={isCloud} />}
        {!isCloud && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={openSinglePrompt} className="gap-2">
              <FlaskConical className="h-4 w-4" />
              Or test a single prompt
            </Button>
          </div>
        )}
        <RunSinglePromptDialog
          brandId={brand.id}
          open={showSinglePrompt}
          onClose={() => setShowSinglePrompt(false)}
          onJobStarted={handleJobStarted}
        />
      </div>
    );
  }

  // The trend's subtitle (VIS-007): "Visibility · last 30 days".
  const trendRangeLabel =
    filters.datePreset === 'custom'
      ? t('trend.range.custom', {
          from: formatWindowBound(filters.dateFrom, locale),
          to: formatWindowBound(filters.dateTo, locale),
        })
      : t(`trend.range.${filters.datePreset}`);

  const handleResetFilters = () => {
    const resetFilters = { ...DEFAULT_FILTERS };
    setFilters(resetFilters);
    loadData(resetFilters);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>

            {/* The brand's last full run from the ledger; before the ledger has
                one, the newest answer in view. */}
            <RunLine
              brandName={brand.name}
              lastRunAt={runTimes.lastRunAt ?? summary?.lastCheckedAt ?? null}
              nextRunAt={runTimes.nextRunAt}
              hasData={hasAnyData === true}
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Always visible */}
            <FormulaDialog />

            <Button
              variant="outline"
              className="gap-2"
              onClick={handleExportCsv}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isExporting ? tCommon('exporting') : tCommon('exportCsv')}
            </Button>

            <Link href="/dashboard/reports" className={cn(buttonVariants(), 'gap-2')}>
              <FileText className="h-4 w-4" />
              Reports
            </Link>

            {/* Self-host only */}
            {!isCloud && (
              <>
                <Button variant="outline" onClick={openSinglePrompt} className="gap-2">
                  <FlaskConical className="h-4 w-4" />
                  Test Single Prompt
                </Button>

                <Button onClick={runAll} disabled={isRunning} className="gap-2">
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  Run All
                </Button>
              </>
            )}
          </div>
        </div>
      </HeaderWithAiUsage>

      {/* Filter Bar */}
      <FilterBar
        filters={filters}
        onChange={handleFilterChange}
        availableRegions={availableRegions}
        availableModels={availableModels}
        availableTopics={availableTopics}
      />

      {/* Tracking Progress */}
      <TrackingProgressBanner jobStatus={jobStatus} pace={pace} onStop={handleStopTracking} />
      {!localJobActive && <ServerRunBanner run={cronRun} firstRun={!runTimes.lastRunAt} />}

      {/* Refetch overlay: on a filter/date change the previous window's data
          stays mounted (no skeleton — that's first-load only), so without a
          signal the user reads stale numbers as the new period's. Dim the
          content and float a spinner over it; the overlay also swallows
          clicks so a stale card can't be interacted with. The filter bar
          stays outside, so switching presets mid-load keeps working. */}
      <div className="relative">
        {isRefetching && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/50 pt-32">
            <div className="flex items-center rounded-md border bg-background p-2.5 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div className={cn('space-y-6', isRefetching && 'opacity-60')}>
          {noResults && firstRun ? null : noResults ? (
            <NoDataForPeriod datePreset={filters.datePreset} onReset={handleResetFilters} />
          ) : (
            <>
              {/* Summary line (VIS-006): the page's story in one line. */}
              <SummaryLine
                trend={rateTrend}
                competitors={competitorData}
                comparison={comparison}
                platformChanges={platformChanges}
                answers={summary?.totalResults}
              />

              {/* KPI cards (VIS-003): today's five, then the new rates. */}
              <KpiRows
                summary={summary!}
                trend={rateTrend}
                trackedPrompts={trackedPrompts}
                coverage={coverage}
                sov={sovData}
                competitors={competitorData}
                comparison={comparison}
                series={kpiSeries}
                onBreakdown={(metric) => {
                  setBreakdownTab(undefined);
                  setBreakdownMetric(metric);
                }}
                onNavigate={(path) => router.push(path)}
                mentionsHref={mentionsHref({
                  range: filters.datePreset,
                  from: filters.dateFrom,
                  to: filters.dateTo,
                  region: filters.region,
                  topic: filters.topic,
                })}
              />

              {/* Competitor Comparison */}
              {competitorData ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
                  <TrendCard
                    className="lg:col-span-3"
                    brandId={brand.id}
                    data={rateTrend}
                    markers={trendMarkers}
                    rangeLabel={trendRangeLabel}
                    answers={summary?.totalResults}
                    onPinnedChange={(pinned) =>
                      setRateTrend((current) => current && { ...current, pinned })
                    }
                  />

                  <Leaderboard
                    className="lg:col-span-2"
                    brands={competitorData.brands}
                    providerRows={competitorData.providerRows}
                    platforms={platforms}
                    answers={summary?.totalResults}
                  />
                </div>
              ) : (
                <NoCompetitorsTeaser />
              )}

              {/* By AI platform (VIS-008) and Why it changed (VIS-009), side by side as in the mockup. */}
              {((platforms && platforms.length > 0) || whyChanged) && (
                <div className="flex flex-wrap gap-4">
                  {platforms && platforms.length > 0 && (
                    <PlatformTable className="min-w-0 flex-[1_1_520px]" rows={platforms} />
                  )}
                  {whyChanged && (
                    <WhyChanged
                      className="min-w-0 flex-[1_1_420px]"
                      data={whyChanged}
                      onOpenBreakdown={(tab) => {
                        setBreakdownTab(tab);
                        setBreakdownMetric('visibility');
                      }}
                    />
                  )}
                </div>
              )}

              {/* Topics vs competitors (VIS-010): the trend's brands, topic by topic. */}
              {/* Its columns are the trend's lines, so it needs the trend's points. */}
              {rateTrend &&
                rateTrend.points.length > 0 &&
                topicCompetitors &&
                topicCompetitors.length > 0 && (
                  <TopicHeatmap
                    topics={topicCompetitors}
                    columns={trendLines(rateTrend.entities, rateTrend.points, rateTrend.pinned).map(
                      (line) => ({ key: line.key, name: line.name }),
                    )}
                  />
                )}

              {/* Opportunities (VIS-011), under the map: stored suggestions, not period-scoped. */}
              {opportunities && (
                <Opportunities
                  brandId={brand.id}
                  suggestions={opportunities.suggestions}
                  trackedTopicIds={opportunities.trackedTopicIds}
                  topics={topicCompetitors}
                  entities={rateTrend?.entities ?? null}
                  slotsLeft={
                    !trackedPrompts || trackedPrompts.quotaLimit < 0
                      ? null
                      : Math.max(0, trackedPrompts.quotaLimit - trackedPrompts.quotaUsed)
                  }
                  contentUsage={opportunities.contentUsage}
                  onTracked={(count) =>
                    setTrackedPrompts(
                      (current) => current && { ...current, quotaUsed: current.quotaUsed + count },
                    )
                  }
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Single Prompt Runner */}
      <RunSinglePromptDialog
        brandId={brand.id}
        open={showSinglePrompt}
        onClose={() => setShowSinglePrompt(false)}
        onJobStarted={handleJobStarted}
      />

      {/* Metric Breakdown Drilldown */}
      <MetricBreakdownSheet
        brandId={brand.id}
        metric={breakdownMetric}
        onOpenChange={(open) => {
          if (!open) setBreakdownMetric(null);
        }}
        filters={loadedFilters}
        initialTab={breakdownTab}
      />
    </div>
  );
}
