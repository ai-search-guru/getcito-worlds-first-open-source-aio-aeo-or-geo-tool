'use server';

import { unstable_cache } from 'next/cache';
import { dbClient, withDbClient } from '@/lib/supabase/scoped';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import { expandDateToEndOfDay } from '@/lib/dates';
import { runDayWindow } from '@/lib/citations/rollupWindow';
import {
  comparisonWindows,
  dailyWindow,
  deltaDayWindows,
  visibilityChange,
  windowBounds,
  type ComparisonWindows,
  type DayWindow,
  type MetricWindow,
} from '@/lib/insightsWindows';
import {
  parseSamePromptComparison,
  samePromptChanges,
  withPromptComparison,
  type PromptComparison,
  type SamePromptComparison,
} from '@/lib/insightsSamePrompts';
import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import type {
  PromptResult,
  AIPlatform,
  Sentiment,
  Citation,
  CompetitorMention,
  Topic,
  ObservedSearchQuery,
} from '@/types';
import { API_BASE_URL } from '@/config/api';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  type SourceCategory,
} from '@/lib/citations/classify';
import { normalizeCitationUrl } from '@/lib/citations/normalize';
import { getTopicById } from '@/lib/actions/topic';
import { getOrgPlan } from '@/lib/guards/planGuard';
import { getOrgLocationUsage } from '@/lib/promptLocations';
import { getPromptSuggestions } from '@/lib/actions/promptSuggestions';
import { nextScheduledRun } from '@/lib/trackingSchedule';
import { numberFormat, type NumberFormat } from '@/lib/numberFormat';
import { getContentUsage } from '@/lib/actions/content';
import type { ContentUsage } from '@/lib/contentUsage';
import { percentageChange } from '@/lib/metrics';
import { parseChangeDrivers, whyChanged, type WhyChanged } from '@/lib/insightsDrivers';
import { parseTrendMarkers, type TrendMarkerData } from '@/lib/insightsTrend';
import { parseTopicCompetitors, type TopicCompetitors } from '@/lib/insightsTopics';
import type { OpportunitySuggestion } from '@/lib/insightsOpportunities';
import {
  parsePlatformRows,
  platformChanges,
  platformTable,
  type PlatformChange,
  type PlatformRow,
  type PlatformTableRow,
} from '@/lib/insightsSummary';
import {
  coverage as coverageRate,
  kpiRates,
  parseKpiSeries,
  rateChange,
  type KpiRates,
  type KpiSeriesDay,
} from '@/lib/insightsKpis';
import {
  breakdownDelta,
  buildBreakdownRows,
  parseBreakdownGroups,
  pickDriver,
  type BreakdownFilters,
  type BreakdownMetric,
  type BreakdownRow,
  type InsightsBreakdown,
} from '@/lib/insightsBreakdown';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import {
  competitorScoreIn,
  emptyHeadToHead,
  headToHeadFromRollups,
  type HeadToHeadData,
  type HeadToHeadRollups,
  type HeadToHeadRun,
} from '@/lib/headToHead';

/** Round to one decimal place (keeps sub-1 averages visible instead of flooring to 0). */
function roundTo1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Apply the `model` filter to a Supabase query against `prompt_results.model_used`.
 *
 * Accepts either a single slug ("gpt-5-5") or a comma-separated list
 * ("gpt-5-5,gpt-5-3-mini,chatgpt-web") so callers can filter by a provider
 * family without the UI having to enumerate every per-model row in the
 * filter dropdown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyModelFilter<T extends { eq: any; in: any }>(query: T, model: string | undefined): T {
  if (!model) return query;
  const list = model
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length <= 1) return query.eq('model_used', list[0] ?? model);
  return query.in('model_used', list);
}

function mapResultRow(row: Record<string, unknown>): PromptResult {
  return {
    id: row.id as string,
    promptId: row.prompt_id as string,
    brandId: row.brand_id as string,
    platform: row.platform as AIPlatform,
    response: row.response as string,
    citations: (row.citations as Citation[]) ?? [],
    mentionCount: row.mention_count as number,
    citationCount: row.citation_count as number,
    sentiment: row.sentiment as Sentiment,
    visibilityScore: row.visibility_score as number,
    modelUsed: (row.model_used as string | null) ?? undefined,
    region: (row.region as string | null) ?? undefined,
    competitorMentions: (row.competitor_mentions as CompetitorMention[] | null) ?? undefined,
    searchQueries: Array.isArray(row.search_queries)
      ? (row.search_queries as ObservedSearchQuery[])
      : [],
    createdAt: row.created_at as string,
  };
}

export interface PromptResultWithText extends PromptResult {
  promptText: string;
  promptCategory?: string;
  topicId?: string;
  topicName?: string;
}

