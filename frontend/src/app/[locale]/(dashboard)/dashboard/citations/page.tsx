'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
const DynamicSourceTypeDonutChart = dynamic(
  () => import('./citations_charts').then((m) => m.SourceTypeDonutChartView),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full" />,
  },
);
import {
  AlertCircle,
  Quote,
  Globe,
  ExternalLink,
  Filter as FilterIcon,
  Layers,
  Loader2,
  Info,
  Download,
  RotateCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { readUrlChoice, readUrlParam, writeUrlParams } from '@/lib/urlState';
import { useBrandStore } from '@/state/useBrandStore';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import { rangeChipLabel } from '@/lib/chat/pageContext';
import { formatRegionDisplay } from '@/lib/region';
import { Link } from '@/i18n/navigation';
import { AddCompetitorButton } from '@/components/citations/AddCompetitorButton';
import {
  CitationsFilterBar,
  SourceScopeFilter,
  DEFAULT_CITATIONS_FILTERS as DEFAULT_FILTERS,
  DATE_PRESETS,
  buildPlatformOptions,
  buildCitationDetailHref,
  getDateRange,
  getGroupedPlatformLabel,
  type CitationsUIFilters as UIFilters,
  type PlatformOption,
  type PromptOption,
} from '@/components/citations/FilterBar';
import {
  getCitationsOverview,
  getCitationGaps,
  brandHasCitations,
  type CitationsFilters,
  type CitationsOverview,
  type CitationDomainRow,
  type CitationUrlRow,
  type CitationsDatePreset,
  type CitationGaps,
  type CitationGapDomain,
} from '@/lib/actions/citations';
import { getTopics } from '@/lib/actions/topic';
import { getBrandFilterOptions, getBrandPrompts } from '@/lib/actions/tracking';
import { isSingleModel, modelFamilies, modelFamilyValue } from '@/lib/modelFamilies';
import { toCsv } from '@/lib/csv';
import type { Topic } from '@/types';
import { SOURCE_CATEGORY_LABELS, type SourceCategory } from '@/lib/citations/classify';
import { inSourceScope } from '@/lib/citations/scope';
import {
  CategoryBadge,
  DomainFavicon,
  PlatformsCell,
  UsageBar,
} from '@/components/citations/SourceCells';
import { PAGE_SIZE, TablePager, usePagination } from '@/components/TablePager';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import { exportFileName } from '@/lib/white-label/exportName';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

// ─── Constants ───────────────────────────────────────────────────────────────

// As the category badges (SourceCells.tsx): You in ink, Social in rose.
const CATEGORY_COLORS: Record<SourceCategory, string> = {
  you: 'var(--primary)',
  competitor: '#f97316',
  editorial: '#3b82f6',
  forum: '#22c55e',
  social: '#f43f5e',
  review: '#eab308',
  institutional: '#14b8a6',
  other: '#94a3b8',
};

// ─── Filter types ─────────────────────────────────────────────────────────────

// ─── Sub-components ───────────────────────────────────────────────────────────

// ─── Donut ────────────────────────────────────────────────────────────────────

function ChartContainer({
  height,
  children,
}: {
  height: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 && children(width)}
    </div>
  );
}

