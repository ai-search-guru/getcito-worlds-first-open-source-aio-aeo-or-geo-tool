'use client';

import { useEffect, useMemo, useState, type ComponentType, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buildCitationDetailHref } from '@/components/citations/FilterBar';
import {
  getPromptDetail,
  type PromptDetailData,
  type PromptTopSource,
  type PromptTopSourceUrl,
} from '@/lib/actions/tracking';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Activity,
  ArrowLeft,
  AlertCircle,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  MessageSquareText,
  Quote,
  RotateCw,
  TrendingUp,
} from 'lucide-react';
import { getPromptVolume, type PromptVolumeEstimateRow } from '@/lib/actions/promptVolume';
import { promptVolumeEstimate } from '@/lib/volumeEstimate';
import { EstimateBadge, EstimateRange } from '@/components/prompts/VolumeEstimate';
import { DemandLevelValue, DemandSection } from '@/components/prompts/DemandCard';
import { getPromptDemandSignals } from '@/lib/actions/promptDemandSignals';
import { getSuggestionSourceStates } from '@/lib/actions/integrations';
import { DEMAND_SIGNALS, type PromptDemand } from '@/lib/promptDemand';
import { googleSourceStatus, type GoogleSourceStatus } from '@/lib/trafficSources';
import { cn } from '@/lib/utils';
import { formatRegionDisplay } from '@/lib/region';
import { toast } from 'sonner';
import { useUserRole } from '@/hooks/useUserRole';
import { getOpportunities } from '@/lib/actions/content';
import type { ContentOpportunity } from '@/types';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { WorkStatusBadge } from '@/components/prompts/WorkStatus';
import {
  getPromptWorkflow,
  setPromptWorkStatus,
  type PromptNote,
  type PromptTargetUrl,
  type PromptWorkStatus,
} from '@/lib/actions/promptWorkflow';
import {
  NotesCard,
  TargetUrlsCard,
  ContentOpportunitiesCard,
  OPPORTUNITY_PREVIEW_LIMIT,
} from './_WorkflowCards';
import { ResponseDetail } from '@/components/results/ResponseDetail';
import {
  CategoryBadge,
  DomainFavicon,
  PlatformsCell,
  UsageBar,
} from '@/components/citations/SourceCells';
import { TablePager, usePagination } from '@/components/TablePager';
import { MODEL_PROVIDER_LABELS, PLATFORM_LABELS } from '@/config/platformLabels';
import { groupByPlatform, type PlatformGroup } from './grouping';
import { dayRangeBounds, viewerTimeZone } from '@/lib/timeZone';
import { formatNumber } from '@/lib/format';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

// ─── Date range (kept in sync with the insights page filter bar) ─────────────

type DatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

const DATE_PRESETS: DatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

function getDateRange(preset: DatePreset, custom: { from: string; to: string }) {
  if (preset === 'all') return { dateFrom: undefined, dateTo: undefined };
  if (preset === 'custom') {
    // Whole days on the viewer's clock, as the answer times below read.
    const { from, to } = dayRangeBounds(custom.from, custom.to, viewerTimeZone());
    return { dateFrom: from, dateTo: to };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString(), dateTo: undefined };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString(), dateTo: undefined };
}

function DateRangeBar({
  preset,
  customFrom,
  customTo,
  onPreset,
  onCustomFrom,
  onCustomTo,
}: {
  preset: DatePreset;
  customFrom: string;
  customTo: string;
  onPreset: (p: DatePreset) => void;
  onCustomFrom: (v: string) => void;
  onCustomTo: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Date Range</label>
        <div className="flex overflow-hidden rounded-md border">
          {DATE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPreset(p)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                preset === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card hover:bg-muted text-foreground',
              )}
            >
              {p === 'custom' ? 'Custom' : p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => onCustomFrom(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">To</label>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => onCustomTo(e.target.value)}
              className="h-8 w-36 text-xs"
            />
          </div>
        </>
      )}
    </div>
  );
}

