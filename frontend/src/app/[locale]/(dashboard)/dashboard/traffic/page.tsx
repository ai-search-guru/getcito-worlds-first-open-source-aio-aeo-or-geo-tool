'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPlatformFilterItems } from './_charts';
import { getPlatformName, movedPlatformOf, platformTableRows } from '@/lib/trafficPlatforms';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
const ReferralTrendChart = dynamic(() => import('./_charts').then((m) => m.ReferralTrendChart), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full" />,
});

const PlatformBreakdownChart = dynamic(
  () => import('./_charts').then((m) => m.PlatformBreakdownChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);
import { useTranslations } from 'next-intl';
import { useBrandStore } from '@/state/useBrandStore';
import { AskAboutThis } from '@/components/chat/panel/AskAboutThis';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import { rangeChipLabel } from '@/lib/chat/pageContext';
import type { Brand } from '@/types';
import {
  type TrafficSources,
  type TrafficSummary,
  type TrafficTrendPoint,
  type TrafficLog,
  type TrafficDateWindow,
} from '@/lib/actions/traffic';
import {
  ALL_DATE_PRESETS,
  DateRangeFilter,
  type DateRangePreset,
} from '@/components/filters/DateRangeFilter';
import { PagesCard } from './_PagesCard';
import { ConversionsSection } from './_conversions';
import { TrafficKpis } from './_kpis';
import { VisitListSourceNote } from './_VisitListNote';
import { EngagedCell, KeyEventsCell, PlatformValueNote } from './_PlatformValue';
import { ExportMenu, TableExport, useTrafficExport } from './_export';
import { SourcesStrip } from './_SourcesStrip';
import { useFirstSnippetCheck } from './_useFirstSnippetCheck';
import { SnippetBanner, SnippetDialog } from './_SnippetCode';
import { GoogleTrendView } from './_GoogleTrend';
import { GoogleSection } from './_GoogleSection';
import { BotsReportSection } from './_BotsReport';
import { NeedsTag } from './_SourceGate';
import { googleSourceStatus, snippetStateOf } from '@/lib/trafficSources';
import { useUserRole } from '@/hooks/useUserRole';
import { useLatestRequest } from '@/hooks/useLatestRequest';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Globe,
  TrendingUp,
  TrendingDown,
  LayoutList,
  Search,
  X,
  Loader2,
  CalendarX2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/formatRelative';
import { formatNumber } from '@/lib/format';
import { visitChange } from '@/lib/trafficChange';
import { browserStorage, readTrafficRange, writeTrafficRange } from '@/lib/trafficRange';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getTrafficLogs,
  getTrafficSources,
  getTrafficSummary,
  getTrafficTrend,
} from '@/lib/trafficReads';
import { RangeReadyProvider, rangeKeyOf, useRangeGate } from './_RangeReady';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const PAGE_SIZE = 10;

// ─── Sub-components ───────────────────────────────────────────────────────────

/**
 * A visit count against the previous period: a %, "new", "—", or "Low sample"
 * when either period is too small for a % to mean anything (AT-003, F4).
 * `comparable` is false when the range has no previous period (all time).
 */
