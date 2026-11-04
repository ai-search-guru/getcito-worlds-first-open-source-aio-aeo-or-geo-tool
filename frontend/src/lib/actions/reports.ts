'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import type { Json } from '@/types/supabase';
import { API_BASE_URL } from '@/config/api';
import {
  getInsightsSummary,
  getShareOfVoiceData,
  getCompetitorComparison,
  getVisibilityRateTrend,
  getVisibilityRateKpi,
  getTrackedPromptsKpi,
  type InsightsSummary,
  type CompetitorComparisonEntry,
  type SoVByPlatform,
  type VisibilityTrendPoint,
} from '@/lib/actions/tracking';
import { getCitationsOverview, type CitationsSourceBreakdown } from '@/lib/actions/citations';
import { getShoppingKpis } from '@/lib/actions/shopping';
import { type SourceCategory } from '@/lib/citations/classify';
import { stripEntityMarkup } from '@/lib/entityMarkup';
import { countTrafficLogs, scanTrafficLogs } from '@/lib/trafficScan';
import { LOW_SAMPLE_VISITS } from '@/lib/trafficChange';
import {
  getReportTemplate,
  ALL_REPORT_SECTIONS,
  type ReportSection,
  type ReportTemplateId,
} from '@/lib/reports/templates';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * Simple Reports MVP — generate, list and delete immutable report snapshots.
 *
 * `createReport` gathers the brand's metrics for the chosen period through the
 * existing analytics actions, asks the server for a 1-2 paragraph AI executive
 * summary, and saves everything as one JSONB payload in the `reports` table
 * (migration 00023). The detail page renders purely from that saved payload —
 * a report never changes after generation.
 */

// ─── Payload shape (what reports.payload stores) ─────────────────────────────

export interface ReportTopDomain {
  domain: string;
  category: SourceCategory;
  totalCitations: number;
  resultsCiting: number;
  usagePct: number;
}

export interface ReportPromptPerf {
  text: string;
  /** Average 0-100 intensity score over all runs — kept for older payloads. */
  avgVisibility: number;
  /**
   * Share of runs where the brand was mentioned or cited, as a percentage
   * (#562 semantics). Absent on reports generated before this shipped.
   */
  visibilityRate?: number;
  /** AI Visibility Score (0-100). Absent on reports generated before it shipped. */
  score?: number;
  totalMentions: number;
  runs: number;
}

export interface ReportFanoutQuery {
  query: string;
  engines: string[];
  timesSearched: number;
}

/**
 * How much each engine fanned out, beside the top-ten table.
 *
 * That table ranks by how many answers ran the identical string, which favours
 * engines that reuse their phrasing — an engine can search the most and place
 * in the top ten the least. These two numbers separate variety from volume so
 * the table is not read as the whole picture.
 */
export interface ReportFanoutEngine {
  /** Platform slug as stored on the result (UI maps to a label). */
  engine: string;
  distinctQueries: number;
  answersWithFanout: number;
}

/** One concrete brand mention: which prompt, where, and the passage (#429). */
export interface ReportMentionEvidence {
  promptText: string;
  /** Platform slug as stored on the result (UI maps to a label). */
  platform: string;
  date: string;
  mentionCount: number;
  /** Short passage of the answer around the brand mention. */
  excerpt: string;
}

/** One concrete cited URL and the prompts whose answers cited it (#429). */
export interface ReportCitationEvidence {
  url: string;
  domain: string;
  title: string;
  totalCitations: number;
  /** Up to a few tracked prompts whose answers cited this URL. */
  sourcedPrompts: string[];
}

export interface ReportTopicPerf {
  name: string;
  /** Average 0-100 intensity score over all runs — kept for older payloads. */
  avgVisibility: number;
  /**
   * Share of the topic's runs where the brand was mentioned or cited, as a
   * percentage (#562 semantics). Absent on reports generated before this
   * shipped.
   */
  visibilityRate?: number;
  /** AI Visibility Score (0-100). Absent on reports generated before it shipped. */
  score?: number;
  /**
   * Points change vs the previous window of equal length; null when no prior
   * data. Score points on payloads carrying `score`, visibility-rate points
   * on `visibilityRate`-era ones, raw-score points on the oldest.
   */
  change: number | null;
  results: number;
}