/** One row of the prompt detail "Top Sources" card — mirrors CitationDomainRow. */
export interface PromptTopSource {
  domain: string;
  category: SourceCategory;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

/** One URL row of the prompt detail "Top Sources" card — mirrors CitationUrlRow. */
export interface PromptTopSourceUrl {
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

export interface PromptDetailData {
  prompt: {
    id: string;
    brandId: string;
    text: string;
    category?: string;
    topicId?: string;
    topicName?: string;
    isActive: boolean;
    createdAt: string;
  };
  summary: {
    avgVisibilityScore: number;
    /** visibleResults / totalResults as a percentage, one decimal (coverage). */
    visibilityRate: number;
    /** Results with >= 1 brand mention/citation. */
    visibleResults: number;
    /** AI Visibility Score (0-100) over this prompt's loaded answers. */
    score: number | null;
    mentionAnswers: number;
    citationAnswers: number;
    positionFactor: number | null;
    totalMentions: number;
    totalCitations: number;
    totalResults: number;
    lastCheckedAt: string | null;
  };
  results: PromptResultWithText[];
  topSources: PromptTopSource[];
  topSourceUrls: PromptTopSourceUrl[];
}

export interface InsightsSummary {
  avgVisibilityScore: number;
  totalMentions: number;
  totalCitations: number;
  positiveSentimentPct: number;
  totalResults: number;
  lastCheckedAt: string | null;
  platformBreakdown: {
    platform: string;
    avgScore: number;
    resultCount: number;
  }[];
  visibilityChange: number | null;
  /** Percentage change vs the previous period; null when the previous count is zero or unavailable. */
  mentionsChange: number | null;
  /** Percentage change vs the previous period; null when the previous count is zero or unavailable. */
  citationsChange: number | null;
  /** Raw previous-period count, used to distinguish a zero base from unavailable comparison data. */
  prevMentions: number | null;
  /** Raw previous-period count, used to distinguish a zero base from unavailable comparison data. */
  prevCitations: number | null;
  sentimentChange: number | null;
  /**
   * The v2 KPI cards (VIS-003, 00131). Null without the answers they need,
   * and Net sentiment / Avg. position also while the rollups behind the
   * window are not backfilled. Changes are in points (positions for Avg.
   * position, where lower is better).
   */
  citationRate: number | null;
  citationRateChange: number | null;
  negativeSentimentPct: number | null;
  netSentiment: number | null;
  netSentimentChange: number | null;
  avgPosition: number | null;
  avgPositionChange: number | null;
  /**
   * The answers Net sentiment and Avg. position are taken over (VIS-005):
   * those that name the brand, and those that place it.
   */
  mentioningResults: number;
  positionedResults: number;
}

/**
 * Convert the comma-separated `model` filter string the UI passes around
 * into the `text[]` shape the aggregate RPCs accept. Matches the parsing
 * applyModelFilter does for the buildResultsQuery path so the two callers
 * stay equivalent.
 */
function modelFilterArray(model: string | undefined): string[] | undefined {
  if (!model) return undefined;
  const list = model
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

// Daily-rollup routing and the comparison windows live in
// @/lib/insights-windows, shared with the breakdown panel (VIS-001).
export type { DayWindow } from '@/lib/insightsWindows';

// ── RPC return shapes (mirror supabase/migrations/00031_insights_sentiment_denominator.sql) ─

interface InsightsAggregates {
  /** 00131: the KPI cards' components; kpi_complete is false before the backfill. */
  citation_answers?: number;
  negative_count?: number;
  sum_position?: number | null;
  position_count?: number;
  kpi_complete?: boolean;
  total_results: number;
  sum_visibility: number;
  total_mentions: number;
  total_citations: number;
  positive_count: number;
  mentioning_results: number;
  /** 00191: answers naming the brand, Net sentiment's base. */
  mention_results?: number;
  last_checked_at: string | null;
  by_model: Array<{
    model_used: string;
    sum_visibility: number;
    result_count: number;
  }>;
}

interface CompetitorAggregatesRow {
  brand_row_count: number;
  brand_sum_visibility: number;
  brand_total_mentions: number;
  brand_total_citations: number;
  brand_prompt_count: number;
  brand_visible_prompts: number;
  by_competitor: Array<{
    competitor_id: string;
    name: string | null;
    sum_visibility: number;
    row_count: number;
    total_mentions: number;
    total_citations: number;
    visible_prompts: number;
  }>;
  by_brand_provider: Array<{
    model_used: string | null;
    platform: string | null;
    sum_visibility: number;
    row_count: number;
    prompt_count: number;
    visible_prompts: number;
  }>;
  by_competitor_provider: Array<{
    model_used: string | null;
    platform: string | null;
    competitor_id: string;
    competitor_name: string | null;
    sum_visibility: number;
    row_count: number;
    visible_prompts: number;
  }>;
}

interface ShareOfVoiceAggregatesRow {
  total_brand_mentions: number;
  total_competitor_mentions: number;
  by_platform: Array<{
    model_used: string | null;
    platform: string | null;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
  by_day: Array<{
    day: string;
    brand_mentions: number;
    competitor_mentions: number;
  }>;
}

/**
 * Build a filtered query on prompt_results for a brand.
 */
async function buildResultsQuery(
  brandId: string,
  opts?: {
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
  selectOpts?: { count?: 'exact' },
) {
  const supabase = await dbClient();
  // #155 — Insights aggregates exclude `chatgpt-shopping`. That model's
  // visibility numbers aren't comparable to a normal ChatGPT answer and
  // would skew brand-level visibility/mentions/citations. Shopping data
  // is consumed by /dashboard/shopping only.
  //
  // `count: 'exact'` (opt-in) makes the query return the full match count
  // alongside a `.range()` page, so getPromptResults gets an accurate total
  // without materializing every row. Export leaves it off (it paginates and
  // doesn't need a per-page count).
  const base = supabase.from('prompt_results');
  let query = (selectOpts?.count ? base.select('*', { count: selectOpts.count }) : base.select('*'))
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping');

  if (opts?.platform) query = query.eq('platform', opts.platform);
  query = applyModelFilter(query, opts?.model);
  if (opts?.region) query = query.eq('region', opts.region);
  if (opts?.dateFrom) query = query.gte('created_at', opts.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(opts?.dateTo);
  if (expandedDateTo) query = query.lte('created_at', expandedDateTo);
  if (opts?.promptId) query = query.eq('prompt_id', opts.promptId);

  if (opts?.topicId) {
    const { data: topicPrompts } = await supabase
      .from('prompts')
      .select('id')
      .eq('topic_id', opts.topicId);
    const topicPromptIds = ((topicPrompts ?? []) as { id: string }[]).map((p) => p.id);
    // Use a sentinel that matches nothing when the topic has no prompts so results are empty.
    query = query.in(
      'prompt_id',
      topicPromptIds.length > 0 ? topicPromptIds : ['00000000-0000-0000-0000-000000000000'],
    );
  }

  return { supabase, query };
}

/**
 * Fetch prompt results for a brand with proper date filtering.
 */
export async function getPromptResults(
  brandId: string,
  opts?: {
    limit?: number;
    offset?: number;
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
): Promise<{ results: PromptResultWithText[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const { supabase, query } = await buildResultsQuery(brandId, opts, { count: 'exact' });

  // One round trip: fetch only the requested page via SQL `.range()` and read
  // the full match count from the same query, instead of materializing every
  // matching row (all heavy columns) into Node and slicing/counting in JS.
  const {
    data: pageRows,
    count,
    error,
  } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error(error.message);

  const rows = (pageRows ?? []) as Record<string, unknown>[];
  const total = count ?? rows.length;

  const promptIds = [...new Set(rows.map((r) => r.prompt_id as string))];
  const { data: promptRows } =
    promptIds.length > 0
      ? await supabase.from('prompts').select('id, text, category, topic_id').in('id', promptIds)
      : { data: [] };

  const promptRowsRaw = (promptRows ?? []) as unknown as Record<string, unknown>[];

  const topicIds = [
    ...new Set(promptRowsRaw.map((p) => p.topic_id as string | null).filter(Boolean) as string[]),
  ];
  const { data: topicRows } =
    topicIds.length > 0
      ? await supabase.from('topics').select('id, name').in('id', topicIds)
      : { data: [] };
  const topicMap = new Map(
    ((topicRows ?? []) as Record<string, unknown>[]).map((t) => [t.id as string, t.name as string]),
  );

  const promptMap = new Map(
    promptRowsRaw.map((p) => [
      p.id as string,
      {
        text: p.text as string,
        category: p.category as string | null,
        topicId: p.topic_id as string | null,
      },
    ]),
  );

  // `rows` is already the requested page (SQL `.range()` above), so map it
  // directly — no JS slicing.
  const results = rows.map((r) => {
    const pm = promptMap.get(r.prompt_id as string);
    return {
      ...mapResultRow(r),
      promptText: (pm?.text as string) ?? '',
      promptCategory: (pm?.category as string | null) ?? undefined,
      topicId: (pm?.topicId as string | null) ?? undefined,
      topicName: pm?.topicId
        ? (topicMap.get(pm.topicId) ?? (pm?.category as string | null) ?? undefined)
        : ((pm?.category as string | null) ?? undefined),
    };
  });

  return { results, total };
}

export interface TrackedPromptsKpi {
  /** Distinct prompts with results in the filtered window (shopping excluded). */
  activeInPeriod: number;
  /** Org-wide prompt count — the number the plan limit is enforced against. */
  quotaUsed: number;
  /** Effective org limit with Enterprise plan_overrides merged; -1 = unlimited. */
  quotaLimit: number;
}

export interface VisibilityRateKpi {
  /** Distinct prompts with >= 1 answer mentioning or citing the brand. */
  visiblePrompts: number;
  /** Result rows where the brand appeared. */
  visibleResults: number;
  /** Average visibility score over only the rows the brand appeared in. */
  avgScoreWhenVisible: number;
}

/**
 * Visibility Rate KPI — the "appeared" side of the how-often ⁄ how-good
 * split. Averaging visibility over ALL results reads near zero for most
 * brands (absent answers contribute 0 each), so the headline shows how many
 * tracked prompts the brand actually surfaced in, and the average score of
 * only those appearances. Same filters and shopping exclusion as the rest of
 * the KPI row; the rate's denominator is TrackedPromptsKpi.activeInPeriod.
 */
export async function getVisibilityRateKpi(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
  },
): Promise<VisibilityRateKpi> {
  const supabase = await dbClient();
  const daily = dailyWindow(opts);

  const { data, error } = daily
    ? await supabase.rpc('visible_prompt_stats_daily', {
        p_brand_id: brandId,
        p_platform: undefined,
        p_models: modelFilterArray(opts?.model),
        p_region: opts?.region ?? undefined,
        p_day_from: daily.dayFrom,
        p_day_to: daily.dayTo,
        p_topic_id: opts?.topicId ?? undefined,
      })
    : await supabase.rpc('visible_prompt_stats', {
        p_brand_id: brandId,
        p_platform: undefined,
        p_models: modelFilterArray(opts?.model),
        p_region: opts?.region ?? undefined,
        p_date_from: opts?.dateFrom ?? undefined,
        p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? undefined,
        p_topic_id: opts?.topicId ?? undefined,
      });
  if (error) throw new Error(error.message);

  const row = (data ?? {}) as {
    visible_prompts?: number;
    visible_results?: number;
    sum_visibility_visible?: number;
  };
  const visibleResults = Number(row.visible_results ?? 0);
  return {
    visiblePrompts: Number(row.visible_prompts ?? 0),
    visibleResults,
    avgScoreWhenVisible:
      visibleResults > 0 ? Math.round(Number(row.sum_visibility_visible ?? 0) / visibleResults) : 0,
  };
}

/**
 * Tracked Prompts KPI (#457). The main value is period-aware — distinct
 * prompts that produced results under the SAME filters as the other KPI
 * cards (the `tracked_prompt_count` RPC mirrors `insights_aggregates`,
 * shopping excluded) — because a static account-state number sitting in a
 * filter-reactive row would read as inconsistent. The quota sub-line is
 * deliberately a "now" fact: org-wide tracked LOCATIONS against the
 * effective plan limit (#691), from the same counter every write-path guard
 * uses, so the number shown and the number that rejects a save cannot
 * disagree.
 */
export async function getTrackedPromptsKpi(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
  },
): Promise<TrackedPromptsKpi> {
  const supabase = await dbClient();
  const daily = dailyWindow(opts);

  const { data: brand } = await supabase
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .single();
  const orgId = (brand?.organization_id as string | undefined) ?? null;

  const countOrgLocations = async (): Promise<number> => {
    if (!orgId) return 0;
    const usage = await getOrgLocationUsage(supabase, orgId);
    return usage.total;
  };

  const [rpcResult, plan, quotaUsed] = await Promise.all([
    daily
      ? supabase.rpc('tracked_prompt_count_daily', {
          p_brand_id: brandId,
          p_platform: undefined,
          p_models: modelFilterArray(opts?.model),
          p_region: opts?.region ?? undefined,
          p_day_from: daily.dayFrom,
          p_day_to: daily.dayTo,
          p_topic_id: opts?.topicId ?? undefined,
        })
      : supabase.rpc('tracked_prompt_count', {
          p_brand_id: brandId,
          p_platform: undefined,
          p_models: modelFilterArray(opts?.model),
          p_region: opts?.region ?? undefined,
          p_date_from: opts?.dateFrom ?? undefined,
          p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? undefined,
          p_topic_id: opts?.topicId ?? undefined,
        }),
    orgId ? getOrgPlan(orgId) : Promise.resolve(null),
    countOrgLocations(),
  ]);
  if (rpcResult.error) throw new Error(rpcResult.error.message);

  return {
    activeInPeriod: (rpcResult.data as number | null) ?? 0,
    quotaUsed,
    quotaLimit: plan?.limits.maxPrompts ?? -1,
  };
}

export interface InsightsFilterOptions {
  /** Distinct result regions for the brand (shopping excluded), sorted. */
  regions: string[];
  /** Distinct model_used slugs for the brand (shopping excluded), sorted. */
  models: string[];
}

/**
 * Filter dropdown options for the Insights page (#458). These used to be
 * derived client-side from the removed results tree's 1500-row fetch; one
 * DISTINCT scan in Postgres returns the same sets without shipping rows.
 * Deliberately unfiltered (whole-brand): the dropdowns must keep offering
 * every value the brand has ever produced, not just the current window's.
 */
export async function getBrandFilterOptions(brandId: string): Promise<InsightsFilterOptions> {
  return getInsightsFilterOptions(brandId);
}

async function getInsightsFilterOptions(brandId: string): Promise<InsightsFilterOptions> {
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('insights_filter_options', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  const row = (data as { regions: string[] | null; models: string[] | null }[] | null)?.[0];
  return {
    regions: row?.regions ?? [],
    models: row?.models ?? [],
  };
}

export interface InsightsOpportunities {
  suggestions: OpportunitySuggestion[];
  /** The suggestions' topics with at least one active tracked prompt; null when unknown. */
  trackedTopicIds: string[] | null;
  /** The month's content quota, for Suggest content (CONTENT-001); null when unread. */
  contentUsage: ContentUsage | null;
}

/** PostgREST's default row cap: a read that fills it may have been cut short. */
const TRACKED_TOPIC_ROWS = 1000;

/**
 * The Opportunities card's data (VIS-011): the stored prompt suggestions and
 * which of their topics you already track. A bounded read of persisted data:
 * suggestions are only ever generated by the Prompts page's explicit refresh,
 * never from the Insights load path. A failure degrades to an empty card so
 * it can never take the Insights page down with it.
 */
async function getInsightsOpportunities(brandId: string): Promise<InsightsOpportunities> {
  try {
    const read = await getPromptSuggestions(brandId);
    if (!read.ok) return { suggestions: [], trackedTopicIds: [], contentUsage: null };
    const { suggestions } = read;
    const topicIds = [...new Set(suggestions.flatMap((s) => (s.topicId ? [s.topicId] : [])))];
    const readTrackedTopics = async (): Promise<string[] | null> => {
      if (topicIds.length === 0) return [];
      const supabase = await dbClient();
      const { data, error } = await supabase
        .from('prompts')
        .select('topic_id')
        .in('topic_id', topicIds)
        .eq('is_active', true)
        .limit(TRACKED_TOPIC_ROWS);
      // Unknown, not "none": a failed or cut-off read would call tracked topics untracked.
      return error || (data?.length ?? 0) >= TRACKED_TOPIC_ROWS
        ? null
        : [...new Set((data ?? []).map((r) => r.topic_id as string))];
    };
    const [trackedTopicIds, contentUsage] = await Promise.all([
      readTrackedTopics(),
      // Only Suggest content uses it. The server still enforces the quota; an
      // unread one only leaves the button enabled.
      suggestions.length > 0 ? getContentUsage().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      suggestions: suggestions.map((s) => ({
        id: s.id,
        text: s.suggestedText,
        topicId: s.topicId,
        topicName: s.topicName,
        estVolume: s.estVolume,
        relevance: s.relevance,
      })),
      trackedTopicIds,
      contentUsage,
    };
  } catch {
    return { suggestions: [], trackedTopicIds: [], contentUsage: null };
  }
}

/**
 * Does this brand have any (non-shopping) prompt_results at all?
 *
 * A yes/no question, so it asks for a single row with LIMIT 1 and stops at the
 * first match, rather than an exact COUNT that visits every matching row only
 * to compare the total against zero.
 */
async function brandHasResults(brandId: string): Promise<boolean> {
  const supabase = await dbClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('id')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .limit(1);
  // Throw rather than swallow: a failed check must not masquerade as "no data"
  // and silently flip the page to its empty state.
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export interface InsightsData {
  summary: InsightsSummary;
  competitors: CompetitorComparisonData;
  sov: ShareOfVoiceData;
  trackedPrompts: TrackedPromptsKpi;
  filterOptions: InsightsFilterOptions;
  opportunities: InsightsOpportunities;
  hasAnyData: boolean;
  /** The visibility-rate chart for the same window; null when its read failed. */
  trend: VisibilityRateTrendData | null;
  /**
   * Which prompts the changes on the page compare (VIS-002), with how many
   * were added or dropped between the periods. Null without a previous
   * window (All time) or before the rollups behind it are backfilled.
   */
  comparison: PromptComparison | null;
  /** Coverage card (VIS-003); null when its read failed. */
  coverage: CoverageKpi | null;
  /**
   * The KPI cards' sparklines, one point per day (VIS-003). Null for the 24h
   * view (a single day), when the read failed, or before the backfill.
   */
  kpiSeries: KpiSeriesDay[] | null;
  /**
   * Each platform's Visibility change for the summary line (VIS-006),
   * following Same prompts; biggest rise first. Null without a previous
   * window, before the backfill, or when the read failed.
   */
  platformChanges: PlatformChange[] | null;
  /** The "By AI platform" table (VIS-008); null under the same conditions. */
  platforms: PlatformTableRow[] | null;
  /**
   * "Why it changed" (VIS-009): what moved the change and the prompts new this
   * period. Null for All time, before the backfill, or when the read failed.
   */
  whyChanged: WhyChanged | null;
  /**
   * The trend's markers and goal (VIS-007): prompts added and actions sent per
   * day, and the AI visibility KPI's target. Null on the 24h view, whose
   * chart has no days to mark, or when the read failed.
   */
  trendMarkers: TrendMarkerData | null;
  /**
   * "Topics vs competitors" (VIS-010): per topic, your and each competitor's
   * Visibility components. Null on the 24h view, with a topic selected,
   * before the backfill, or when the read failed.
   */
  topicCompetitors: TopicCompetitors[] | null;
  /** The run ledger, when the 24h window was anchored to it (`anchor24h`). */
  trackingWindow: TrackingWindow | null;
}

export interface TrackingWindow {
  /**
   * The stable 24h window: (previous completed run, latest completed run].
   * Null when the brand has no completed run yet (fresh onboarding) — the
   * caller falls back to the live rolling window, which cannot regress
   * because a new brand has nothing older than 24h to age out.
   */
  anchored: { dateFrom: string; dateTo: string } | null;
  /** UTC day(s) touched by the latest completed run, for daily rollups. */
  runDays?: DayWindow | null;
  /** UTC day(s) touched by the prior completed run, for run-over-run deltas. */
  previousRunDays?: DayWindow | null;
  /** A full run currently in flight (cron or manual), for the progress banner. */
  activeRun: { startedAt: string; source: string } | null;
  /** The brand's last completed full run, scheduled or Run All (VIS-012); null before its first. */
  lastRunAt: string | null;
  /** When the next scheduled run is due, from the last ones (VIS-012); null when not known. */
  nextRunAt: string | null;
}

/**
 * Resolve the effective 24h window from the tracking-run ledger (00044).
 *
 * The naive `[now - 24h, now]` window empties and refills every morning while
 * the daily run streams in: old results age out second by second, new ones
 * arrive over ~an hour, so users watch "no results" flashes and a shrinking
 * prompt count. Anchoring to the latest COMPLETED run freezes the window
 * between runs and swaps it atomically when the next run finishes draining.
 *
 * The lower bound is capped at the previous run's completion so the window
 * never bleeds into the prior cycle's drain tail (a run that completes at
 * 10:15 must not pick up yesterday's 10:20 stragglers).
 */
export async function getTrackingWindow(brandId: string): Promise<TrackingWindow> {
  const supabase = await dbClient();

  const [completedResp, activeResp, scheduledResp] = await Promise.all([
    supabase
      .from('tracking_runs')
      .select('started_at, completed_at')
      .eq('brand_id', brandId)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(2),
    supabase
      .from('tracking_runs')
      .select('started_at, source')
      .eq('brand_id', brandId)
      .is('completed_at', null)
      // A run row without a stamp older than the worker's drain ceiling is a
      // crashed run, not an active one — never pin the banner on it.
      .gte('started_at', new Date(Date.now() - 2 * 3600_000).toISOString())
      .order('started_at', { ascending: false })
      .limit(1),
    // The daily runs, for when the next one is due (the header's "next run in 13h").
    supabase
      .from('tracking_runs')
      .select('started_at')
      .eq('brand_id', brandId)
      .eq('source', 'cron')
      .order('started_at', { ascending: false })
      .limit(2),
  ]);

  const completed = (completedResp.data ?? []) as {
    started_at?: string | null;
    completed_at?: string | null;
  }[];
  const latestRun = completed[0];
  const previousRun = completed[1];
  const latest = latestRun?.completed_at ?? undefined;
  const runDays =
    latestRun?.started_at && latestRun.completed_at
      ? runDayWindow({
          started_at: latestRun.started_at,
          completed_at: latestRun.completed_at,
        })
      : null;
  const previousRunDays =
    previousRun?.started_at && previousRun.completed_at
      ? runDayWindow({
          started_at: previousRun.started_at,
          completed_at: previousRun.completed_at,
        })
      : null;

  let anchored: TrackingWindow['anchored'] = null;
  if (latest) {
    const latestMs = new Date(latest).getTime();
    const prev = previousRun?.completed_at ?? undefined;
    const lowerMs = Math.max(latestMs - 24 * 3600_000, prev ? new Date(prev).getTime() + 1 : 0);
    anchored = { dateFrom: new Date(lowerMs).toISOString(), dateTo: latest };
  }

  const active = activeResp.data?.[0];
  return {
    anchored,
    runDays,
    previousRunDays,
    activeRun: active
      ? { startedAt: active.started_at as string, source: (active.source as string) ?? 'manual' }
      : null,
    lastRunAt: latest ?? null,
    nextRunAt: nextScheduledRun((scheduledResp.data ?? []).map((r) => r.started_at as string)),
  };
}

/**
 * One consolidated server action for the Insights page's first load (#313).
 *
 * Next.js runs server actions sequentially (each is its own queued POST), so
 * firing the summary / competitor / SoV reads separately from the client cost
 * roughly their sum, not the slowest. This runs them in a real server-side
 * `Promise.all` (genuinely parallel, one round trip), and derives "has any
 * data" from a cheap count instead of the old unbounded full-table scan.
 * The raw prompt_results rows are no longer part of the payload — the
 * "Prompt Results by Topic" tree they fed was removed in #458.
 */
/** The part of the Insights page that depends only on the brand and the window. */
type WindowedInsights = Pick<
  InsightsData,
  | 'summary'
  | 'competitors'
  | 'sov'
  | 'filterOptions'
  | 'trend'
  | 'comparison'
  | 'coverage'
  | 'kpiSeries'
  | 'platformChanges'
  | 'platforms'
  | 'whyChanged'
  | 'trendMarkers'
  | 'topicCompetitors'
>;

type InsightsFilterArgs = {
  model?: string;
  region?: string;
  topicId?: string;
  dateFrom?: string;
  dateTo?: string;
  days?: DayWindow;
  /** Previous completed run's UTC day(s), for run-over-run comparisons. */
  previousDays?: DayWindow;
  /** "Compare: Same prompts" (VIS-002); on unless explicitly false. */
  samePrompts?: boolean;
};

const EMPTY_COMPETITORS: CompetitorComparisonData = { brands: [], providerRows: [] };
const EMPTY_SOV: ShareOfVoiceData = {
  overallSov: 0,
  overallSovChange: null,
  byPlatform: [],
  trend: [],
};

/**
 * Read the windowed sections in parallel. Lenient mode is the page's normal
 * behaviour: a competitor, SoV or trend error costs its own card (the empty
 * shapes are what the page maps to "section hidden"), while the summary and
 * KPI reads stay fatal. Strict mode lets every error through, so a result
 * with a silently emptied section is never cached.
 */
async function loadWindowedInsights(
  brandId: string,
  filterOpts: InsightsFilterArgs,
  { strict }: { strict: boolean },
): Promise<WindowedInsights> {
  const lenient = <T>(promise: Promise<T>, fallback: T, label: string): Promise<T> =>
    strict
      ? promise
      : promise.catch((err) => {
          console.error(`[insights] ${label} failed`, err);
          return fallback;
        });

  const [
    summary,
    competitors,
    sov,
    filterOptions,
    trend,
    same,
    coverage,
    kpiSeries,
    platformData,
    drivers,
    trendMarkers,
    topicCompetitors,
  ] = await Promise.all([
    getInsightsSummary(brandId, filterOpts),
    lenient(
      getCompetitorComparison(brandId, filterOpts),
      EMPTY_COMPETITORS,
      'competitor comparison',
    ),
    lenient(getShareOfVoiceData(brandId, filterOpts), EMPTY_SOV, 'share of voice'),
    getInsightsFilterOptions(brandId),
    // The chart follows the same window as every other number on the page.
    lenient<VisibilityRateTrendData | null>(
      getVisibilityRateTrend(brandId, filterOpts),
      null,
      'visibility trend',
    ),
    lenient(getSamePromptComparison(brandId, filterOpts), null, 'same-prompt comparison'),
    lenient(getCoverageKpi(brandId, filterOpts), null, 'coverage'),
    lenient(getKpiSeries(brandId, filterOpts), null, 'KPI sparklines'),
    lenient(getPlatformData(brandId, filterOpts), null, 'platforms'),
    lenient(getChangeDrivers(brandId, filterOpts), null, 'why it changed'),
    lenient(getTrendMarkers(brandId, filterOpts), null, 'trend markers'),
    lenient(getTopicCompetitors(brandId, filterOpts), null, 'topics vs competitors'),
  ]);
  const windowed = {
    ...(comparisonWindows(filterOpts).prev ? { summary, sov } : withoutChanges(summary, sov)),
    competitors,
    filterOptions,
    trend,
    coverage,
    kpiSeries,
    platformChanges: platformData?.changes ?? null,
    platforms: platformData
      ? platformTable(
          platformData.rows,
          platformData.changes ?? [],
          sov.byPlatform,
          resolveProvider,
        )
      : null,
    whyChanged:
      drivers &&
      whyChanged(drivers, resolveProvider, { samePrompts: filterOpts.samePrompts !== false }),
    trendMarkers,
    topicCompetitors,
  };
  return withPromptComparison(windowed, same, filterOpts.samePrompts !== false);
}

/** Coverage card (VIS-003): the answered prompts where the brand appeared. */
export interface CoverageKpi {
  visiblePrompts: number;
  activePrompts: number;
  /** %, one decimal; null without answered prompts. */
  value: number | null;
  /** Change in points vs the previous window; null without one. */
  change: number | null;
}

/**
 * Coverage over the card's windows: distinct prompts the brand appeared in
 * (visible_prompt_stats) over distinct prompts answered (tracked_prompt_count),
 * the same counts the Visibility card's "appeared in x/y" line shows.
 */
async function getCoverageKpi(brandId: string, opts?: InsightsFilterArgs): Promise<CoverageKpi> {
  const supabase = await dbClient();
  const windows = comparisonWindows(opts);
  const base = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
  };

  const countsFor = async (win: MetricWindow) => {
    let visible;
    let active;
    if (win.kind === 'days') {
      const days = {
        ...base,
        p_day_from: win.days.dayFrom,
        p_day_to: win.days.dayTo,
        p_topic_id: opts?.topicId ?? undefined,
      };
      [visible, active] = await Promise.all([
        supabase.rpc('visible_prompt_stats_daily', days),
        supabase.rpc('tracked_prompt_count_daily', days),
      ]);
    } else {
      const range = {
        ...base,
        p_date_from: win.from,
        p_date_to: win.to,
        p_topic_id: opts?.topicId ?? undefined,
      };
      [visible, active] = await Promise.all([
        supabase.rpc('visible_prompt_stats', range),
        supabase.rpc('tracked_prompt_count', range),
      ]);
    }
    if (visible.error) throw new Error(visible.error.message);
    if (active.error) throw new Error(active.error.message);
    return {
      visible: Number((visible.data as { visible_prompts?: number } | null)?.visible_prompts ?? 0),
      active: Number(active.data ?? 0),
    };
  };

  const [cur, prev] = await Promise.all([
    countsFor(windows.cur),
    windows.prev ? countsFor(windows.prev) : Promise.resolve(null),
  ]);
  const value = coverageRate(cur.visible, cur.active);
  return {
    visiblePrompts: cur.visible,
    activePrompts: cur.active,
    value,
    change: prev ? rateChange(value, coverageRate(prev.visible, prev.active)) : null,
  };
}

/**
 * The KPI cards' sparklines: one point per day of the window, from the
 * prompt-grain rollups (00131), topic filter included. Whole days only — the
 * 24h view is a single day, nothing to plot.
 */
async function getKpiSeries(
  brandId: string,
  opts?: InsightsFilterArgs,
): Promise<KpiSeriesDay[] | null> {
  if (!opts?.days) return null;
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('insights_kpi_series', {
    p_brand_id: brandId,
    p_day_from: opts.days.dayFrom,
    p_day_to: opts.days.dayTo,
    p_models: modelFilterArray(opts.model),
    p_region: opts.region ?? undefined,
    p_topic_id: opts.topicId ?? undefined,
  });
  if (error) throw new Error(error.message);
  return parseKpiSeries(data);
}

/**
 * "Topics vs competitors" (VIS-010): per active topic, the brand's and each
 * competitor's Visibility components in the window, from the rollups. Null
 * on the 24h view and when a topic is selected (one row isn't a map).
 */
async function getTopicCompetitors(
  brandId: string,
  opts?: InsightsFilterArgs,
): Promise<TopicCompetitors[] | null> {
  if (!opts?.days || opts.topicId) return null;
  const supabase = await dbClient();
  const { data, error } = await supabase.rpc('insights_topic_competitors_daily', {
    p_brand_id: brandId,
    p_day_from: opts.days.dayFrom,
    p_day_to: opts.days.dayTo,
    p_models: modelFilterArray(opts.model),
    p_region: opts.region ?? undefined,
  });
  if (error) throw new Error(error.message);
  return parseTopicCompetitors(data);
}

/**
 * The trend's markers and goal (VIS-007): per UTC day in the charted range,
 * the prompts added and the actions people sent, and the target of the
 * brand's active AI visibility KPI. Null on the 24h view, charted by run
 * rather than by day.
 */
async function getTrendMarkers(
  brandId: string,
  opts?: InsightsFilterArgs,
): Promise<TrendMarkerData | null> {
  if (!opts?.days) return null;
  const supabase = await dbClient();
  const { dayFrom, dayTo } = opts.days;
  const [markers, kpi] = await Promise.all([
    supabase.rpc('insights_trend_markers', {
      p_brand_id: brandId,
      p_from: dayFrom ? `${dayFrom}T00:00:00Z` : undefined,
      p_to: dayTo ? `${dayTo}T23:59:59.999Z` : undefined,
      p_topic_id: opts.topicId ?? undefined,
    }),
    supabase
      .from('kpi_definitions')
      .select('target')
      .eq('brand_id', brandId)
      .eq('kpi_key', 'ai_visibility')
      .eq('is_active', true)
      .maybeSingle(),
  ]);
  if (markers.error) throw new Error(markers.error.message);
  return {
    ...parseTrendMarkers(markers.data),
    // A missing or unreadable KPI only means no goal line.
    goal: kpi.data ? Number(kpi.data.target) : null,
  };
}

/**
 * The inputs of "Why it changed" (VIS-009): each prompt's and engine's
 * Visibility components in both comparison windows, over the same prompts as
 * the card's change, and the prompts new this period. Null for All time.
 */
async function getChangeDrivers(
  brandId: string,
  opts?: InsightsFilterArgs,
): Promise<ReturnType<typeof parseChangeDrivers>> {
  const windows = comparisonWindows(opts);
  if (!windows.prev) return null;
  const supabase = await dbClient();
  const base = {
    p_brand_id: brandId,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
    p_same_prompts: opts?.samePrompts !== false,
  };

  let res;
  if (windows.cur.kind === 'days') {
    const { cur, prev } = deltaDayWindows(windows.cur.days, opts?.previousDays);
    res = await supabase.rpc('insights_change_drivers_daily', {
      ...base,
      p_cur_from: cur.dayFrom,
      p_cur_to: cur.dayTo,
      p_prev_from: prev.dayFrom,
      p_prev_to: prev.dayTo,
      p_topic_id: opts?.topicId ?? undefined,
    });
  } else {
    const cur = windowBounds(windows.cur);
    const prev = windowBounds(windows.prev);
    res = await supabase.rpc('insights_change_drivers', {
      ...base,
      p_cur_from: cur.from,
      p_cur_to: cur.to,
      p_prev_from: prev.from,
      p_prev_to: prev.to,
      p_topic_id: opts?.topicId ?? undefined,
    });
  }
  if (res.error) throw new Error(res.error.message);
  return parseChangeDrivers(res.data);
}

/**
 * Each platform in the comparison windows (VIS-006, VIS-008): the rows over
 * every prompt, for the "By AI platform" table's values, and each platform's
 * Visibility change for the summary line's movers and the table's Change
 * column. With Same prompts on (the default) the changes count only the
 * prompts answered in both windows, like every other change. All time reads
 * the current window alone and has no changes.
 */
async function getPlatformData(
  brandId: string,
  opts?: InsightsFilterArgs,
): Promise<{ rows: PlatformRow[]; changes: PlatformChange[] | null } | null> {
  const windows = comparisonWindows(opts);
  const supabase = await dbClient();
  const base = {
    p_brand_id: brandId,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
  };

  // An absent bound is open; without a previous window only the current one is read.
  const prev = windows.prev && windowBounds(windows.prev);
  const read = async (samePrompts: boolean) => {
    const res =
      windows.cur.kind === 'days'
        ? await supabase.rpc('insights_platform_compare_daily', {
            ...base,
            p_same_prompts: samePrompts,
            p_cur_from: windows.cur.days.dayFrom,
            p_cur_to: windows.cur.days.dayTo,
            p_prev_from: prev?.from,
            p_prev_to: prev?.to,
            p_topic_id: opts?.topicId ?? undefined,
          })
        : await supabase.rpc('insights_platform_compare', {
            ...base,
            p_same_prompts: samePrompts,
            p_cur_from: windows.cur.from,
            p_cur_to: windows.cur.to,
            p_prev_from: prev?.from,
            p_prev_to: prev?.to,
            p_topic_id: opts?.topicId ?? undefined,
          });
    if (res.error) throw new Error(res.error.message);
    return parsePlatformRows(res.data);
  };

  const samePrompts = prev !== null && opts?.samePrompts !== false;
  const [all, same] = await Promise.all([
    read(false),
    samePrompts ? read(true) : Promise.resolve(null),
  ]);
  const changeRows = samePrompts ? same : all;
  if (!all || !changeRows) return null;
  return { rows: all, changes: prev ? platformChanges(changeRows, resolveProvider) : null };
}

/**
 * The comparison windows' totals over the prompts answered in both
 * (VIS-002): the daily rollups for whole days, the raw rows for the 24h and
 * topic views. Null without a previous window, or while the rollups behind it
 * are not yet backfilled (00130) — the page then compares all prompts, as it
 * always did. A failed read throws, so strict mode keeps it out of the cache.
 */
async function getSamePromptComparison(
  brandId: string,
  opts?: InsightsFilterArgs,
  windows: ComparisonWindows = comparisonWindows(opts),
): Promise<SamePromptComparison | null> {
  if (!windows.prev) return null;
  const supabase = await dbClient();
  const base = {
    p_brand_id: brandId,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
  };

  let res;
  if (windows.cur.kind === 'days') {
    // Explicit bounds for both windows: the same days the card compares.
    const { cur, prev } = deltaDayWindows(windows.cur.days, opts?.previousDays);
    res = await supabase.rpc('insights_same_prompt_compare_daily', {
      ...base,
      p_cur_from: cur.dayFrom,
      p_cur_to: cur.dayTo,
      p_prev_from: prev.dayFrom,
      p_prev_to: prev.dayTo,
      p_topic_id: opts?.topicId ?? undefined,
    });
  } else {
    const cur = windowBounds(windows.cur);
    const prev = windowBounds(windows.prev);
    res = await supabase.rpc('insights_same_prompt_compare', {
      ...base,
      p_cur_from: cur.from,
      p_cur_to: cur.to,
      p_prev_from: prev.from,
      p_prev_to: prev.to,
      p_topic_id: opts?.topicId ?? undefined,
    });
  }
  const { data, error } = res;
  if (error) throw new Error(error.message);
  return parseSamePromptComparison(data);
}

/**
 * Raw fallback for anchored 24h reads that cannot use daily rollups (currently
 * topic-filtered reads). The result is cached per brand, filters and anchored
 * window; the next completed run moves the window and so the key.
 *
 * Computed with the service-role client because the cache cannot read the
 * caller's cookies; every loader scopes its reads by brand, and the caller's
 * access to the brand is checked on each call before the cache is read.
 */
async function cachedAnchoredInsights(
  brandId: string,
  filterOpts: InsightsFilterArgs,
  anchored: { dateFrom: string; dateTo: string },
): Promise<WindowedInsights> {
  const { data: brand, error } = await (
    await dbClient()
  )
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand) throw new Error('Brand not found');

  // Imported here: the admin client is created at module load and needs the
  // service-role env, which only this path uses.
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const compute = unstable_cache(
    () =>
      withDbClient(supabaseAdmin as unknown as Awaited<ReturnType<typeof dbClient>>, () =>
        loadWindowedInsights(brandId, filterOpts, { strict: true }),
      ),
    [
      'insights-24h',
      brandId,
      anchored.dateFrom,
      anchored.dateTo,
      filterOpts.model ?? '',
      filterOpts.region ?? '',
      filterOpts.topicId ?? '',
      filterOpts.samePrompts === false ? 'all-prompts' : 'same-prompts',
    ],
    { revalidate: 2 * 24 * 60 * 60, tags: [`insights:${brandId}`] },
  );
  return compute();
}

export async function getInsightsData(
  brandId: string,
  opts: {
    model?: string;
    region?: string;
    topicId?: string;
    dateFrom?: string;
    dateTo?: string;
    days?: DayWindow;
    /** "Compare: Same prompts" (VIS-002); on unless explicitly false. */
    samePrompts?: boolean;
    /** When the current view is filtered, check unfiltered data existence too. */
    checkUnfiltered?: boolean;
    /**
     * The 24h preset: resolve the latest completed run here so the view can use
     * its UTC day window (including topic-filtered daily rollups), without a
     * separate client action request.
     */
    anchor24h?: boolean;
  },
): Promise<InsightsData> {
  const trackingWindow = opts.anchor24h ? await getTrackingWindow(brandId).catch(() => null) : null;
  const anchored = trackingWindow?.anchored ?? null;
  const rollup24h = Boolean(opts.anchor24h && trackingWindow?.runDays);

  const filterOpts: InsightsFilterArgs = {
    model: opts.model,
    region: opts.region,
    topicId: opts.topicId,
    dateFrom: rollup24h ? undefined : (anchored?.dateFrom ?? opts.dateFrom),
    dateTo: rollup24h ? undefined : (anchored?.dateTo ?? opts.dateTo),
    days: rollup24h ? (trackingWindow?.runDays ?? undefined) : opts.days,
    previousDays: rollup24h ? (trackingWindow?.previousRunDays ?? undefined) : undefined,
    samePrompts: opts.samePrompts,
  };

  // All 24h reads use daily rollups for the latest run's UTC day(s), with
  // p_topic_id passed through when a topic is selected. Without a completed
  // run-day window, retain the existing raw, anchored fallback. Keep the cached
  // path until the rollup path's latency has been measured.
  const windowedRead = rollup24h
    ? loadWindowedInsights(brandId, filterOpts, { strict: false })
    : anchored
      ? cachedAnchoredInsights(brandId, filterOpts, anchored).catch((err) => {
          console.error('[insights] cached 24h read failed, reading live', err);
          return loadWindowedInsights(brandId, filterOpts, { strict: false });
        })
      : loadWindowedInsights(brandId, filterOpts, { strict: false });

  // Quota (tracked prompts), opportunities and the unfiltered check depend
  // on the caller's org and session, so they are read live on every open.
  const [windowed, trackedPrompts, opportunities, unfilteredHasData] = await Promise.all([
    windowedRead,
    getTrackedPromptsKpi(brandId, filterOpts),
    getInsightsOpportunities(brandId),
    opts.checkUnfiltered ? brandHasResults(brandId) : Promise.resolve(null),
  ]);

  // insights_aggregates counts the same filtered set the summary shows, so it
  // stands in for the removed results fetch when no unfiltered check ran.
  const hasAnyData =
    unfilteredHasData !== null ? unfilteredHasData : windowed.summary.totalResults > 0;

  return {
    ...windowed,
    trackedPrompts,
    opportunities,
    hasAnyData,
    trackingWindow,
  };
}

/**
 * Fetch all prompt results for export, bypassing the default 1000 limit by paginating.
 * Applies a hard ceiling to prevent OOM errors on massive datasets.
 */
export async function exportPromptResults(
  brandId: string,
  opts?: {
    platform?: string;
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    promptId?: string;
    topicId?: string;
  },
): Promise<{ results: PromptResultWithText[]; isCapped: boolean }> {
  const allRows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  const hardCeiling = 50000;
  let isCapped = false;
  let offset = 0;

  while (true) {
    const { query } = await buildResultsQuery(brandId, opts);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    allRows.push(...rows);

    if (rows.length < pageSize) {
      break; // Reached the end
    }

    offset += pageSize;
    if (offset >= hardCeiling) {
      isCapped = true;
      break;
    }
  }

  const { supabase } = await buildResultsQuery(brandId, opts);

  const promptIds = [...new Set(allRows.map((r) => r.prompt_id as string))];
  const promptRowsRaw: Record<string, unknown>[] = [];
  const chunkSize = 500;

  for (let i = 0; i < promptIds.length; i += chunkSize) {
    const chunk = promptIds.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      const { data: pRows } = await supabase
        .from('prompts')
        .select('id, text, category, topic_id')
        .in('id', chunk);
      if (pRows) {
        promptRowsRaw.push(...(pRows as unknown as Record<string, unknown>[]));
      }
    }
  }

  const topicIds = [
    ...new Set(promptRowsRaw.map((p) => p.topic_id as string | null).filter(Boolean) as string[]),
  ];
  const topicRowsRaw: Record<string, unknown>[] = [];

  for (let i = 0; i < topicIds.length; i += chunkSize) {
    const chunk = topicIds.slice(i, i + chunkSize);
    if (chunk.length > 0) {
      const { data: tRows } = await supabase.from('topics').select('id, name').in('id', chunk);
      if (tRows) {
        topicRowsRaw.push(...(tRows as Record<string, unknown>[]));
      }
    }
  }

  const topicMap = new Map(topicRowsRaw.map((t) => [t.id as string, t.name as string]));

  const promptMap = new Map(
    promptRowsRaw.map((p) => [
      p.id as string,
      {
        text: p.text as string,
        category: p.category as string | null,
        topicId: p.topic_id as string | null,
      },
    ]),
  );

  const results = allRows.map((r) => {
    const pm = promptMap.get(r.prompt_id as string);
    return {
      ...mapResultRow(r),
      promptText: (pm?.text as string) ?? '',
      promptCategory: (pm?.category as string | null) ?? undefined,
      topicId: (pm?.topicId as string | null) ?? undefined,
      topicName: pm?.topicId
        ? (topicMap.get(pm.topicId) ?? (pm?.category as string | null) ?? undefined)
        : ((pm?.category as string | null) ?? undefined),
    };
  });

  return { results, isCapped };
}

/**
 * Fetch a single prompt result by its ID, joining prompt text.
 */
export async function getPromptResultById(resultId: string): Promise<PromptResultWithText | null> {
  const supabase = await dbClient();

  // #155 — Insights detail view; chatgpt-shopping is excluded here for the
  // same reason the aggregates exclude it. Shopping rows are shown by the
  // Shopping dashboard, not Insights.
  const { data, error } = await supabase
    .from('prompt_results')
    .select('*')
    .eq('id', resultId)
    .neq('platform', 'chatgpt-shopping')
    .maybeSingle();

  // A failed read throws, so the page can offer a retry instead of reporting
  // the result as missing.
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const { data: promptData } = await supabase
    .from('prompts')
    .select('text, category, topic_id')
    .eq('id', row.prompt_id as string)
    .single();

  const prompt = promptData as unknown as Record<string, unknown> | null;

  let topicName: string | undefined;
  if (prompt?.topic_id) {
    const { data: topic } = await supabase
      .from('topics')
      .select('name')
      .eq('id', prompt.topic_id as string)
      .single();
    topicName = (topic?.name as string) ?? undefined;
  }
  if (!topicName && prompt?.category) {
    topicName = prompt.category as string;
  }

  return {
    ...mapResultRow(row),
    promptText: (prompt?.text as string) ?? '',
    promptCategory: (prompt?.category as string | null) ?? undefined,
    topicId: (prompt?.topic_id as string | null) ?? undefined,
    topicName,
  };
}

/**
 * Fetch one prompt and its recent tracking results for the prompt detail page.
 */
export async function getPromptDetail(
  promptId: string,
  opts?: { limit?: number; dateFrom?: string; dateTo?: string },
): Promise<PromptDetailData | null> {
  const supabase = await dbClient();

  const { data: promptData, error: promptError } = await supabase
    .from('prompts')
    .select('id, prompt_set_id, text, category, topic_id, is_active, created_at')
    .eq('id', promptId)
    .single();

  if (promptError || !promptData) return null;

  const prompt = promptData as unknown as Record<string, unknown>;
  const promptSetId = prompt.prompt_set_id as string;

  const { data: promptSetData } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', promptSetId)
    .single();

  const brandId = (promptSetData?.brand_id as string | undefined) ?? '';

  // Brand + competitor domains feed classifyDomain, same as the citations page.
  // The extra query pins lastCheckedAt to the prompt's true latest run so the
  // "Last run" badge doesn't move (or empty out) when a date window is applied.
  const [{ data: brandDomainRows }, { data: competitorRows }, { data: lastRunRows }] =
    await Promise.all([
      supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
      supabase.from('competitors').select('domain').eq('brand_id', brandId),
      supabase
        .from('prompt_results')
        .select('created_at')
        .eq('prompt_id', promptId)
        .neq('platform', 'chatgpt-shopping')
        .order('created_at', { ascending: false })
        .limit(1),
    ]);
  const lastCheckedAt = (lastRunRows?.[0]?.created_at as string | undefined) ?? null;
  const classifyCtx = {
    brandDomains: (brandDomainRows ?? [])
      .map((r) => normalizeDomain((r as { domain: string }).domain))
      .filter(Boolean),
    competitorDomains: (competitorRows ?? [])
      .map((r) => normalizeDomain((r as { domain: string }).domain))
      .filter(Boolean),
  };

  let topicName: string | undefined;
  if (prompt.topic_id) {
    const { data: topic } = await supabase
      .from('topics')
      .select('name')
      .eq('id', prompt.topic_id as string)
      .single();
    topicName = (topic?.name as string) ?? undefined;
  }
  if (!topicName && prompt.category) {
    topicName = prompt.category as string;
  }

  // #155 — same isolation rule as the other aggregating queries here.
  let resultQuery = supabase
    .from('prompt_results')
    .select('*')
    .eq('prompt_id', promptId)
    .neq('platform', 'chatgpt-shopping');
  if (opts?.dateFrom) resultQuery = resultQuery.gte('created_at', opts.dateFrom);
  const expandedDateTo = expandDateToEndOfDay(opts?.dateTo);
  if (expandedDateTo) resultQuery = resultQuery.lte('created_at', expandedDateTo);
  const { data: resultRows, error: resultError } = await resultQuery
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 500);

  if (resultError) throw new Error(resultError.message);

  const rows = (resultRows ?? []) as unknown as Record<string, unknown>[];
  const results: PromptResultWithText[] = rows.map((row) => ({
    ...mapResultRow(row),
    promptText: prompt.text as string,
    promptCategory: (prompt.category as string | null) ?? undefined,
    topicId: (prompt.topic_id as string | null) ?? undefined,
    topicName,
  }));

  const totalResults = results.length;
  const avgVisibilityScore =
    totalResults > 0
      ? Math.round(results.reduce((sum, row) => sum + row.visibilityScore, 0) / totalResults)
      : 0;
  // Prompt-level Visibility Rate — same run-visibility rule as the All
  // Prompts column and the Insights headline (mention or citation > 0).
  const visibleResults = results.filter(
    (row) => row.mentionCount > 0 || row.citationCount > 0,
  ).length;
  const visibilityRate =
    totalResults > 0 ? Math.round((visibleResults / totalResults) * 1000) / 10 : 0;

  // AI Visibility Score over the same answer set — identical blend to the
  // All Prompts column and the Insights headline.
  const mentionAnswers = results.filter((row) => row.mentionCount > 0).length;
  const citationAnswers = results.filter((row) => row.citationCount > 0).length;
  const positionValues = rows
    .map((row) => row.mention_position as number | null)
    .filter((pos): pos is number => pos !== null && pos !== undefined && pos > 0);
  const positionFactor =
    positionValues.length > 0
      ? positionValues.reduce((sum, pos) => sum + 1 / pos, 0) / positionValues.length
      : null;
  const score = computeAiVisibilityScore({
    answers: totalResults,
    mentionAnswers,
    citationAnswers,
    positionFactor,
  });

  // Aggregate citations by domain — same shape and rounding as getCitationsOverview,
  // but scoped to this prompt's already-loaded results.
  interface SourceAgg {
    domain: string;
    category: SourceCategory;
    totalCitations: number;
    resultsCiting: Set<string>;
    models: Set<string>;
  }
  interface UrlAgg extends SourceAgg {
    url: string;
    title: string;
  }
  const sourceMap = new Map<string, SourceAgg>();
  const urlMap = new Map<string, UrlAgg>();
  for (const result of results) {
    const modelKey = result.modelUsed || result.platform || '';
    for (const cite of result.citations) {
      const host = extractHostname(cite.url);
      if (!host) continue;
      const category = sourceMap.get(host)?.category ?? classifyDomain(host, classifyCtx);

      const agg = sourceMap.get(host) ?? {
        domain: host,
        category,
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
      };
      agg.totalCitations += 1;
      agg.resultsCiting.add(result.id);
      if (modelKey) agg.models.add(modelKey);
      sourceMap.set(host, agg);

      // URL aggregation uses the same host-aware rule as getCitationsOverview.
      const normalizedUrl = normalizeCitationUrl(cite.url);
      const urlAgg = urlMap.get(normalizedUrl) ?? {
        url: normalizedUrl,
        domain: host,
        category,
        title: cite.title || '',
        totalCitations: 0,
        resultsCiting: new Set<string>(),
        models: new Set<string>(),
      };
      urlAgg.totalCitations += 1;
      urlAgg.resultsCiting.add(result.id);
      if (modelKey) urlAgg.models.add(modelKey);
      if (!urlAgg.title && cite.title) urlAgg.title = cite.title;
      urlMap.set(normalizedUrl, urlAgg);
    }
  }
  const usagePctOf = (resultsCiting: number) =>
    totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0;
  const topSources: PromptTopSource[] = Array.from(sourceMap.values())
    .map((agg) => ({
      domain: agg.domain,
      category: agg.category,
      models: Array.from(agg.models).sort(),
      totalCitations: agg.totalCitations,
      resultsCiting: agg.resultsCiting.size,
      usagePct: usagePctOf(agg.resultsCiting.size),
    }))
    .sort((a, b) => b.totalCitations - a.totalCitations || a.domain.localeCompare(b.domain));
  const topSourceUrls: PromptTopSourceUrl[] = Array.from(urlMap.values())
    .map((agg) => ({
      url: agg.url,
      domain: agg.domain,
      category: agg.category,
      title: agg.title,
      models: Array.from(agg.models).sort(),
      totalCitations: agg.totalCitations,
      resultsCiting: agg.resultsCiting.size,
      usagePct: usagePctOf(agg.resultsCiting.size),
    }))
    .sort((a, b) => b.totalCitations - a.totalCitations || a.url.localeCompare(b.url));

  return {
    prompt: {
      id: prompt.id as string,
      brandId,
      text: prompt.text as string,
      category: (prompt.category as string | null) ?? undefined,
      topicId: (prompt.topic_id as string | null) ?? undefined,
      topicName,
      isActive: Boolean(prompt.is_active),
      createdAt: prompt.created_at as string,
    },
    summary: {
      avgVisibilityScore,
      visibilityRate,
      visibleResults,
      score,
      mentionAnswers,
      citationAnswers,
      positionFactor,
      totalMentions: results.reduce((sum, row) => sum + row.mentionCount, 0),
      totalCitations: results.reduce((sum, row) => sum + row.citationCount, 0),
      totalResults,
      lastCheckedAt,
    },
    results,
    topSources,
    topSourceUrls,
  };
}

/**
 * Compute aggregated insights for a brand with proper date filtering.
 */
export async function getInsightsSummary(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
    previousDays?: DayWindow;
  },
): Promise<InsightsSummary> {
  const supabase = await dbClient();
  const p_models = modelFilterArray(opts?.model);
  const daily = dailyWindow(opts);

  // Sums + counts come from Postgres in one round trip; we still do the
  // final divide + round in JS so the displayed numbers track the old
  // reducer math exactly (verified by the parity test in 00006).
  const baseArgs = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models,
    p_region: opts?.region ?? undefined,
    p_prompt_id: undefined as string | undefined,
    p_topic_id: opts?.topicId ?? undefined,
  };
  const dailyArgs = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models,
    p_region: opts?.region ?? undefined,
    p_topic_id: opts?.topicId ?? undefined,
  };

  const { data: curData, error } = daily
    ? await supabase.rpc('insights_aggregates_daily', {
        ...dailyArgs,
        p_day_from: daily.dayFrom,
        p_day_to: daily.dayTo,
      })
    : await supabase.rpc('insights_aggregates', {
        ...baseArgs,
        p_date_from: opts?.dateFrom ?? undefined,
        p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? undefined,
      });
  if (error) throw new Error(error.message);

  const cur = curData as unknown as InsightsAggregates;

  if (cur.total_results === 0) {
    return {
      avgVisibilityScore: 0,
      totalMentions: 0,
      totalCitations: 0,
      positiveSentimentPct: 0,
      totalResults: 0,
      lastCheckedAt: null,
      platformBreakdown: [],
      visibilityChange: null,
      mentionsChange: null,
      citationsChange: null,
      prevMentions: null,
      prevCitations: null,
      sentimentChange: null,
      citationRate: null,
      citationRateChange: null,
      negativeSentimentPct: null,
      netSentiment: null,
      netSentimentChange: null,
      avgPosition: null,
      avgPositionChange: null,
      mentioningResults: 0,
      positionedResults: 0,
    };
  }

  const totalResults = cur.total_results;
  // Average visibility across ALL runs (brand-mentioned or not) — the intended
  // "absolute visibility" metric. Keep one decimal instead of rounding to a
  // whole number: a brand that appears in a small fraction of answers can have
  // a genuine sub-1 average (e.g. 0.4), and integer rounding collapsed that to
  // a flat "0" that read like a broken metric next to non-zero mentions.
  const avgVisibilityScore = roundTo1(cur.sum_visibility / totalResults);
  const totalMentions = cur.total_mentions;
  const totalCitations = cur.total_citations;
  // Denominator is answers that name the brand, not all results — sentiment
  // is only read where the brand is named, so dividing by totalResults (or by
  // answers that only cite it, #508) dilutes it with rows that can never be
  // positive. The same base as the Mentions page (00191).
  const positiveSentimentPct = positivePctOf(cur);
  const lastCheckedAt = cur.last_checked_at;

  const platformBreakdown = cur.by_model.map((m) => ({
    platform: m.model_used,
    avgScore: m.result_count > 0 ? Math.round(m.sum_visibility / m.result_count) : 0,
    resultCount: m.result_count,
  }));

  // --- Previous period comparison ---
  let visibilityChange: number | null = null;
  let mentionsChange: number | null = null;
  let citationsChange: number | null = null;
  let prevMentions: number | null = null;
  let prevCitations: number | null = null;
  let sentimentChange: number | null = null;
  let citationRateChange: number | null = null;
  let netSentimentChange: number | null = null;
  let avgPositionChange: number | null = null;
  const curRates = aggregateRates(cur);

  {
    let currentFrom: Date;
    let currentTo: Date;

    if (opts?.dateFrom) {
      currentFrom = new Date(opts.dateFrom);
      currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
    } else {
      currentTo = new Date();
      currentFrom = new Date();
      currentFrom.setDate(currentFrom.getDate() - 7);
    }

    const duration = currentTo.getTime() - currentFrom.getTime();
    const prevFrom = new Date(currentFrom.getTime() - duration);
    const deltaDays = daily ? deltaDayWindows(daily, opts?.previousDays) : null;

    // Current-window aggregate: when no dateFrom was passed, the top-level
    // call above is unbounded — for the delta math we need the same
    // explicit "last 7 days" window the JS code used so the comparison
    // stays anchored to recent momentum.
    const [curRes, prevRes] = await Promise.all([
      deltaDays
        ? supabase.rpc('insights_aggregates_daily', {
            ...dailyArgs,
            p_day_from: deltaDays.cur.dayFrom,
            p_day_to: deltaDays.cur.dayTo,
          })
        : supabase.rpc('insights_aggregates', {
            ...baseArgs,
            p_date_from: opts?.dateFrom ?? currentFrom.toISOString(),
            p_date_to: expandDateToEndOfDay(opts?.dateTo) ?? undefined,
          }),
      deltaDays
        ? supabase.rpc('insights_aggregates_daily', {
            ...dailyArgs,
            p_day_from: deltaDays.prev.dayFrom,
            p_day_to: deltaDays.prev.dayTo,
          })
        : supabase.rpc('insights_aggregates', {
            ...baseArgs,
            p_date_from: prevFrom.toISOString(),
            p_date_to: currentFrom.toISOString(),
          }),
    ]);
    // Surface RPC failures rather than silently emit null deltas — masking
    // server-side errors here would hide real outages behind "no change."
    if (curRes.error) throw new Error(curRes.error.message);
    if (prevRes.error) throw new Error(prevRes.error.message);

    const curWin = curRes.data as unknown as InsightsAggregates | null;
    const prevWin = prevRes.data as unknown as InsightsAggregates | null;

    if (curWin && prevWin && curWin.total_results > 0 && prevWin.total_results > 0) {
      const curAvgVis = roundTo1(curWin.sum_visibility / curWin.total_results);
      const curMentions = curWin.total_mentions;
      const curCitations = curWin.total_citations;
      const curSentimentPct = positivePctOf(curWin);

      const prevAvgVis = roundTo1(prevWin.sum_visibility / prevWin.total_results);
      prevMentions = prevWin.total_mentions;
      prevCitations = prevWin.total_citations;
      const prevSentimentPct = positivePctOf(prevWin);

      visibilityChange = roundTo1(curAvgVis - prevAvgVis);
      mentionsChange = percentageChange(curMentions, prevMentions);
      citationsChange = percentageChange(curCitations, prevCitations);
      sentimentChange = curSentimentPct - prevSentimentPct;

      const deltaCur = aggregateRates(curWin);
      const deltaPrev = aggregateRates(prevWin);
      citationRateChange = rateChange(deltaCur.citationRate, deltaPrev.citationRate);
      netSentimentChange = rateChange(deltaCur.netSentiment, deltaPrev.netSentiment);
      avgPositionChange = rateChange(deltaCur.avgPosition, deltaPrev.avgPosition);
    }
  }

  return {
    avgVisibilityScore,
    totalMentions,
    totalCitations,
    positiveSentimentPct,
    totalResults,
    lastCheckedAt,
    platformBreakdown,
    visibilityChange,
    mentionsChange,
    citationsChange,
    prevMentions,
    prevCitations,
    sentimentChange,
    citationRate: curRates.citationRate,
    citationRateChange,
    negativeSentimentPct: curRates.negativePct,
    netSentiment: curRates.netSentiment,
    netSentimentChange,
    avgPosition: curRates.avgPosition,
    avgPositionChange,
    mentioningResults: namedAnswers(cur),
    positionedResults: Number(cur.position_count ?? 0),
  };
}

/**
 * Answers naming the brand in a window: Net sentiment's base (00191). Before
 * that migration the aggregates have only answers naming or citing it.
 */
function namedAnswers(a: InsightsAggregates): number {
  return Number(a.mention_results ?? a.mentioning_results ?? 0);
}

/** Positive answers as a whole % of those naming the brand; 0 without any. */
function positivePctOf(a: InsightsAggregates): number {
  const named = namedAnswers(a);
  return named > 0 ? Math.round((a.positive_count * 100) / named) : 0;
}

/**
 * The KPI cards' rates from one insights_aggregates window (00131). Before
 * the rollups behind it are backfilled, negatives and positions are missing:
 * Net sentiment and Avg. position read null rather than a partial value. A
 * payload without the 00131 fields at all (migration not run) reads the same
 * way, and so does Citation rate, instead of counting what's missing as 0.
 */
function aggregateRates(a: InsightsAggregates): KpiRates {
  const rates = kpiRates({
    answers: Number(a.total_results ?? 0),
    citationAnswers: Number(a.citation_answers ?? 0),
    named: namedAnswers(a),
    positive: Number(a.positive_count ?? 0),
    negative: Number(a.negative_count ?? 0),
    sumPosition:
      a.sum_position === null || a.sum_position === undefined ? null : Number(a.sum_position),
    positionCount: Number(a.position_count ?? 0),
  });
  return {
    ...rates,
    citationRate: a.citation_answers === undefined ? null : rates.citationRate,
    ...(a.kpi_complete === true
      ? {}
      : { negativePct: null, netSentiment: null, avgPosition: null }),
  };
}

/**
 * All time has no earlier period of the same length (VIS-001), so the cards
 * show no change. getInsightsSummary and getShareOfVoiceData keep comparing
 * the trailing 7 days there for their other callers (the topic page).
 */
function withoutChanges(
  summary: InsightsSummary,
  sov: ShareOfVoiceData,
): { summary: InsightsSummary; sov: ShareOfVoiceData } {
  return {
    summary: {
      ...summary,
      visibilityChange: null,
      mentionsChange: null,
      citationsChange: null,
      sentimentChange: null,
      citationRateChange: null,
      netSentimentChange: null,
      avgPositionChange: null,
    },
    sov: { ...sov, overallSovChange: null },
  };
}

/**
 * Trigger a tracking check via the aeo-server API.
 * Pass promptId to run a single prompt instead of all.
 */
export async function triggerTrackingCheck(
  brandId: string,
  opts?: { promptId?: string },
): Promise<{ jobId: string }> {
  const supabase = await dbClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  const payload: Record<string, string> = { brandId };
  if (opts?.promptId) payload.promptId = opts.promptId;

  const res = await fetch(`${serverUrl}/api/tracking/check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { jobId: data.jobId };
}

/**
 * Submit a single freshly created prompt to the tracking pipeline.
 *
 * Deliberately scoped to ONE prompt id rather than the brand's whole
 * unanalyzed set. Cloro delivers results asynchronously, so a prompt that is
 * still in flight has no `prompt_results` rows yet and would be picked up —
 * and paid for — a second time by the very next add. Passing only the id we
 * just created keeps each prompt to exactly one submission.
 *
 * Never throws, and never surfaces a failure as an error: a prompt that can't
 * be submitted right now (daily cap, cooldown, paused brand, no active
 * subscription, server unreachable) is still saved, and the daily scheduled
 * run picks it up. The boolean only decides which "prompt added" message the
 * user sees.
 */
export async function analyzeNewPrompt(
  brandId: string,
  promptId: string,
): Promise<{ started: boolean }> {
  return analyzeNewPrompts(brandId, [promptId]);
}

/**
 * Submit several just-added prompts for their first run in one request — a
 * bulk import (PROMPT-005) spends one on-demand run, not one per row. A
 * refusal (daily cap, cooldown, paused brand) is not an error: the prompts are
 * saved and the next scheduled run picks them up.
 */
export async function analyzeNewPrompts(
  brandId: string,
  promptIds: string[],
): Promise<{ started: boolean }> {
  if (promptIds.length === 0) return { started: false };
  const supabase = await dbClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { started: false };

  try {
    const res = await fetch(`${API_BASE_URL}/api/tracking/analyze-new`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, promptIds }),
    });

    if (!res.ok) {
      // 402 (no subscription), 409 (paused brand) and 429 (daily cap or
      // cooldown) are expected states rather than faults — stay quiet about
      // them. Anything else is worth a server-side log.
      if (res.status !== 402 && res.status !== 409 && res.status !== 429) {
        console.error('Failed to submit new prompt for analysis', res.status);
      }
      return { started: false };
    }

    const body: { jobId?: string } = await res.json().catch(() => ({}));
    return { started: Boolean(body.jobId) };
  } catch (err) {
    console.error('Failed to submit new prompt for analysis', err);
    return { started: false };
  }
}

export interface TrackingJobStatus {
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'not_found';
  progress: {
    current: number;
    total: number;
    promptText?: string;
    model?: string;
    region?: string;
    platform?: string;
  } | null;
  /**
   * A finished job's answers stored, webhook deliveries included; `stillArriving`
   * when the run waits on late answers before it closes.
   */
  result: { resultCount: number; stamped?: boolean; stillArriving?: boolean } | null;
  failedReason: string | null;
}

/**
 * Poll a tracking job's status from the aeo-server.
 */
export async function getJobStatus(jobId: string): Promise<TrackingJobStatus> {
  const supabase = await dbClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${serverUrl}/api/tracking/job/${jobId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      return {
        status: 'not_found',
        progress: null,
        result: null,
        failedReason: null,
      };
    }

    const data = await res.json();
    return {
      status: data.status ?? 'not_found',
      progress:
        data.progress && typeof data.progress === 'object' && data.progress.total
          ? data.progress
          : null,
      result: data.result ?? null,
      failedReason: data.failedReason ?? null,
    };
  } catch {
    return {
      status: 'not_found',
      progress: null,
      result: null,
      failedReason: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Cancel/stop an active tracking job.
 */
export async function cancelTrackingJob(jobId: string): Promise<void> {
  const supabase = await dbClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const serverUrl = API_BASE_URL;

  await fetch(`${serverUrl}/api/tracking/job/${jobId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
}

export interface PromptVisibilitySummary {
  avgVisibility: number;
  /** Average score across visible runs only (null when never visible). */
  avgVisibilityVisible: number | null;
  totalMentions: number;
  totalCitations: number;
  runs: number;
  /** Runs with >= 1 brand mention/citation — numerator of the prompt-level rate. */
  visibleRuns: number;
  /** visibleRuns / runs as a percentage, one decimal (coverage, secondary). */
  visibilityRate: number;
  /** AI Visibility Score (0-100) over this prompt's answers; null when no runs. */
  score: number | null;
  /** Answers mentioning the brand (score component). */
  mentionAnswers: number;
  /** Answers citing the brand's domain (score component). */
  citationAnswers: number;
  /** Mean of 1/position over mentioning answers; null when never mentioned. */
  positionFactor: number | null;
  lastRunAt: string;
}

/**
 * Aggregate visibility + mention stats per prompt for a brand, over the
 * last N days (default 30). Used by the All Prompts tab to show a quick
 * health column next to each prompt.
 *
 * `region` scopes the aggregate to one tracked location (#691). Without it
 * a multi-location prompt's figures are the blend of everywhere it runs,
 * which hides exactly what tracking several locations was meant to reveal —
 * a prompt can be strong at home and invisible abroad.
 *
 * Returns a map keyed by prompt_id. Prompts without any runs in the window
 * simply won't appear in the map (callers should render "—").
 */
export async function getPromptVisibilitySummaries(
  brandId: string,
  opts?: { days?: number; from?: string; to?: string; region?: string },
): Promise<Record<string, PromptVisibilitySummary>> {
  const supabase = await dbClient();
  // `from`/`to` win when given (the custom range, #713); otherwise the day
  // count keeps every existing caller on its previous behaviour.
  const days = opts?.days ?? 30;
  const since = opts?.from ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // One GROUP BY in Postgres (migration 00025) instead of pulling the raw
  // result window into JS: the old un-paginated select silently capped at
  // 1000 rows (wrong health columns on busy brands — the #430/#464 defect
  // family) and its transfer cost slowed the Prompts page's first load.
  // The RPC excludes chatgpt-shopping (#155) like every analytical surface.
  // One row per prompt, read a page at a time so a brand past 1000 prompts
  // keeps them all.
  const data = await readAllRpcRows((from, to) =>
    supabase
      .rpc('prompt_visibility_summaries', {
        p_brand_id: brandId,
        p_date_from: since,
        p_date_to: opts?.to ?? undefined,
        // One tracked location, or every location blended when absent (#691).
        p_region: opts?.region ?? undefined,
      })
      .order('prompt_id')
      .range(from, to),
  );

  const result: Record<string, PromptVisibilitySummary> = {};
  for (const row of data) {
    const runs = Number(row.runs ?? 0);
    const visibleRuns = Number(row.visible_runs ?? 0);
    const mentionAnswers = Number(row.mention_answers ?? 0);
    const citationAnswers = Number(row.citation_answers ?? 0);
    const positionFactor = row.position_factor ?? null;
    result[row.prompt_id] = {
      avgVisibility: row.avg_visibility ?? 0,
      avgVisibilityVisible: row.avg_visibility_visible ?? null,
      totalMentions: Number(row.total_mentions ?? 0),
      totalCitations: Number(row.total_citations ?? 0),
      runs,
      visibleRuns,
      visibilityRate: runs > 0 ? Math.round((visibleRuns / runs) * 1000) / 10 : 0,
      score: computeAiVisibilityScore({
        answers: runs,
        mentionAnswers,
        citationAnswers,
        positionFactor,
      }),
      mentionAnswers,
      citationAnswers,
      positionFactor,
      lastRunAt: row.last_run_at,
    };
  }
  return result;
}

/**
 * Fetch active prompts for a brand (for the prompt selector).
 */
export async function getBrandPrompts(
  brandId: string,
): Promise<{ id: string; text: string; category?: string; platforms: string[] }[]> {
  const supabase = await dbClient();

  const { data: promptSets } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (!promptSets || promptSets.length === 0) return [];

  const setIds = promptSets.map((s) => s.id);

  const { data: prompts, error } = await supabase
    .from('prompts')
    .select('id, text, category, platforms')
    .in('prompt_set_id', setIds)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (prompts ?? []).map((p) => ({
    id: p.id as string,
    text: p.text as string,
    category: (p.category as string | null) ?? undefined,
    platforms: (p.platforms as string[]) ?? [],
  }));
}

/** Raw shape of the ai_visibility_aggregates RPC payload (00040). */
interface AiVisibilityAggregatesRow {
  answers: number;
  mention_answers: number;
  citation_answers: number;
  position_factor: number | null;
  by_competitor: {
    competitor_id: string;
    name: string | null;
    mention_answers: number;
    citation_answers: number;
    position_factor: number | null;
  }[];
}

interface AiVisibilityWindow {
  answers: number;
  brandScore: number | null;
  brandComponents: {
    mentionAnswers: number;
    citationAnswers: number;
    positionFactor: number | null;
  };
  compScore: Map<string, number | null>;
  compComponents: Map<
    string,
    { mentionAnswers: number; citationAnswers: number; positionFactor: number | null }
  >;
}

/**
 * Fold an ai_visibility_aggregates payload into per-entity scores. Every
 * entity divides by the same answer count (the brand's filtered answers),
 * so brand and competitor scores are directly comparable.
 */
function foldAiVisibility(raw: unknown): AiVisibilityWindow {
  const row = (raw ?? {}) as AiVisibilityAggregatesRow;
  const answers = Number(row.answers ?? 0);
  const brandComponents = {
    mentionAnswers: Number(row.mention_answers ?? 0),
    citationAnswers: Number(row.citation_answers ?? 0),
    positionFactor: row.position_factor === null ? null : Number(row.position_factor),
  };
  const compScore = new Map<string, number | null>();
  const compComponents = new Map<
    string,
    { mentionAnswers: number; citationAnswers: number; positionFactor: number | null }
  >();
  for (const c of row.by_competitor ?? []) {
    const components = {
      mentionAnswers: Number(c.mention_answers ?? 0),
      citationAnswers: Number(c.citation_answers ?? 0),
      positionFactor: c.position_factor === null ? null : Number(c.position_factor),
    };
    compComponents.set(c.competitor_id, components);
    compScore.set(c.competitor_id, computeAiVisibilityScore({ answers, ...components }));
  }
  return {
    answers,
    brandScore: computeAiVisibilityScore({ answers, ...brandComponents }),
    brandComponents,
    compScore,
    compComponents,
  };
}

/**
 * ai_visibility_aggregates over one comparison window (VIS-001): the daily
 * rollups for whole days, the raw rows for a timestamp range. The card, the
 * breakdown panel and the leaderboard read their Visibility through this, so
 * the same window always yields the same number.
 */
function aiVisibilityWindow(
  supabase: Awaited<ReturnType<typeof dbClient>>,
  brandId: string,
  opts: { model?: string; region?: string; topicId?: string } | undefined,
  win: MetricWindow,
) {
  const base = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
  };
  return win.kind === 'days'
    ? supabase.rpc('ai_visibility_aggregates_daily', {
        ...base,
        p_day_from: win.days.dayFrom,
        p_day_to: win.days.dayTo,
        p_topic_id: opts?.topicId ?? undefined,
      })
    : supabase.rpc('ai_visibility_aggregates', {
        ...base,
        p_date_from: win.from,
        p_date_to: win.to,
        p_topic_id: opts?.topicId ?? undefined,
      });
}

export interface CompetitorComparisonEntry {
  name: string;
  avgVisibilityScore: number;
  /**
   * Prompt-level visibility rate (%): distinct prompts this entity appeared
   * in ÷ distinct prompts that produced results in the window. Same
   * denominator for the brand and every competitor — the leaderboard metric.
   */
  visibilityRate: number;
  /** Distinct prompts this entity appeared in (the rate's numerator). */
  visiblePrompts: number;
  /** Distinct prompts that produced results in the window (shared denominator). */
  promptCount: number;
  /**
   * Point change of the visibility rate versus the previous comparable
   * window (e.g. last 7 days vs the 7 days before that).
   * `null` when there is no comparable previous-period value.
   */
  change: number | null;
  /**
   * AI Visibility Score (0-100, one decimal): 0.6×mention rate +
   * 0.25×citation rate + 0.15×position factor, all over the brand's
   * filtered answers (shared denominator). Null when the window is empty.
   */
  score: number | null;
  /** Score point change vs the previous comparable window; null without one. */
  scoreChange: number | null;
  /** Answers naming this entity (numerator of the mention component). */
  mentionAnswers: number;
  /** Answers citing this entity's own domain. */
  citationAnswers: number;
  /** Mean of 1/position over answers naming the entity; null when never named. */
  positionFactor: number | null;
  totalMentions: number;
  totalCitations: number;
  resultCount: number;
  isOwnBrand: boolean;
  /** The competitor's id; absent on the brand's own entry. */
  competitorId?: string;
}

export interface ProviderComparisonRow {
  provider: string;
  [brandName: string]: string | number;
}

export interface CompetitorComparisonData {
  brands: CompetitorComparisonEntry[];
  providerRows: ProviderComparisonRow[];
}

const MODEL_TO_PROVIDER: Record<string, string> = {
  'gpt-5-chat-latest': 'ChatGPT',
  'gpt-5-mini': 'ChatGPT',
  'gpt-4o': 'ChatGPT',
  'claude-sonnet-5': 'Claude',
  'claude-sonnet-4-6': 'Claude',
  'claude-opus-4-6': 'Claude',
  'gemini-2.5-pro': 'Gemini',
  'gemini-2.5-flash': 'Gemini',
};

const SCRAPER_PROVIDER: Record<string, string> = {
  chatgpt: 'ChatGPT',
  'chatgpt-web': 'ChatGPT',
  'google-aio': 'Google AI Overviews',
  'google-aimode': 'Google AI Mode',
  'copilot-web': 'Microsoft Copilot',
  'grok-web': 'Grok',
  'perplexity-web': 'Perplexity',
  'gemini-web': 'Gemini',
};

function resolveProvider(modelUsed: string | null | undefined, platform?: string | null): string {
  if (platform && SCRAPER_PROVIDER[platform]) return SCRAPER_PROVIDER[platform];
  if (!modelUsed) return 'Unknown';
  const mapped = MODEL_TO_PROVIDER[modelUsed];
  if (mapped) return mapped;
  if (modelUsed.startsWith('gpt-')) return 'ChatGPT';
  if (modelUsed.startsWith('claude-')) return 'Claude';
  if (modelUsed.startsWith('gemini-')) return 'Gemini';
  if (modelUsed.startsWith('sonar')) return 'Perplexity';
  if (modelUsed.startsWith('grok')) return 'Grok';
  return modelUsed;
}

/**
 * Aggregate competitor comparison data from prompt results.
 * Returns both flat brand scores and per-provider breakdown.
 *
 * Server-side aggregation lives in the competitor_aggregates RPC
 * (supabase/migrations/00006). This function only does the resolveProvider
 * fold + final divide/round — the heavy `select(*) + reduce` loop is gone.
 */
export async function getCompetitorComparison(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
    previousDays?: DayWindow;
  },
): Promise<CompetitorComparisonData> {
  const supabase = await dbClient();
  const p_models = modelFilterArray(opts?.model);
  const daily = dailyWindow(opts);

  const baseArgs = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models,
    p_region: opts?.region ?? undefined,
    p_prompt_id: undefined as string | undefined,
    p_topic_id: opts?.topicId ?? undefined,
  };
  const dailyArgs = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models,
    p_region: opts?.region ?? undefined,
    p_topic_id: opts?.topicId ?? undefined,
  };

