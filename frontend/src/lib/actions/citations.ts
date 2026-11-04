'use server';

import { createClient } from '@/lib/supabase/server';
import { expandDateToEndOfDay } from '@/lib/dates';
import {
  classifyDomain,
  extractHostname,
  normalizeDomain,
  type SourceCategory,
  SOURCE_CATEGORIES,
} from '@/lib/citations/classify';
import { classifyArticleType } from '@/lib/citations/articleType';
import { scopeDomainArgs, type CitationsSourceScope } from '@/lib/citations/scope';
import { citationUrlMatchKey, normalizeCitationUrl } from '@/lib/citations/normalize';
import { rollupDayWindow, runDayWindow, type DayWindow } from '@/lib/citations/rollupWindow';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CitationsDatePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

// Do NOT re-export types from this file with `export type { ... }`. This is a
// 'use server' module, and Turbopack's production transform lists every export
// clause in ensureServerEntryExports as a runtime value — a re-exported type
// becomes a bare undefined identifier there, and the whole module (every
// citation server action with it) dies at evaluation with a ReferenceError.
// Import CitationsSourceScope from '@/lib/citations/scope' instead.
// Declarations (`export type X = ...`, `export interface`) are erased fine.

export interface CitationsFilters {
  datePreset: CitationsDatePreset;
  dateFrom?: string;
  dateTo?: string;
  platforms?: string[];
  topicIds?: string[];
  promptIds?: string[];
  regions?: string[];
  /**
   * Which sources the URL list covers (#745).
   *
   * Only the URL list needs it. The domain list is returned uncapped, so
   * filtering that after the fact is exact and stays on the client; the URL
   * list is capped at the top 2,000, and a scope applied to what arrived
   * reports a slice of the global top N as though it were the whole scope.
   */
  sourceScope?: CitationsSourceScope;
}

export interface CitationArticleTypeCount {
  type: string;
  count: number;
}

export interface CitationDomainRow {
  domain: string;
  category: SourceCategory;
  models: string[];
  totalCitations: number;
  avgCitationsPerResult: number;
  resultsCiting: number;
  usagePct: number;
  articleTypes: CitationArticleTypeCount[];
}

export interface CitationUrlRow {
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  models: string[];
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
  articleType: string | null;
}

export interface CitationsSourceBreakdown {
  category: SourceCategory;
  count: number;
  pct: number;
}

