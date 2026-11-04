'use client';

/**
 * Per-URL citation detail page (#535): everything one cited URL is doing for
 * the brand — the answers citing it, the prompts triggering it and, for
 * brand-owned URLs, the targeting + AI-referred traffic bridges. Keyed by
 * `?u=<encoded-url>`; scoped by the shared citations filter bar so counts
 * agree with the overview for the same URL, window and filters.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/state/useBrandStore';
import {
  getCitationUrlDetail,
  type CitationsDatePreset,
  type CitationsFilters,
  type CitationUrlDetail,
} from '@/lib/actions/citations';
import {
  CitationsFilterBar,
  DEFAULT_CITATIONS_FILTERS,
  buildPlatformOptions,
  getDateRange,
  getPlatformDisplayLabel,
  type CitationsUIFilters,
} from '@/components/citations/FilterBar';
import { AddCompetitorButton } from '@/components/citations/AddCompetitorButton';
import { CategoryBadge, DomainFavicon, PlatformsCell } from '@/components/citations/SourceCells';
import { PositionLabel } from '@/components/PositionLabel';
import { TablePager, usePagination } from '@/components/TablePager';
import { Badge } from '@/components/ui/badge';
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
import {
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Layers,
  ListChecks,
  MessagesSquare,
  Quote,
  Target,
  TrendingUp,
} from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

const CITED_IN_PAGE_SIZE = 10;
const DATE_PRESET_VALUES: CitationsDatePreset[] = ['24h', '7d', '30d', '90d', 'all', 'custom'];

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
        <div className="text-2xl font-bold tabular-nums truncate">{value}</div>
        <p className="text-xs mt-1 text-muted-foreground truncate">{sub}</p>
      </CardContent>
    </Card>
  );
}

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] font-medium capitalize',
        sentiment === 'positive' &&
          'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        sentiment === 'negative' &&
          'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      )}
    >
      {sentiment}
    </Badge>
  );
}

export default function CitationUrlDetailPage() {
  const { getActiveBrand } = useBrandStore();
  const brand = getActiveBrand();
  const searchParams = useSearchParams();
  const targetUrl = searchParams.get('u') ?? '';

  const [filters, setFilters] = useState<CitationsUIFilters>(() => {
    const presetParam = searchParams.get('preset');
    const preset = DATE_PRESET_VALUES.includes(presetParam as CitationsDatePreset)
      ? (presetParam as CitationsDatePreset)
      : DEFAULT_CITATIONS_FILTERS.datePreset;
    return {
      ...DEFAULT_CITATIONS_FILTERS,
      datePreset: preset,
      dateFrom: searchParams.get('from') ?? '',
      dateTo: searchParams.get('to') ?? '',
      platform: searchParams.get('platform') ?? '',
      region: searchParams.get('region') ?? '',
    };
  });
  const [data, setData] = useState<CitationUrlDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const activeBrandId = brand?.id ?? null;
  const filterKey = JSON.stringify(filters);
  const citedInPager = usePagination(data?.occurrences.length ?? 0, filterKey, CITED_IN_PAGE_SIZE);
  const promptGroupsPager = usePagination(
    data?.promptGroups.length ?? 0,
    filterKey,
    CITED_IN_PAGE_SIZE,
  );

  const apiFilters = useMemo<CitationsFilters>(() => {
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
    };
  }, [filters.datePreset, filters.dateFrom, filters.dateTo, filters.platform, filters.region]);

  const loadData = useCallback(async () => {
    if (!activeBrandId || !targetUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    try {
      setData(await getCitationUrlDetail(activeBrandId, targetUrl, apiFilters));
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [activeBrandId, targetUrl, apiFilters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const platformOptions = useMemo(
    () => (data ? buildPlatformOptions([{ models: data.totals.models }]) : []),
    [data],
  );

  const pageOccurrences = data?.occurrences.slice(citedInPager.start, citedInPager.end) ?? [];
  const pagePromptGroups =
    data?.promptGroups.slice(promptGroupsPager.start, promptGroupsPager.end) ?? [];

  if (!targetUrl) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">
          No URL provided. Open this page from a citation row on the Citations page.
        </p>
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">Select a brand from the top switcher first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          {/* The back link's line takes the page's button, beside Ask Chat. */}
          <div className="flex items-center justify-between gap-3">
            <BackLink />
            <div className="shrink-0">
              {data &&
                (data.category === 'you' ? (
                  <Badge className="border border-primary/30 bg-primary/10 text-foreground">
                    Owned
                  </Badge>
                ) : (
                  <AddCompetitorButton
                    brandId={brand.id}
                    domain={data.domain}
                    onAdded={loadData}
                    appearance="button"
                  />
                ))}
            </div>
          </div>
          {/* Header */}
          <div className="mt-2 flex items-start gap-3 min-w-0">
            <div className="pt-1">
              <DomainFavicon domain={data?.domain || extractDisplayHost(targetUrl)} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight leading-tight break-all">
                {data?.title || targetUrl}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <a
                  href={targetUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex max-w-[560px] items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  <span className="truncate">{targetUrl}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
                {data && <CategoryBadge category={data.category} />}
                {data?.articleType && (
                  <Badge variant="outline" className="text-[10px] font-medium">
                    {data.articleType}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>
      </HeaderWithAiUsage>

      {/* Filters */}
      <CitationsFilterBar
        filters={filters}
        onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
        platforms={platformOptions}
        regions={[]}
      />

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-[320px]" />
        </div>
      ) : !data || data.totals.answers === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {loadFailed
              ? 'Could not load this URL — please try again.'
              : 'No citations recorded for this URL in the selected window.'}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              title="Total citations"
              value={formatNumber(data.totals.citations)}
              sub={`across ${data.totals.answers} answers`}
              icon={Quote}
            />
            <KpiCard
              title="Answers citing"
              value={formatNumber(data.totals.answers)}
              sub="AI answers include this URL"
              icon={MessagesSquare}
            />
            <KpiCard
              title="Prompts"
              value={formatNumber(data.totals.prompts)}
              sub="distinct prompts triggering it"
              icon={ListChecks}
            />
            <KpiCard
              title="Platforms"
              value={String(
                new Set(data.totals.models.map((m) => getPlatformDisplayLabel(m))).size,
              )}
              sub={Array.from(new Set(data.totals.models.map((m) => getPlatformDisplayLabel(m))))
                .sort()
                .join(', ')}
              icon={Layers}
            />
            <KpiCard
              title="Last seen"
              value={formatDate(data.totals.lastSeen)}
              sub={`first seen ${formatDate(data.totals.firstSeen)}`}
              icon={Clock}
            />
          </div>

          {/* Owned-URL bridges */}
          {data.owned && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Targeted in {data.owned.targetingPrompts.length} prompt
                    {data.owned.targetingPrompts.length === 1 ? '' : 's'}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Prompts tracking this URL as a target in the prompt workflow
                  </p>
                </CardHeader>
                <CardContent>
                  {data.owned.targetingPrompts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Not targeted yet — add it from a prompt&apos;s Target URLs card.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {data.owned.targetingPrompts.map((tp) => (
                        <li key={tp.promptId} className="flex items-center gap-3 py-2">
                          <Link
                            href={`/dashboard/prompts/${tp.promptId}`}
                            className="flex-1 truncate text-sm hover:underline"
                            title={tp.promptText}
                          >
                            {tp.promptText}
                          </Link>
                          {tp.label && (
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {tp.label}
                            </Badge>
                          )}
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            cited {tp.citedCount}×
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    AI-referred visits
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Visits to this page from AI platforms in the selected window
                  </p>
                </CardHeader>
                <CardContent>
                  {data.owned.traffic.totalVisits === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No AI-referred visits recorded for this page yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="text-2xl font-bold tabular-nums">
                        {formatNumber(data.owned.traffic.totalVisits)}
                      </div>
                      <ul className="space-y-1.5">
                        {data.owned.traffic.byPlatform.map((p) => (
                          <li key={p.platform} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 truncate capitalize">
                              {p.platform === 'unknown'
                                ? 'Unknown'
                                : getPlatformDisplayLabel(p.platform)}
                            </span>
                            <span className="tabular-nums text-muted-foreground">{p.visits}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Cited-in list */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Cited in</CardTitle>
              <p className="text-xs text-muted-foreground">
                Every AI answer citing this URL in the selected window
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6 text-xs">Date</TableHead>
                    <TableHead className="text-xs">Platform</TableHead>
                    <TableHead className="text-xs">Prompt</TableHead>
                    <TableHead className="text-xs">Sentiment</TableHead>
                    <TableHead className="text-xs">Brand mentioned</TableHead>
                    <TableHead className="pr-6 text-xs">Position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageOccurrences.map((o) => (
                    <TableRow key={o.resultId}>
                      <TableCell className="pl-6 text-xs tabular-nums whitespace-nowrap">
                        {formatDate(o.createdAt)}
                      </TableCell>
                      <TableCell>
                        <PlatformsCell models={[o.modelUsed || o.platform || ''].filter(Boolean)} />
                      </TableCell>
                      <TableCell className="max-w-[380px]">
                        <Link
                          href={`/dashboard/prompts/${o.promptId}`}
                          className="block truncate text-sm hover:underline"
                          title={o.promptText}
                        >
                          {o.promptText}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <SentimentBadge sentiment={o.sentiment} />
                      </TableCell>
                      <TableCell>
                        {o.brandMentioned ? (
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="pr-6">
                        {/* Where in the answer the URL's first citation sits. */}
                        <PositionLabel rank={o.rank} total={o.totalSources} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <TablePager
                page={citedInPager.page}
                totalPages={citedInPager.totalPages}
                total={data.occurrences.length}
                start={citedInPager.start}
                end={citedInPager.end}
                onPage={citedInPager.setPage}
              />
            </CardContent>
          </Card>

          {/* Prompts breakdown */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Prompts breakdown</CardTitle>
              <p className="text-xs text-muted-foreground">
                The queries this page is winning, grouped by prompt
              </p>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {data.promptGroups.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No prompts recorded for this URL in the selected window.
                </p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6 text-xs">Prompt</TableHead>
                        <TableHead className="text-right text-xs">Answers</TableHead>
                        <TableHead className="text-right text-xs">Citations</TableHead>
                        <TableHead className="pr-6 text-right text-xs">Last seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagePromptGroups.map((g) => (
                        <TableRow key={g.promptId}>
                          <TableCell className="pl-6 max-w-[520px]">
                            <Link
                              href={`/dashboard/prompts/${g.promptId}`}
                              className="block truncate text-sm hover:underline"
                              title={g.promptText}
                            >
                              {g.promptText}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {g.answers}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {g.citations}
                          </TableCell>
                          <TableCell className="pr-6 text-right text-xs tabular-nums whitespace-nowrap">
                            {formatDate(g.lastSeen)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <TablePager
                    page={promptGroupsPager.page}
                    totalPages={promptGroupsPager.totalPages}
                    total={data.promptGroups.length}
                    start={promptGroupsPager.start}
                    end={promptGroupsPager.end}
                    onPage={promptGroupsPager.setPage}
                  />
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/citations"
      className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Citations
    </Link>
  );
}

/** Display-only host fallback while the detail payload is loading. */
function extractDisplayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
