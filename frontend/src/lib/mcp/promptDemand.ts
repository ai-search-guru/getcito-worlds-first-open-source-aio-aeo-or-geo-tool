import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * A prompt's real demand (PROMPT-014, 00370) for get_prompt_volumes, beside
 * its estimated AI volume: the signs people really ask it and the level they
 * come to, as the prompt's Demand card shows them. The server's nightly sweep
 * writes them: Search Console every night, Google Trends, People Also Ask and
 * YouTube about once a week.
 *
 * Kept short, as a list of up to 500 prompts carries one each: a single
 * read_at for the row, the top Search Console query alone, People Also Ask's
 * count and first questions, no weekly Trends points or video lists. The
 * paid signals are read for the prompt's keyword with the most Google
 * searches (its google_volumes' top one), so the keyword isn't repeated.
 */
export interface PromptDemand {
  /** high / medium / low, from the signals read; null until one was. */
  level: 'high' | 'medium' | 'low' | null;
  /** How many of the four signals were read (0–4). */
  signals_read: number;
  /** When the sweep last wrote the row. */
  read_at: string | null;
  /** The brand's matching Search Console queries over the last 28 days. */
  search_console: {
    impressions: number;
    clicks: number;
    queries: number;
    top_query: string | null;
  } | null;
  /** Google Trends for the keyword over 12 months. */
  google_trends: {
    trend: 'rising' | 'steady' | 'falling' | null;
    /** Change from the first weeks to the last, in percent; null without a base. */
    change_percent: number | null;
  } | null;
  /** The People Also Ask questions Google lists for the keyword: how many, and the first few. */
  people_also_ask: { count: number; questions: string[] } | null;
  /** The videos YouTube lists for the keyword, and their views. */
  youtube: { videos: number; views: number } | null;
}

/** People Also Ask questions a row carries. */
export const DEMAND_QUESTIONS_SHOWN = 3;

type Json = Record<string, unknown> | null | undefined;

const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value: unknown) => (typeof value === 'string' ? value : null);
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * A prompt_demand row as get_prompt_volumes returns it; null for one with
 * nothing read yet (the sweep writes a row when it sets the paid tasks, before
 * any is read).
 */
export function promptDemandOf(row: Record<string, unknown>): PromptDemand | null {
  const gsc = object(row.gsc);
  const trends = object(row.trends);
  const paa = object(row.paa);
  const youtube = object(row.youtube);
  if (num(row.signals) === 0 && !gsc && !trends && !paa && !youtube) return null;
  const level = text(row.level);
  const trend = text(trends?.trend);
  const questions = (Array.isArray(paa?.questions) ? paa.questions : [])
    .map((q) => text(object(q)?.question))
    .filter((q): q is string => q !== null);
  return {
    level: level === 'high' || level === 'medium' || level === 'low' ? level : null,
    signals_read: num(row.signals),
    read_at: text(row.updated_at),
    search_console: gsc
      ? {
          impressions: num(gsc.impressions),
          clicks: num(gsc.clicks),
          queries: num(gsc.queries),
          top_query: text(object(gsc.top)?.query),
        }
      : null,
    google_trends: trends
      ? {
          trend: trend === 'rising' || trend === 'steady' || trend === 'falling' ? trend : null,
          change_percent: trends.change == null ? null : num(trends.change),
        }
      : null,
    people_also_ask: paa
      ? { count: questions.length, questions: questions.slice(0, DEMAND_QUESTIONS_SHOWN) }
      : null,
    youtube: youtube ? { videos: num(youtube.videos), views: num(youtube.views) } : null,
  };
}

/** Prompt ids per `.in()` filter, so the request stays short. */
const DEMAND_CHUNK = 100;

/**
 * The brand's prompts' real demand, by prompt id; a prompt with nothing read
 * has none. A read that fails is logged and leaves every prompt without it:
 * the volumes still answer.
 */
export async function readPromptDemand(
  brandId: string,
  promptIds: string[],
): Promise<Map<string, PromptDemand>> {
  const chunks: string[][] = [];
  for (let i = 0; i < promptIds.length; i += DEMAND_CHUNK) {
    chunks.push(promptIds.slice(i, i + DEMAND_CHUNK));
  }
  const demand = new Map<string, PromptDemand>();
  try {
    const results = await Promise.all(
      chunks.map((ids) =>
        supabaseAdmin
          .from('prompt_demand')
          .select('prompt_id, level, signals, gsc, trends, paa, youtube, updated_at')
          .eq('brand_id', brandId)
          .in('prompt_id', ids),
      ),
    );
    for (const { data, error } of results) {
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as Record<string, unknown>[]) {
        const read = promptDemandOf(row);
        if (read) demand.set(row.prompt_id as string, read);
      }
    }
  } catch (err) {
    console.error('[mcp] prompt demand read failed; volumes answer without it', err);
    return new Map();
  }
  return demand;
}
