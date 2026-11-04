'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { dbClient } from '@/lib/supabase/scoped';
import { addPromptToSet, type PromptAddFailureCode } from '@/lib/actions/prompt';
import { API_BASE_URL } from '@/config/api';
import { FANOUT_MIN_SILENT_ANSWERS, FANOUT_SHARING_PLATFORMS } from '@/config/fanoutPlatforms';

/**
 * Query Fan-out (#333) — read + promote actions over the OBSERVED sub-queries
 * answer engines actually ran, captured in `prompt_results.search_queries`
 * (#332) as `[{ query, engine?, source_platform }]`. Read-only aggregation;
 * we never synthesize sub-queries.
 */

export interface FanoutSourcePrompt {
  id: string;
  text: string;
}

export interface FanoutSubQuery {
  /** The observed sub-query, in its canonical (trimmed) form. */
  query: string;
  /** Source-platform slugs that surfaced it (UI maps to labels). */
  engines: string[];
  /** Distinct tracked answers whose fan-out contained this sub-query. */
  timesSearched: number;
  /** The user's tracked prompts whose answers ran this sub-query. */
  sourcedPrompts: FanoutSourcePrompt[];
  /** True when this exact sub-query is already tracked as a prompt. */
  tracked: boolean;
  /** The tracked prompt's id when `tracked` (for linking), else null. */
  trackedPromptId: string | null;
}

export interface FanoutPromptCoverage {
  id: string;
  text: string;
  /** All tracked answers for this prompt inside the fetched window. */
  totalRuns: number;
  /** Of those, how many contained at least one observed sub-query. */
  runsWithFanout: number;
  /** Platforms that answered this prompt in the window. */
  platforms: string[];
  /** Of those, the ones whose answers carried fan-out. */
  fanoutPlatforms: string[];
}

/** One platform's fan-out over the window, for the page's engine strip. */
export interface FanoutEngineCoverage {
  /** Platform slug, as in `prompt_results.platform`. */
  platform: string;
  /** Tracked answers from this platform in the window. */
  answers: number;
  /** Of those, how many carried observed fan-out. */
  answersWithFanout: number;
  /** Distinct sub-queries this platform surfaced in the window. */
  subQueries: number;
  /**
   * For a platform that shares its searches (FANOUT_SHARING_PLATFORMS) but
   * had none in the window: when its last one arrived, up to MAX_FANOUT_DAYS
   * back. Null otherwise, or when none arrived in that time either.
   */
  lastFanoutAt: string | null;
}

export interface QueryFanoutData {
  subQueries: FanoutSubQuery[];
  /** Total distinct observed sub-queries in the window. */
  totalObserved: number;
  /**
   * Per-prompt fan-out coverage over the same fetched window as `subQueries`,
   * including prompts whose answers triggered no search at all (0 / N) — the
   * denominator that tells "engines never search for this" apart from "we
   * barely track it". Empty for the single-prompt variant.
   *
   * Unordered: the caller owns display ranking (see the By-prompt view, which
   * ranks by sub-query count). Only a stable baseline sort is applied here.
   */
  promptCoverage: FanoutPromptCoverage[];
  /**
   * Per-platform fan-out over the same window, every platform that answered
   * included (those that never share searches too). Ordered by the answers
   * that carried fan-out. Empty for the single-prompt variant.
   */
  engines: FanoutEngineCoverage[];
  /**
   * True when the window held more answers than `FANOUT_MAX_ROWS` and the read
   * stopped early. Rows come back oldest-first, so it's the MOST RECENT answers
   * that are missing — counts under-report and coverage ratios are only
   * approximate. The UI says so rather than presenting a confident wrong ratio.
   */
  truncated: boolean;
}

interface RawSearchQueryItem {
  query?: unknown;
  engine?: unknown;
  source_platform?: unknown;
}

/** Longest fan-out window a caller may request (days). */
const MAX_FANOUT_DAYS = 90;