  // The heaviest reads on the page: competitor_aggregates over the raw rows
  // took 9.7s on the largest brand's all-time window — past the 8s statement
  // timeout. The rollup variants answer the same payload from the daily
  // tables (00066).
  const compRpc = (win: { dayFrom?: string; dayTo?: string } | null, from?: string, to?: string) =>
    win
      ? supabase.rpc('competitor_aggregates_daily', {
          ...dailyArgs,
          p_day_from: win.dayFrom,
          p_day_to: win.dayTo,
        })
      : supabase.rpc('competitor_aggregates', {
          ...baseArgs,
          p_date_from: from,
          p_date_to: to,
        });
  // Scores and their change use the card's windows (VIS-001), so the
  // brand's own row always matches the Visibility card.
  const visWindows = comparisonWindows(opts);

  // Brand name + the displayed-period aggregates fire in parallel — all
  // are needed before we can shape the response.
  const [{ data: brand }, { data: aggDisplay, error: aggErr }, visDisplayRes] = await Promise.all([
    supabase.from('brands').select('name').eq('id', brandId).single(),
    compRpc(daily, opts?.dateFrom ?? undefined, expandDateToEndOfDay(opts?.dateTo) ?? undefined),
    aiVisibilityWindow(supabase, brandId, opts, visWindows.cur),
  ]);
  if (aggErr) throw new Error(aggErr.message);
  if (visDisplayRes.error) throw new Error(visDisplayRes.error.message);
  const visDisplay = foldAiVisibility(visDisplayRes.data);

