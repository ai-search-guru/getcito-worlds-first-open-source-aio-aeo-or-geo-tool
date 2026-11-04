import { computeAiVisibilityScore } from '@/lib/visibilityScore';
import { percentageChange } from '@/lib/metrics';
import { coverage, kpiRates, rateChange, shareOfVoice } from '@/lib/insightsKpis';

/**
 * Insights "Compare: Same prompts" (VIS-002). Adding prompts used to inflate
 * every change on the page: 509 new prompts read as +203% mentions. With the
 * switch on, a change compares only the prompts answered in both periods
 * (insights_same_prompt_compare[_daily], 00130); the numbers themselves still
 * cover every prompt.
 */

export interface SamePromptCompetitor {
  competitor_id: string;
  name: string | null;
  mention_answers: number;
  citation_answers: number;
  position_factor: number | null;
}

/** One window's totals over the shared prompts (ai_visibility_aggregates shape plus summary fields). */
export interface SamePromptTotals {
  answers: number;
  mention_answers: number;
  citation_answers: number;
  position_factor: number | null;
  total_mentions: number;
  total_citations: number;
  positive_count: number;
  mentioning_answers: number;
  /** 00131: the KPI cards' components on the shared prompts. */
  negative_count: number;
  sum_position: number | null;
  position_count: number;
  /** Shared prompts where the brand appeared (named or cited). */
  visible_prompts: number;
  /** Every competitor's mentions, for share of voice. */
  competitor_mentions: number;
  by_competitor: SamePromptCompetitor[];
}

export interface SamePromptComparison {
  /** Prompts answered in both windows: the ones every change is measured on. */
  samePrompts: number;
  /** Prompts answered only in the current window. */
  newPrompts: number;
  /** Prompts answered only in the previous window. */
  droppedPrompts: number;
  cur: SamePromptTotals;
  prev: SamePromptTotals;
}

/** What the page says about the prompts behind its changes. */
export interface PromptComparison {
  /** 'same': changes compare only prompts answered in both periods; 'all': every prompt. */
  basis: 'same' | 'all';
  samePrompts: number;
  newPrompts: number;
  droppedPrompts: number;
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function parseTotals(raw: unknown): SamePromptTotals {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    answers: num(t.answers),
    mention_answers: num(t.mention_answers),
    citation_answers: num(t.citation_answers),
    position_factor: numOrNull(t.position_factor),
    total_mentions: num(t.total_mentions),
    total_citations: num(t.total_citations),
    positive_count: num(t.positive_count),
    mentioning_answers: num(t.mentioning_answers),
    negative_count: num(t.negative_count),
    sum_position: numOrNull(t.sum_position),
    position_count: num(t.position_count),
    visible_prompts: num(t.visible_prompts),
    competitor_mentions: num(t.competitor_mentions),
    by_competitor: ((t.by_competitor as Record<string, unknown>[] | undefined) ?? []).map((c) => ({
      competitor_id: String(c.competitor_id),
      name: (c.name as string | null) ?? null,
      mention_answers: num(c.mention_answers),
      citation_answers: num(c.citation_answers),
      position_factor: numOrNull(c.position_factor),
    })),
  };
}

/**
 * The RPC payload, or null when it can't be used: missing, or read from
 * rollup rows not yet rewritten since 00130 (`complete: false`). Callers then
 * compare all prompts, as before, rather than show a change built on gaps.
 */