/**
 * PostgREST silently caps un-paginated selects at 1000 rows, which quietly
 * truncated the aggregation on exactly the brands where fan-out matters most
 * (#427). Page through the window instead, with a hard row ceiling so a
 * pathological brand can't pin the server action.
 */
const FANOUT_PAGE_SIZE = 1000;
const FANOUT_MAX_ROWS = 50_000;

/**
 * Chunk size for the residual `.in('id', …)` prompt-text lookup. The binding
 * constraint is URL length, not the row cap: PostgREST takes the id list in the
 * query string, and 100 UUIDs is already ~3.7KB against the ~8KB request line
 * most proxies allow, which the base URL and auth params also draw on.
 */
const PROMPT_TEXT_CHUNK_SIZE = 100;

/**
 * Ceiling on the brand's prompt roster read (see fetchBrandPromptRoster), in the
 * same spirit as FANOUT_MAX_ROWS: plan limits put real rosters orders of
 * magnitude below this.
 */
const PROMPT_ROSTER_MAX_ROWS = 20_000;

/** How long the intent-classification round-trip may take before we abort (#427). */
const FANOUT_INTENT_FETCH_TIMEOUT_MS = 20_000;

interface FanoutResultRow {
  prompt_id: string | null;
  platform: string | null;
  search_queries: unknown;
}