  const agg = aggDisplay as unknown as CompetitorAggregatesRow;
  if (agg.brand_row_count === 0) return { brands: [], providerRows: [] };

  // --- Current vs previous period for change calculation ---
  // The displayed avg/totals come from `agg` (respects the selected preset),
  // but the ↑/↓ delta always compares a fixed "current" window to the window
  // immediately before it so the arrow reflects recent momentum (mirrors
  // getInsightsSummary's KPI change logic).
  let currentFrom: Date;
  let currentTo: Date;

  if (opts?.dateFrom) {
    currentFrom = new Date(opts.dateFrom);
    currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
  } else {
    currentTo = new Date();
    currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 7);
  }

  const duration = currentTo.getTime() - currentFrom.getTime();
  const prevFrom = new Date(currentFrom.getTime() - duration);
  const deltaDays = daily ? deltaDayWindows(daily, opts?.previousDays) : null;

  const [curRes, prevRes, visPrevRes] = await Promise.all([
    deltaDays
      ? compRpc(deltaDays.cur)
      : compRpc(
          null,
          opts?.dateFrom ?? currentFrom.toISOString(),
          expandDateToEndOfDay(opts?.dateTo) ?? undefined,
        ),
    deltaDays
      ? compRpc(deltaDays.prev)
      : compRpc(null, prevFrom.toISOString(), currentFrom.toISOString()),
    visWindows.prev
      ? aiVisibilityWindow(supabase, brandId, opts, visWindows.prev)
      : Promise.resolve({ data: null, error: new Error('no previous window') }),
  ]);
  if (curRes.error) throw new Error(curRes.error.message);
  if (prevRes.error) throw new Error(prevRes.error.message);
  // Score delta compares the displayed window against the one immediately
  // before it (none for All time); a previous-window failure only costs the
  // delta, not the page.
  const visPrev = visPrevRes.error ? null : foldAiVisibility(visPrevRes.data);
  const scoreDiff = (cur: number | null, prev: number | null | undefined): number | null => {
    if (cur === null || prev === null || prev === undefined) return null;
    return Math.round((cur - prev) * 10) / 10;
  };

  const curWin = curRes.data as unknown as CompetitorAggregatesRow | null;
  const prevWin = prevRes.data as unknown as CompetitorAggregatesRow | null;

  // The leaderboard metric is the prompt-level visibility rate: distinct
  // prompts an entity appeared in ÷ distinct prompts that produced results.
  // Same-denominator rule as before (#478) — the brand and every competitor
  // divide by the same prompt count, so absence still costs; but a prompt
  // counts once no matter how many platforms answered it, which keeps the
  // number readable instead of the near-zero all-rows score average.
  const rateOf = (visible: number, prompts: number): number | null =>
    prompts > 0 ? Math.round((visible / prompts) * 1000) / 10 : null;

  const curBrandRate = curWin
    ? rateOf(curWin.brand_visible_prompts, curWin.brand_prompt_count)
    : null;
  const prevBrandRate = prevWin
    ? rateOf(prevWin.brand_visible_prompts, prevWin.brand_prompt_count)
    : null;

  const curCompRate = new Map<string, number | null>();
  if (curWin) {
    for (const c of curWin.by_competitor) {
      curCompRate.set(c.competitor_id, rateOf(c.visible_prompts, curWin.brand_prompt_count));
    }
  }
  const prevCompRate = new Map<string, number | null>();
  if (prevWin) {
    for (const c of prevWin.by_competitor) {
      prevCompRate.set(c.competitor_id, rateOf(c.visible_prompts, prevWin.brand_prompt_count));
    }
  }

  const brandName = (brand?.name as string) ?? 'Your Brand';
  const brandAvg = Math.round(agg.brand_sum_visibility / agg.brand_row_count);
  const brandRate = rateOf(agg.brand_visible_prompts, agg.brand_prompt_count) ?? 0;

  // Point change of the rate relative to the previous-period value.
  // Null when no comparable previous value exists.
  const rateDiff = (cur: number | null, prev: number | null): number | null => {
    if (cur === null || prev === null) return null;
    return Math.round((cur - prev) * 10) / 10;
  };

  // Falls back to the competitor id when the name is null/empty so two
  // unnamed competitors don't collide under the same empty-string key in
  // compByProvider below. Applied consistently to the entries[] name field
  // so the providerRows column header matches the table row label.
  const competitorDisplayName = (name: string | null | undefined, id: string): string =>
    name && name.trim() !== '' ? name : id;

  const entries: CompetitorComparisonEntry[] = [
    {
      name: brandName,
      avgVisibilityScore: brandAvg,
      visibilityRate: brandRate,
      visiblePrompts: agg.brand_visible_prompts,
      promptCount: agg.brand_prompt_count,
      change: rateDiff(curBrandRate, prevBrandRate),
      score: visDisplay.brandScore,
      scoreChange: scoreDiff(visDisplay.brandScore, visPrev?.brandScore),
      mentionAnswers: visDisplay.brandComponents.mentionAnswers,
      citationAnswers: visDisplay.brandComponents.citationAnswers,
      positionFactor: visDisplay.brandComponents.positionFactor,
      totalMentions: agg.brand_total_mentions,
      totalCitations: agg.brand_total_citations,
      resultCount: agg.brand_row_count,
      isOwnBrand: true,
    },
  ];

  for (const c of agg.by_competitor) {
    // Same-denominator rule as the window rates above (agg.brand_row_count
    // is guaranteed > 0 by the early return).
    const avg = Math.round(c.sum_visibility / agg.brand_row_count);
    const compComponents = visDisplay.compComponents.get(c.competitor_id);
    entries.push({
      name: competitorDisplayName(c.name, c.competitor_id),
      avgVisibilityScore: avg,
      visibilityRate: rateOf(c.visible_prompts, agg.brand_prompt_count) ?? 0,
      visiblePrompts: c.visible_prompts,
      promptCount: agg.brand_prompt_count,
      change: rateDiff(
        curCompRate.get(c.competitor_id) ?? null,
        prevCompRate.get(c.competitor_id) ?? null,
      ),
      score: visDisplay.compScore.get(c.competitor_id) ?? null,
      scoreChange: scoreDiff(
        visDisplay.compScore.get(c.competitor_id) ?? null,
        visPrev?.compScore.get(c.competitor_id),
      ),
      mentionAnswers: compComponents?.mentionAnswers ?? 0,
      citationAnswers: compComponents?.citationAnswers ?? 0,
      positionFactor: compComponents?.positionFactor ?? null,
      totalMentions: c.total_mentions,
      totalCitations: c.total_citations,
      resultCount: c.row_count,
      isOwnBrand: false,
      competitorId: c.competitor_id,
    });
  }

  entries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.totalMentions - a.totalMentions);

  // --- Per-provider breakdown ---
  // resolveProvider stays in JS so we don't keep a SQL copy of the mapping
  // table in sync — fold the (model_used, platform) groups into provider
  // buckets here. The chart plots the same prompt-level rate as the
  // leaderboard; summing DISTINCT counts across two engines of one provider
  // counts a shared prompt once per engine in numerator and denominator
  // alike, so the folded rate stays unbiased.
  type Agg = { visiblePrompts: number; promptCount: number };
  const brandByProvider = new Map<string, Agg>();
  for (const bp of agg.by_brand_provider) {
    const provider = resolveProvider(bp.model_used, bp.platform);
    const ex = brandByProvider.get(provider) ?? { visiblePrompts: 0, promptCount: 0 };
    ex.visiblePrompts += bp.visible_prompts;
    ex.promptCount += bp.prompt_count;
    brandByProvider.set(provider, ex);
  }

  // compName -> provider -> visible prompt count. Keyed by the same display
  // name used in entries[] above so the providerRows column headers line up
  // with the table rows (empty/null names fall back to competitor_id). No
  // denominator here — competitors divide by the brand's provider bucket.
  const compByProvider = new Map<string, Map<string, number>>();
  for (const cp of agg.by_competitor_provider) {
    const provider = resolveProvider(cp.model_used, cp.platform);
    const name = competitorDisplayName(cp.competitor_name, cp.competitor_id);
    if (!compByProvider.has(name)) compByProvider.set(name, new Map());
    const pm = compByProvider.get(name)!;
    pm.set(provider, (pm.get(provider) ?? 0) + cp.visible_prompts);
  }

  const allProviders = new Set<string>();
  for (const p of brandByProvider.keys()) allProviders.add(p);
  for (const pm of compByProvider.values()) {
    for (const p of pm.keys()) allProviders.add(p);
  }

  const providerRows: ProviderComparisonRow[] = [...allProviders].sort().map((provider) => {
    const row: ProviderComparisonRow = { provider };
    const bp = brandByProvider.get(provider);
    // Same-denominator rule: everyone divides by the brand bucket's prompt
    // count (which spans every filtered prompt for the provider), not their
    // own appearance count. Competitor rows are a subset of the brand's, so
    // bp always exists when a competitor has data for the provider.
    const denom = bp?.promptCount ?? 0;
    row[brandName] = bp && denom > 0 ? Math.round((bp.visiblePrompts / denom) * 1000) / 10 : 0;
    for (const [compName, pm] of compByProvider) {
      const visible = pm.get(provider) ?? 0;
      row[compName] = denom > 0 ? Math.round((visible / denom) * 1000) / 10 : 0;
    }
    return row;
  });

  return { brands: entries, providerRows };
}