export interface CitationsOverview {
  rows: CitationDomainRow[];
  urlRows: CitationUrlRow[];
  totals: {
    domains: number;
    urls: number;
    citations: number;
    results: number;
    avgCitationsPerResult: number;
  };
  sourceTypeBreakdown: CitationsSourceBreakdown[];
  /** Distinct regions observed on results in the scanned (filtered) window (#598). */
  availableRegions: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDateRange(filters: CitationsFilters): { from?: string; to?: string } {
  if (filters.datePreset === 'custom') {
    return { from: filters.dateFrom, to: filters.dateTo };
  }
  if (filters.datePreset === 'all') {
    return {};
  }
  const to = new Date();
  const from = new Date();
  switch (filters.datePreset) {
    case '24h':
      from.setHours(from.getHours() - 24);
      break;
    case '7d':
      from.setDate(from.getDate() - 7);
      break;
    case '30d':
      from.setDate(from.getDate() - 30);
      break;
    case '90d':
      from.setDate(from.getDate() - 90);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// ─── Daily rollups (00118) ────────────────────────────────────────────────────

/**
 * The UTC day window the daily rollups answer these filters with, or null when
 * the raw functions must (see rollupDayWindow). The 24h view is the latest
 * completed run's day(s); before a brand's first run it stays on the raw path.
 */
async function rollupWindow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  filters: CitationsFilters,
): Promise<DayWindow | null> {
  const window = rollupDayWindow(filters);
  if (window !== 'latest-run') return window;

  const { data } = await supabase
    .from('tracking_runs')
    .select('started_at, completed_at')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1);
  const run = data?.[0] as { started_at: string; completed_at: string } | undefined;
  return run ? runDayWindow(run) : null;
}

/** Arguments shared by the three daily functions. */
function dailyArgs(brandId: string, filters: CitationsFilters, window: DayWindow) {
  return {
    p_brand_id: brandId,
    p_day_from: window.dayFrom,
    p_day_to: window.dayTo,
    p_models: modelFilterList(filters.platforms) ?? undefined,
    p_regions: filters.regions && filters.regions.length > 0 ? filters.regions : undefined,
    p_topic_ids: filters.topicIds && filters.topicIds.length > 0 ? filters.topicIds : undefined,
  };
}

// ─── Main action ──────────────────────────────────────────────────────────────

/** URL rows the overview asks for. The table paginates a hundred at a time. */
const CITATIONS_URL_LIMIT = 2000;

/**
 * Arguments shared by the three aggregate functions.
 *
 * Absent filters are `undefined`, which PostgREST omits from the request
 * entirely, so each function falls back to its own default — `null`, meaning
 * no filter. That is the same convention the insights RPCs already use.
 */
function overviewArgs(brandId: string, filters: CitationsFilters, topicPromptIds: string[] | null) {
  const { from, to } = resolveDateRange(filters);
  const promptIds =
    filters.promptIds && filters.promptIds.length > 0 ? filters.promptIds : undefined;

  return {
    p_brand_id: brandId,
    p_date_from: from ?? undefined,
    p_date_to: expandDateToEndOfDay(to) ?? undefined,
    p_models: modelFilterList(filters.platforms) ?? undefined,
    p_regions: filters.regions && filters.regions.length > 0 ? filters.regions : undefined,
    // Topics resolve to prompts before the call, so the functions never have
    // to know that a topic is a set of prompts.
    p_prompt_ids: topicPromptIds ?? promptIds ?? undefined,
  };
}

/**
 * Flatten the platform filter the way the picker sends it.
 *
 * One option can stand for a whole model family (`gpt-5-3-mini,gpt-5-5`), so a
 * single selection may mean several slugs.
 */
function modelFilterList(models: string[] | undefined): string[] | null {
  if (!models || models.length === 0) return null;
  const list = Array.from(
    new Set(
      models.flatMap((model) =>
        model
          .split(',')
          .map((slug) => slug.trim())
          .filter(Boolean),
      ),
    ),
  );
  return list.length > 0 ? list : null;
}

interface DomainAggRow {
  domain: string;
  total_citations: number;
  results_citing: number;
  models: string[] | null;
}

interface UrlAggRow {
  url: string;
  domain: string;
  title: string | null;
  total_citations: number;
  results_citing: number;
  models: string[] | null;
  total_urls: number;
}

/**
 * The Citations overview, aggregated in Postgres (#732).
 *
 * Until phase 2 this paged every answer in the window out to the app tier and
 * expanded `prompt_results.citations` here: 50 sequential requests carrying
 * 65 MB of jsonb on the largest brand, and a hard 50,000-row ceiling that
 * silently truncated it at its 51,679. The citation rows written in phase 1
 * make that an ordinary indexed aggregation.
 *
 * What stays in JavaScript is what the database cannot know: which domains
 * belong to this brand and which to a competitor. That classification depends
 * on the brand's own domain list, and it applies to the ~20,000 aggregated
 * domains rather than to two million citations.
 */
export async function getCitationsOverview(
  brandId: string,
  filters: CitationsFilters,
): Promise<CitationsOverview> {
  const supabase = await createClient();

  const [{ data: brandDomainRows }, { data: competitorRows }, window] = await Promise.all([
    supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabase.from('competitors').select('domain').eq('brand_id', brandId),
    rollupWindow(supabase, brandId, filters),
  ]);

  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const classifyCtx = { brandDomains, competitorDomains };

  // Daily rollups unless the filters need the raw rows (see rollupWindow).
  // The raw path resolves a topic to its prompts; the rollups carry topic.
  const rawArgs = window
    ? null
    : overviewArgs(brandId, filters, await resolveTopicPromptIds(supabase, filters));
  const daily = window ? dailyArgs(brandId, filters, window) : null;
  const readDomains = () =>
    daily
      ? supabase.rpc('citations_domains_daily', daily)
      : supabase.rpc('citations_domains', rawArgs!);
  const readStats = () =>
    daily
      ? supabase.rpc('citations_window_stats_daily', daily)
      : supabase.rpc('citations_window_stats', rawArgs!);
  const readUrls = (extra: { p_domains?: string[]; p_exclude_domains?: string[] } = {}) =>
    daily
      ? supabase.rpc('citations_urls_daily', { ...daily, p_limit: CITATIONS_URL_LIMIT, ...extra })
      : supabase.rpc('citations_urls', { ...rawArgs!, p_limit: CITATIONS_URL_LIMIT, ...extra });
  const scoped = Boolean(filters.sourceScope && filters.sourceScope !== 'all');

  // A scope is resolved from the classified domain list, so a scoped URL query
  // has to wait for the domain query to land. The unscoped view — the one every
  // page open starts on — keeps all three in flight, because serializing it
  // would double the default load for a filter nobody selected.
  const [domainRes, statsRes, parallelUrlRes] = await Promise.all([
    readDomains(),
    readStats(),
    scoped ? null : readUrls(),
  ]);

  if (domainRes.error) throw new Error(domainRes.error.message);
  if (statsRes.error) throw new Error(statsRes.error.message);

  const stats = (statsRes.data as { results: number; regions: string[] | null }[] | null)?.[0];
  const totalResults = Number(stats?.results ?? 0);

  const classifyCache = new Map<string, SourceCategory>();
  const categoryOf = (domain: string): SourceCategory => {
    let category = classifyCache.get(domain);
    if (category === undefined) {
      category = classifyDomain(domain, classifyCtx);
      classifyCache.set(domain, category);
    }
    return category;
  };

  const usagePct = (resultsCiting: number) =>
    totalResults > 0 ? Math.round((resultsCiting / totalResults) * 1000) / 10 : 0;

  const rows: CitationDomainRow[] = ((domainRes.data as DomainAggRow[] | null) ?? [])
    .map((row) => ({ row, category: categoryOf(row.domain) }))
    .map(({ row, category }) => {
      const resultsCiting = Number(row.results_citing);
      const totalCitations = Number(row.total_citations);
      return {
        domain: row.domain,
        category,
        models: (row.models ?? []).slice().sort(),
        totalCitations,
        avgCitationsPerResult:
          resultsCiting > 0 ? Math.round((totalCitations / resultsCiting) * 10) / 10 : 0,
        resultsCiting,
        usagePct: usagePct(resultsCiting),
        // Computed but never rendered — see CitationDomainRow.
        articleTypes: [],
      };
    });

  const urlRes = parallelUrlRes ?? (await readUrls(scopeDomainArgs(filters.sourceScope, rows)));
  if (urlRes.error) throw new Error(urlRes.error.message);

  const urlRowsRaw = (urlRes.data as UrlAggRow[] | null) ?? [];
  const urlRows: CitationUrlRow[] = urlRowsRaw
    .map((row) => ({ row, category: categoryOf(row.domain) }))
    .map(({ row, category }) => {
      const resultsCiting = Number(row.results_citing);
      return {
        url: row.url,
        domain: row.domain,
        category,
        title: row.title ?? '',
        models: (row.models ?? []).slice().sort(),
        totalCitations: Number(row.total_citations),
        resultsCiting,
        usagePct: usagePct(resultsCiting),
        articleType: classifyArticleType(row.url, row.title ?? undefined),
      };
    });

  const citations = rows.reduce((sum, row) => sum + row.totalCitations, 0);

  const categoryCounts = new Map<SourceCategory, number>();
  for (const row of rows) {
    categoryCounts.set(row.category, (categoryCounts.get(row.category) ?? 0) + 1);
  }
  const sourceTypeBreakdown: CitationsSourceBreakdown[] = SOURCE_CATEGORIES.map((category) => {
    const count = categoryCounts.get(category) ?? 0;
    return {
      category,
      count,
      pct: rows.length > 0 ? Math.round((count / rows.length) * 1000) / 10 : 0,
    };
  }).filter((b) => b.count > 0);

  return {
    rows,
    urlRows,
    totals: {
      domains: rows.length,
      // The uncapped count *within the selected scope*, so the page never
      // implies it has every URL and never reports a slice of the global top
      // 2,000 as the whole scope (#745). Falls back to what arrived when the
      // window produced nothing at all.
      urls: Number(urlRowsRaw[0]?.total_urls ?? urlRows.length),
      citations,
      results: totalResults,
      avgCitationsPerResult:
        totalResults > 0 ? Math.round((citations / totalResults) * 10) / 10 : 0,
    },
    sourceTypeBreakdown,
    availableRegions: (stats?.regions ?? []).slice().sort(),
  };
}

/** Topic filter → the prompt ids it covers, or null when no topic is selected. */
async function resolveTopicPromptIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: CitationsFilters,
): Promise<string[] | null> {
  if (!filters.topicIds || filters.topicIds.length === 0) return null;
  const { data } = await supabase.from('prompts').select('id').in('topic_id', filters.topicIds);
  const ids = ((data ?? []) as { id: string }[]).map((p) => p.id);
  // An empty result must exclude everything rather than filter nothing.
  return ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'];
}