export function parseSamePromptComparison(raw: unknown): SamePromptComparison | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || r.complete !== true) return null;
  return {
    samePrompts: num(r.same_prompts),
    newPrompts: num(r.new_prompts),
    droppedPrompts: num(r.dropped_prompts),
    cur: parseTotals(r.cur),
    prev: parseTotals(r.prev),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const brandScore = (t: SamePromptTotals) =>
  computeAiVisibilityScore({
    answers: t.answers,
    mentionAnswers: t.mention_answers,
    citationAnswers: t.citation_answers,
    positionFactor: t.position_factor,
  });

/**
 * A competitor's score over the brand's answers. The list holds every
 * competitor tracked in the window (named or not), so one missing from it
 * wasn't tracked yet and has no score, as on all prompts.
 */
function competitorScore(t: SamePromptTotals, id: string): number | null {
  const c = t.by_competitor.find((x) => x.competitor_id === id);
  if (!c) return null;
  return computeAiVisibilityScore({
    answers: t.answers,
    mentionAnswers: c.mention_answers,
    citationAnswers: c.citation_answers,
    positionFactor: c.position_factor,
  });
}

// Of the answers naming the brand, as Net sentiment (00191).
const sentimentPct = (t: SamePromptTotals) =>
  t.mention_answers > 0 ? Math.round((t.positive_count * 100) / t.mention_answers) : 0;

export interface SamePromptChanges {
  /** Visibility on the shared prompts in each window, and the change in points. */
  visibility: { cur: number | null; prev: number | null; change: number | null };
  /** A competitor's score change on the shared prompts, in points. */
  competitorChange: (competitorId: string) => number | null;
  mentions: { cur: number; prev: number };
  /** Percentage changes, with the cards' rule: null unless both windows have answers. */
  mentionsChange: number | null;
  citationsChange: number | null;
  /** Positive-sentiment share change in points. */
  sentimentChange: number | null;
  /** The KPI cards' rate changes (VIS-003), in points (positions for Avg. position). */
  netSentimentChange: number | null;
  avgPositionChange: number | null;
  citationRateChange: number | null;
  coverageChange: number | null;
  shareOfVoiceChange: number | null;
}

/** Every change the Insights page shows, measured on the shared prompts. */
export function samePromptChanges(same: SamePromptComparison): SamePromptChanges {
  const { cur, prev } = same;
  const comparable = cur.answers > 0 && prev.answers > 0;
  const visCur = brandScore(cur);
  const visPrev = brandScore(prev);
  const rates = (t: SamePromptTotals) =>
    kpiRates({
      answers: t.answers,
      citationAnswers: t.citation_answers,
      named: t.mention_answers,
      positive: t.positive_count,
      negative: t.negative_count,
      sumPosition: t.sum_position,
      positionCount: t.position_count,
    });
  const ratesCur = rates(cur);
  const ratesPrev = rates(prev);
  return {
    visibility: {
      cur: visCur,
      prev: visPrev,
      change: visCur === null || visPrev === null ? null : round1(visCur - visPrev),
    },
    competitorChange: (id) => {
      const c = competitorScore(cur, id);
      const p = competitorScore(prev, id);
      return c === null || p === null ? null : round1(c - p);
    },
    mentions: { cur: cur.total_mentions, prev: prev.total_mentions },
    mentionsChange: comparable ? percentageChange(cur.total_mentions, prev.total_mentions) : null,
    citationsChange: comparable
      ? percentageChange(cur.total_citations, prev.total_citations)
      : null,
    sentimentChange: comparable ? sentimentPct(cur) - sentimentPct(prev) : null,
    netSentimentChange: rateChange(ratesCur.netSentiment, ratesPrev.netSentiment),
    avgPositionChange: rateChange(ratesCur.avgPosition, ratesPrev.avgPosition),
    citationRateChange: rateChange(ratesCur.citationRate, ratesPrev.citationRate),
    coverageChange: rateChange(
      coverage(cur.visible_prompts, same.samePrompts),
      coverage(prev.visible_prompts, same.samePrompts),
    ),
    shareOfVoiceChange: rateChange(
      shareOfVoice(cur.total_mentions, cur.competitor_mentions),
      shareOfVoice(prev.total_mentions, prev.competitor_mentions),
    ),
  };
}

/** The parts of the Insights payload whose changes Same prompts re-measures. */
export interface ComparedInsights {
  summary: {
    totalResults: number;
    mentionsChange: number | null;
    citationsChange: number | null;
    sentimentChange: number | null;
    netSentimentChange: number | null;
    avgPositionChange: number | null;
    citationRateChange: number | null;
  };
  sov: { overallSovChange: number | null };
  coverage: { change: number | null } | null;
  trend: { summary: { change: number | null } } | null;
  competitors: {
    brands: { isOwnBrand: boolean; competitorId?: string; scoreChange: number | null }[];
  };
}

/**
 * Re-measure the page's changes on the prompts answered in both periods
 * when Same prompts is on. The numbers themselves still cover every prompt;
 * only the changes move: the Visibility change on the trend card, every
 * leaderboard row's change, and every KPI card's change. Without a usable comparison the changes stay as they are,
 * measured on all prompts. With Same prompts off, the counts still come
 * back so the page can say how many new prompts the change includes.
 */
export function withPromptComparison<T extends ComparedInsights>(
  insights: T,
  same: SamePromptComparison | null,
  samePrompts: boolean,
): T & { comparison: PromptComparison | null } {
  if (!same) return { ...insights, comparison: null };
  const comparison: PromptComparison = {
    basis: samePrompts ? 'same' : 'all',
    samePrompts: same.samePrompts,
    newPrompts: same.newPrompts,
    droppedPrompts: same.droppedPrompts,
  };
  if (!samePrompts) return { ...insights, comparison };

  const changes = samePromptChanges(same);
  const { summary, trend, competitors, sov, coverage: coverageKpi } = insights;
  return {
    ...insights,
    comparison,
    summary:
      summary.totalResults > 0
        ? {
            ...summary,
            mentionsChange: changes.mentionsChange,
            citationsChange: changes.citationsChange,
            sentimentChange: changes.sentimentChange,
            netSentimentChange: changes.netSentimentChange,
            avgPositionChange: changes.avgPositionChange,
            citationRateChange: changes.citationRateChange,
          }
        : summary,
    sov: { ...sov, overallSovChange: changes.shareOfVoiceChange },
    coverage: coverageKpi && { ...coverageKpi, change: changes.coverageChange },
    trend: trend && { ...trend, summary: { ...trend.summary, change: changes.visibility.change } },
    competitors: {
      ...competitors,
      brands: competitors.brands.map((entry) => ({
        ...entry,
        scoreChange: entry.isOwnBrand
          ? changes.visibility.change
          : entry.competitorId
            ? changes.competitorChange(entry.competitorId)
            : null,
      })),
    },
  };
}