// ─── Share of Voice ─────────────────────────────────────────────────────────

export interface SoVByPlatform {
  provider: string;
  brandMentions: number;
  competitorMentions: number;
  sov: number;
}

export interface SoVTrendPoint {
  date: string;
  brandSov: number;
  competitorSov: number;
}

export interface ShareOfVoiceData {
  overallSov: number;
  overallSovChange: number | null;
  byPlatform: SoVByPlatform[];
  trend: SoVTrendPoint[];
}

export async function getShareOfVoiceData(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
    previousDays?: DayWindow;
  },
): Promise<ShareOfVoiceData> {
  const supabase = await dbClient();
  const p_models = modelFilterArray(opts?.model);
  const daily = dailyWindow(opts);

  const baseArgs = {
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models,
    p_region: opts?.region ?? undefined,
    p_prompt_id: undefined as string | undefined,
    p_topic_id: opts?.topicId ?? undefined,
  };
  const sovRpc = (win: { dayFrom?: string; dayTo?: string } | null, from?: string, to?: string) =>
    win
      ? supabase.rpc('share_of_voice_aggregates_daily', {
          p_brand_id: brandId,
          p_platform: undefined as string | undefined,
          p_models,
          p_region: opts?.region ?? undefined,
          p_day_from: win.dayFrom,
          p_day_to: win.dayTo,
          p_topic_id: opts?.topicId ?? undefined,
        })
      : supabase.rpc('share_of_voice_aggregates', {
          ...baseArgs,
          p_date_from: from,
          p_date_to: to,
        });

  // Current-period aggregate + previous-period aggregate run in parallel —
  // both server-side, no row transfer or JS reduce. The previous-period
  // window always anchors to "last 7 days" when the caller hasn't picked an
  // explicit dateFrom (matches the original delta logic for SoV).
  let currentFrom: Date;
  let currentTo: Date;
  if (opts?.dateFrom) {
    currentFrom = new Date(opts.dateFrom);
    currentTo = opts.dateTo ? new Date(opts.dateTo) : new Date();
  } else {
    currentTo = new Date();
    currentFrom = new Date();
    currentFrom.setDate(currentFrom.getDate() - 7);
  }
  const duration = currentTo.getTime() - currentFrom.getTime();
  const prevFrom = new Date(currentFrom.getTime() - duration);
  const deltaDays = daily ? deltaDayWindows(daily, opts?.previousDays) : null;

  const [{ data: curData, error: curErr }, { data: prevData, error: prevErr }] = await Promise.all([
    daily
      ? sovRpc(daily)
      : sovRpc(null, opts?.dateFrom ?? undefined, expandDateToEndOfDay(opts?.dateTo) ?? undefined),
    deltaDays
      ? sovRpc(deltaDays.prev)
      : sovRpc(null, prevFrom.toISOString(), currentFrom.toISOString()),
  ]);
  if (curErr) throw new Error(curErr.message);
  if (prevErr) throw new Error(prevErr.message);

  const cur = curData as unknown as ShareOfVoiceAggregatesRow;
  const prev = prevData as unknown as ShareOfVoiceAggregatesRow | null;

  const totalBrandMentions = Number(cur.total_brand_mentions);
  const totalCompMentions = Number(cur.total_competitor_mentions);

  if (totalBrandMentions === 0 && totalCompMentions === 0) {
    return { overallSov: 0, overallSovChange: null, byPlatform: [], trend: [] };
  }

  const totalAll = totalBrandMentions + totalCompMentions;
  const overallSov = totalAll > 0 ? Math.round((totalBrandMentions / totalAll) * 1000) / 10 : 0;

  // --- By provider ---
  // resolveProvider stays in JS so the SQL doesn't carry a duplicate of the
  // model/platform → provider mapping table.
  type ProviderAgg = { brandMentions: number; competitorMentions: number };
  const providerMap = new Map<string, ProviderAgg>();
  for (const bp of cur.by_platform) {
    const provider = resolveProvider(bp.model_used, bp.platform);
    const ex = providerMap.get(provider) ?? { brandMentions: 0, competitorMentions: 0 };
    ex.brandMentions += Number(bp.brand_mentions);
    ex.competitorMentions += Number(bp.competitor_mentions);
    providerMap.set(provider, ex);
  }

  const byPlatform: SoVByPlatform[] = [...providerMap.entries()]
    .map(([provider, agg]) => {
      const total = agg.brandMentions + agg.competitorMentions;
      return {
        provider,
        brandMentions: agg.brandMentions,
        competitorMentions: agg.competitorMentions,
        sov: total > 0 ? Math.round((agg.brandMentions / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.sov - a.sov);

  // --- Trend ---
  // RPC already returns by_day ordered by date ascending, but be defensive.
  const trend: SoVTrendPoint[] = [...cur.by_day]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .map((d) => {
      const brand = Number(d.brand_mentions);
      const comp = Number(d.competitor_mentions);
      const total = brand + comp;
      const brandSov = total > 0 ? Math.round((brand / total) * 1000) / 10 : 0;
      const competitorSov = total > 0 ? Math.round((comp / total) * 1000) / 10 : 0;
      const dateObj = new Date(d.day + 'T00:00:00');
      const label = dateObj.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return { date: label, brandSov, competitorSov };
    });

  // --- Previous period delta (overall SoV only) ---
  let overallSovChange: number | null = null;
  if (prev) {
    const prevBrandM = Number(prev.total_brand_mentions);
    const prevCompM = Number(prev.total_competitor_mentions);
    if (prevBrandM + prevCompM > 0) {
      const prevTotal = prevBrandM + prevCompM;
      const prevSov = prevTotal > 0 ? Math.round((prevBrandM / prevTotal) * 1000) / 10 : 0;
      overallSovChange = Math.round((overallSov - prevSov) * 10) / 10;
    }
  }

  return { overallSov, overallSovChange, byPlatform, trend };
}

export interface VisibilityTrendPoint {
  date: string;
  score: number;
  competitors: number | null;
}

/**
 * Fetch daily visibility score trend for a brand (and avg competitor score).
 * Queries ALL prompt_results (not deduplicated) to build a time-series.
 */

// ─── Visibility Rate trend (brand + each competitor) ────────────────────────

export interface VisibilityRateTrendEntity {
  /** 'you' for the own brand, competitor id otherwise. */
  key: string;
  name: string;
  isOwnBrand: boolean;
  /** Domain used for the favicon fallback at the line's end. */
  domain: string | null;
  /** Explicit logo (own brand only); falls back to the domain favicon. */
  logoUrl: string | null;
}

export interface VisibilityRateTrendPoint {
  /** Short label for the X axis, e.g. "Jul 28". */
  date: string;
  /** The UTC day it covers, 'YYYY-MM-DD' (VIS-007: markers are placed by day). */
  day: string;
  /** Per-entity rate for the day, keyed by entity key. 0 = tracked but not visible. */
  values: Record<string, number>;
}

export interface VisibilityRateTrendSummary {
  /** Overall rate for the charted window (distinct prompts, not a daily average). */
  rate: number;
  /** Rate over the equal-length window immediately before; null without data. */
  prevRate: number | null;
  /**
   * rate − prevRate in points, one decimal; null when prevRate is null. With
   * Same prompts on (VIS-002) the Insights page replaces it with the change
   * on the prompts answered in both windows, so it no longer equals
   * rate − prevRate there.
   */
  change: number | null;
  /**
   * Inclusive bounds of the previous window, for the "vs <range>" label:
   * 'YYYY-MM-DD' UTC days for whole-day windows, ISO timestamps for the 24h
   * and topic views. Empty when there is no previous window (All time).
   */
  prevFrom: string;
  prevTo: string;
}

export interface VisibilityRateTrendData {
  entities: VisibilityRateTrendEntity[];
  points: VisibilityRateTrendPoint[];
  summary: VisibilityRateTrendSummary;
  /** Competitors pinned on the chart (VIS-007), in pin order; ids of deleted ones dropped. */
  pinned: string[];
}

interface VisibilityRateTrendRow {
  day: string;
  prompt_count: number;
  visible_prompts: number;
  answers: number;
  mention_answers: number;
  citation_answers: number;
  position_factor: number | null;
  position_n: number;
  competitors: {
    competitor_id: string;
    visible_prompts: number;
    mention_answers: number;
    citation_answers: number;
    position_factor: number | null;
    position_n: number;
  }[];
}

/**
 * Daily Visibility Rate series for the brand and each live competitor
 * (visibility_rate_trend RPC, migration 00039). Every entity divides by the
 * brand's per-day prompt count — the shared-denominator rule from
 * getCompetitorComparison — so the lines are directly comparable.
 * Defaults to the last 7 days when no explicit range is given.
 */
export async function getVisibilityRateTrend(
  brandId: string,
  opts?: {
    model?: string;
    region?: string;
    dateFrom?: string;
    dateTo?: string;
    topicId?: string;
    days?: DayWindow;
    previousDays?: DayWindow;
  },
): Promise<VisibilityRateTrendData> {
  const supabase = await dbClient();
  const daily = dailyWindow(opts);
  // The headline and its change: the same windows the breakdown panel and
  // the leaderboard use (VIS-001).
  const windows = comparisonWindows(opts);
  // No explicit lower bound = the "All time" preset: the summary covers
  // everything (matching the leaderboard) and the chart plots an expanding
  // cumulative window instead of a fixed-length rolling one.
  // undefined rather than null: these flow straight into RPC arguments, where
  // an omitted key takes the function's own DEFAULT NULL. "All time" is the
  // absence of a bound, and undefined is how that is spelled at this boundary.
  const boundedFrom = opts?.dateFrom ?? undefined;
  const dateTo = expandDateToEndOfDay(opts?.dateTo) ?? new Date().toISOString();

  // On the raw path the chart reads one window further back, to warm up the
  // rolling window of its earliest points (all-time needs none).
  const windowMs = boundedFrom
    ? new Date(dateTo).getTime() - new Date(boundedFrom).getTime()
    : null;
  const prevFrom =
    boundedFrom && windowMs !== null
      ? new Date(new Date(boundedFrom).getTime() - windowMs).toISOString()
      : undefined;

  const rateArgs = (from: string | undefined, to: string) => ({
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
    p_date_from: from,
    p_date_to: to,
    p_topic_id: opts?.topicId ?? undefined,
  });
  const dayArgs = (dayFrom: string | undefined, dayTo: string | undefined) => ({
    p_brand_id: brandId,
    p_platform: undefined as string | undefined,
    p_models: modelFilterArray(opts?.model),
    p_region: opts?.region ?? undefined,
    p_day_from: dayFrom,
    p_day_to: dayTo,
    p_topic_id: opts?.topicId ?? undefined,
  });
  // The chart's warm-up range on the rollup path starts at the previous
  // window's first day.
  const deltaDays = daily?.dayFrom ? deltaDayWindows(daily, opts?.previousDays) : null;

  const [
    { data: brand },
    { data: brandDomains },
    { data: competitors },
    { data: pins },
    rpcRes,
    visCurRes,
    visPrevRes,
  ] = await Promise.all([
    supabase.from('brands').select('name, logo_url').eq('id', brandId).single(),
    supabase.from('brand_domains').select('domain, is_primary').eq('brand_id', brandId),
    supabase.from('competitors').select('id, name, domain').eq('brand_id', brandId),
    // Read on its own: without the pins (00136) the chart falls back to the
    // strongest competitors, and the brand's name and logo still load.
    supabase.from('brands').select('insights_pinned_competitors').eq('id', brandId).single(),
    // The chart plots a rolling window per day, so the earliest displayed
    // days need trailing data from before the display range (all-time needs
    // no warm-up — the window expands from the first row).
    daily
      ? supabase.rpc('visibility_rate_trend_daily', dayArgs(deltaDays?.prev.dayFrom, daily.dayTo))
      : supabase.rpc('visibility_rate_trend', rateArgs(prevFrom, dateTo)),
    aiVisibilityWindow(supabase, brandId, opts, windows.cur),
    windows.prev
      ? aiVisibilityWindow(supabase, brandId, opts, windows.prev)
      : Promise.resolve({ data: null, error: new Error('no previous window') }),
  ]);
  if (rpcRes.error) throw new Error(rpcRes.error.message);
  if (visCurRes.error) throw new Error(visCurRes.error.message);

  const rows = (rpcRes.data ?? []) as unknown as VisibilityRateTrendRow[];

  const primaryDomain =
    (brandDomains ?? []).find((d) => d.is_primary)?.domain ?? brandDomains?.[0]?.domain ?? null;

  const entities: VisibilityRateTrendEntity[] = [
    {
      key: 'you',
      name: brand?.name ?? 'You',
      isOwnBrand: true,
      domain: primaryDomain,
      logoUrl: brand?.logo_url ?? null,
    },
    ...(competitors ?? []).map((c) => ({
      key: c.id,
      name: c.name,
      isOwnBrand: false,
      domain: c.domain || null,
      logoUrl: null,
    })),
  ];

  // Each day's point is the score over the TRAILING window of the selected
  // length ending that day (rolling window). This makes the line's last
  // point equal the headline card exactly — the chart's inside and outside
  // can never disagree — and every earlier point answers "what would the
  // headline have shown that day".
  // Whole-day windows count their days: rounding the elapsed time made the
  // 30d chart's newest point cover 29 days before noon UTC.
  const windowDays = windows.windowDays;
  const dayMs = (day: string) => new Date(day + 'T00:00:00Z').getTime();
  const displayFromMs = boundedFrom ? new Date(boundedFrom).getTime() : Number.NEGATIVE_INFINITY;

  interface RollingSums {
    answers: number;
    mention: number;
    citation: number;
    posSum: number;
    posN: number;
  }
  const emptySums = (): RollingSums => ({
    answers: 0,
    mention: 0,
    citation: 0,
    posSum: 0,
    posN: 0,
  });
  const entityKeys = ['you', ...(competitors ?? []).map((c) => c.id)];
  const sums = new Map<string, RollingSums>(entityKeys.map((k) => [k, emptySums()]));

  const dayComponents = (row: VisibilityRateTrendRow, key: string): RollingSums => {
    if (key === 'you') {
      return {
        answers: row.answers,
        mention: row.mention_answers,
        citation: row.citation_answers,
        posSum: (row.position_factor ?? 0) * (row.position_n ?? 0),
        posN: row.position_n ?? 0,
      };
    }
    const entry = row.competitors.find((c) => c.competitor_id === key);
    return {
      answers: 0,
      mention: entry?.mention_answers ?? 0,
      citation: entry?.citation_answers ?? 0,
      posSum: (entry?.position_factor ?? 0) * (entry?.position_n ?? 0),
      posN: entry?.position_n ?? 0,
    };
  };
  const apply = (key: string, comp: RollingSums, sign: 1 | -1) => {
    const s = sums.get(key)!;
    s.answers += sign * comp.answers;
    s.mention += sign * comp.mention;
    s.citation += sign * comp.citation;
    s.posSum += sign * comp.posSum;
    s.posN += sign * comp.posN;
  };

  const points: VisibilityRateTrendPoint[] = [];
  let start = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const key of entityKeys) apply(key, dayComponents(row, key), 1);
    // Evict day-buckets that fell out of the trailing window (all-time
    // keeps everything — the window expands cumulatively).
    while (
      windowDays !== null &&
      dayMs(row.day) - dayMs(rows[start].day) >= windowDays * 86_400_000
    ) {
      for (const key of entityKeys) apply(key, dayComponents(rows[start], key), -1);
      start++;
    }
    // Only emit points inside the display range; earlier rows exist purely
    // to warm up the trailing window.
    if (dayMs(row.day) + 86_400_000 <= displayFromMs) continue;

    const brandSums = sums.get('you')!;
    const values: Record<string, number> = {};
    for (const key of entityKeys) {
      const s = sums.get(key)!;
      values[key] =
        computeAiVisibilityScore({
          answers: brandSums.answers,
          mentionAnswers: s.mention,
          citationAnswers: s.citation,
          positionFactor: s.posN > 0 ? s.posSum / s.posN : null,
        }) ?? 0;
    }
    points.push({
      date: new Date(row.day + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      day: row.day,
      values,
    });
  }

  // Headline: overall window score (components over the whole window — not
  // an average of the daily points) plus the delta vs the previous
  // equal-length window. Same RPC the leaderboard uses.
  const visCur = foldAiVisibility(visCurRes.data);
  const visPrev = visPrevRes.error ? null : foldAiVisibility(visPrevRes.data);
  const headline = visibilityChange(visCur.brandScore, visPrev?.brandScore ?? null);

  // The window the change was measured against: 'YYYY-MM-DD' days for the
  // rollup presets, ISO timestamps for the 24h and topic views.
  const prevWin = windows.prev;
  const summary: VisibilityRateTrendSummary = {
    rate: headline.value,
    prevRate: headline.prev,
    change: headline.change,
    prevFrom: prevWin ? windowBounds(prevWin).from : '',
    prevTo: prevWin ? windowBounds(prevWin).to : '',
  };

  const competitorIds = new Set((competitors ?? []).map((c) => c.id));
  const pinned = (pins?.insights_pinned_competitors ?? []).filter((id) => competitorIds.has(id));

  return { entities, points, summary, pinned };
}

// ─── Head-to-Head Competitor Comparison ─────────────────────────────────────

/**
 * Compare a brand vs a single competitor (#923): one summary per (prompt,
 * engine, model, region), the per-engine breakdown, and the largest gaps and
 * strengths. A group's individual runs load separately via
 * `getHeadToHeadRuns`, so no answer text is sent up front.
 */
export async function getHeadToHeadComparison(
  brandId: string,
  competitorId: string,
): Promise<HeadToHeadData> {
  const supabase = await dbClient();

  // Every answer, from the daily rollups (00169, #923): a read of the raw
  // answers stopped at PostgREST's 1,000-row page. The rollups leave out
  // chatgpt-shopping (#155), as the Competitors tab always did.
  const { data, error } = await supabase.rpc('head_to_head_daily', {
    p_brand_id: brandId,
    p_competitor_id: competitorId,
  });
  if (error) throw new Error(error.message);
  const rollups = data as unknown as HeadToHeadRollups | null;
  if (!rollups || rollups.groups.length === 0) return emptyHeadToHead();

  return headToHeadFromRollups(rollups, resolveProvider);
}

/**
 * The individual runs behind one head-to-head group, newest first, loaded when
 * the user opens the group. Bounded by `limit` (max 100).
 */
export async function getHeadToHeadRuns(
  brandId: string,
  competitorId: string,
  group: {
    promptId: string;
    rawPlatform: string | null;
    rawModelUsed: string | null;
    region: string | null;
  },
  limit = 50,
): Promise<HeadToHeadRun[]> {
  const supabase = await dbClient();

  let query = supabase
    .from('prompt_results')
    .select('id, created_at, visibility_score, sentiment, competitor_mentions')
    .eq('brand_id', brandId)
    .eq('prompt_id', group.promptId);
  query = group.rawPlatform ? query.eq('platform', group.rawPlatform) : query.is('platform', null);
  query = group.rawModelUsed
    ? query.eq('model_used', group.rawModelUsed)
    : query.is('model_used', null);
  query = group.region ? query.eq('region', group.region) : query.is('region', null);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    resultId: row.id as string,
    createdAt: row.created_at as string,
    brandScore: (row.visibility_score as number | null) ?? 0,
    competitorScore: competitorScoreIn(row.competitor_mentions, competitorId) ?? 0,
    sentiment: ((row.sentiment as Sentiment | null) ?? 'neutral') as Sentiment,
  }));
}