export interface ReportAiTraffic {
  totalVisits: number;
  /**
   * Percent change vs the previous window, or null: no visits before, or too
   * few on either side for a % to mean anything (see changeNote).
   */
  change: number | null;
  /**
   * Why there's no %, as the AI Traffic page says it (AT-003): 'new' — visits
   * now and none before; 'lowSample' — fewer than 30 visits in this period
   * or the one before. Absent on reports created before it.
   */
  changeNote?: 'new' | 'lowSample';
  platformBreakdown: { platform: string; visits: number }[];
  topPages: { url: string; visits: number }[];
}

export interface ReportShoppingVisibility {
  /** Own share of all shopping cards in the window, as a percentage. */
  shoppingSovPct: number;
  /** Points change vs the previous window; null when no prior shopping data. */
  sovChange: number | null;
  productsSurfaced: number;
  /** Share of tracked answers that produced shopping cards, as a percentage. */
  cardRatePct: number;
  topMerchant: string | null;
}

export interface ReportAuditScore {
  url: string;
  totalScore: number | null;
  /** The prior completed audit's score, for the delta; null when first audit. */
  previousScore: number | null;
  auditedAt: string;
}

/** Prompt-level Visibility Rate KPI (#492) — mirrors the Insights dashboard's headline metric. */
export interface ReportVisibilityRate {
  /** Distinct prompts the brand appeared in (the rate's numerator). */
  visiblePrompts: number;
  /** Distinct tracked prompts that produced results in the window (shared denominator). */
  promptCount: number;
  /** visiblePrompts / promptCount as a percentage, one decimal place (coverage). */
  ratePct: number;
  /**
   * AI Visibility Score (0-100): 0.6×mention rate + 0.25×citation rate +
   * 0.15×position factor over the window's answers. Absent on reports
   * generated before the score shipped.
   */
  score?: number | null;
  mentionAnswers?: number;
  citationAnswers?: number;
  positionFactor?: number | null;
}

/**
 * All metric fields are optional: a template only gathers its own sections
 * (see lib/reports/templates.ts), and the detail page + PDF render purely by
 * field presence. Reports generated before a field shipped simply don't have
 * it — the payload is immutable.
 */
export interface ReportPayload {
  brandName: string;
  /** AI-generated executive summary (plain prose). */
  summaryText: string;
  /**
   * Sections that were asked for but could not be gathered. A report is
   * generated without them rather than not at all, and this is how the page
   * says which ones are missing instead of leaving the reader to guess.
   */
  missingSections?: ReportSection[];
  insights?: InsightsSummary;
  /** Prompt-level Visibility Rate — leads the KPI row (#492); absent on reports generated before this shipped. */
  visibilityRate?: ReportVisibilityRate;
  /** Daily visibility trend over the report period. */
  visibilityTrend?: VisibilityTrendPoint[];
  /** Best/worst performing prompts in the period. */
  promptPerformance?: {
    best: ReportPromptPerf[];
    worst: ReportPromptPerf[];
  };
  /** The top mentioning answers, with the passage around the mention (#429). */
  mentionEvidence?: ReportMentionEvidence[];
  /** The top cited URLs with the prompts whose answers cited them (#429). */
  citationEvidence?: ReportCitationEvidence[];
  /** Most-run observed fan-out sub-queries in the period. */
  queryFanout?: ReportFanoutQuery[];
  /** Per-engine fan-out coverage; absent on reports generated before it shipped. */
  queryFanoutEngines?: ReportFanoutEngine[];
  /** Per-topic visibility with deltas vs the previous window. */
  topicPerformance?: ReportTopicPerf[];
  /** Real AI-referred visits in the period. */
  aiTraffic?: ReportAiTraffic;
  /** Shopping card presence (only gathered when the brand's shopping mode is on). */
  shoppingVisibility?: ReportShoppingVisibility;
  /** Latest completed Site Audit as of the period end. */
  auditScore?: ReportAuditScore;
  shareOfVoice?: {
    overallSov: number;
    overallSovChange: number | null;
    byPlatform: SoVByPlatform[];
  };
  /** Own brand + competitors, as returned by getCompetitorComparison. */
  competitors?: CompetitorComparisonEntry[];
  citations?: {
    totals: {
      domains: number;
      urls: number;
      citations: number;
      results: number;
      avgCitationsPerResult: number;
    };
    sourceTypeBreakdown: CitationsSourceBreakdown[];
    topDomains: ReportTopDomain[];
  };
}