// ─── Competitor Gaps (#300) ─────────────────────────────────────────────────

/** A third-party domain that cites competitors but never cites/mentions us. */
export interface CitationGapDomain {
  domain: string;
  category: SourceCategory;
  /** Distinct answers where this domain co-occurs with a competitor and we're absent. */
  competitorAnswers: number;
  /** Competitor display names seen alongside this domain (top few). */
  competitors: string[];
  /** Weighted co-occurrence score (each answer split across its distinct sources). */
  strength: number;
}

/** A domain that feeds a specific competitor's AI visibility. */
export interface CompetitorSourceDomain {
  domain: string;
  category: SourceCategory;
  /** Distinct answers where the competitor is mentioned and this domain is cited. */
  answersFeeding: number;
  /** Whether this domain also appears in any answer where our brand is present. */
  alsoCitesUs: boolean;
  strength: number;
}

export interface CitationGapCompetitor {
  id: string;
  name: string;
}

export interface CitationGaps {
  /** Outreach list: domains citing ≥1 competitor and never citing/mentioning us. */
  gapDomains: CitationGapDomain[];
  /** Per-competitor source map, keyed by competitor id. */
  byCompetitor: Record<string, CompetitorSourceDomain[]>;
  /** Competitors that have ≥1 feeding domain (for the selector). */
  competitors: CitationGapCompetitor[];
  /** Answers in the window where our brand was present. */
  ourAnswerCount: number;
  /** Total answers in the window. */
  totalAnswers: number;
  /** True when our presence is so low the gap list is likely too broad to act on. */
  lowVisibility: boolean;
}