function SourceTypeDonut({
  data,
  total,
}: {
  data: { category: SourceCategory; count: number; pct: number }[];
  total: number;
}) {
  if (data.length === 0 || total === 0) {
    return (
      <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Layers className="h-8 w-8 opacity-30" />
        No citation sources yet.
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    fill: CATEGORY_COLORS[d.category],
    label: SOURCE_CATEGORY_LABELS[d.category],
  }));

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer height={200}>
        {(width) => {
          return <DynamicSourceTypeDonutChart width={width} chartData={chartData} />;
        }}
      </ChartContainer>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {chartData.map((d) => (
          <li key={d.category} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: d.fill }}
              aria-hidden
            />
            <span className="truncate text-foreground">{d.label}</span>
            <span className="ml-auto tabular-nums text-muted-foreground">{d.pct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string;
  value: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
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
        <div className="text-3xl font-bold tabular-nums">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ─── Tables ───────────────────────────────────────────────────────────────────

const DomainsTable = memo(function DomainsTable({
  rows,
  brandId,
  onAdded,
  page,
  onPage,
  filters,
  onResetFilters,
  hasAnyCitations,
  loadFailed,
  onRetry,
}: {
  rows: CitationDomainRow[];
  brandId: string;
  onAdded: () => void;
  page: number;
  onPage: (p: number) => void;
  filters: UIFilters;
  onResetFilters: () => void;
  hasAnyCitations: boolean | null;
  loadFailed: boolean;
  onRetry: () => void;
}) {
  if (rows.length === 0)
    return (
      <EmptyRows
        isFiltered={filters.datePreset !== 'all'}
        datePreset={filters.datePreset}
        onShowAll={onResetFilters}
        hasAnyCitations={hasAnyCitations}
        loadFailed={loadFailed}
        onRetry={onRetry}
      />
    );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const pageRows = rows.slice(start, end);

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[56px] text-xs">Rank</TableHead>
            <TableHead className="text-xs">Domain</TableHead>
            <TableHead className="text-xs">Platforms</TableHead>
            <TableHead className="text-xs">Usage</TableHead>
            <TableHead className="text-right text-xs">Avg Citations</TableHead>
            <TableHead className="w-[44px]">
              <span className="sr-only">Add as competitor</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pageRows.map((row, i) => (
            <TableRow key={row.domain}>
              {/* Global rank — offset by page so rank is continuous across pages */}
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 min-w-0">
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
                {row.avgCitationsPerResult.toFixed(1)}
              </TableCell>
              <TableCell className="text-right">
                {row.category !== 'you' && row.category !== 'competitor' && brandId ? (
                  <AddCompetitorButton brandId={brandId} domain={row.domain} onAdded={onAdded} />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <TablePager
        page={clampedPage}
        totalPages={totalPages}
        total={rows.length}
        start={start}
        end={end}
        onPage={onPage}
      />
    </div>
  );
});

const UrlsTable = memo(function UrlsTable({
  rows,
  page,
  onPage,
  filters,
  onResetFilters,
  hasAnyCitations,
  loadFailed,
  onRetry,
}: {
  rows: CitationUrlRow[];
  page: number;
  onPage: (p: number) => void;
  filters: UIFilters;
  onResetFilters: () => void;
  hasAnyCitations: boolean | null;
  loadFailed: boolean;
  onRetry: () => void;
}) {
  if (rows.length === 0)
    return (
      <EmptyRows
        isFiltered={filters.datePreset !== 'all'}
        datePreset={filters.datePreset}
        onShowAll={onResetFilters}
        hasAnyCitations={hasAnyCitations}
        loadFailed={loadFailed}
        onRetry={onRetry}
      />
    );

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const pageRows = rows.slice(start, end);

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
              <TableCell className="text-xs text-muted-foreground tabular-nums">
                {start + i + 1}
              </TableCell>
              <TableCell>
                <div className="flex items-start gap-2 min-w-0">
                  <DomainFavicon domain={row.domain} />
                  <div className="flex min-w-0 max-w-[480px] flex-col">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link
                        href={buildCitationDetailHref(row.url, filters)}
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
        page={clampedPage}
        totalPages={totalPages}
        total={rows.length}
        start={start}
        end={end}
        onPage={onPage}
      />
    </div>
  );
});

/**
 * Period-aware empty state for the Domains / URLs tables (#485).
 *
 * hasAnyCitations is fetched once in loadData (via brandHasCitations) and
 * passed down, so both keepMounted panels share a single server call instead
 * of each firing their own (#313 action queue note).
 *
 * Three states:
 *  1. Checking (null) — loadData is still in flight; shows a spinner.
 *  2. Has data outside window — "No citations in the last Xh/d" + "Show all data" button.
 *  3. No data at all — generic filter message (original behaviour).
 *
 * isFiltered / datePreset / onShowAll default to gap-safe values so
 * ByCompetitorView / CompetitorGapsTab can render <EmptyRows /> with no props.
 */
function EmptyRows({
  isFiltered = false,
  datePreset = 'all',
  onShowAll = () => {},
  hasAnyCitations = null,
  loadFailed = false,
  onRetry = () => {},
}: {
  isFiltered?: boolean;
  datePreset?: CitationsDatePreset;
  onShowAll?: () => void;
  hasAnyCitations?: boolean | null;
  loadFailed?: boolean;
  onRetry?: () => void;
}) {
  // ── 0. Load failed — never falls through to the endless "Checking…" spinner (#599) ──
  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-8 w-8 text-destructive/60 mb-3" />
        <p className="text-sm font-medium">Couldn&apos;t load citation data</p>
        <p className="mt-1 text-xs text-muted-foreground">Please try again.</p>
        <Button variant="outline" size="sm" className="mt-4 gap-2 text-xs" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  // ── 1. Checking ──────────────────────────────────────────────────────────────
  if (hasAnyCitations === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/60 mb-3" />
        <p className="text-xs text-muted-foreground">Checking citation data…</p>
      </div>
    );
  }

  // ── 2. Period-aware: data exists outside this window ─────────────────────────
  if (hasAnyCitations && isFiltered) {
    const periodLabel =
      datePreset === '24h'
        ? 'the last 24 hours'
        : datePreset === '7d'
          ? 'the last 7 days'
          : datePreset === '30d'
            ? 'the last 30 days'
            : datePreset === '90d'
              ? 'the last 90 days'
              : 'the selected period';

    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FilterIcon className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No citations in {periodLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Citation data exists outside this window.
        </p>
        <Button variant="outline" size="sm" className="mt-4 text-xs" onClick={onShowAll}>
          Show all data
        </Button>
      </div>
    );
  }

  // ── 3. No data at all — original generic message ──────────────────────────────
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <FilterIcon className="h-8 w-8 text-muted-foreground/40 mb-3" />
      <p className="text-sm font-medium">No citations match your filters</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Try widening your date range or removing filters.
      </p>
    </div>
  );
}

// ─── Competitor Gaps (#300) ───────────────────────────────────────────────────

const GAP_METHODOLOGY =
  'Sources that appear in answers mentioning competitors but not you, weighted by how many sources each answer had.';

function StrengthBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-20 rounded-full bg-muted overflow-hidden" title={`Strength ${pct}%`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, pct)}%` }} />
    </div>
  );
}

