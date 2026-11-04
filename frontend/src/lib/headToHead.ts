/**
 * Head-to-head aggregation for the Competitors page (#923).
 *
 * A plain module rather than part of `lib/actions/tracking.ts`, because that
 * file is `'use server'` and its runtime exports must be async server actions.
 *
 * The page used to receive one row per tracked answer — answer text and
 * citations included — and group them in the browser. On large brands that is
 * hundreds of thousands of rows. It now receives one summary per (prompt,
 * engine, model, region) and loads a group's individual runs only when the
 * user opens it.
 *
 * The summaries come from the daily rollups (head_to_head_daily, 00169), so
 * every answer counts: a read of the raw answers stopped at PostgREST's
 * 1,000-row page and compared large brands on their newest answers only.
 */

import type { Sentiment } from '@/types';

/** One (prompt, engine, model, region) combination, averaged over its runs. */
export interface HeadToHeadGroup {
  promptId: string;
  promptText: string;
  promptCategory?: string;
  /** Display provider, e.g. "ChatGPT". */
  platform: string;
  /** Raw `prompt_results.platform`, used to load this group's runs. */
  rawPlatform: string | null;
  modelUsed: string;
  rawModelUsed: string | null;
  region?: string;
  runs: number;
  brandScore: number;
  competitorScore: number;
  diff: number;
  latestAt: string;
}

/** One tracked answer inside a group, loaded on demand. */
export interface HeadToHeadRun {
  resultId: string;
  createdAt: string;
  brandScore: number;
  competitorScore: number;
  sentiment: Sentiment;
}

export interface HeadToHeadPlatformRow {
  platform: string;
  brandScore: number;
  competitorScore: number;
  diff: number;
}

export interface HeadToHeadData {
  groups: HeadToHeadGroup[];
  platformRows: HeadToHeadPlatformRow[];
  brandAvg: number;
  competitorAvg: number;
  gaps: HeadToHeadGroup[];
  strengths: HeadToHeadGroup[];
}

/** One (prompt, engine, model, region) as head_to_head_daily sums it. */
export interface HeadToHeadRollupGroup {
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  runs: number;
  /** The brand's visibility summed over the group's answers. */
  brand_total: number;
  /** The competitor's, an answer that doesn't list it counting 0. */
  comp_total: number;
  latest_at: string;
}

/** One (platform, model) over every answer, for the averages. */
export interface HeadToHeadRollupEngine {
  platform: string | null;
  model_used: string | null;
  /** Answers, those without a prompt included. */
  brand_count: number;
  brand_total: number;
  /** Answers that list the competitor, and its visibility over them. */
  comp_count: number;
  comp_total: number;
}

/** head_to_head_daily's payload (00169). */
export interface HeadToHeadRollups {
  groups: HeadToHeadRollupGroup[];
  engines: HeadToHeadRollupEngine[];
  prompts: { id: string; text: string | null; category: string | null }[];
}

interface CompetitorMention {
  competitor_id?: string;
  visibility_score?: number;
}

const GAP_STRENGTH_LIMIT = 10;

export function emptyHeadToHead(): HeadToHeadData {
  return { groups: [], platformRows: [], brandAvg: 0, competitorAvg: 0, gaps: [], strengths: [] };
}

/** The competitor's score in one answer, or null when the answer doesn't list it. */
export function competitorScoreIn(mentions: unknown, competitorId: string): number | null {
  if (!Array.isArray(mentions)) return null;
  const hit = (mentions as CompetitorMention[]).find((m) => m?.competitor_id === competitorId);
  return hit ? (hit.visibility_score ?? 0) : null;
}

/**
 * The page's summaries from head_to_head_daily (00169). Each group is
 * averaged over its runs, a missing competitor counting 0, as the page always
 * did. The averages per display provider and overall are over every answer
 * for the brand (those without a prompt included) and over the answers that
 * list the competitor for it: an answer from before the competitor was added
 * says nothing about it. Groups come most recently run first, the order the
 * page lists prompts in.
 */
export function headToHeadFromRollups(
  rollups: HeadToHeadRollups,
  resolveProvider: (modelUsed: string | null, platform: string | null) => string,
): HeadToHeadData {
  type Totals = { brandTotal: number; brandCount: number; compTotal: number; compCount: number };
  const newTotals = (): Totals => ({ brandTotal: 0, brandCount: 0, compTotal: 0, compCount: 0 });

  const prompts = new Map(rollups.prompts.map((p) => [p.id, p]));
  const byProvider = new Map<string, Totals>();
  const overall = newTotals();

  for (const engine of rollups.engines) {
    const provider = resolveProvider(engine.model_used, engine.platform);
    const providerTotals = byProvider.get(provider) ?? newTotals();
    byProvider.set(provider, providerTotals);
    for (const totals of [overall, providerTotals]) {
      totals.brandTotal += Number(engine.brand_total);
      totals.brandCount += Number(engine.brand_count);
      totals.compTotal += Number(engine.comp_total);
      totals.compCount += Number(engine.comp_count);
    }
  }

  const groupList: HeadToHeadGroup[] = rollups.groups
    .filter((g) => Number(g.runs) > 0)
    .map((g) => {
      const runs = Number(g.runs);
      const brandScore = Number(g.brand_total) / runs;
      const competitorScore = Number(g.comp_total) / runs;
      const prompt = prompts.get(g.prompt_id);
      return {
        promptId: g.prompt_id,
        promptText: prompt?.text ?? '',
        promptCategory: prompt?.category ?? undefined,
        platform: resolveProvider(g.model_used, g.platform),
        rawPlatform: g.platform,
        modelUsed: g.model_used ?? '',
        rawModelUsed: g.model_used,
        region: g.region ?? undefined,
        runs,
        brandScore,
        competitorScore,
        diff: brandScore - competitorScore,
        latestAt: g.latest_at,
      };
    })
    .sort((a, b) => (a.latestAt < b.latestAt ? 1 : a.latestAt > b.latestAt ? -1 : 0));

  const avg = (total: number, count: number) => (count > 0 ? Math.round(total / count) : 0);
  const platformRows = [...byProvider.entries()]
    .map(([platform, a]) => {
      const brandScore = avg(a.brandTotal, a.brandCount);
      const competitorScore = avg(a.compTotal, a.compCount);
      return { platform, brandScore, competitorScore, diff: brandScore - competitorScore };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));

  const byDiff = [...groupList].sort((a, b) => a.diff - b.diff);
  return {
    groups: groupList,
    platformRows,
    brandAvg: avg(overall.brandTotal, overall.brandCount),
    competitorAvg: avg(overall.compTotal, overall.compCount),
    gaps: byDiff.filter((g) => g.diff < 0).slice(0, GAP_STRENGTH_LIMIT),
    strengths: byDiff
      .filter((g) => g.diff > 0)
      .reverse()
      .slice(0, GAP_STRENGTH_LIMIT),
  };
}