function DeltaBadge({
  current,
  previous,
  comparable = true,
}: {
  current: number;
  previous: number;
  comparable?: boolean;
}) {
  const t = useTranslations('traffic.change');
  const change = visitChange(current, previous, { comparable });
  if (change.kind === 'none') return <span className="text-xs text-muted-foreground">—</span>;
  if (change.kind === 'low') {
    return (
      <span
        title={t('lowSampleHint')}
        className="whitespace-nowrap rounded-md border border-dashed px-1.5 text-[11px] font-medium leading-4 text-muted-foreground"
      >
        {t('lowSample')}
      </span>
    );
  }
  if (change.kind === 'new') {
    return (
      <span className="flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <TrendingUp className="h-3 w-3" />
        {t('new')}
      </span>
    );
  }
  const pos = change.pct > 0;
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 whitespace-nowrap text-xs font-medium',
        pos ? 'text-green-600 dark:text-green-400' : 'text-red-500',
      )}
    >
      {pos ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {pos ? '+' : ''}
      {formatNumber(change.pct)}%
    </span>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

interface TrafficFilters {
  platform: string;
  search: string;
}

function TrafficFilterBar({
  searchInput,
  onSearchInputChange,
  filters,
  onChange,
  platforms,
  isLoading,
}: {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  filters: TrafficFilters;
  onChange: (patch: Partial<TrafficFilters>) => void;
  platforms: string[];
  isLoading: boolean;
}) {
  const t = useTranslations('traffic');
  const hasActiveFilters = filters.platform || filters.search;
  const platformItems = getPlatformFilterItems(platforms, t('allPlatforms'));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[240px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          placeholder={t('searchPlaceholder')}
          value={searchInput}
          onChange={(e) => onSearchInputChange(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>

      <Select
        value={filters.platform || ''}
        onValueChange={(v) => onChange({ platform: v || '' })}
        items={platformItems}
      >
        <SelectTrigger className="w-40 h-9 text-sm">
          <SelectValue placeholder={t('allPlatforms')} />
        </SelectTrigger>
        <SelectContent>
          {platformItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() => {
            onSearchInputChange('');
            onChange({ platform: '', search: '' });
          }}
          disabled={isLoading}
        >
          <X className="h-3.5 w-3.5" />
          {t('clearFilters')}
        </Button>
      )}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function TablePager({
  page,
  totalPages,
  total,
  start,
  end,
  onPage,
  isLoading,
}: {
  page: number;
  totalPages: number;
  total: number;
  start: number;
  end: number;
  onPage: (p: number) => void;
  isLoading: boolean;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <span className="text-xs text-muted-foreground tabular-nums">
        {start + 1}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page === 0 || isLoading}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={page >= totalPages - 1 || isLoading}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyLogsState({ hasFilters }: { hasFilters: boolean }) {
  const t = useTranslations('traffic');
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Search className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h3 className="text-sm font-medium">{t('noMatchingVisitsTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md">
          {t('noMatchingVisitsDescription')}
        </p>
      </div>
    );
  } else {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <LayoutList className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <h3 className="text-sm font-medium">{t('noVisitsTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md">{t('noVisitsDescription')}</p>
      </div>
    );
  }
}

function NoTrafficForPeriod({
  rangeLabel,
  onReset,
  onShowWeek,
}: {
  rangeLabel: string;
  onReset: () => void;
  /** The 24-hour range offers the last 7 days first (AT-017). */
  onShowWeek?: () => void;
}) {
  const t = useTranslations('traffic');
  return (
    <Card>
      <CardContent className="py-16 text-center">
        <CalendarX2 className="h-10 w-10 mx-auto text-muted-foreground/50" />
        <h3 className="text-lg font-semibold mt-4">{t('noTrafficInPeriodTitle')}</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          {t('noTrafficInPeriodDescription', { range: rangeLabel })}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {onShowWeek && (
            <Button variant="outline" size="sm" onClick={onShowWeek}>
              {t('visits.showLast7Days')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onReset}>
            {t('showAllData')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Date range ─────────────

// The preset vocabulary is shared with the control that renders it (#713).
type DatePreset = DateRangePreset;

const DATE_PRESETS = ALL_DATE_PRESETS;

function getDateRange(preset: DatePreset, custom: { from: string; to: string }): TrafficDateWindow {
  if (preset === 'all') return {};
  if (preset === 'custom') {
    return {
      dateFrom: custom.from || undefined,
      dateTo: custom.to ? `${custom.to}T23:59:59.999Z` : undefined,
    };
  }
  if (preset === '24h') {
    const from = new Date();
    from.setHours(from.getHours() - 24);
    return { dateFrom: from.toISOString() };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { dateFrom: from.toISOString() };
}

function getRangeSubLabel(preset: DatePreset, custom: { from: string; to: string }): string {
  switch (preset) {
    case '24h':
      return 'last 24 hours';
    case '7d':
      return 'last 7 days';
    case '30d':
      return 'last 30 days';
    case '90d':
      return 'last 90 days';
    case 'all':
      return 'all time';
    case 'custom':
      if (custom.from && custom.to) return `${custom.from} – ${custom.to}`;
      if (custom.from) return `from ${custom.from}`;
      if (custom.to) return `through ${custom.to}`;
      return 'selected period';
  }
}

function getTrendTitle(preset: DatePreset, custom: { from: string; to: string }): string {
  switch (preset) {
    case '24h':
      return 'AI Referral Trend — Last 24 Hours';
    case '7d':
      return 'AI Referral Trend — Last 7 Days';
    case '30d':
      return 'AI Referral Trend — Last 30 Days';
    case '90d':
      return 'AI Referral Trend — Last 90 Days';
    case 'all':
      return 'AI Referral Trend — All Time';
    case 'custom':
      if (custom.from && custom.to) return `AI Referral Trend — ${custom.from} – ${custom.to}`;
      return 'AI Referral Trend';
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TrafficPage() {
  const t = useTranslations('traffic');
  const brand = useBrandStore((s) => s.getActiveBrand());
  if (!brand) {
    return (
      <div className="flex flex-col justify-center items-center py-20 text-center">
        <h2 className="font-semibold text-lg">{t('noBrandTitle')}</h2>
        <p className="mt-1 text-muted-foreground text-sm">{t('noBrandDescription')}</p>
      </div>
    );
  }
  return <TrafficPageContent key={brand.id} brand={brand} />;
}

function TrafficPageContent({ brand }: { brand: Brand }) {
  const t = useTranslations('traffic');
  // The tag follows AI visitors to conversions once the brand turned them on (CE-017).
  const conversions = brand.conversionsEnabled ? (brand.conversionsConsent ?? 'wait') : null;
  const tCommon = useTranslations('common');
  const tVisits = useTranslations('traffic.visits');
  const tTrend = useTranslations('traffic.trend');
  const tChat = useTranslations('chatPanel.suggest');
  const tChatRange = useTranslations('chatPanel.range');
  // The page opens on the member's last range, or the last 24 hours (AT-017,
  // spec §3.01). This only renders in the browser, once the brand has loaded,
  // so the stored choice is read before the first load rather than after it.
  const [initialRange] = useState(() => readTrafficRange(browserStorage()));
  const [datePreset, setDatePreset] = useState<DatePreset>(initialRange.preset);
  const [customFrom, setCustomFrom] = useState(initialRange.from);
  const [customTo, setCustomTo] = useState(initialRange.to);
  useEffect(() => {
    writeTrafficRange(browserStorage(), { preset: datePreset, from: customFrom, to: customTo });
  }, [datePreset, customFrom, customTo]);
  const dateWindow = useMemo(
    () => getDateRange(datePreset, { from: customFrom, to: customTo }),
    [datePreset, customFrom, customTo],
  );
  const rangeSubLabel = getRangeSubLabel(datePreset, { from: customFrom, to: customTo });
  const trendTitle = getTrendTitle(datePreset, { from: customFrom, to: customTo });
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [trend, setTrend] = useState<TrafficTrendPoint[]>([]);
  const [trendView, setTrendView] = useState<'platforms' | 'google'>('platforms');
  // Bumped when Google queries are tracked, so the summary line counts again (AT-009).
  const [queriesRevision, setQueriesRevision] = useState(0);
  // Bumped when an AI-bot connection is made or revoked, so the sources
  // strip's card and the bot report read it again (AT-010, AT-011).
  const [botsRevision, setBotsRevision] = useState(0);
  const [logs, setLogs] = useState<TrafficLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPageviews, setLogsPageviews] = useState(0);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  // The range the summary and the visit list on screen answer, read or failed.
  const rangeKey = rangeKeyOf(dateWindow);
  const [summaryRange, setSummaryRange] = useState<string | null>(null);
  const [logsRange, setLogsRange] = useState<string | null>(null);
  // What feeds the page (AT-001); null while it loads.
  const [sources, setSources] = useState<TrafficSources | null>(null);
  // A failed read hides the strip and leaves the snippet code open, as before it.
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const { canManage } = useUserRole();

  const loadSources = useCallback(async () => {
    try {
      setSources(await getTrafficSources(brand.id));
      setSourcesFailed(false);
    } catch (err) {
      console.error('Failed to load traffic sources:', err);
      setSourcesFailed(true);
    }
  }, [brand.id]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const [filters, setFilters] = useState<TrafficFilters>({ platform: '', search: '' });
  const [searchInput, setSearchInput] = useState(filters.search);
  const [page, setPage] = useState(0);
  // The page as files (AT-015): the same range, and the visit list's filters.
  const exporter = useTrafficExport({
    brandId: brand.id,
    dateWindow,
    rangeLabel: rangeSubLabel,
    platform: filters.platform,
    search: filters.search,
  });

  useEffect(() => {
    const id = window.setTimeout(() => {
      setFilters((prevFilters) => {
        if (prevFilters.search === searchInput) {
          return prevFilters;
        }
        setPage(0);
        return {
          ...prevFilters,
          search: searchInput,
        };
      });
    }, 300);

    return () => window.clearTimeout(id);
  }, [searchInput]);

  // The reads run side by side (/api/traffic/read), so they can answer out of
  // order: 90d then 24h, or "pri" then "pricing". Only the latest request of
  // each loader sets state.
  const startSummary = useLatestRequest();
  const startLogs = useLatestRequest();

  const loadSummary = useCallback(async () => {
    const latest = startSummary();
    const range = rangeKeyOf(dateWindow);
    setIsLoadingSummary(true);
    try {
      const [s, t] = await Promise.all([
        getTrafficSummary(brand.id, dateWindow),
        getTrafficTrend(brand.id, dateWindow),
      ]);
      if (!latest()) return;
      setSummary(s);
      setTrend(t);
    } catch (err) {
      if (latest()) console.error('Failed to load traffic summary:', err);
    } finally {
      if (latest()) {
        setIsLoadingSummary(false);
        setSummaryRange(range);
      }
    }
  }, [brand.id, dateWindow, startSummary]);

  const loadLogs = useCallback(async () => {
    const latest = startLogs();
    const range = rangeKeyOf(dateWindow);
    setIsLoadingLogs(true);
    try {
      const result = await getTrafficLogs(brand.id, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        platform: filters.platform || undefined,
        search: filters.search || undefined,
        dateFrom: dateWindow.dateFrom,
        dateTo: dateWindow.dateTo,
      });
      if (!latest()) return;
      setLogs(result.logs);
      setLogsTotal(result.total);
      setLogsPageviews(result.pageviews);
    } catch (err) {
      if (latest()) console.error('Failed to load traffic logs:', err);
    } finally {
      if (latest()) {
        setIsLoadingLogs(false);
        setLogsRange(range);
      }
    }
  }, [brand.id, page, filters.platform, filters.search, dateWindow, startLogs]);

  const handleFiltersChange = useCallback((patch: Partial<TrafficFilters>) => {
    setPage(0);
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  const handleDatePresetChange = useCallback((preset: DatePreset) => {
    setPage(0);
    setDatePreset(preset);
  }, []);

  const handleCustomFromChange = useCallback((value: string) => {
    setPage(0);
    setCustomFrom(value);
  }, []);

  const handleCustomToChange = useCallback((value: string) => {
    setPage(0);
    setCustomTo(value);
  }, []);

  // Apart, so a visit-list page or filter reads only the list.
  useEffect(() => {
    const id = window.setTimeout(() => void loadSummary(), 0);
    return () => window.clearTimeout(id);
  }, [loadSummary]);
  useEffect(() => {
    const id = window.setTimeout(() => void loadLogs(), 0);
    return () => window.clearTimeout(id);
  }, [loadLogs]);

  const primaryDomain = brand.domains.find((d) => d.isPrimary)?.domain ?? brand.domains[0]?.domain;
  // A brand never checked for the snippet is checked once as the page opens.
  const snippetChecking = useFirstSnippetCheck({
    brandId: brand.id,
    sources,
    domain: primaryDomain,
    onChecked: () => void loadSources(),
  });

  // A new range shows only a spinner until the page and every section have
  // its data, rather than one range's numbers beside another's.
  const rangeGate = useRangeGate(
    rangeKey,
    summaryRange === rangeKey && logsRange === rangeKey && (sources !== null || sourcesFailed),
  );
  const rangeSpinner = (
    <div className="flex justify-center py-24" role="status" aria-label={t('loadingRange')}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );

  // No early spinner for the first read: the gate shows it, and the sections
  // stay mounted behind it, so they read alongside the summary.
  const totalVisits = summary?.totalVisits ?? 0;
  // From the summary, not the selected range: while a new range loads, the
  // numbers on screen are still the previous range's.
  const comparable = summary?.hasPreviousPeriod ?? false;
  // Analytics isn't ready for this brand: the platform table's engagement
  // columns show "—", as the KPI cards do, and say what they need (AT-005,
  // §3.8b's partial note) — even with rows left from an earlier connection.
  const gaMissing =
    !sourcesFailed && sources !== null && googleSourceStatus(sources.ga) !== 'connected';
  // The trend's Google line reads Search Console once it has data, or when
  // the states couldn't be read, as the Google clicks card does; null while
  // they load (AT-008).
  const gscConnected = sources
    ? googleSourceStatus(sources.gsc) === 'connected'
    : sourcesFailed || null;

  // Where the tracking snippet stands (00433); null while the sources load or couldn't be read.
  const snippet = sources ? snippetStateOf(sources) : null;

  const isEmpty = totalVisits === 0 && logs.length === 0;
  const hasAnyData = summary?.hasAnyData ?? false;
  const trulyEmpty = isEmpty && !hasAnyData;

  // Pages: which answers send visitors (AT-006), in the page's range. It
  // replaces "Pages AI engines aren't sending traffic to" (#719, AT-002),
  // whose list is now its No AI traffic tab, and reads the snippet,
  // Analytics, citations and the sitemap; without Analytics it says what's
  // partial rather than hiding.
  // Where AI visitors convert (AT-014, spec §3.4b): Google Analytics' own
  // sessions, so it shows even when the snippet saw no visit in the range; a
  // thin range reads the last 30 days.
  const conversionsSection = (
    <ConversionsSection
      brandId={brand.id}
      dateWindow={dateWindow}
      rangeLabel={rangeSubLabel}
      source={sourcesFailed ? null : (sources?.ga ?? null)}
      domain={primaryDomain}
      canConnect={canManage}
      onConnected={() => void loadSources()}
      pagesActions={<TableExport exporter={exporter} section="convertingPages" />}
      answersActions={<TableExport exporter={exporter} section="buyerAnswers" />}
    />
  );

  const pagesCard = (
    <PagesCard
      brandId={brand.id}
      dateWindow={dateWindow}
      rangeLabel={rangeSubLabel}
      domain={primaryDomain}
      analyticsMissing={gaMissing}
      actions={<TableExport exporter={exporter} section="pageStatus" />}
      brokenActions={<TableExport exporter={exporter} section="brokenLinks" />}
    />
  );

  // Google Search Console (AT-008, AT-009, spec §3.6): pages whose
  // impressions rose while their CTR fell, and the queries no tracked prompt
  // covers. Search Console's own data, so it shows even when the snippet saw
  // no visit in the range.
  const googleSection = (
    <GoogleSection
      brandId={brand.id}
      dateWindow={dateWindow}
      rangeLabel={rangeSubLabel}
      source={sourcesFailed ? null : (sources?.gsc ?? null)}
      domain={primaryDomain}
      canConnect={canManage}
      onConnected={() => void loadSources()}
      canTrack={canManage}
      onQueriesTracked={() => setQueriesRevision((n) => n + 1)}
      pagesActions={<TableExport exporter={exporter} section="googlePages" />}
      queriesActions={<TableExport exporter={exporter} section="googleQueries" />}
    />
  );

  // AI bots reading the site (AT-011, spec §3.7): from the brand's own
  // Cloudflare or Vercel, so it shows even when the snippet saw no visit.
  const botsSection = (
    <BotsReportSection
      brandId={brand.id}
      dateWindow={dateWindow}
      // The bot counters are by UTC day, so 24 hours read yesterday and today.
      rangeLabel={datePreset === '24h' ? t('botReport.yesterdayAndToday') : rangeSubLabel}
      canConnect={canManage}
      revision={botsRevision}
      onChanged={() => setBotsRevision((n) => n + 1)}
      typesActions={<TableExport exporter={exporter} section="bots" />}
      pagesActions={<TableExport exporter={exporter} section="botPages" />}
    />
  );

  // Chat's side panel sees the page (W1-08): its range and platform, the
  // platform whose visits moved most, and the two tables to ask about.
  const movedPlatform = movedPlatformOf(summary);
  useChatPageContext({
    dateRange: {
      from: datePreset === 'custom' ? customFrom : datePreset,
      to: datePreset === 'custom' ? customTo : null,
      label: rangeChipLabel(datePreset, { from: customFrom, to: customTo }, (key, values) =>
        tChatRange(key, values),
      ),
    },
    filters: [
      {
        key: 'platform',
        label: filters.platform ? getPlatformName(filters.platform) : tCommon('allPlatforms'),
        value: filters.platform,
      },
    ],
    suggestions: [
      ...(movedPlatform
        ? [
            tChat(movedPlatform.change < 0 ? 'trafficDrop' : 'trafficRise', {
              platform: movedPlatform.name,
            }),
          ]
        : []),
      tChat('trafficPages'),
      tChat('actions'),
    ],
    referenceables: [
      { type: 'table', id: 'traffic-platforms', label: t('chat.platformsTable') },
      { type: 'table', id: 'traffic-pages', label: t('chat.pagesTable') },
    ],
  });

  return (
    <div className="space-y-6">
      {/* Header: the meter and Ask Chat at its bottom, beside the range's buttons. */}
      <HeaderWithAiUsage align="end">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AI Traffic Analytics</h1>
            <p className="text-muted-foreground text-sm">
              {primaryDomain ? `${primaryDomain} · ` : ''}AI-referred visits to your website
            </p>
          </div>
          {/* items-end, not items-center: the range control is two rows tall
              (its label sits above the buttons), so centring left the Export
              button floating above the segmented control's baseline. */}
          <div className="flex flex-wrap items-end gap-3">
            <DateRangeFilter
              value={datePreset}
              presets={DATE_PRESETS}
              onChange={handleDatePresetChange}
              from={customFrom}
              to={customTo}
              onFromChange={handleCustomFromChange}
              onToChange={handleCustomToChange}
            />
            <ExportMenu exporter={exporter} />
          </div>
        </div>
      </HeaderWithAiUsage>

      {!rangeGate.settled && rangeSpinner}
      <RangeReadyProvider value={rangeGate.value}>
        {/* Kept mounted while hidden, so every section reads the new range
            side by side; laid out at full width, so charts measure right. */}
        <div
          className={cn('space-y-6', !rangeGate.settled && 'invisible h-0 overflow-hidden')}
          aria-hidden={!rangeGate.settled || undefined}
        >
          {!sourcesFailed && (
            <SourcesStrip
              brandId={brand.id}
              sources={sources}
              domain={primaryDomain}
              snippetChecking={snippetChecking}
              hasTrackingCode={Boolean(brand.trackingCode)}
              canConnect={canManage}
              onShowCode={() => setCodeOpen(true)}
              onConnected={() => void loadSources()}
              botsRevision={botsRevision}
              onBotsChanged={() => setBotsRevision((n) => n + 1)}
            />
          )}
          {/* The code stays open only while the snippet isn't seen on the site (F3, 00433). */}
          {(sourcesFailed || snippet === 'not_detected') && (
            <SnippetBanner
              trackingCode={brand.trackingCode}
              conversions={conversions}
              check={
                sources
                  ? {
                      brandId: brand.id,
                      domain: primaryDomain,
                      checkedAt: sources.snippetCheckedAt,
                      busy: snippetChecking,
                      onFound: () => void loadSources(),
                    }
                  : undefined
              }
            />
          )}
          <SnippetDialog
            trackingCode={brand.trackingCode}
            conversions={conversions}
            open={codeOpen}
            onOpenChange={setCodeOpen}
          />

          {trulyEmpty ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Globe className="h-10 w-10 mx-auto text-muted-foreground/50" />
                <h3 className="text-lg font-semibold mt-4">{t('noDataTitle')}</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                  {snippet === 'not_detected'
                    ? t('noDataDescriptionNoSnippet')
                    : t('noVisitsDescription')}
                </p>
              </CardContent>
            </Card>
          ) : isEmpty ? (
            <NoTrafficForPeriod
              rangeLabel={rangeSubLabel}
              onReset={() => handleDatePresetChange('all')}
              onShowWeek={datePreset === '24h' ? () => handleDatePresetChange('7d') : undefined}
            />
          ) : null}
          {!isEmpty && (
            <>
              {/* KPI cards: two rows of four (AT-017, spec §3.2). */}
              <TrafficKpis
                brandId={brand.id}
                rangeLabel={rangeSubLabel}
                dateWindow={dateWindow}
                preset={datePreset}
                summary={summary}
                summaryLoading={isLoadingSummary}
                sources={sources}
                sourcesFailed={sourcesFailed}
                canConnect={canManage}
                onConnected={() => void loadSources()}
                onRangeChange={handleDatePresetChange}
                queriesRevision={queriesRevision}
              />

              {/* Charts row */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="font-medium text-sm">{trendTitle}</CardTitle>
                        {trendView === 'google' && <NeedsTag provider="google-search-console" />}
                      </div>
                      {/* By platform, or AI visits against Google clicks (AT-008, spec §3.3). */}
                      <Tabs
                        value={trendView}
                        onValueChange={(v) => setTrendView(v as 'platforms' | 'google')}
                      >
                        <TabsList variant="line" aria-label={trendTitle}>
                          <TabsTrigger value="platforms">{tTrend('tabs.platforms')}</TabsTrigger>
                          <TabsTrigger value="google">{tTrend('tabs.google')}</TabsTrigger>
                        </TabsList>
                      </Tabs>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {trendView === 'google' ? (
                      <GoogleTrendView
                        brandId={brand.id}
                        trend={trend}
                        rangeStart={dateWindow.dateFrom}
                        gscConnected={gscConnected}
                        onShowWeek={() => handleDatePresetChange('7d')}
                      />
                    ) : (
                      <ReferralTrendChart data={trend} analyticsDays={summary?.analyticsDays} />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Platform Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <PlatformBreakdownChart data={summary?.platformBreakdown ?? []} />
                  </CardContent>
                </Card>
              </div>

              {/* Tables row: side by side from 1,280px. The platform table's five
              columns (AT-005) need more than half the page below that, and
              numeric cells never wrap (spec §3.2). */}
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {/* Platform table */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <CardTitle className="text-sm font-medium">Referrals by Platform</CardTitle>
                        <AskAboutThis
                          reference={{
                            type: 'table',
                            id: 'traffic-platforms',
                            label: t('chat.platformsTable'),
                          }}
                        />
                      </div>
                      <TableExport exporter={exporter} section="platforms" />
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Platform</TableHead>
                          <TableHead className="text-right">Visits</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          {/* From Google Analytics (AT-005). */}
                          <TableHead className="text-right">{t('platforms.engaged')}</TableHead>
                          <TableHead className="text-right pr-6">
                            {t('platforms.keyEvents')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {platformTableRows(summary?.platformBreakdown ?? []).map((row) => (
                          <TableRow
                            key={`${row.platform}|${row.surface ?? ''}`}
                            className="hover:bg-muted/50"
                          >
                            <TableCell className={row.surface ? 'pl-10' : 'pl-6'}>
                              {row.surface ? (
                                // Part of its platform's row above (#1283).
                                <span
                                  className="text-sm text-muted-foreground"
                                  title={t(`platforms.surfaceTips.${row.surface}`, {
                                    platform: getPlatformName(row.platform),
                                  })}
                                >
                                  {t(`platforms.surfaceNames.${row.surface}`, {
                                    platform: getPlatformName(row.platform),
                                  })}
                                </span>
                              ) : (
                                <span className="font-medium text-sm">
                                  {getPlatformName(row.platform)}
                                </span>
                              )}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                row.surface ? 'text-muted-foreground' : 'font-semibold',
                              )}
                            >
                              {formatNumber(row.visits)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end">
                                <DeltaBadge
                                  current={row.visits}
                                  previous={row.visitsPrev}
                                  comparable={comparable}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <EngagedCell analytics={gaMissing ? null : row.analytics} />
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              <KeyEventsCell analytics={gaMissing ? null : row.analytics} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {gaMissing && <PlatformValueNote />}
                  </CardContent>
                </Card>

                {/* Top Pages */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <CardTitle className="text-sm font-medium">Top Landing Pages</CardTitle>
                        <AskAboutThis
                          reference={{
                            type: 'table',
                            id: 'traffic-pages',
                            label: t('chat.pagesTable'),
                          }}
                        />
                      </div>
                      <TableExport exporter={exporter} section="pages" />
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-6">Page</TableHead>
                          <TableHead className="text-right">Visits</TableHead>
                          <TableHead className="text-right">Change</TableHead>
                          {/* How often tracked AI answers cite the page (AT-006). */}
                          <TableHead className="text-right pr-6">
                            {t('pageList.columns.citedInAnswers')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(summary?.topPages ?? []).map((row) => (
                          <TableRow key={row.url} className="hover:bg-muted/50">
                            <TableCell className="pl-6 max-w-[200px]">
                              <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                                {row.url}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-sm">
                              {formatNumber(row.visits)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end">
                                <DeltaBadge
                                  current={row.visits}
                                  previous={row.visitsPrev}
                                  comparable={comparable}
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right pr-6 tabular-nums text-sm">
                              {formatNumber(row.citations)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
          {/* In one place whether the range has visits or not, so a range
              that has none (or some again) keeps these sections and their
              data rather than mounting them anew and reading it again. */}
          {conversionsSection}
          {pagesCard}
          {googleSection}
          {botsSection}
          {!isEmpty && (
            <>
              {/* Recent Visit Log with filtering and pagination*/}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <LayoutList className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">
                          Recent AI Referral Visits
                        </CardTitle>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {logsTotal > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {tVisits('listTotal', { visits: logsTotal, pageviews: logsPageviews })}
                          </Badge>
                        )}
                        <TableExport exporter={exporter} section="visits" />
                      </div>
                    </div>
                    <TrafficFilterBar
                      filters={filters}
                      searchInput={searchInput}
                      onSearchInputChange={setSearchInput}
                      onChange={handleFiltersChange}
                      platforms={summary?.platformBreakdown.map((p) => p.platform) ?? []}
                      isLoading={isLoadingLogs}
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {isLoadingLogs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (filters.platform || filters.search) && logs.length === 0 ? (
                    <EmptyLogsState hasFilters={true} />
                  ) : logs.length === 0 ? (
                    <EmptyLogsState hasFilters={false} />
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-6 w-[100px]">Time</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead>Page</TableHead>
                            <TableHead className="text-right pr-6">Country</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {logs.map((row) => (
                            <TableRow key={row.id} className="hover:bg-muted/50">
                              <TableCell className="pl-6 text-xs text-muted-foreground whitespace-nowrap">
                                {formatRelative(row.createdAt, tCommon)}
                              </TableCell>
                              <TableCell>
                                <span className="text-sm">
                                  {getPlatformName(row.sourcePlatform ?? 'unknown')}
                                </span>
                              </TableCell>
                              <TableCell>
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <span className="font-mono text-xs text-muted-foreground line-clamp-1">
                                    {(() => {
                                      try {
                                        return new URL(row.url).pathname;
                                      } catch {
                                        return row.url;
                                      }
                                    })()}
                                  </span>
                                  {/* A reload or a further link in the same visit (AT-003). */}
                                  {row.pageviews > 1 && (
                                    <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-1.5 text-[11px] font-medium leading-4 text-muted-foreground">
                                      {tVisits('rowPageviews', { count: row.pageviews })}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right pr-6">
                                <span className="text-xs text-muted-foreground">
                                  {row.country ?? '—'}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {(() => {
                        const totalPages = Math.max(1, Math.ceil(logsTotal / PAGE_SIZE));
                        const clampedPage = Math.min(page, totalPages - 1);
                        const start = clampedPage * PAGE_SIZE;
                        const end = Math.min(start + PAGE_SIZE, logsTotal);
                        return (
                          <TablePager
                            page={clampedPage}
                            totalPages={totalPages}
                            total={logsTotal}
                            start={start}
                            end={end}
                            onPage={setPage}
                            isLoading={isLoadingLogs}
                          />
                        );
                      })()}
                      {/* What the list covers, and a wider range when it is a short one
                      (AT-017, spec §3.01). */}
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 pb-1 text-xs text-muted-foreground">
                        <span>
                          {tVisits('listRange', {
                            visits: logsTotal,
                            pageviews: logsPageviews,
                            range: rangeSubLabel,
                            preset:
                              datePreset === 'custom' || datePreset === 'all' ? 'other' : 'last',
                          })}
                        </span>
                        {datePreset === '24h' && (
                          <button
                            type="button"
                            onClick={() => handleDatePresetChange('7d')}
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                          >
                            {tVisits('showLast7Days')}
                          </button>
                        )}
                      </div>
                      <VisitListSourceNote analyticsDays={summary?.analyticsDays.length ?? 0} />
                      <p className="px-6 pb-4 text-xs text-muted-foreground">
                        {tVisits('listNote')}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </RangeReadyProvider>
    </div>
  );
}