async function fetchFanoutRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  since: string,
  promptId?: string,
  until?: string,
  /** Only these platforms' answers (Chat's read keeps the plan's); all when absent. */
  platforms?: readonly string[],
): Promise<{ rows: FanoutResultRow[]; truncated: boolean }> {
  const rows: FanoutResultRow[] = [];
  for (let from = 0; from < FANOUT_MAX_ROWS; from += FANOUT_PAGE_SIZE) {
    let query = supabase
      .from('prompt_results')
      .select('prompt_id, platform, search_queries')
      .eq('brand_id', brandId)
      .gte('created_at', since)
      // Deterministic order so .range() pages don't shuffle between requests.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + FANOUT_PAGE_SIZE - 1);
    if (until) query = query.lte('created_at', until);
    if (promptId) query = query.eq('prompt_id', promptId);
    if (platforms) query = query.in('platform', [...platforms]);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as FanoutResultRow[];
    rows.push(...batch);
    // A short page means we reached the end of the window — the only exit that
    // guarantees a complete read.
    if (batch.length < FANOUT_PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

interface RosterPrompt {
  id: string;
  text: string;
  is_active: boolean;
}

/**
 * Every prompt belonging to the brand, paused ones included. One read serves
 * both jobs downstream: resolving prompt text for coverage / sourced-prompt rows,
 * and the "is this sub-query already tracked?" comparison — which used to be two
 * queries over almost exactly the same rows.
 *
 * Paged for the same reason the result fetch is (#427/#428): an un-paginated
 * select is silently capped at 1000 rows by PostgREST, which quietly truncated
 * the tracked-prompt map on brands with the largest prompt sets.
 */
async function fetchBrandPromptRoster(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<RosterPrompt[]> {
  const { data: brandSets, error: setsError } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (setsError) throw new Error(setsError.message);

  const setIds = (brandSets ?? []).map((s) => s.id as string);
  if (setIds.length === 0) return [];

  const prompts: RosterPrompt[] = [];
  for (let from = 0; from < PROMPT_ROSTER_MAX_ROWS; from += FANOUT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('prompts')
      .select('id, text, is_active')
      .in('prompt_set_id', setIds)
      .order('id', { ascending: true })
      .range(from, from + FANOUT_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as RosterPrompt[];
    prompts.push(...batch);
    if (batch.length < FANOUT_PAGE_SIZE) break;
  }
  return prompts;
}

/**
 * Canonical form of a sub-query for display + grouping: trim, then collapse any
 * internal whitespace run (double spaces, tabs, newlines) to a single space, so
 * "best  laptops" and "best laptops" group as one row.
 */
function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Aggregate the brand's observed query fan-out over a rolling window.
 *
 * `timesSearched` counts DISTINCT answers (prompt_results rows) whose
 * `search_queries` contains the sub-query — an observed demand signal that
 * replaces Google Ads volume for these long-tail, natural-language queries.
 * Grouping is by the normalized, lower-cased query string (see normalizeQuery)
 * so whitespace/case variants collapse into one row.
 */
export async function getQueryFanout(
  brandId: string,
  opts?: { days?: number; from?: string; to?: string; platforms?: readonly string[] },
): Promise<QueryFanoutData> {
  const supabase = await dbClient();
  // Clamp the window to a sane range so a crafted call can't force an
  // unbounded prompt_results scan + in-memory aggregation. The custom range
  // (#713) is clamped by the caller to the same ceiling, and re-clamped here
  // because this action is reachable on its own.
  const days = Math.min(Math.max(Math.trunc(opts?.days ?? 30) || 30, 1), MAX_FANOUT_DAYS);
  const earliest = Date.now() - MAX_FANOUT_DAYS * 86_400_000;
  const requested = opts?.from ? Date.parse(opts.from) : NaN;
  const since = Number.isFinite(requested)
    ? new Date(Math.max(requested, earliest)).toISOString()
    : new Date(Date.now() - days * 86_400_000).toISOString();

  // No server-side "non-empty" filter: comparing a jsonb column to '[]' through
  // PostgREST is unreliable, and rows with an empty fan-out contribute nothing
  // to the sub-query aggregation below (the item loop skips them) — but they do
  // count toward coverage, which is the whole point of the denominator.
  const { rows, truncated } = await fetchFanoutRows(
    supabase,
    brandId,
    since,
    undefined,
    opts?.to,
    opts?.platforms,
  );

  interface Acc {
    display: string;
    engines: Set<string>;
    promptIds: Set<string>;
    answerCount: number;
  }
  const byQuery = new Map<string, Acc>();

  /**
   * Fan-out coverage per prompt, from the exact same fetched rows: how many of
   * a prompt's tracked answers triggered a live search at all. Without this
   * denominator "8 sub-queries" reads the same whether it came from 10 answers
   * or 500 — and a prompt the engines never search for is invisible entirely.
   */
  interface CoverageAcc {
    totalRuns: number;
    runsWithFanout: number;
    platforms: Set<string>;
    fanoutPlatforms: Set<string>;
  }
  const coverageByPrompt = new Map<string, CoverageAcc>();
  // The same per answer, by the platform that answered.
  const byEngine = new Map<string, { answers: number; answersWithFanout: number }>();

  for (const row of rows) {
    let coverage: CoverageAcc | undefined;
    if (row.prompt_id) {
      coverage = coverageByPrompt.get(row.prompt_id);
      if (!coverage) {
        coverage = {
          totalRuns: 0,
          runsWithFanout: 0,
          platforms: new Set(),
          fanoutPlatforms: new Set(),
        };
        coverageByPrompt.set(row.prompt_id, coverage);
      }
      coverage.totalRuns += 1;
      if (row.platform) coverage.platforms.add(row.platform);
    }
    let engine: { answers: number; answersWithFanout: number } | undefined;
    if (row.platform) {
      engine = byEngine.get(row.platform);
      if (!engine) {
        engine = { answers: 0, answersWithFanout: 0 };
        byEngine.set(row.platform, engine);
      }
      engine.answers += 1;
    }

    const items = Array.isArray(row.search_queries)
      ? (row.search_queries as RawSearchQueryItem[])
      : [];
    // Dedup within a single answer so one answer counts once per sub-query,
    // even if the engine listed it twice.
    const seenInRow = new Set<string>();
    for (const item of items) {
      const q = typeof item?.query === 'string' ? normalizeQuery(item.query) : '';
      if (!q) continue;
      const key = q.toLowerCase();

      let acc = byQuery.get(key);
      if (!acc) {
        acc = { display: q, engines: new Set(), promptIds: new Set(), answerCount: 0 };
        byQuery.set(key, acc);
      }

      const sp =
        typeof item?.source_platform === 'string' && item.source_platform
          ? item.source_platform
          : (row.platform as string | null);
      if (sp) acc.engines.add(sp);
      if (row.prompt_id) acc.promptIds.add(row.prompt_id as string);

      if (!seenInRow.has(key)) {
        acc.answerCount += 1;
        seenInRow.add(key);
      }
    }
    // `seenInRow` is only written to past the validity guard above, so a
    // non-empty set means this answer contributed at least one real sub-query.
    if (seenInRow.size > 0) {
      if (coverage) {
        coverage.runsWithFanout += 1;
        if (row.platform) coverage.fanoutPlatforms.add(row.platform);
      }
      if (engine) engine.answersWithFanout += 1;
    }
  }

  if (byQuery.size === 0 && coverageByPrompt.size === 0) {
    return { subQueries: [], totalObserved: 0, promptCoverage: [], engines: [], truncated };
  }

  // Independent reads: the last-fan-out lookups overlap the roster's.
  const [engines, roster] = await Promise.all([
    engineCoverage(supabase, brandId, since, byEngine, byQuery),
    fetchBrandPromptRoster(supabase, brandId),
  ]);

  // Prompt text for every prompt with a run in the window — a superset of the
  // fan-out-sourced prompts, since coverage reports the zero rows too. Paused
  // prompts are included: they did run in the window, so their answers count.
  const promptTextById = new Map<string, string>();
  // Which sub-queries are already tracked as prompts for THIS brand? Compare
  // against the brand's ACTIVE prompt texts so the row shows Tracked ✓ vs +.
  const trackedByText = new Map<string, string>();
  for (const p of roster) {
    promptTextById.set(p.id, p.text);
    if (p.is_active) trackedByText.set(normalizeQuery(p.text).toLowerCase(), p.id);
  }

  // Whatever the roster didn't cover — a prompt moved to another set, or removed
  // mid-window — still needs its text, or its coverage row silently disappears.
  const missingIds = [...coverageByPrompt.keys()].filter((id) => !promptTextById.has(id));
  for (let i = 0; i < missingIds.length; i += PROMPT_TEXT_CHUNK_SIZE) {
    const { data: promptRows, error } = await supabase
      .from('prompts')
      .select('id, text')
      .in('id', missingIds.slice(i, i + PROMPT_TEXT_CHUNK_SIZE));
    // A dropped chunk deletes whole rows from both views (text is the filter
    // below), and an under-reported table looks exactly like a correct smaller
    // one — so fail loudly instead of degrading invisibly.
    if (error) throw new Error(error.message);
    for (const p of promptRows ?? []) {
      promptTextById.set(p.id as string, p.text as string);
    }
  }

  const subQueries: FanoutSubQuery[] = [...byQuery.entries()]
    .map(([key, acc]) => {
      const trackedPromptId = trackedByText.get(key) ?? null;
      const sourcedPrompts = [...acc.promptIds]
        .map((id) => ({ id, text: promptTextById.get(id) ?? '' }))
        .filter((p) => p.text)
        .sort((a, b) => a.text.localeCompare(b.text));
      return {
        query: acc.display,
        engines: [...acc.engines].sort(),
        timesSearched: acc.answerCount,
        sourcedPrompts,
        tracked: trackedPromptId !== null,
        trackedPromptId,
      };
    })
    .sort((a, b) => b.timesSearched - a.timesSearched || a.query.localeCompare(b.query));

  // Prompts whose text no longer resolves (hard-deleted) are dropped, matching
  // how `sourcedPrompts` already treats them. Sorted by text only: a stable,
  // deterministic baseline. Display ranking belongs to the caller, which ranks
  // by sub-query count — duplicating that here would just be discarded work.
  const promptCoverage: FanoutPromptCoverage[] = [...coverageByPrompt.entries()]
    .map(([id, acc]) => ({
      id,
      text: promptTextById.get(id) ?? '',
      totalRuns: acc.totalRuns,
      runsWithFanout: acc.runsWithFanout,
      platforms: [...acc.platforms].sort(),
      fanoutPlatforms: [...acc.fanoutPlatforms].sort(),
    }))
    .filter((p) => p.text)
    .sort((a, b) => a.text.localeCompare(b.text));

  return { subQueries, totalObserved: subQueries.length, promptCoverage, engines, truncated };
}

/**
 * The engine strip's numbers. For a platform that shares its searches but
 * had none in the window, also when its last ones arrived: ChatGPT's stopped
 * on 2026-09-30, and "none since Sep 30" says far more than "0%".
 */
async function engineCoverage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  since: string,
  byEngine: Map<string, { answers: number; answersWithFanout: number }>,
  byQuery: Map<string, { engines: Set<string> }>,
): Promise<FanoutEngineCoverage[]> {
  const subQueriesByEngine = new Map<string, number>();
  for (const acc of byQuery.values()) {
    for (const engine of acc.engines) {
      subQueriesByEngine.set(engine, (subQueriesByEngine.get(engine) ?? 0) + 1);
    }
  }

  const earliest = new Date(Date.now() - MAX_FANOUT_DAYS * 86_400_000).toISOString();
  const silent = [...byEngine.entries()]
    .filter(
      ([platform, e]) =>
        e.answers >= FANOUT_MIN_SILENT_ANSWERS &&
        e.answersWithFanout === 0 &&
        FANOUT_SHARING_PLATFORMS.includes(platform),
    )
    .map(([platform]) => platform);
  const lastFanoutAt = new Map<string, string | null>();
  await Promise.all(
    silent.map(async (platform) => {
      // `search_queries->0` exists only on a non-empty array, which PostgREST
      // can test; comparing the jsonb to '[]' it can't do reliably.
      const { data, error } = await supabase
        .from('prompt_results')
        .select('created_at')
        .eq('brand_id', brandId)
        .eq('platform', platform)
        .gte('created_at', earliest)
        .lt('created_at', since)
        .not('search_queries->0', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // The date is a nicety on top of the counts; never fail the page for it.
      lastFanoutAt.set(platform, error ? null : ((data?.created_at as string | undefined) ?? null));
    }),
  );

  return [...byEngine.entries()]
    .map(([platform, e]) => ({
      platform,
      answers: e.answers,
      answersWithFanout: e.answersWithFanout,
      subQueries: subQueriesByEngine.get(platform) ?? 0,
      lastFanoutAt: lastFanoutAt.get(platform) ?? null,
    }))
    .sort(
      (a, b) => b.answersWithFanout - a.answersWithFanout || a.platform.localeCompare(b.platform),
    );
}

/**
 * Promote an observed sub-query into a tracked prompt for the brand. Mirrors
 * the Insights "accept suggestion" flow: add to the brand's earliest prompt
 * set, deriving platforms/models from its most recent active prompt.
 * `addPromptToSet` enforces the plan's `maxPrompts` limit, and refuses a
 * brand with no topic yet (`no_topics`).
 */
export type TrackFanoutResult =
  { promptId: string } | { error: string; code?: PromptAddFailureCode };

export async function trackFanoutQuery(brandId: string, query: string): Promise<TrackFanoutResult> {
  const supabase = await createClient();
  const text = normalizeQuery(query);
  if (!text) return { error: 'Empty query' };

  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr || !ps) {
    return { error: 'No prompt set exists for this brand. Create one first.' };
  }

  const { data: defaults } = await supabase
    .from('prompts')
    .select('platforms, models')
    .eq('prompt_set_id', ps.id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const platforms =
    Array.isArray(defaults?.platforms) && defaults!.platforms.length > 0
      ? (defaults!.platforms as string[])
      : ['chatgpt-web'];
  const models = Array.isArray(defaults?.models) ? (defaults!.models as string[]) : [];

  const created = await addPromptToSet({ promptSetId: ps.id as string, text, platforms, models });
  if ('error' in created) return { error: created.error, code: created.code };

  revalidatePath('/dashboard/prompts');
  return { promptId: created.prompt.id };
}

/**
 * Classify the search intent of fan-out sub-queries via the server (#333).
 * Intent is brand-independent and cached server-side, so this is a cheap
 * on-demand lookup — a sub-query is classified by the LLM once and reused
 * everywhere after. Returns a map of normalized (lower-cased) query → intent.
 */
export async function classifyFanoutIntents(queries: string[]): Promise<Record<string, string>> {
  if (queries.length === 0) return {};

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  // Bounded: classifying a cold cache can take the aeo-server a while, and a
  // hung upstream must never pin this server action until the platform kills
  // it (#427). The tab degrades gracefully to no intent badges on rejection.
  const res = await fetch(`${API_BASE_URL}/api/prompts/fanout-intents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ queries }),
    signal: AbortSignal.timeout(FANOUT_INTENT_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Server error: ${res.status}`);
  }
  const data = await res.json();
  return (data.intents ?? {}) as Record<string, string>;
}

/**
 * Observed query fan-out for a single prompt (#392).
 * Filters prompt_results by both brand_id and prompt_id so only sub-queries
 * from answers to THIS prompt are returned. Aggregation is identical to
 * getQueryFanout (normalise → dedupe per answer → count distinct answers).
 */
export async function getPromptFanout(
  brandId: string,
  promptId: string,
  opts?: { days?: number },
): Promise<QueryFanoutData> {
  const supabase = await createClient();
  const days = Math.min(Math.max(Math.trunc(opts?.days ?? 30) || 30, 1), MAX_FANOUT_DAYS);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { rows, truncated } = await fetchFanoutRows(supabase, brandId, since, promptId);

  interface Acc {
    display: string;
    engines: Set<string>;
    answerCount: number;
  }
  const byQuery = new Map<string, Acc>();

  for (const row of rows) {
    const items = Array.isArray(row.search_queries)
      ? (row.search_queries as RawSearchQueryItem[])
      : [];
    const seenInRow = new Set<string>();
    for (const item of items) {
      const q = typeof item?.query === 'string' ? normalizeQuery(item.query) : '';
      if (!q) continue;
      const key = q.toLowerCase();

      let acc = byQuery.get(key);
      if (!acc) {
        acc = { display: q, engines: new Set(), answerCount: 0 };
        byQuery.set(key, acc);
      }

      const sp =
        typeof item?.source_platform === 'string' && item.source_platform
          ? item.source_platform
          : (row.platform as string | null);
      if (sp) acc.engines.add(sp);

      if (!seenInRow.has(key)) {
        acc.answerCount += 1;
        seenInRow.add(key);
      }
    }
  }

  // `promptCoverage` stays empty here: this variant answers for a single prompt
  // and has no prompt roster to report coverage over.
  if (byQuery.size === 0) {
    return { subQueries: [], totalObserved: 0, promptCoverage: [], engines: [], truncated };
  }

  const subQueries: FanoutSubQuery[] = [...byQuery.entries()]
    .map(([, acc]) => ({
      query: acc.display,
      engines: [...acc.engines].sort(),
      timesSearched: acc.answerCount,
      sourcedPrompts: [],
      tracked: false,
      trackedPromptId: null,
    }))
    .sort((a, b) => b.timesSearched - a.timesSearched || a.query.localeCompare(b.query));

  return {
    subQueries,
    totalObserved: subQueries.length,
    promptCoverage: [],
    engines: [],
    truncated,
  };
}