function getModelDisplayName(model?: string, platform?: string): string {
  if (model && MODEL_PROVIDER_LABELS[model]) return MODEL_PROVIDER_LABELS[model];
  if (platform && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
  return model ?? platform ?? 'Unknown';
}

/**
 * An answer's time on the viewer's clock, with the zone so it can't be read
 * as UTC, written as the Positions panel writes it ("Oct 12, 16:28 GMT+3").
 */
function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  });
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs capitalize',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {sentiment}
    </Badge>
  );
}

function ModelBadge({ model, platform }: { model?: string; platform?: string }) {
  const provider = resolveAIProvider(model ?? platform ?? '', platform);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1">
      <AIProviderAvatar provider={provider} className="h-4 w-4" />
      <span className="text-xs">{getModelDisplayName(model, platform)}</span>
    </span>
  );
}

function VisibilityBar({ score }: { score: number }) {
  const rounded = Math.round(score);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            rounded >= 70 ? 'bg-emerald-500' : rounded >= 40 ? 'bg-amber-500' : 'bg-red-500',
          )}
          style={{ width: `${Math.min(100, Math.max(0, rounded))}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-semibold tabular-nums">{rounded}</span>
    </div>
  );
}

/** The KPI row's columns for its number of cards: three, four, or five with Demand. */
function kpiGridColumns(count: number): string {
  if (count >= 5) return 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';
  if (count === 4) return 'sm:grid-cols-2 lg:grid-cols-4';
  return 'sm:grid-cols-3';
}

function KpiCard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: React.ReactNode;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-5 w-5 text-muted-foreground" />
        <div>
          <div className="text-2xl font-bold tabular-nums">{value}</div>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TopSourceDomainsTable({
  rows,
  filterKey,
  pageSize,
}: {
  rows: PromptTopSource[];
  filterKey: string;
  pageSize?: number;
}) {
  const pager = usePagination(rows.length, filterKey, pageSize ?? 10);
  const pageRows = rows.slice(pager.start, pager.end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">Domain</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.domain}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {pager.start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{row.domain}</span>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <CategoryBadge category={row.category} />
                      <a
                        href={`https://${row.domain}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center text-muted-foreground hover:text-foreground"
                        aria-label={`Open ${row.domain} in a new tab`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.totalCitations}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={pager.page}
        totalPages={pager.totalPages}
        total={rows.length}
        start={pager.start}
        end={pager.end}
        onPage={pager.setPage}
      />
    </div>
  );
}

function TopSourceUrlsTable({
  rows,
  filterKey,
  pageSize,
}: {
  rows: PromptTopSourceUrl[];
  filterKey: string;
  pageSize?: number;
}) {
  const pager = usePagination(rows.length, filterKey, pageSize ?? 10);
  const pageRows = rows.slice(pager.start, pager.end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">URL</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Citations</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.url}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {pager.start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex min-w-0 items-start gap-2">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 max-w-[480px] flex-col">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link
                        href={buildCitationDetailHref(row.url, { datePreset: 'all' })}
                        className="truncate text-sm font-medium text-foreground hover:underline"
                        title={row.title || row.url}
                      >
                        {row.title || row.url}
                      </Link>
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Open cited page in a new tab"
                        title="Open cited page"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="truncate text-[11px] text-muted-foreground">
                        {row.domain}
                      </span>
                      <CategoryBadge category={row.category} />
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <PlatformsCell models={row.models} />
              </TableCell>
              <TableCell>
                <UsageBar pct={row.usagePct} />
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">
                {row.totalCitations}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={pager.page}
        totalPages={pager.totalPages}
        total={rows.length}
        start={pager.start}
        end={pager.end}
        onPage={pager.setPage}
      />
    </div>
  );
}