const GAP_MIN_COMPETITOR_ANSWERS = 2;
const GAP_LOW_VISIBILITY_RATIO = 0.1;
const GAP_MAX_ROWS = 100;
const GAP_MAX_COMPETITOR_CHIPS = 6;

/**
 * Compute Competitor Gaps from the same `prompt_results` data the citations
 * overview reads — no LLM/scraper calls, no new writes.
 *
 * For each AI answer we look at response-level co-occurrence: the set of cited
 * domains, whether any competitor was mentioned, and whether we were present
 * (our brand mentioned or one of our domains cited). A "gap" domain cites a
 * competitor in an answer where we're absent and never appears in an answer
 * where we're present. Each co-occurrence is weighted by `1 / distinct sources
 * in the answer`, so a focused 2-source answer counts more than a 20-source one.
 *
 * Read from the daily rollups (00203) over whole UTC days, as the other tabs
 * are, unless a single prompt is selected (#1002).
 */
export async function getCitationGaps(
  brandId: string,
  filters: CitationsFilters,
): Promise<CitationGaps> {
  const supabase = await createClient();

  const [{ data: brandDomainRows }, { data: competitorRows }, window] = await Promise.all([
    supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabase.from('competitors').select('id, name, domain').eq('brand_id', brandId),
    rollupWindow(supabase, brandId, filters),
  ]);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorList = (competitorRows ?? []) as Array<{
    id: string;
    name: string;
    domain: string;
  }>;
  const competitorDomains = competitorList.map((c) => normalizeDomain(c.domain)).filter(Boolean);
  const competitorNameById = new Map(
    competitorList.map((c) => [c.id, (c.name || '').trim() || 'Competitor']),
  );

  const classifyCtx = { brandDomains, competitorDomains };

  // The co-occurrence counting lives in SQL (#777) over the citation rows —
  // the raw-answer scan it replaces moved 129 MB of jsonb for the largest
  // brand and silently stopped at 50,000 answers, oldest first. The brand and
  // competitor domain lists ride along because the you/competitor split
  // depends on their CURRENT state; category labels for display are still
  // computed here, with the same classifier as the rest of the page.
  interface GapDomainRow {
    domain: string | null;
    competitor_answers: number;
    appears_in_ours: boolean;
    strength: number;
    competitor_names: string[] | null;
    our_answer_count: number;
    total_answers: number;
  }
  interface CompSourceRow {
    competitor_id: string;
    domain: string;
    answers_feeding: number;
    strength: number;
  }

  // Daily rollups (00203) unless the filters need the raw rows, as on the
  // other tabs (see rollupWindow). The raw path resolves a topic to its
  // prompts; the rollups carry topic.
  const domainArgs = { p_brand_domains: brandDomains, p_competitor_domains: competitorDomains };
  const daily = window ? { ...dailyArgs(brandId, filters, window), ...domainArgs } : null;
  const rawArgs = window
    ? null
    : {
        ...overviewArgs(brandId, filters, await resolveTopicPromptIds(supabase, filters)),
        ...domainArgs,
      };
  const [gapRes, compRes] = await Promise.all([
    daily
      ? supabase.rpc('citation_gap_domains_daily', daily)
      : supabase.rpc('citation_gap_domains', rawArgs!),
    daily
      ? supabase.rpc('citation_competitor_sources_daily', daily)
      : supabase.rpc('citation_competitor_sources', rawArgs!),
  ]);
  if (gapRes.error) throw new Error(gapRes.error.message);
  if (compRes.error) throw new Error(compRes.error.message);

  const gapRows = (gapRes.data as GapDomainRow[] | null) ?? [];
  // The null-domain summary row is always present, so the totals survive
  // windows where no third-party domain qualifies.
  const summary = gapRows.find((r) => r.domain === null);
  const totalAnswers = Number(summary?.total_answers ?? 0);
  const ourAnswerCount = Number(summary?.our_answer_count ?? 0);
  const domainRows = gapRows.filter((r): r is GapDomainRow & { domain: string } => !!r.domain);

  const domainClassificationCache = new Map<string, SourceCategory>();
  const categoryOf = (domain: string): SourceCategory => {
    let category = domainClassificationCache.get(domain);
    if (category === undefined) {
      category = classifyDomain(domain, classifyCtx);
      domainClassificationCache.set(domain, category);
    }
    return category;
  };
  const appearsInOurs = new Map(domainRows.map((r) => [r.domain, r.appears_in_ours]));

  const gapDomains: CitationGapDomain[] = domainRows
    .filter((r) => !r.appears_in_ours && Number(r.competitor_answers) >= GAP_MIN_COMPETITOR_ANSWERS)
    .map((r) => ({
      domain: r.domain,
      category: categoryOf(r.domain),
      competitorAnswers: Number(r.competitor_answers),
      competitors: (r.competitor_names ?? []).slice(0, GAP_MAX_COMPETITOR_CHIPS),
      strength: Math.round(Number(r.strength) * 1000) / 1000,
    }))
    .sort((a, b) => b.strength - a.strength || b.competitorAnswers - a.competitorAnswers)
    .slice(0, GAP_MAX_ROWS);

  const byCompMap = new Map<string, CompetitorSourceDomain[]>();
  for (const row of (compRes.data as CompSourceRow[] | null) ?? []) {
    let list = byCompMap.get(row.competitor_id);
    if (!list) {
      list = [];
      byCompMap.set(row.competitor_id, list);
    }
    list.push({
      domain: row.domain,
      category: categoryOf(row.domain),
      answersFeeding: Number(row.answers_feeding),
      alsoCitesUs: appearsInOurs.get(row.domain) ?? false,
      strength: Math.round(Number(row.strength) * 1000) / 1000,
    });
  }
  const byCompetitor: Record<string, CompetitorSourceDomain[]> = {};
  for (const [competitorId, list] of byCompMap) {
    byCompetitor[competitorId] = list
      .sort((a, b) => b.strength - a.strength || b.answersFeeding - a.answersFeeding)
      .slice(0, GAP_MAX_ROWS);
  }

  const competitors: CitationGapCompetitor[] = competitorList
    .filter((c) => byCompetitor[c.id]?.length)
    .map((c) => ({ id: c.id, name: competitorNameById.get(c.id) ?? c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lowVisibility =
    totalAnswers > 0 && ourAnswerCount / totalAnswers < GAP_LOW_VISIBILITY_RATIO;

  return { gapDomains, byCompetitor, competitors, ourAnswerCount, totalAnswers, lowVisibility };
}

// ─── Existence check (#485) ───────────────────────────────────────────────────

/**
 * Unfiltered existence check — does this brand have any cited answer at all,
 * ignoring the page's date and filter selection? Lets the Citations page
 * distinguish "no data in this window" from "no data at all".
 *
 * Deliberately not a count (#706). `citations <> '[]'` can't use an index, so
 * an exact count made Postgres read and detoast every citation payload the
 * brand has ever produced — ~1.8s and 780 MB of buffers on a large brand with
 * a warm cache, and past the 8s statement timeout once the nightly run had
 * churned the cache, which failed the whole page load. Only the yes/no answer
 * was ever used. Stopping at the first match answers it in ~0.1ms.
 *
 * The ordering is load-bearing: without it the planner picks a sequential scan
 * over the entire table, which is unbounded for a brand whose answers never
 * cite anything. Ordering by created_at keeps the scan on this brand's rows
 * via idx_prompt_results_brand_created.
 *
 * Note that prompt_results.citation_count is NOT a substitute for the
 * `citations <> '[]'` predicate — it counts something narrower, and disagrees
 * on the overwhelming majority of rows.
 */
export async function brandHasCitations(brandId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('prompt_results')
    .select('id')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .neq('citations', '[]')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// ─── Per-URL detail (#535) ────────────────────────────────────────────────────

/** One answer citing the URL, for the detail page's "Cited in" list. */
export interface CitationUrlOccurrence {
  resultId: string;
  promptId: string;
  promptText: string;
  platform: string | null;
  modelUsed: string | null;
  region: string | null;
  createdAt: string;
  sentiment: string | null;
  /** Whether the brand was mentioned in the same answer. */
  brandMentioned: boolean;
  /** How many times this URL was cited within this one answer. */
  citationsInAnswer: number;
  /** 1-based order of the URL's first citation in the answer (by start index). */
  rank: number;
  /** Total citations in the answer (the rank's denominator). */
  totalSources: number;
}

/** Prompts that trigger this citation, grouped with counts. */
export interface CitationUrlPromptGroup {
  promptId: string;
  promptText: string;
  answers: number;
  citations: number;
  lastSeen: string;
}

export interface CitationUrlTargetingPrompt {
  promptId: string;
  promptText: string;
  label: string | null;
  citedCount: number;
}

export interface CitationUrlDetail {
  /** The normalized URL the page is keyed by. */
  url: string;
  domain: string;
  category: SourceCategory;
  title: string;
  articleType: string | null;
  totals: {
    citations: number;
    answers: number;
    prompts: number;
    models: string[];
    firstSeen: string | null;
    lastSeen: string | null;
  };
  /** Newest first. */
  occurrences: CitationUrlOccurrence[];
  promptGroups: CitationUrlPromptGroup[];
  /** Present only when the URL is on one of the brand's own domains. */
  owned: {
    targetingPrompts: CitationUrlTargetingPrompt[];
    traffic: { totalVisits: number; byPlatform: { platform: string; visits: number }[] };
  } | null;
}

/** Escape `\`, `%` and `_` for a PostgREST ilike pattern (mirrors traffic.ts). */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const URL_DETAIL_TRAFFIC_MAX_ROWS = 5000;

/**
 * Everything the per-URL citation detail page needs (#535), read from the
 * citation rows (#732) plus, for brand-owned URLs, the targeting and traffic
 * bridges. Uses the same filters as getCitationsOverview so the counts here
 * agree with the overview tables for the same URL, window and filters.
 *
 * Two calls rather than one because the URL identity this page groups by is
 * `normalizeCitationUrl`, which lives in TypeScript: SQL narrows to the
 * target's domain, the match itself happens here with the same function that
 * renders the result, and only the ids it accepted go back for the
 * occurrences. Reimplementing those rules in SQL would be a second definition
 * of the same identity, free to drift from this one.
 */
export async function getCitationUrlDetail(
  brandId: string,
  rawUrl: string,
  filters: CitationsFilters,
): Promise<CitationUrlDetail> {
  const supabase = await createClient();
  const targetUrl = normalizeCitationUrl(rawUrl);
  const targetHost = extractHostname(targetUrl) ?? '';
  const targetMatchKey = citationUrlMatchKey(targetUrl);

  // Brand + competitor domains → category (same context as the overview).
  const [{ data: brandDomainRows }, { data: competitorRows }] = await Promise.all([
    supabase.from('brand_domains').select('domain').eq('brand_id', brandId),
    supabase.from('competitors').select('domain').eq('brand_id', brandId),
  ]);
  const brandDomains = (brandDomainRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const competitorDomains = (competitorRows ?? [])
    .map((r) => normalizeDomain((r as { domain: string }).domain))
    .filter(Boolean);
  const category = targetHost
    ? classifyDomain(targetHost, { brandDomains, competitorDomains })
    : 'other';

  interface CandidateRow {
    id: number;
    url: string;
    title: string | null;
  }

  interface OccurrenceRow {
    result_id: string;
    prompt_id: string;
    prompt_text: string | null;
    platform: string | null;
    model_used: string | null;
    region: string | null;
    created_at: string;
    sentiment: string | null;
    brand_mentioned: boolean;
    citations_in_answer: number;
    rank: number;
    total_sources: number;
  }

  // Every URL the brand has cited on this host, folded through the page's own
  // normalization. One target usually covers several stored URLs: query
  // strings and a trailing slash are not part of the identity here.
  const { data: candidateRows, error: candidateErr } = await supabase.rpc(
    'citation_url_candidates',
    { p_brand_id: brandId, p_domain: targetHost },
  );
  if (candidateErr) throw new Error(candidateErr.message);

  const urlIds: number[] = [];
  let title = '';
  // By id, so the title is the one recorded the first time the URL was seen
  // rather than whichever row the database happened to return first.
  for (const row of ((candidateRows ?? []) as CandidateRow[]).slice().sort((a, b) => a.id - b.id)) {
    if (normalizeCitationUrl(row.url) !== targetUrl) continue;
    urlIds.push(row.id);
    if (!title && row.title) title = row.title;
  }

  const topicPromptIds = await resolveTopicPromptIds(supabase, filters);
  let occurrenceRows: OccurrenceRow[] = [];
  if (urlIds.length > 0) {
    const { data, error } = await supabase.rpc('citation_url_occurrences', {
      ...overviewArgs(brandId, filters, topicPromptIds),
      p_url_ids: urlIds,
    });
    if (error) throw new Error(error.message);
    occurrenceRows = (data ?? []) as OccurrenceRow[];
  }

  const models = new Set<string>();
  let totalCitations = 0;
  let firstSeen: string | null = null;
  let lastSeen: string | null = null;

  const withText: CitationUrlOccurrence[] = occurrenceRows.map((row) => {
    totalCitations += row.citations_in_answer;
    const modelKey = row.model_used || row.platform || '';
    if (modelKey) models.add(modelKey);
    if (!firstSeen || row.created_at < firstSeen) firstSeen = row.created_at;
    if (!lastSeen || row.created_at > lastSeen) lastSeen = row.created_at;

    return {
      resultId: row.result_id,
      promptId: row.prompt_id,
      promptText: row.prompt_text ?? '(deleted prompt)',
      platform: row.platform,
      modelUsed: row.model_used,
      region: row.region,
      createdAt: row.created_at,
      sentiment: row.sentiment,
      brandMentioned: row.brand_mentioned,
      citationsInAnswer: row.citations_in_answer,
      rank: row.rank,
      totalSources: row.total_sources,
    };
  });

  const promptIds = Array.from(new Set(withText.map((o) => o.promptId)));

  // Prompts breakdown — the queries this page is winning.
  const groupMap = new Map<string, CitationUrlPromptGroup>();
  for (const o of withText) {
    const existing = groupMap.get(o.promptId) ?? {
      promptId: o.promptId,
      promptText: o.promptText,
      answers: 0,
      citations: 0,
      lastSeen: o.createdAt,
    };
    existing.answers += 1;
    existing.citations += o.citationsInAnswer;
    if (o.createdAt > existing.lastSeen) existing.lastSeen = o.createdAt;
    groupMap.set(o.promptId, existing);
  }
  const promptGroups = Array.from(groupMap.values()).sort(
    (a, b) => b.citations - a.citations || b.answers - a.answers,
  );

  // Owned-URL bridges: targeting + AI-referred traffic, brand-domain URLs only.
  let owned: CitationUrlDetail['owned'] = null;
  if (category === 'you' && targetMatchKey) {
    const { from, to } = resolveDateRange(filters);
    const expandedTo = expandDateToEndOfDay(to);

    // (a) Prompts targeting this URL, via the workflow's prompt_target_urls.
    // Scoped to the brand through the prompts → prompt_sets join; matched with
    // the same loose key the cited-stats pipeline uses.
    const targetingPromise = supabase
      .from('prompt_target_urls')
      .select(
        'prompt_id, url, label, cited_count, prompts!inner(text, prompt_sets!inner(brand_id))',
      )
      .eq('prompts.prompt_sets.brand_id', brandId);

    // (b) AI-referred visits that landed on this page: the rows that start a
    // visit (00172), so a reload isn't another visit. The ilike narrows
    // server-side; the exact match happens on the loose key below.
    const pathForSearch = (() => {
      try {
        return new URL(targetUrl).pathname.replace(/\/+$/, '');
      } catch {
        return '';
      }
    })();
    let trafficQuery = supabase
      .from('ai_traffic_logs')
      .select('url, source_platform, created_at')
      .eq('brand_id', brandId)
      .is('visit_of', null)
      .order('created_at', { ascending: false })
      .range(0, URL_DETAIL_TRAFFIC_MAX_ROWS - 1);
    if (pathForSearch) trafficQuery = trafficQuery.ilike('url', `%${escapeIlike(pathForSearch)}%`);
    if (from) trafficQuery = trafficQuery.gte('created_at', from);
    if (expandedTo) trafficQuery = trafficQuery.lte('created_at', expandedTo);

    const [targetingRes, trafficRes] = await Promise.all([targetingPromise, trafficQuery]);
    if (targetingRes.error) throw new Error(targetingRes.error.message);
    if (trafficRes.error) throw new Error(trafficRes.error.message);

    interface TargetRow {
      prompt_id: string;
      url: string;
      label: string | null;
      cited_count: number;
      prompts: { text: string } | { text: string }[];
    }
    const targetingPrompts: CitationUrlTargetingPrompt[] = [];
    for (const row of (targetingRes.data ?? []) as unknown as TargetRow[]) {
      if (citationUrlMatchKey(row.url) !== targetMatchKey) continue;
      const prompt = Array.isArray(row.prompts) ? row.prompts[0] : row.prompts;
      targetingPrompts.push({
        promptId: row.prompt_id,
        promptText: prompt?.text ?? '(deleted prompt)',
        label: row.label,
        citedCount: row.cited_count,
      });
    }
    targetingPrompts.sort((a, b) => b.citedCount - a.citedCount);

    const visitsByPlatform = new Map<string, number>();
    let totalVisits = 0;
    for (const row of (trafficRes.data ?? []) as {
      url: string;
      source_platform: string | null;
    }[]) {
      if (citationUrlMatchKey(row.url) !== targetMatchKey) continue;
      totalVisits += 1;
      const platform = row.source_platform || 'unknown';
      visitsByPlatform.set(platform, (visitsByPlatform.get(platform) ?? 0) + 1);
    }
    const byPlatform = Array.from(visitsByPlatform.entries())
      .map(([platform, visits]) => ({ platform, visits }))
      .sort((a, b) => b.visits - a.visits);

    owned = { targetingPrompts, traffic: { totalVisits, byPlatform } };
  }

  return {
    url: targetUrl,
    domain: targetHost,
    category,
    title,
    articleType: classifyArticleType(targetUrl, title) ?? null,
    totals: {
      citations: totalCitations,
      answers: withText.length,
      prompts: promptIds.length,
      models: Array.from(models).sort(),
      firstSeen,
      lastSeen,
    },
    occurrences: withText,
    promptGroups,
    owned,
  };
}