export interface ReportListItem {
  id: string;
  brandId: string;
  title: string;
  template: string;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
}

export interface Report extends ReportListItem {
  payload: ReportPayload;
}

/** How many citation domains a report keeps (the table is capped, by design). */
const REPORT_TOP_DOMAINS = 10;

/** How many best/worst prompts a report keeps. */
const REPORT_PROMPT_COUNT = 5;

/**
 * Best/worst prompts by prompt-level Visibility Rate WITHIN the report period
 * — the share of runs the brand actually appeared in, not an average score
 * that zero-visibility runs dilute into misleading single digits (#562).
 * getPromptVisibilitySummaries anchors its window to "now", which lies for
 * custom historical ranges — so reports aggregate over [dateFrom, dateTo]
 * directly (same shape: exclude chatgpt-shopping, one row per run).
 */
interface PromptPerfRow {
  prompt_text: string | null;
  runs: number;
  visible_runs: number;
  mention_answers: number;
  citation_answers: number;
  total_mentions: number;
  sum_visibility: number;
  pos_sum: number;
  pos_n: number;
}

async function getPromptPerformance(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ best: ReportPromptPerf[]; worst: ReportPromptPerf[] }> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('report_prompt_performance', {
    p_brand_id: brandId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as PromptPerfRow[];

  const ranked = rows
    .filter((r) => r.runs > 0)
    .map((r) => ({
      text: r.prompt_text ?? '',
      avgVisibility: Math.round((r.sum_visibility / r.runs) * 10) / 10,
      visibilityRate: Math.round((r.visible_runs / r.runs) * 1000) / 10,
      // AI Visibility Score over this prompt's answers — same blend as the
      // All Prompts column, so a prompt reads identically in a report.
      score:
        computeAiVisibilityScore({
          answers: r.runs,
          mentionAnswers: r.mention_answers,
          citationAnswers: r.citation_answers,
          positionFactor: r.pos_n > 0 ? r.pos_sum / r.pos_n : null,
        }) ?? 0,
      totalMentions: r.total_mentions,
      runs: r.runs,
    }))
    .filter((p) => p.text)
    .sort((a, b) => b.score - a.score || b.totalMentions - a.totalMentions);

  const best = ranked.slice(0, REPORT_PROMPT_COUNT);
  // Worst come from the remaining pool so a short prompt list doesn't show
  // the same prompt in both columns.
  const worst = ranked.slice(REPORT_PROMPT_COUNT).slice(-REPORT_PROMPT_COUNT).reverse();
  return { best, worst };
}

/** How many fan-out sub-queries a report keeps. */
const REPORT_FANOUT_COUNT = 10;

/**
 * Top observed fan-out sub-queries WITHIN the report period. Mirrors the
 * aggregation in fanout.ts (dedupe per answer, whitespace/case-normalized
 * grouping) but bounded to [dateFrom, dateTo] instead of a rolling window
 * anchored to "now", which would lie for historical custom ranges.
 */
interface FanoutRow {
  query: string;
  engines: string[] | null;
  times_searched: number;
}

interface FanoutEngineRow {
  engine: string;
  distinct_queries: number;
  answers_with_fanout: number;
}

async function getFanoutSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ queries: ReportFanoutQuery[]; engines: ReportFanoutEngine[] }> {
  const supabase = await createClient();

  // The ranking and the coverage read the same rows for the same window, so
  // they go together and either both land or neither does.
  const [topRes, engineRes] = await Promise.all([
    supabase.rpc('report_query_fanout', {
      p_brand_id: brandId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit: REPORT_FANOUT_COUNT,
    }),
    supabase.rpc('report_query_fanout_engines', {
      p_brand_id: brandId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    }),
  ]);
  if (topRes.error) throw new Error(topRes.error.message);
  if (engineRes.error) throw new Error(engineRes.error.message);

  return {
    queries: ((topRes.data ?? []) as unknown as FanoutRow[]).map((r) => ({
      query: r.query,
      engines: r.engines ?? [],
      timesSearched: r.times_searched,
    })),
    engines: ((engineRes.data ?? []) as unknown as FanoutEngineRow[]).map((r) => ({
      engine: r.engine,
      distinctQueries: r.distinct_queries,
      answersWithFanout: r.answers_with_fanout,
    })),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The window of equal length immediately before [dateFrom, dateTo] — every
 *  report delta (US-1.4) compares against this. */
function previousWindow(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(dateFrom).getTime();
  const to = new Date(dateTo).getTime();
  return { from: new Date(from - (to - from)).toISOString(), to: dateFrom };
}

/** How many topics a report keeps. */
const REPORT_TOPIC_COUNT = 8;

/**
 * Per-topic Visibility Rate WITHIN the report period, with a rate-points delta
 * vs the previous window (#562 — an all-runs average score lets zero-visibility
 * runs dilute a well-covered topic). Same two-step pattern as
 * getPromptPerformance: one paged prompt_results scan spanning both windows,
 * then resolve topic names.
 */
interface TopicPerfRow {
  topic_name: string | null;
  runs: number;
  visible_runs: number;
  mention_answers: number;
  citation_answers: number;
  sum_visibility: number;
  pos_sum: number;
  pos_n: number;
  prev_runs: number;
  prev_visible_runs: number;
  prev_mention_answers: number;
  prev_citation_answers: number;
  prev_pos_sum: number;
  prev_pos_n: number;
}

async function getTopicPerformance(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportTopicPerf[]> {
  const supabase = await createClient();
  const prev = previousWindow(dateFrom, dateTo);

  const { data, error } = await supabase.rpc('report_topic_performance', {
    p_brand_id: brandId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_prev_from: prev.from,
  });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as TopicPerfRow[];

  return rows
    .filter((r) => r.runs > 0 && r.topic_name)
    .map((r) => {
      // AI Visibility Score over the topic's answers, per window — same
      // blend as the Topics page so the two surfaces agree.
      const score =
        computeAiVisibilityScore({
          answers: r.runs,
          mentionAnswers: r.mention_answers,
          citationAnswers: r.citation_answers,
          positionFactor: r.pos_n > 0 ? r.pos_sum / r.pos_n : null,
        }) ?? 0;
      const prevScore =
        r.prev_runs > 0
          ? (computeAiVisibilityScore({
              answers: r.prev_runs,
              mentionAnswers: r.prev_mention_answers,
              citationAnswers: r.prev_citation_answers,
              positionFactor: r.prev_pos_n > 0 ? r.prev_pos_sum / r.prev_pos_n : null,
            }) ?? 0)
          : null;
      return {
        name: r.topic_name!,
        avgVisibility: round1(r.sum_visibility / r.runs),
        visibilityRate: Math.round((r.visible_runs / r.runs) * 1000) / 10,
        score,
        change: prevScore === null ? null : round1(score - prevScore),
        results: r.runs,
      };
    })
    .sort((a, b) => b.results - a.results || b.score - a.score)
    .slice(0, REPORT_TOPIC_COUNT);
}

/**
 * Real AI-referred visits WITHIN the report period, with a percent delta vs
 * the previous window. Windowed here (getTrafficSummary anchors to "now").
 */
async function getTrafficSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportAiTraffic> {
  const supabase = await createClient();
  const prev = previousWindow(dateFrom, dateTo);

  // Visits, not pageviews: a row whose visit_of is null starts one (00172),
  // as the AI Traffic page counts them. The totals by count, which no row
  // cap touches, and the breakdowns by paging through the period: one plain
  // select stopped at PostgREST's 1,000 rows.
  const period = { from: dateFrom, to: dateTo, toInclusive: true };
  const cur: Record<string, unknown>[] = [];
  const [totalVisits, prevVisits] = await Promise.all([
    countTrafficLogs(supabase, brandId, period),
    countTrafficLogs(supabase, brandId, { from: prev.from, to: prev.to }),
    scanTrafficLogs(supabase, brandId, { ...period, columns: 'source_platform, url' }, (row) =>
      cur.push(row),
    ),
  ]);

  const byPlatform = new Map<string, number>();
  const byPage = new Map<string, number>();
  for (const r of cur) {
    const p = (r.source_platform as string) || 'unknown';
    byPlatform.set(p, (byPlatform.get(p) ?? 0) + 1);
    const u = (r.url as string) || '';
    if (u) byPage.set(u, (byPage.get(u) ?? 0) + 1);
  }

  // A % on a handful of visits says more about chance than about a trend:
  // 1,250 visits against 2 the week before read "+62400%". As on the AI
  // Traffic page, a % only when both periods have LOW_SAMPLE_VISITS.
  const lowSample = totalVisits < LOW_SAMPLE_VISITS || prevVisits < LOW_SAMPLE_VISITS;
  const changeNote: ReportAiTraffic['changeNote'] =
    prevVisits === 0 ? (totalVisits > 0 ? 'new' : undefined) : lowSample ? 'lowSample' : undefined;

  return {
    totalVisits,
    change:
      prevVisits > 0 && !lowSample ? round1(((totalVisits - prevVisits) / prevVisits) * 100) : null,
    ...(changeNote ? { changeNote } : {}),
    platformBreakdown: [...byPlatform.entries()]
      .map(([platform, visits]) => ({ platform, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5),
    topPages: [...byPage.entries()]
      .map(([url, visits]) => ({ url, visits }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 5),
  };
}

/**
 * Shopping card presence WITHIN the report period (reuses getShoppingKpis
 * with an explicit window), plus a points delta on shopping SoV vs the
 * previous window. Callers gate on the brand's shopping mode.
 */
async function getShoppingSnapshot(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportShoppingVisibility> {
  const prev = previousWindow(dateFrom, dateTo);
  const [cur, prior] = await Promise.all([
    getShoppingKpis(brandId, { datePreset: 'all', dateFrom, dateTo }),
    getShoppingKpis(brandId, { datePreset: 'all', dateFrom: prev.from, dateTo: prev.to }),
  ]);

  const sovPct = round1(cur.shoppingSov * 100);
  const priorHasData = prior.shoppingCardRateSampleSize > 0;
  return {
    shoppingSovPct: sovPct,
    sovChange: priorHasData ? round1(sovPct - prior.shoppingSov * 100) : null,
    productsSurfaced: cur.productsSurfaced,
    cardRatePct: round1(cur.shoppingCardRate * 100),
    topMerchant: cur.topMerchant?.domain ?? null,
  };
}

/**
 * Latest completed Site Audit as of the period end, with the prior audit's
 * score for the delta. Audits aren't period-bound like the other metrics, so
 * "as of dateTo" keeps historical reports honest. A partial audit (its
 * AI-judged signals didn't run) is never compared, so it's left out.
 */
async function getAuditSnapshot(brandId: string, dateTo: string): Promise<ReportAuditScore | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('site_audits')
    .select('url, total_score, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'completed')
    .eq('partial', false)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: false })
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return null;

  const [latest, prior] = data;
  return {
    url: latest.url as string,
    totalScore: latest.total_score === null ? null : round1(Number(latest.total_score)),
    previousScore: prior && prior.total_score !== null ? round1(Number(prior.total_score)) : null,
    auditedAt: latest.created_at as string,
  };
}

/**
 * Visibility Rate KPI for the report snapshot (#492) — same shape and
 * denominator as the Insights dashboard's headline metric, so a report's KPI
 * row matches what the Insights page shows for the identical date range.
 */
async function getReportVisibilityRate(
  brandId: string,
  range: { dateFrom: string; dateTo: string },
): Promise<ReportVisibilityRate> {
  const supabase = await createClient();
  const [rate, tracked, visRes] = await Promise.all([
    getVisibilityRateKpi(brandId, range),
    getTrackedPromptsKpi(brandId, range),
    supabase.rpc('ai_visibility_aggregates', {
      p_brand_id: brandId,
      p_platform: undefined,
      p_models: undefined,
      p_region: undefined,
      p_date_from: range.dateFrom,
      p_date_to: range.dateTo,
      p_prompt_id: undefined,
      p_topic_id: undefined,
    }),
  ]);
  const promptCount = tracked.activeInPeriod;
  const vis = (visRes.data ?? {}) as {
    answers?: number;
    mention_answers?: number;
    citation_answers?: number;
    position_factor?: number | null;
  };
  const answers = Number(vis.answers ?? 0);
  const mentionAnswers = Number(vis.mention_answers ?? 0);
  const citationAnswers = Number(vis.citation_answers ?? 0);
  const positionFactor = vis.position_factor ?? null;
  return {
    visiblePrompts: rate.visiblePrompts,
    promptCount,
    ratePct: promptCount > 0 ? Math.round((rate.visiblePrompts / promptCount) * 1000) / 10 : 0,
    score: computeAiVisibilityScore({ answers, mentionAnswers, citationAnswers, positionFactor }),
    mentionAnswers,
    citationAnswers,
    positionFactor,
  };
}

/** How many evidence rows a report keeps per evidence section (#429). */
const REPORT_EVIDENCE_COUNT = 10;
/** How many sourcing prompts each cited URL lists. */
const EVIDENCE_PROMPTS_PER_URL = 3;

/** Light markdown/URL/entity-tag strip so excerpts read as prose. */
function stripMarkdown(text: string): string {
  return stripEntityMarkup(text)
    .replace(/\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/[*_#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The passage of an answer around the first brand mention — the "how was I
 * mentioned" a KPI total can't convey. Falls back to the answer's opening
 * when the mention came via a domain rather than the brand name.
 */
function mentionExcerpt(response: string, brandName: string): string {
  const clean = stripMarkdown(response);
  const idx = clean.toLowerCase().indexOf(brandName.toLowerCase());
  if (idx === -1) {
    return clean.length > 180 ? `${clean.slice(0, 180).trimEnd()}…` : clean;
  }
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, idx + brandName.length + 140);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

/**
 * Top mentioning answers in the window (#429): prompt, platform, date and the
 * passage around the mention. Server-side ORDER BY + LIMIT — no scan needed.
 */
async function getMentionEvidence(
  brandId: string,
  brandName: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportMentionEvidence[]> {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from('prompt_results')
    .select('prompt_id, platform, created_at, mention_count, response')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gt('mention_count', 0)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('mention_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(REPORT_EVIDENCE_COUNT);

  const results = (rows ?? []) as Array<{
    prompt_id: string | null;
    platform: string | null;
    created_at: string;
    mention_count: number | null;
    response: string | null;
  }>;
  if (results.length === 0) return [];

  const promptIds = [...new Set(results.map((r) => r.prompt_id).filter(Boolean))] as string[];
  const promptTextById = new Map<string, string>();
  if (promptIds.length > 0) {
    const { data: promptRows } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', promptIds);
    for (const p of promptRows ?? []) promptTextById.set(p.id as string, p.text as string);
  }

  return results.map((r) => ({
    promptText: (r.prompt_id && promptTextById.get(r.prompt_id)) || '(deleted prompt)',
    platform: r.platform ?? '',
    date: r.created_at,
    mentionCount: r.mention_count ?? 0,
    excerpt: mentionExcerpt(r.response ?? '', brandName),
  }));
}

/**
 * Top cited URLs in the window with the prompts whose answers cited them
 * (#429). Needs its own paginated scan: the citations overview aggregates
 * URLs but doesn't keep the prompt attribution the evidence section is for.
 */
interface CitationEvidenceRow {
  url: string;
  domain: string;
  title: string;
  total_citations: number;
  sourced_prompts: string[] | null;
}

async function getCitationEvidence(
  brandId: string,
  dateFrom: string,
  dateTo: string,
): Promise<ReportCitationEvidence[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc('report_citation_evidence', {
    p_brand_id: brandId,
    p_date_from: dateFrom,
    p_date_to: dateTo,
    p_limit: REPORT_EVIDENCE_COUNT,
    p_prompts_per_url: EVIDENCE_PROMPTS_PER_URL,
  });
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as CitationEvidenceRow[]).map((r) => ({
    url: r.url,
    domain: r.domain,
    title: r.title,
    totalCitations: r.total_citations,
    sourcedPrompts: r.sourced_prompts ?? [],
  }));
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** English display names used in stored (immutable) report titles. */
const TEMPLATE_TITLES: Record<ReportTemplateId, string> = {
  weekly_visibility: 'Weekly Visibility Summary',
  executive_summary: 'Executive Summary',
  competitor_benchmark: 'Competitor Benchmark',
  citation_sources: 'Citation & Sources Report',
};

export async function createReport(
  brandId: string,
  opts: {
    dateFrom: string;
    dateTo: string;
    title?: string;
    template?: ReportTemplateId;
    /** Explicit section picks (US-1.3); falls back to the template's defaults. */
    sections?: ReportSection[];
  },
): Promise<{ id: string }> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const { dateFrom, dateTo } = opts;
  const range = { dateFrom, dateTo };
  const template = getReportTemplate(opts.template);

  // The brand row gates the shopping section server-side: even if a caller
  // sends `shoppingVisibility`, a brand with shopping mode off never gathers
  // it (mirrors the sidebar's requiresBrandPref rule).
  const { data: brand } = await supabase
    .from('brands')
    .select('name, shopping_mode_enabled')
    .eq('id', brandId)
    .single();
  const brandName = (brand?.name as string) ?? 'Brand';

  const picked = (opts.sections ?? template.sections).filter((s) =>
    ALL_REPORT_SECTIONS.includes(s),
  );
  const sectionSet = new Set<ReportSection>(picked);
  if (!brand?.shopping_mode_enabled) sectionSet.delete('shoppingVisibility');
  const has = (s: ReportSection) => sectionSet.has(s);

  // 1. Gather the metric snapshot through the existing analytics actions —
  //    only the picked sections (null = section not gathered).
  //
  //    A section that fails does not take the report with it. Losing one
  //    module is a gap the reader can see; losing all fourteen because the
  //    last one timed out is a report that never existed. What went missing is
  //    recorded so the output can say so rather than quietly shrink.
  const failed = new Set<ReportSection>();
  async function section<T>(name: ReportSection, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      console.error(`[reports] section "${name}" failed for brand ${brandId}:`, err);
      failed.add(name);
      return null;
    }
  }
  const pick = <T>(name: ReportSection, run: () => Promise<T>) =>
    has(name) ? section(name, run) : Promise.resolve(null);

  //    Two waves rather than one. The first holds the sections backed by the
  //    aggregate RPCs, which read the whole window in a single statement and
  //    are therefore the ones that run out of the database's per-statement
  //    time budget when everything else competes for the same I/O.
  const [insights, visibilityRate, sov, comparison, trend] = await Promise.all([
    pick('kpis', () => getInsightsSummary(brandId, range)),
    pick('kpis', () => getReportVisibilityRate(brandId, range)),
    pick('shareOfVoice', () => getShareOfVoiceData(brandId, range)),
    pick('competitors', () => getCompetitorComparison(brandId, range)),
    pick('trend', () => getVisibilityRateTrend(brandId, range)),
  ]);

  const [
    citations,
    promptPerformance,
    mentionEvidence,
    citationEvidence,
    queryFanout,
    topicPerformance,
    aiTraffic,
    shoppingVisibility,
    auditScore,
  ] = await Promise.all([
    pick('citations', () =>
      getCitationsOverview(brandId, { datePreset: 'custom', dateFrom, dateTo }),
    ),
    pick('promptPerformance', () => getPromptPerformance(brandId, dateFrom, dateTo)),
    pick('mentionEvidence', () => getMentionEvidence(brandId, brandName, dateFrom, dateTo)),
    pick('citationEvidence', () => getCitationEvidence(brandId, dateFrom, dateTo)),
    pick('queryFanout', () => getFanoutSnapshot(brandId, dateFrom, dateTo)),
    pick('topicPerformance', () => getTopicPerformance(brandId, dateFrom, dateTo)),
    pick('aiTraffic', () => getTrafficSnapshot(brandId, dateFrom, dateTo)),
    pick('shoppingVisibility', () => getShoppingSnapshot(brandId, dateFrom, dateTo)),
    pick('auditScore', () => getAuditSnapshot(brandId, dateTo)),
  ]);

  // Adapt VisibilityRateTrendData → VisibilityTrendPoint[] so the report
  // payload's visibilityTrend field stays array-shaped. Existing report
  // snapshots are immutable, so only new reports use the new formula.
  const visibilityTrend: VisibilityTrendPoint[] | null = trend
    ? (() => {
        const competitorKeys = trend.entities.filter((e) => !e.isOwnBrand).map((e) => e.key);
        return trend.points.map((pt) => {
          const compScores = competitorKeys
            .map((k) => pt.values[k])
            .filter((v): v is number => v !== undefined);
          return {
            date: pt.date,
            score: pt.values['you'] ?? 0,
            competitors:
              compScores.length > 0
                ? round1(compScores.reduce((a, b) => a + b, 0) / compScores.length)
                : null,
          };
        });
      })()
    : null;

  const snapshot: Omit<ReportPayload, 'summaryText'> = {
    brandName,
    ...(failed.size > 0 ? { missingSections: [...failed] } : {}),
    ...(insights ? { insights } : {}),
    ...(visibilityRate ? { visibilityRate } : {}),
    ...(visibilityTrend ? { visibilityTrend } : {}),
    ...(promptPerformance ? { promptPerformance } : {}),
    ...(mentionEvidence && mentionEvidence.length > 0 ? { mentionEvidence } : {}),
    ...(citationEvidence && citationEvidence.length > 0 ? { citationEvidence } : {}),
    ...(queryFanout && queryFanout.queries.length > 0
      ? {
          queryFanout: queryFanout.queries,
          ...(queryFanout.engines.length > 0 ? { queryFanoutEngines: queryFanout.engines } : {}),
        }
      : {}),
    ...(topicPerformance && topicPerformance.length > 0 ? { topicPerformance } : {}),
    ...(aiTraffic ? { aiTraffic } : {}),
    ...(shoppingVisibility ? { shoppingVisibility } : {}),
    ...(auditScore ? { auditScore } : {}),
    ...(sov
      ? {
          shareOfVoice: {
            overallSov: sov.overallSov,
            overallSovChange: sov.overallSovChange,
            byPlatform: sov.byPlatform,
          },
        }
      : {}),
    ...(comparison ? { competitors: comparison.brands } : {}),
    ...(citations
      ? {
          citations: {
            totals: citations.totals,
            sourceTypeBreakdown: citations.sourceTypeBreakdown,
            topDomains: citations.rows.slice(0, REPORT_TOP_DOMAINS).map((r) => ({
              domain: r.domain,
              category: r.category,
              totalCitations: r.totalCitations,
              resultsCiting: r.resultsCiting,
              usagePct: r.usagePct,
            })),
          },
        }
      : {}),
  };

  // 2. AI executive summary from the server (content.js-style single call).
  //    The template id lets the server flavor the prose for the report type.
  const res = await fetch(`${API_BASE_URL}/api/reports/summary`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ brandId, snapshot, dateFrom, dateTo, template: template.id }),
  });
  //    The prose is the one part of a report the reader can do without. If it
  //    cannot be written, the figures are still worth keeping — the page shows
  //    no summary, which is visible on its own.
  let summary = '';
  if (res.ok) {
    ({ summary } = (await res.json()) as { summary: string });
  } else {
    const body = await res.json().catch(() => ({}));
    console.error(
      `[reports] summary generation failed for brand ${brandId}:`,
      body.message || res.status,
    );
  }

  const payload: ReportPayload = { ...snapshot, summaryText: summary };

  // 3. Persist the immutable snapshot (RLS scopes the insert to org members).
  const title =
    opts.title?.trim() ||
    `${brandName} — ${TEMPLATE_TITLES[template.id]} (${dateFrom.slice(0, 10)} → ${dateTo.slice(0, 10)})`;

  const { data: created, error } = await supabase
    .from('reports')
    .insert({
      brand_id: brandId,
      title,
      template: template.id,
      date_from: dateFrom,
      date_to: dateTo,
      payload: payload as unknown as Json,
      created_by: session.user.id,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/reports');
  return { id: created.id as string };
}

export async function getReports(brandId: string): Promise<ReportListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    brandId: r.brand_id as string,
    title: r.title as string,
    template: r.template as string,
    dateFrom: r.date_from as string,
    dateTo: r.date_to as string,
    createdAt: r.created_at as string,
  }));
}

export async function getReport(id: string): Promise<Report | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('reports')
    .select('id, brand_id, title, template, date_from, date_to, payload, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id as string,
    brandId: data.brand_id as string,
    title: data.title as string,
    template: data.template as string,
    dateFrom: data.date_from as string,
    dateTo: data.date_to as string,
    createdAt: data.created_at as string,
    payload: data.payload as unknown as ReportPayload,
  };
}

export async function deleteReport(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();
  const { error } = await supabase.from('reports').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/reports');
}