function TopSourcesCard({
  sources,
  sourceUrls,
}: {
  sources: PromptTopSource[];
  sourceUrls: PromptTopSourceUrl[];
}) {
  const [filter, setFilter] = useState('');

  const q = filter.toLowerCase();
  const filteredSources = q ? sources.filter((s) => s.domain.toLowerCase().includes(q)) : sources;
  const filteredUrls = q
    ? sourceUrls.filter(
        (u) => u.url.toLowerCase().includes(q) || (u.title && u.title.toLowerCase().includes(q)),
      )
    : sourceUrls;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Top Sources</CardTitle>
        <p className="text-xs text-muted-foreground">
          Sources AI platforms cite when answering this prompt.
        </p>
      </CardHeader>
      <CardContent>
        <Input
          placeholder="Filter by domain, URL or title..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 text-xs mb-4"
        />
        <Tabs defaultValue="domains">
          <TabsList>
            <TabsTrigger value="domains">Domains ({filteredSources.length})</TabsTrigger>
            <TabsTrigger value="urls">URLs ({filteredUrls.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="domains" keepMounted className="mt-4">
            <TopSourceDomainsTable rows={filteredSources} filterKey={filter} />
          </TabsContent>
          <TabsContent value="urls" keepMounted className="mt-4">
            <TopSourceUrlsTable rows={filteredUrls} filterKey={filter} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function PlatformResultGroup({
  group,
  expanded,
  onToggle,
}: {
  group: PlatformGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const visibleRuns = group.results.slice(0, 10);
  const hiddenCount = group.results.length - visibleRuns.length;
  // Several answers can be open at once, so two runs can be read side by side.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const toggleRun = (id: string) =>
    setOpenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer select-none items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <ModelBadge model={group.modelUsed ?? group.platform} platform={group.platform} />
            {group.region && (
              <Badge variant="outline" className="text-[10px]">
                {formatRegionDisplay(group.region)}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              {group.results.length} run{group.results.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="hidden items-center gap-5 sm:flex">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Mentions</p>
            <p className="text-xs font-semibold tabular-nums">{group.totalMentions}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground">Citations</p>
            <p className="text-xs font-semibold tabular-nums">{group.totalCitations}</p>
          </div>
          <div className="w-32">
            <VisibilityBar score={group.avgScore} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t bg-muted/10 px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Runs
          </p>
          <div className="overflow-hidden rounded-md border bg-background">
            {visibleRuns.map((result, index) => {
              const open = openRuns.has(result.id);
              return (
                <div key={result.id} className={cn(index > 0 && 'border-t')}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    onClick={() => toggleRun(result.id)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleRun(result.id);
                      }
                    }}
                    className={cn(
                      'grid cursor-pointer grid-cols-[1fr_auto] gap-3 px-3 py-2 text-xs transition-colors hover:bg-muted/50 sm:grid-cols-[1.4fr_90px_90px_100px_140px_40px] sm:items-center',
                      open && 'bg-muted/40',
                    )}
                  >
                    <div className="min-w-0 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTimestamp(result.createdAt)}
                      </span>
                    </div>
                    <div className="hidden text-center tabular-nums sm:block">
                      <span className="font-semibold">{result.mentionCount}</span>
                      <span className="text-muted-foreground"> mentions</span>
                    </div>
                    <div className="hidden text-center tabular-nums sm:block">
                      <span className="font-semibold">{result.citationCount}</span>
                      <span className="text-muted-foreground"> citations</span>
                    </div>
                    <div className="hidden justify-center sm:flex">
                      <SentimentBadge sentiment={result.sentiment} />
                    </div>
                    <div className="hidden sm:block">
                      <VisibilityBar score={result.visibilityScore} />
                    </div>
                    <Button
                      variant={open ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-6 w-6 justify-self-end"
                      title={open ? 'Hide response' : 'Show response'}
                      aria-label={open ? 'Hide response' : 'Show response'}
                      aria-expanded={open}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRun(result.id);
                      }}
                    >
                      {open ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <div className="col-span-2 flex flex-wrap items-center gap-2 sm:hidden">
                      <span className="tabular-nums">
                        <span className="font-semibold">{result.mentionCount}</span>
                        <span className="text-muted-foreground"> mentions</span>
                      </span>
                      <span className="tabular-nums">
                        <span className="font-semibold">{result.citationCount}</span>
                        <span className="text-muted-foreground"> citations</span>
                      </span>
                      <SentimentBadge sentiment={result.sentiment} />
                      <div className="w-32">
                        <VisibilityBar score={result.visibilityScore} />
                      </div>
                    </div>
                  </div>

                  {open && (
                    <div className="border-t bg-background px-4 py-4">
                      <div className="mb-3 flex justify-end">
                        <Link
                          href={`/dashboard/insights/${result.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Open full page
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <ResponseDetail result={result} variant="compact" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Showing latest {visibleRuns.length} of {group.results.length} runs for this platform.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PromptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const promptId = params.id as string;

  const { canManage } = useUserRole();
  const [data, setData] = useState<PromptDetailData | null>(null);
  const promptBrandId = data?.prompt.brandId;
  const [opportunities, setOpportunities] = useState<ContentOpportunity[]>([]);
  const [opportunitiesTotal, setOpportunitiesTotal] = useState(0);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [opportunitiesFailed, setOpportunitiesFailed] = useState(false);

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [workStatus, setWorkStatus] = useState<PromptWorkStatus | null>(null);
  const [notes, setNotes] = useState<PromptNote[]>([]);
  const [targetUrls, setTargetUrls] = useState<PromptTargetUrl[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The prompt's estimated AI searches (PROMPT-013); no card without one.
  const [volume, setVolume] = useState<PromptVolumeEstimateRow | null>(null);
  const tVolumes = useTranslations('prompts.volumeInsights');
  // Its real demand (PROMPT-014): read by the server every night.
  const [demand, setDemand] = useState<PromptDemand | null>(null);
  const [demandFailed, setDemandFailed] = useState(false);
  // An API without the demand route yet: the page shows no Demand section.
  const [demandUnavailable, setDemandUnavailable] = useState(false);
  // The brand's Search Console, for the Demand card's state; bumped on connect.
  const [gscStatus, setGscStatus] = useState<GoogleSourceStatus | null>(null);
  const [sourcesRead, setSourcesRead] = useState(0);
  const tDemand = useTranslations('promptDemand');

  // Workflow data is independent of the date window — load it once per
  // prompt, outside the main load cycle, so date changes don't refetch it.
  useEffect(() => {
    let cancelled = false;
    getPromptWorkflow(promptId)
      .then((wf) => {
        if (cancelled) return;
        setWorkStatus(wf.workStatus);
        setNotes(wf.notes);
        setTargetUrls(wf.targetUrls);
      })
      .catch((err) => console.error('Failed to load prompt workflow:', err));
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  // Like the workflow, the volume doesn't depend on the date window.
  useEffect(() => {
    let cancelled = false;
    getPromptVolume(promptId)
      .then((row) => {
        if (!cancelled) setVolume(row);
      })
      .catch((err) => console.error('Failed to load prompt volume:', err));
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  // Like the volume, the demand doesn't depend on the date window.
  useEffect(() => {
    let cancelled = false;
    setDemand(null);
    setDemandFailed(false);
    setDemandUnavailable(false);
    getPromptDemandSignals(promptId)
      .then((res) => {
        if (cancelled) return;
        if ('demand' in res) setDemand(res.demand);
        else if ('unavailable' in res) setDemandUnavailable(true);
        else setDemandFailed(true);
      })
      .catch(() => {
        if (!cancelled) setDemandFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [promptId]);

  useEffect(() => {
    let cancelled = false;
    if (!promptBrandId) return;
    getSuggestionSourceStates(promptBrandId)
      .then((states) => {
        if (!cancelled) setGscStatus(googleSourceStatus(states.gsc));
      })
      .catch(() => {
        if (!cancelled) setGscStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [promptBrandId, sourcesRead]);

  useEffect(() => {
    let cancelled = false;
    if (!promptBrandId) return;

    setOpportunities([]);
    setOpportunitiesTotal(0);
    setOpportunitiesFailed(false);
    setOpportunitiesLoading(true);

    getOpportunities(promptBrandId, {
      promptId,
      status: 'new',
      limit: OPPORTUNITY_PREVIEW_LIMIT,
    })
      .then((res) => {
        if (cancelled) return;
        setOpportunities(res.opportunities);
        setOpportunitiesTotal(res.total);
      })
      .catch((err) => {
        console.error('Failed to load opportunities:', err);
        if (cancelled) return;
        setOpportunities([]);
        setOpportunitiesTotal(0);
        setOpportunitiesFailed(true);
        toast.error('Failed to load content opportunities');
      })
      .finally(() => {
        if (!cancelled) setOpportunitiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [promptBrandId, promptId]);

  const handleStatusChange = (status: PromptWorkStatus | null) => {
    const previous = workStatus;
    setWorkStatus(status);
    setPromptWorkStatus(promptId, status).catch(() => {
      setWorkStatus(previous);
      toast.error('Failed to update status');
    });
  };

  const load = useCallback(
    async (isCancelled?: () => boolean) => {
      setError(null);
      setNotFound(false);
      setLoading(true);

      try {
        const { dateFrom, dateTo } = getDateRange(datePreset, {
          from: customFrom,
          to: customTo,
        });

        const detail = await getPromptDetail(promptId, { dateFrom, dateTo });

        if (isCancelled?.()) return;

        if (!detail) {
          setNotFound(true);
          setData(null);
          return;
        }

        setData(detail);

        const groups = groupByPlatform(detail.results);
        setExpanded(new Set(groups.length > 0 ? [groups[0].key] : []));
      } catch (err) {
        if (isCancelled?.()) return;

        console.error('Failed to load prompt detail:', err);

        setError(err instanceof Error ? err.message : 'Failed to load prompt detail');

        toast.error('Failed to load prompt detail');
      } finally {
        if (!isCancelled?.()) {
          setLoading(false);
        }
      }
    },
    [promptId, datePreset, customFrom, customTo],
  );

  useEffect(() => {
    let cancelled = false;

    void load(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [load]);

  const platformGroups = useMemo(() => groupByPlatform(data?.results ?? []), [data?.results]);

  const togglePlatform = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // First load renders the skeleton (data is still null); once data has ever
  // arrived, a reload from a date change is a "refetch" — the stale content
  // stays visible under the overlay instead of flashing a skeleton (#494).
  const isRefetching = loading && data !== null;

  if (loading && !data && !notFound) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-2 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-full max-w-3xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="mx-auto h-9 w-9 text-destructive/60" />

            <h2 className="mt-3 text-base font-semibold">Couldn&apos;t load this prompt</h2>

            <p className="mt-1 text-sm text-muted-foreground">{error}</p>

            <Button className="mt-4 gap-2" size="sm" variant="outline" onClick={() => void load()}>
              <RotateCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquareText className="mb-4 h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-lg font-semibold">Prompt not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This prompt may have been deleted or does not exist.
        </p>
        <Button variant="outline" className="mt-6 gap-2" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Go back
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-2 sm:p-6">
      <HeaderWithAiUsage>
        <div className="space-y-6">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="space-y-3">
            <h1 className="text-xl font-semibold leading-snug">{data.prompt.text}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {data.prompt.topicName && (
                <Badge variant="secondary" className="text-xs">
                  {data.prompt.topicName}
                </Badge>
              )}
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  data.prompt.isActive
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-muted-foreground/20 text-muted-foreground',
                )}
              >
                {data.prompt.isActive ? 'Active' : 'Paused'}
              </Badge>
              {data.summary.lastCheckedAt && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Clock className="h-3 w-3" />
                  Last run: {formatTimestamp(data.summary.lastCheckedAt)}
                </Badge>
              )}
              <WorkStatusBadge
                status={workStatus}
                onChange={canManage ? handleStatusChange : undefined}
              />
            </div>
          </div>
        </div>
      </HeaderWithAiUsage>

      <DateRangeBar
        preset={datePreset}
        customFrom={customFrom}
        customTo={customTo}
        onPreset={setDatePreset}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
      />

      {/* Refetch overlay: on a date change the previous window's data stays
          mounted; dim it and float a spinner so stale numbers aren't read as
          the new period's. The date bar stays outside, so switching presets
          mid-load keeps working (#494). */}
      <div className="relative">
        {isRefetching && (
          <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/50 pt-32">
            <div className="flex items-center rounded-md border bg-background p-2.5 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div className={cn('space-y-6', isRefetching && 'opacity-60')}>
          <div
            className={cn(
              'grid gap-4',
              kpiGridColumns(3 + (volume ? 1 : 0) + (demand?.level ? 1 : 0)),
            )}
          >
            <KpiCard
              title={`Visibility — mentioned in ${data.summary.mentionAnswers} of ${data.summary.totalResults} answers, cited in ${data.summary.citationAnswers}`}
              value={data.summary.score ?? 0}
              icon={Eye}
            />
            <KpiCard
              title="Mentions"
              value={formatNumber(data.summary.totalMentions)}
              icon={MessageSquareText}
            />
            <KpiCard
              title="Citations"
              value={formatNumber(data.summary.totalCitations)}
              icon={Quote}
            />
            {volume && (
              <KpiCard
                title={tVolumes('detailTitle')}
                value={
                  <span className="flex flex-col items-start gap-1">
                    <EstimateRange estimate={promptVolumeEstimate(volume)} />
                    <EstimateBadge estimate={promptVolumeEstimate(volume)} />
                  </span>
                }
                icon={TrendingUp}
              />
            )}
            {demand?.level && (
              <KpiCard
                title={tDemand('kpiTitle', {
                  signals: demand.signals,
                  total: DEMAND_SIGNALS.length,
                })}
                value={<DemandLevelValue demand={demand} />}
                icon={Activity}
              />
            )}
          </div>

          {!demandUnavailable && (
            <DemandSection
              demand={demand}
              failed={demandFailed}
              gscStatus={gscStatus}
              brandId={data.prompt.brandId}
              topic={data.prompt.topicName ?? ''}
              canManage={canManage}
              onGscConnected={() => setSourcesRead((n) => n + 1)}
            />
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Platform Results</CardTitle>
              <p className="text-xs text-muted-foreground">
                {data.summary.totalResults} result{data.summary.totalResults !== 1 ? 's' : ''}{' '}
                grouped by platform and model.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {platformGroups.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  {datePreset === 'all' ? (
                    'No tracking results yet for this prompt.'
                  ) : (
                    <>
                      No results in the selected date range.{' '}
                      <button
                        type="button"
                        className="font-medium text-foreground underline underline-offset-2"
                        onClick={() => setDatePreset('all')}
                      >
                        Show all data
                      </button>
                    </>
                  )}
                </div>
              ) : (
                platformGroups.map((group) => (
                  <PlatformResultGroup
                    key={group.key}
                    group={group}
                    expanded={expanded.has(group.key)}
                    onToggle={() => togglePlatform(group.key)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {data.topSources.length > 0 && (
            <TopSourcesCard sources={data.topSources} sourceUrls={data.topSourceUrls} />
          )}
        </div>
      </div>

      {/* Workflow — outside the refetch overlay: notes and target URLs are
          date-window independent. */}
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <NotesCard
            promptId={promptId}
            notes={notes}
            onNotesChange={setNotes}
            canManage={canManage}
          />
          <TargetUrlsCard
            promptId={promptId}
            urls={targetUrls}
            onUrlsChange={setTargetUrls}
            canManage={canManage}
          />
        </div>
        <ContentOpportunitiesCard
          promptId={promptId}
          opportunities={opportunities}
          total={opportunitiesTotal}
          loading={opportunitiesLoading}
          failed={opportunitiesFailed}
        />
      </div>
    </div>
  );
}