// ─── Insights Metric Breakdown (Root-Cause Drilldown) ─────────────────────────

export type {
  BreakdownFilters,
  BreakdownMetric,
  BreakdownRow,
  InsightsBreakdown,
} from '@/lib/insightsBreakdown';

function formatPlatformLabel(slug: string): string {
  return PLATFORM_LABELS[slug] ?? slug;
}

/**
 * Per-prompt / per-platform / per-topic breakdown of the Visibility or
 * Mentions card, comparing the window on screen with the one before it.
 *
 * Used by the Insights KPI drill-down Sheet to surface which entities drove a
 * metric change (e.g. "Mentions dropped 12% because prompt X lost 84 mentions
 * on ChatGPT"). VIS-001: the windows are the card's own (comparisonWindows),
 * the totals come from the card's own aggregates, and the slices are
 * aggregated in Postgres (insights_breakdown_groups, 00129) — the rows used
 * to be fetched raw, capped at 1,000 per window, which scored an arbitrary
 * sample instead of the card's answers.
 */
export async function getInsightsBreakdown(
  brandId: string,
  metric: BreakdownMetric,
  opts?: BreakdownFilters,
  /** The UI's locale, for the numbers in the root-cause sentence (VIS-005). */
  locale = 'en',
): Promise<InsightsBreakdown> {
  const f = numberFormat(locale);
  const supabase = await dbClient();
  const windows = comparisonWindows(opts);
  const p_models = modelFilterArray(opts?.model);
  const p_region = opts?.region ?? undefined;

  const groupsFor = (win: MetricWindow) =>
    supabase.rpc('insights_breakdown_groups', {
      p_brand_id: brandId,
      p_models,
      p_region,
      p_topic_id: opts?.topicId ?? undefined,
      ...(win.kind === 'days'
        ? { p_day_from: win.days.dayFrom, p_day_to: win.days.dayTo }
        : { p_date_from: win.from, p_date_to: win.to }),
    });
  // The headline numbers: exactly what the Visibility and Mentions cards read.
  const totalFor = async (win: MetricWindow): Promise<number | null> => {
    if (metric === 'visibility') {
      const { data, error } = await aiVisibilityWindow(supabase, brandId, opts, win);
      if (error) throw new Error(error.message);
      return foldAiVisibility(data).brandScore;
    }
    const { data, error } =
      win.kind === 'days'
        ? await supabase.rpc('insights_aggregates_daily', {
            p_brand_id: brandId,
            p_platform: undefined,
            p_models,
            p_region,
            p_day_from: win.days.dayFrom,
            p_day_to: win.days.dayTo,
            p_topic_id: opts?.topicId ?? undefined,
          })
        : await supabase.rpc('insights_aggregates', {
            p_brand_id: brandId,
            p_platform: undefined,
            p_models,
            p_region,
            p_date_from: win.from,
            p_date_to: win.to,
            p_prompt_id: undefined,
            p_topic_id: opts?.topicId ?? undefined,
          });
    if (error) throw new Error(error.message);
    // Null for a window with no answers: the Mentions card shows no change
    // unless both windows have some.
    const agg = data as unknown as InsightsAggregates | null;
    return agg && agg.total_results > 0 ? agg.total_mentions : null;
  };

  const [curGroupsRes, prevGroupsRes, curScore, prevScore, same] = await Promise.all([
    groupsFor(windows.cur),
    windows.prev ? groupsFor(windows.prev) : Promise.resolve(null),
    totalFor(windows.cur),
    windows.prev ? totalFor(windows.prev) : Promise.resolve(null),
    // Without it the panel compares all prompts, as the cards then do.
    getSamePromptComparison(brandId, opts, windows).catch((err) => {
      console.error('[insights] same-prompt comparison failed', err);
      return null;
    }),
  ]);
  if (curGroupsRes.error) throw new Error(curGroupsRes.error.message);
  if (prevGroupsRes?.error) throw new Error(prevGroupsRes.error.message);

  // "Same prompts" (VIS-002): the change and every row compare only the
  // prompts answered in both windows, exactly as the cards do.
  const useSame = opts?.samePrompts !== false && same !== null;
  const comparison: PromptComparison | null = same && {
    basis: useSame ? 'same' : 'all',
    samePrompts: same.samePrompts,
    newPrompts: same.newPrompts,
    droppedPrompts: same.droppedPrompts,
  };

  const { byPrompt, byPlatform, byTopic } = buildBreakdownRows(
    metric,
    parseBreakdownGroups(curGroupsRes.data),
    prevGroupsRes ? parseBreakdownGroups(prevGroupsRes.data) : null,
    formatPlatformLabel,
    { samePrompts: useSame },
  );

  // Totals and their change, worked out the way each card does.
  let curTotal: number;
  let comparedCur: number;
  let prevTotal: number | null;
  let totalDelta: number | null;
  let totalDeltaPct: number | null;
  const changes = useSame && same ? samePromptChanges(same) : null;
  if (metric === 'visibility') {
    const v = visibilityChange(curScore, prevScore);
    curTotal = v.value;
    comparedCur = changes ? (changes.visibility.cur ?? 0) : v.value;
    prevTotal = changes ? changes.visibility.prev : v.prev;
    totalDelta = changes ? changes.visibility.change : v.change;
    totalDeltaPct = null;
  } else if (changes) {
    curTotal = curScore ?? 0;
    comparedCur = changes.mentions.cur;
    prevTotal = changes.mentions.prev;
    totalDeltaPct = changes.mentionsChange;
    totalDelta = totalDeltaPct === null ? null : comparedCur - prevTotal;
  } else {
    curTotal = curScore ?? 0;
    comparedCur = curTotal;
    prevTotal = prevScore;
    ({ delta: totalDelta, deltaPct: totalDeltaPct } =
      curScore === null
        ? { delta: null, deltaPct: null }
        : breakdownDelta(curTotal, prevTotal, metric));
  }

  // ─── Root-cause summary ─────────────────────────────────────────────────────
  const metricLabel = metric === 'visibility' ? 'Visibility' : 'Mentions';
  const windowDays = windows.windowDays;
  const topPrompt = pickDriver(byPrompt, totalDelta);
  const topPlatform = pickDriver(byPlatform, totalDelta);

  let rootCause: string;
  if (!windows.prev) {
    rootCause = `${metricLabel} over all time; there is no earlier period of the same length to compare.`;
  } else if (useSame && same?.samePrompts === 0) {
    rootCause = `No prompt was answered in both ${windowDays}-day windows, so there is no like-for-like change yet.`;
  } else if (totalDelta === null && useSame) {
    // Shared prompts were answered in both windows, so the change is missing
    // only because the previous count was 0 (no percentage from 0).
    rootCause = `No ${metricLabel.toLowerCase()} on the shared prompts in the previous ${windowDays}-day window, so there is no percentage change.`;
  } else if (totalDelta === null) {
    rootCause = `No answers in one of the two ${windowDays}-day windows, so there is no change to explain yet.`;
  } else if (totalDelta === 0) {
    rootCause = `${metricLabel} held steady vs the previous ${windowDays}-day window.`;
  } else if (!topPrompt) {
    const dir = totalDelta > 0 ? 'rose' : 'fell';
    const magnitude = formatTotalMagnitude(totalDelta, totalDeltaPct, metric, f);
    rootCause = `${metricLabel} ${dir} ${magnitude} vs the previous ${windowDays}d — the change is spread evenly across prompts, no single driver.`;
  } else {
    const headline = totalDelta < 0 ? 'Biggest drop' : 'Biggest gain';
    const promptClause = `"${truncate(topPrompt.label, 60)}" ${formatContribution(topPrompt, metric, f)}`;
    const platformClause = topPlatform
      ? ` Top platform ${totalDelta < 0 ? 'drop' : 'gain'}: ${topPlatform.label} ${formatContribution(topPlatform, metric, f)}.`
      : '';
    rootCause = `${headline}: ${promptClause}.${platformClause}`;
  }

  return {
    metric,
    curTotal,
    comparedCur,
    prevTotal,
    comparison,
    delta: totalDelta,
    deltaPct: totalDeltaPct,
    windowDays,
    byPrompt,
    byPlatform,
    byTopic,
    rootCause,
  };
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Format a single contributor's delta as a human sentence fragment, e.g.:
 *   - mentions:  "lost 84 mentions (−38%)"   or  "gained 12 mentions"
 *   - visibility: "dropped 2.1 pts"           or  "rose 2.1 pts"
 */
function formatContribution(row: BreakdownRow, metric: BreakdownMetric, f: NumberFormat): string {
  const delta = row.delta ?? 0;
  const isLoss = delta < 0;
  const abs = Math.abs(delta);

  if (metric === 'visibility') {
    const verb = isLoss ? 'dropped' : 'rose';
    return `${verb} ${f.number(Math.round(abs * 10) / 10)} pts`;
  }

  const verb = isLoss ? 'lost' : 'gained';
  const core = `${verb} ${f.number(abs)} mentions`;
  if (row.deltaPct === null) return core;
  const sign = row.deltaPct < 0 ? '−' : '+';
  return `${core} (${sign}${f.percent(Math.abs(row.deltaPct))})`;
}

function formatTotalMagnitude(
  delta: number,
  deltaPct: number | null,
  metric: BreakdownMetric,
  f: NumberFormat,
): string {
  const abs = Math.abs(delta);
  if (metric === 'visibility') {
    return `${f.number(Math.round(abs * 10) / 10)} pts`;
  }
  const core = `${f.number(abs)} mentions`;
  if (deltaPct === null) return core;
  const sign = deltaPct < 0 ? '−' : '+';
  return `${core} (${sign}${f.percent(Math.abs(deltaPct))})`;
}

// ─── Topic detail bundle (#312) ───────────────────────────────────────────

export interface TopicDetailData {
  topic: Topic | null;
  summary: InsightsSummary;
  trend: VisibilityTrendPoint[];
  sov: ShareOfVoiceData;
  competitors: CompetitorComparisonData;
  results: TopicRecentRun[];
}

/** One of a topic's latest runs, as its best and worst prompts read them. */
export interface TopicRecentRun {
  promptId: string;
  promptText: string;
  visibilityScore: number;
}

/**
 * A topic's latest runs for the topic page's best and worst prompts: each
 * run's prompt and visibility, nothing else. It went through
 * getPromptResults, which read every column of the 50 rows — answers,
 * citations, competitors, searches — and counted every answer the topic has
 * ever had (`count: 'exact'`, under RLS) for a total the page never showed:
 * the one raw read over prompt_results left once the rest moved to the
 * rollups (00164). Here: the topic's prompts with their text, then the runs.
 */
async function getTopicRecentRuns(
  brandId: string,
  topicId: string,
  limit: number,
): Promise<TopicRecentRun[]> {
  const supabase = await dbClient();
  const { data: prompts, error: promptsError } = await supabase
    .from('prompts')
    .select('id, text')
    .eq('topic_id', topicId);
  if (promptsError) throw new Error(promptsError.message);
  const texts = new Map(
    ((prompts ?? []) as { id: string; text: string }[]).map((p) => [p.id, p.text]),
  );
  if (texts.size === 0) return [];

  // #155 — as every Insights read: chatgpt-shopping answers aren't comparable.
  const { data: runs, error } = await supabase
    .from('prompt_results')
    .select('prompt_id, visibility_score')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .in('prompt_id', [...texts.keys()])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((runs ?? []) as { prompt_id: string; visibility_score: number }[]).map((run) => ({
    promptId: run.prompt_id,
    promptText: texts.get(run.prompt_id) ?? '',
    visibilityScore: Number(run.visibility_score ?? 0),
  }));
}

/**
 * One server action for the whole topic detail page (#312).
 *
 * The page previously fired six separate server-action calls from the client.
 * Next.js runs server actions **sequentially** (each is its own queued POST),
 * so that cost was roughly the sum of all six, not the slowest. Collapsing them
 * into one action means a single round trip whose body runs the work in a real
 * server-side `Promise.all` (genuinely parallel). The topic is fetched by id
 * instead of pulling the whole topics list just to read one name.
 *
 * Output is identical to the old per-call results — this is a perf refactor.
 */
export async function getTopicDetail(brandId: string, topicId: string): Promise<TopicDetailData> {
  // All time, as whole UTC days: the empty window routes every aggregate to
  // the daily rollups (00164), whose cost follows the topic's days rather
  // than its answers. Raw, these reads took 11-18 s on a 91-prompt topic and
  // ran under the service role to get past the 8 s statement timeout; from
  // the rollups they take under half a second. Everything runs on the
  // caller's own client, so RLS scopes every read.
  const allTime: DayWindow = {};
  const [topic, summary, rateTrend, sov, competitors, results] = await Promise.all([
    getTopicById(brandId, topicId),
    getInsightsSummary(brandId, { topicId, days: allTime }),
    // #685 — use the new-formula RPC so the trend sits on the same 0-100
    // scale as the headline AI Visibility Score. getVisibilityTrend
    // averaged raw visibility_score over all answers (incl. 0-scored
    // absent-brand rows).
    getVisibilityRateTrend(brandId, { topicId, days: allTime }),
    getShareOfVoiceData(brandId, { topicId, days: allTime }),
    getCompetitorComparison(brandId, { topicId, days: allTime }),
    getTopicRecentRuns(brandId, topicId, 50),
  ]);
  if (!topic) throw new Error('Topic not found');

  // Adapt VisibilityRateTrendData → VisibilityTrendPoint[] so topic_charts.tsx
  // keeps its existing VisibilityTrendPoint shape without modification.
  const competitorKeys = rateTrend.entities.filter((e) => !e.isOwnBrand).map((e) => e.key);
  const trend: VisibilityTrendPoint[] = rateTrend.points.map((pt) => {
    const compScores = competitorKeys
      .map((k) => pt.values[k])
      .filter((v): v is number => v !== undefined);
    return {
      date: pt.date,
      score: pt.values['you'] ?? 0,
      competitors:
        compScores.length > 0
          ? roundTo1(compScores.reduce((a, b) => a + b, 0) / compScores.length)
          : null,
    };
  });

  return { topic, summary, trend, sov, competitors, results };
}