function DomainCell({ domain }: { domain: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <DomainFavicon domain={domain} />
      <span className="truncate text-sm font-medium">{domain}</span>
      <a
        href={`https://${domain}`}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center text-muted-foreground hover:text-foreground"
        aria-label={`Open ${domain} in a new tab`}
      >
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function GapListTable({ rows }: { rows: CitationGapDomain[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No gap domains for these filters</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every domain citing a competitor also cites you, or there isn&apos;t enough data yet.
        </p>
      </div>
    );
  }
  const max = rows[0]?.strength ?? 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-xs">Domain</TableHead>
          <TableHead className="text-xs">Source type</TableHead>
          <TableHead className="text-right text-xs">Competitor answers</TableHead>
          <TableHead className="text-xs">Which competitors</TableHead>
          <TableHead className="text-xs">Strength</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.domain}>
            <TableCell>
              <DomainCell domain={row.domain} />
            </TableCell>
            <TableCell>
              <CategoryBadge category={row.category} />
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              {row.competitorAnswers}
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {row.competitors.map((c) => (
                  <Badge key={c} variant="outline" className="text-[10px] whitespace-nowrap">
                    {c}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <StrengthBar value={row.strength} max={max} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ByCompetitorView({
  gaps,
  competitorId,
  onSelect,
}: {
  gaps: CitationGaps;
  competitorId: string;
  onSelect: (id: string) => void;
}) {
  const rows = gaps.byCompetitor[competitorId] ?? [];
  const max = rows[0]?.strength ?? 0;

  if (gaps.competitors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Layers className="h-8 w-8 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium">No competitor source data yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add competitors (with domains) and let a few tracking runs complete.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Competitor</span>
        <Select
          value={competitorId}
          onValueChange={(v) => {
            if (v) onSelect(v);
          }}
        >
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="Select competitor">
              {(value) => gaps.competitors.find((c) => c.id === value)?.name ?? 'Select competitor'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {gaps.competitors.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyRows />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Domain</TableHead>
              <TableHead className="text-xs">Source type</TableHead>
              <TableHead className="text-right text-xs">Answers feeding</TableHead>
              <TableHead className="text-center text-xs">Also cites us?</TableHead>
              <TableHead className="text-xs">Strength</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.domain}>
                <TableCell>
                  <DomainCell domain={row.domain} />
                </TableCell>
                <TableCell>
                  <CategoryBadge category={row.category} />
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {row.answersFeeding}
                </TableCell>
                <TableCell className="text-center">
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[10px] whitespace-nowrap',
                      row.alsoCitesUs
                        ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'text-muted-foreground',
                    )}
                  >
                    {row.alsoCitesUs ? '✓ Yes' : '✗ No'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <StrengthBar value={row.strength} max={max} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function CompetitorGapsTab({ loading, gaps }: { loading: boolean; gaps: CitationGaps | null }) {
  const [view, setView] = useState<'list' | 'byCompetitor'>('list');
  // The user's pick; falls back to the first competitor (derived, no effect) so
  // it stays valid when the gaps data changes under a filter switch.
  const [picked, setPicked] = useState('');
  const competitorId =
    gaps && gaps.competitors.some((c) => c.id === picked)
      ? picked
      : (gaps?.competitors[0]?.id ?? '');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!gaps) return <EmptyRows />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setView('list')}
            className={cn(
              'rounded px-2.5 py-1 transition-colors',
              view === 'list'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Gap list
          </button>
          <button
            type="button"
            onClick={() => setView('byCompetitor')}
            className={cn(
              'rounded px-2.5 py-1 transition-colors',
              view === 'byCompetitor'
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            By competitor
          </button>
        </div>
        <span
          className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-help"
          title={GAP_METHODOLOGY}
        >
          <Info className="h-3.5 w-3.5" /> How this works
        </span>
      </div>

      {gaps.lowVisibility && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          Your visibility is low in this window, so this list may be broad — focus on baseline
          visibility first.
        </div>
      )}

      {view === 'list' ? (
        <GapListTable rows={gaps.gapDomains} />
      ) : (
        <ByCompetitorView gaps={gaps} competitorId={competitorId} onSelect={setPicked} />
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;',
  });

  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

const SOURCE_SCOPE_VALUES = ['own', 'competitors', 'third_party', 'all'] as const;

/**
 * The filters as kept in the URL (#917). The names match the ones the per-URL
 * detail page reads (buildCitationDetailHref): ?preset=, ?from=/&to= for a
 * custom range, ?platform=, ?region=, plus ?topic=, ?prompt= and ?scope=.
 * Defaults are left out; an unknown preset or scope falls back to the default.
 */
function filtersFromUrl(): UIFilters {
  const datePreset = readUrlChoice('preset', DATE_PRESETS, DEFAULT_FILTERS.datePreset);
  return {
    datePreset,
    dateFrom: datePreset === 'custom' ? readUrlParam('from') : '',
    dateTo: datePreset === 'custom' ? readUrlParam('to') : '',
    platform: readUrlParam('platform'),
    region: readUrlParam('region'),
    topic: readUrlParam('topic'),
    prompt: readUrlParam('prompt'),
    sourceScope: readUrlChoice('scope', SOURCE_SCOPE_VALUES, DEFAULT_FILTERS.sourceScope),
  };
}

function writeFiltersToUrl(f: UIFilters) {
  const custom = f.datePreset === 'custom';
  writeUrlParams(
    {
      preset: f.datePreset,
      from: custom ? f.dateFrom : null,
      to: custom ? f.dateTo : null,
      platform: f.platform,
      region: f.region,
      topic: f.topic,
      prompt: f.prompt,
      scope: f.sourceScope,
    },
    { preset: DEFAULT_FILTERS.datePreset, scope: DEFAULT_FILTERS.sourceScope },
  );
}

export default function CitationsPage() {
  const t = useTranslations('citations');
  const tCommon = useTranslations('common');
  const tChat = useTranslations('chatPanel.suggest');
  const tChatRange = useTranslations('chatPanel.range');
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();

  const [filters, setFilters] = useState<UIFilters>(DEFAULT_FILTERS);
  // Read after mount (window isn't available during the server render); the
  // loads below wait for it so a linked view doesn't load the defaults first.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    setFilters(filtersFromUrl());
    setUrlRead(true);
  }, []);

  useEffect(() => {
    if (urlRead) writeFiltersToUrl(filters);
  }, [urlRead, filters]);
  const [data, setData] = useState<CitationsOverview | null>(null);
  const [hasAnyCitations, setHasAnyCitations] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Every cited domain arrives (the list isn't capped), so the scope is
  // applied here, and the Domains tab counts these rows rather than all of them.
  const filteredDomainRows = (data?.rows ?? []).filter((row) =>
    inSourceScope(row.category, filters.sourceScope),
  );

  // The server already scoped these (#745). This is kept for the moment
  // between picking a scope and the refetch landing, when `data` still holds
  // the previous scope's rows — without it the table would show the old scope
  // under the new one's name. Once the fresh rows arrive it filters nothing.
  const filteredUrlRows = (data?.urlRows ?? []).filter((urlRow) =>
    inSourceScope(urlRow.category, filters.sourceScope),
  );

  // Pagination — resets to page 0 whenever any filter changes
  const filterKey = JSON.stringify(filters);
  const domainPager = usePagination(filteredDomainRows.length, filterKey);
  const urlPager = usePagination(filteredUrlRows.length, filterKey);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [availablePlatforms, setAvailablePlatforms] = useState<PlatformOption[]>([]);
  const [availableRegions, setAvailableRegions] = useState<string[]>([]);
  // The platform asked for is always one of the choices: the dropdown drops a
  // value it doesn't list, and the choices come from the rows read, so a
  // family partly answered in the window, or a link's, would go unasked.
  const platformChoices = useMemo<PlatformOption[]>(
    () =>
      !filters.platform || availablePlatforms.some((p) => p.value === filters.platform)
        ? availablePlatforms
        : [
            ...availablePlatforms,
            { value: filters.platform, label: getGroupedPlatformLabel(filters.platform) },
          ],
    [availablePlatforms, filters.platform],
  );
  const isRefetching = isLoading && data !== null;

  const activeBrandId = brand?.id ?? null;

  const [sourceTab, setSourceTab] = useState<'domains' | 'urls' | 'gaps' | 'types'>('domains');
  const [gaps, setGaps] = useState<CitationGaps | null>(null);
  const [gapsLoading, setGapsLoading] = useState(false);

  // Shared scoping filters (date / platform / region / topic / prompt). The
  // domain-list flags below don't apply to Competitor Gaps, so keeping them out
  // of this memo means toggling them doesn't refetch the Gaps tab.
  const gapFilters = useMemo<CitationsFilters>(() => {
    const { dateFrom, dateTo } = getDateRange(filters.datePreset, {
      from: filters.dateFrom,
      to: filters.dateTo,
    });
    return {
      datePreset: filters.datePreset,
      dateFrom,
      dateTo,
      platforms: filters.platform ? [filters.platform] : undefined,
      regions: filters.region ? [filters.region] : undefined,
      topicIds: filters.topic ? [filters.topic] : undefined,
      promptIds: filters.prompt ? [filters.prompt] : undefined,
    };
  }, [
    filters.datePreset,
    filters.dateFrom,
    filters.dateTo,
    filters.platform,
    filters.region,
    filters.topic,
    filters.prompt,
  ]);

  // The URL list is capped, so its scope has to be applied in the query rather
  // than to what came back (#745) — which means changing the scope refetches
  // the overview. Kept separate from gapFilters above so Competitor Gaps, which
  // the scope does not apply to, still doesn't refetch when it changes.
  const overviewFilters = useMemo<CitationsFilters>(
    () => ({ ...gapFilters, sourceScope: filters.sourceScope }),
    [gapFilters, filters.sourceScope],
  );

  useEffect(() => {
    if (!activeBrandId) return;
    getTopics(activeBrandId)
      .then(setTopics)
      .catch(() => {});
    getBrandPrompts(activeBrandId)
      .then((rows) => setPrompts(rows.map((r) => ({ id: r.id, text: r.text }))))
      .catch(() => {});
  }, [activeBrandId]);

  // Each load claims a generation. The effect's cleanup bumps the counter, so
  // a response arriving after the filters changed — or after the user left the
  // page — can recognise itself as stale instead of writing state or toasting.
  const loadGen = useRef(0);
  // The single models already read as their family (modelFamilyValue): each
  // asks the brand's models once.
  const familyRead = useRef(new Set<string>());

  const loadData = useCallback(async () => {
    if (!activeBrandId) {
      setIsLoading(false);
      return;
    }
    const gen = ++loadGen.current;
    const stale = () => loadGen.current !== gen;

    setIsLoading(true);
    setLoadFailed(false);
    // A platform from an address can be one model of a family (Chat's link,
    // platform=chatgpt-web): it reads as its family, as the dropdown sets it,
    // so the numbers are those of picking ChatGPT there. The rows below are
    // filtered, so the brand's models are asked for.
    const asked = overviewFilters.platforms?.[0] ?? '';
    if (isSingleModel(asked) && !familyRead.current.has(asked)) {
      familyRead.current.add(asked);
      const family = await getBrandFilterOptions(activeBrandId)
        .then((options) => modelFamilyValue(asked, modelFamilies(options.models)))
        .catch(() => asked);
      if (stale()) return;
      familyRead.current.add(family);
      if (family !== asked) {
        // The filters change, and the load they start reads the family.
        setFilters((f) => ({ ...f, platform: family }));
        return;
      }
    }
    try {
      const overview = await getCitationsOverview(activeBrandId, overviewFilters);
      if (stale()) return;
      setData(overview);

      // Surface filter options from the observed models/regions.
      const platformOptions = buildPlatformOptions(overview.rows);
      setAvailablePlatforms((prev) =>
        Array.from(
          new Map(
            [...prev, ...platformOptions].map((platform) => [platform.value, platform]),
          ).values(),
        ).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value)),
      );
      if (overview.availableRegions.length > 0) {
        setAvailableRegions((prev) =>
          Array.from(new Set([...prev, ...overview.availableRegions])).sort((a, b) =>
            a.localeCompare(b),
          ),
        );
      }
    } catch (err) {
      // Leaving the page aborts the in-flight request. That rejection is not a
      // failure worth reporting — and the toast is global, so it would surface
      // on whichever page the user navigated to.
      if (stale()) return;
      console.error('[citations] load failed', err);
      setLoadFailed(true);
      toast.error('Failed to load citation data');
    } finally {
      if (!stale()) setIsLoading(false);
    }
  }, [activeBrandId, overviewFilters]);

  useEffect(() => {
    if (!activeBrandId) return;

    let active = true;

    brandHasCitations(activeBrandId)
      .then((result) => {
        if (!active) return;
        setHasAnyCitations(result);
      })
      .catch((err) => {
        if (!active) return;
        console.error('[citations] brandHasCitations failed', err);
        setLoadFailed(true);
        toast.error('Failed to check citation data');
      });

    return () => {
      active = false;
    };
  }, [activeBrandId]);

  useEffect(() => {
    if (!urlRead) return;
    loadData();
    // Invalidate whatever is in flight when the filters change or the page
    // unmounts, so a slow earlier response can't overwrite newer data.
    //
    // The exhaustive-deps warning about reading a ref in cleanup doesn't apply
    // here: this ref is a counter, not a node, and a value that moved on since
    // the effect ran is exactly what we want to invalidate — incrementing is
    // correct whether the last load came from this effect or from a Retry.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadGen.current++;
    };
  }, [loadData, urlRead]);

  // Lazy-load Competitor Gaps only when its tab is active; re-fetch when the
  // shared scoping filters change while it's open. Uses `gapFilters` (not
  // `apiFilters`) so the domain-list flags don't trigger a no-op refetch.
  useEffect(() => {
    if (sourceTab !== 'gaps' || !activeBrandId || !urlRead) return;
    let cancelled = false;
    setGapsLoading(true);
    getCitationGaps(activeBrandId, gapFilters)
      .then((res) => {
        if (!cancelled) setGaps(res);
      })
      .catch(() => {
        if (!cancelled) setGaps(null);
      })
      .finally(() => {
        if (!cancelled) setGapsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceTab, activeBrandId, gapFilters, urlRead]);

  const totals = data?.totals;
  // Within the selected scope, as the Domains tab and the URL count under it.
  const domainsInScope = filteredDomainRows.length;
  const kpis = useMemo(
    () => [
      {
        title: t('kpiTotalCitations'),
        value: totals ? formatNumber(totals.citations) : '—',
        sub: t('kpiTotalCitationsSub', {
          results: totals?.results ?? 0,
        }),
        icon: Quote,
      },
      {
        title: t('kpiUniqueDomains'),
        value: totals ? formatNumber(domainsInScope) : '—',
        sub: t('kpiUniqueDomainsSub', {
          urls: totals?.urls ?? 0,
        }),
        icon: Globe,
      },
      {
        title: t('kpiAvgPerResult'),
        value: totals ? totals.avgCitationsPerResult.toFixed(1) : '—',
        sub: t('kpiAvgPerResultSub'),
        icon: Layers,
      },
    ],
    [totals, domainsInScope, t],
  );

  const handleExportCsv = useCallback(async () => {
    if (!brand) return;

    setIsExporting(true);

    try {
      const date = new Date().toISOString().slice(0, 10);
      const slug = brand.slug ?? 'brand';

      if (sourceTab === 'domains' && data) {
        const DOMAIN_HEADERS = [
          'domain',
          'category',
          'total_citations',
          'results_citing',
          'usage_pct',
          'models',
        ];

        const rows = filteredDomainRows.map((r) => ({
          domain: r.domain,
          category: r.category,
          total_citations: r.totalCitations,
          results_citing: r.resultsCiting,
          usage_pct: r.usagePct,
          models: r.models.join(', '),
        }));

        const csv = toCsv(rows, DOMAIN_HEADERS);

        triggerDownload(csv, await exportFileName(`${slug}_citations_domains_${date}.csv`));
      } else if (sourceTab === 'urls' && data) {
        const URL_HEADERS = [
          'url',
          'domain',
          'category',
          'title',
          'total_citations',
          'results_citing',
          'usage_pct',
        ];

        const rows = filteredUrlRows.map((r) => ({
          url: r.url,
          domain: r.domain,
          category: r.category,
          title: r.title ?? '',
          total_citations: r.totalCitations,
          results_citing: r.resultsCiting,
          usage_pct: r.usagePct,
        }));

        const csv = toCsv(rows, URL_HEADERS);

        triggerDownload(csv, await exportFileName(`${slug}_citations_urls_${date}.csv`));
      } else if (sourceTab === 'gaps' && gaps) {
        const GAP_HEADERS = ['domain', 'category', 'competitor_answers', 'competitors', 'strength'];

        const rows = gaps.gapDomains.map((g) => ({
          domain: g.domain,
          category: g.category,
          competitor_answers: g.competitorAnswers,
          competitors: g.competitors.join('; '),
          strength: g.strength,
        }));

        const csv = toCsv(rows, GAP_HEADERS);

        triggerDownload(csv, await exportFileName(`${slug}_citations_gaps_${date}.csv`));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export CSV');
    } finally {
      setIsExporting(false);
    }
  }, [brand, data, gaps, sourceTab]);

  // Chat's side panel sees the page (W1-08): its dates and filters, the
  // source cited most, and the sources table to ask about.
  const scopeLabel = {
    all: tCommon('sourceAll'),
    own: tCommon('sourceBrand'),
    competitors: tCommon('sourceCompetitors'),
    third_party: tCommon('sourceThirdParty'),
  }[filters.sourceScope];
  const topSource = data?.rows.reduce<CitationDomainRow | null>(
    (best, row) => (!best || row.totalCitations > best.totalCitations ? row : best),
    null,
  );
  const topicName = topics.find((topic) => topic.id === filters.topic)?.name;
  const promptText = prompts.find((prompt) => prompt.id === filters.prompt)?.text;
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
              label: filters.platform
                ? (availablePlatforms.find((p) => p.value === filters.platform)?.label ??
                  getGroupedPlatformLabel(filters.platform))
                : tCommon('allPlatforms'),
              value: filters.platform,
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
            ...(filters.prompt && promptText
              ? [{ key: 'prompt', label: promptText, value: filters.prompt }]
              : []),
            { key: 'sources', label: scopeLabel, value: filters.sourceScope },
          ],
          suggestions: [
            ...(topSource && topSource.totalCitations > 0
              ? [tChat('citedMost', { domain: topSource.domain })]
              : []),
            tChat('citeRivals'),
            tChat('actions'),
          ],
          referenceables: [{ type: 'table', id: 'citations-sources', label: t('sourcesTitle') }],
        }
      : null,
  );

  const exportDisabled =
    isExporting ||
    isLoading ||
    sourceTab === 'types' ||
    (sourceTab === 'gaps' && (gapsLoading || !gaps));

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Globe className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h2 className="text-lg font-semibold">{t('noBrandTitle')}</h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('noBrandDescription')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{t('title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
          </div>
          <span
            title={
              sourceTab === 'types'
                ? 'Source Types is a chart breakdown, not exportable — switch to Domains, URLs, or Competitor Gaps to export.'
                : undefined
            }
          >
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleExportCsv}
              disabled={exportDisabled}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}

              {isExporting ? tCommon('exporting') : tCommon('exportCsv')}
            </Button>
          </span>
        </div>
      </HeaderWithAiUsage>

      <CitationsFilterBar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        topics={topics}
        prompts={prompts}
        platforms={platformChoices}
        regions={availableRegions}
      />

      {isLoading && data === null ? (
        <CitationsSkeleton />
      ) : (
        <div className="relative">
          {isRefetching && (
            <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-background/50 pt-32">
              <div className="flex items-center rounded-md border bg-background p-2.5 shadow-sm">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
          <div className={cn('space-y-6', isRefetching && 'opacity-60')}>
            <div className="grid gap-4 sm:grid-cols-3">
              {kpis.map((k) => (
                <KpiCard key={k.title} {...k} />
              ))}
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-1">
                  <CardTitle className="text-base">{t('sourcesTitle')}</CardTitle>
                  <AskAboutThis
                    reference={{ type: 'table', id: 'citations-sources', label: t('sourcesTitle') }}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {/* Only Domains and URLs are scoped by it — Competitor Gaps and
                  Source Types read the same data whatever it says — so it
                  appears with those two rather than standing over all four
                  claiming to narrow them. */}
                {(sourceTab === 'domains' || sourceTab === 'urls') && (
                  <SourceScopeFilter
                    value={filters.sourceScope}
                    onChange={(sourceScope) => setFilters((f) => ({ ...f, sourceScope }))}
                    className="mb-4"
                  />
                )}
                <Tabs
                  value={sourceTab}
                  onValueChange={(v) => setSourceTab(v as 'domains' | 'urls' | 'gaps' | 'types')}
                >
                  <TabsList>
                    <TabsTrigger value="domains">
                      {/* The scope's domains, as the table lists them; All counts every one. */}
                      {t('tabDomains')} ({filteredDomainRows.length})
                    </TabsTrigger>
                    <TabsTrigger value="urls">
                      {t('tabUrls')} ({data?.totals.urls ?? 0})
                    </TabsTrigger>
                    <TabsTrigger value="gaps">Competitor Gaps</TabsTrigger>
                    <TabsTrigger value="types">{t('sourceTypesTitle')}</TabsTrigger>
                  </TabsList>
                  {/* keepMounted: data is already in memory, so mount these panels
                    once and make switching a pure CSS visibility toggle (#299).
                    Competitor Gaps stays lazy — it fetches on activation. */}
                  <TabsContent value="domains" keepMounted className="mt-4">
                    <DomainsTable
                      rows={filteredDomainRows}
                      brandId={activeBrandId ?? ''}
                      onAdded={loadData}
                      page={domainPager.page}
                      onPage={domainPager.setPage}
                      filters={filters}
                      onResetFilters={() =>
                        setFilters({ ...DEFAULT_FILTERS, datePreset: 'all', sourceScope: 'all' })
                      }
                      hasAnyCitations={hasAnyCitations}
                      loadFailed={loadFailed}
                      onRetry={loadData}
                    />
                  </TabsContent>
                  <TabsContent value="urls" keepMounted className="mt-4">
                    <UrlsTable
                      rows={filteredUrlRows}
                      page={urlPager.page}
                      onPage={urlPager.setPage}
                      filters={filters}
                      onResetFilters={() =>
                        setFilters({ ...DEFAULT_FILTERS, datePreset: 'all', sourceScope: 'all' })
                      }
                      hasAnyCitations={hasAnyCitations}
                      loadFailed={loadFailed}
                      onRetry={loadData}
                    />
                  </TabsContent>
                  <TabsContent value="gaps" className="mt-4">
                    <CompetitorGapsTab loading={gapsLoading} gaps={gaps} />
                  </TabsContent>
                  <TabsContent value="types" keepMounted className="mt-4">
                    {/* Cap the width: the donut sizes itself to its container, and
                      an unbounded full-width chart dwarfs the legend (#486). */}
                    <div className="mx-auto w-full max-w-md">
                      <SourceTypeDonut
                        data={data?.sourceTypeBreakdown ?? []}
                        total={data?.totals.domains ?? 0}
                      />
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function CitationsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
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
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
