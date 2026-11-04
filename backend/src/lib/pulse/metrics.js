import supabaseAdmin from '../../config/supabase.js';
import { computeAiVisibilityScore } from '../../config/visibilityScore.js';
import { chunkIds, selectInChunks } from '../chunkedIn.js';
import { logger } from '../logger.js';
import { readAllRpcRows } from '../rpcPages.js';
import { resolve } from '../../config/actionEngine.js';

/**
 * Daily Pulse metric computation (#540).
 *
 * Everything here reads through the same RPCs the Insights dashboard uses
 * (visible_prompt_stats, tracked_prompt_count, insights_aggregates,
 * competitor_aggregates, prompt_performance_aggregates) with the same
 * rounding, so the email and the dashboard always agree for the same
 * window. Pure computation — no sending, no persistence.
 */

const DAY_MS = 86_400_000;

function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The instants a whole-day window spans, for callers with no daily RPC. */
function dayWindowBounds(win) {
  return [new Date(`${win.from}T00:00:00.000Z`), new Date(`${win.to}T23:59:59.999Z`)];
}

/**
 * The trailing `length` whole UTC days ending today, and the equal window
 * before it.
 *
 * Same convention the dashboard's delta math uses (deltaDayWindows in
 * frontend/src/lib/actions/tracking.ts), so a comparison the pulse reports and one
 * the user reads on Insights cover the same days.
 */
export function trailingDayWindows(now, length) {
  const to = utcDay(now);
  const from = addDays(to, -(length - 1));
  return {
    cur: { from, to },
    prev: { from: addDays(from, -length), to: addDays(from, -1) },
  };
}

// Detector thresholds live in config/actionEngine.js, with every other
// number that decides what counts (#818 phase 2.5). Read through `resolve()`
// so per-definition and per-workspace overrides land without touching this
// file.
const { detection, noise } = resolve();

// How many risers the digest names. A presentation choice, not a detection
// threshold — it does not change what was found, only how much of it is
// listed — so it stays here.
const MOVER_LIMIT = 3;

// Cloro scraper platforms, as stored in prompt_results.platform. Keep in
// sync with SCRAPER_TASK_TYPES in ../cloroScraper.js (minus shopping,
// which is excluded from Insights per #155).
const TRACKED_PLATFORMS = [
  'chatgpt-web',
  'google-aio',
  'google-aimode',
  'copilot-web',
  'grok-web',
  'perplexity-web',
  'gemini-web',
];

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Run thunks one at a time and collect their results, `Promise.all`-style.
 *
 * The pulse is a background job that nobody waits on interactively, so
 * running its dozen aggregate queries concurrently buys no wall-clock the
 * user perceives — it only multiplies the peak load a single brand puts on
 * the database. That mattered in production: whole waves of brands woke from
 * the drain wait in the same second, each firing its queries in parallel, and
 * the largest brand's statements crossed the 8s timeout and its digest was
 * dropped. Sequential keeps one brand's footprint to a couple of statements.
 */
export async function series(thunks) {
  const results = [];
  for (const thunk of thunks) results.push(await thunk());
  return results;
}

// The aggregate RPCs are heavy on large brands (ai_visibility_aggregates
// touches ~1GB and spills to disk), and PostgREST's role carries an 8s
// statement_timeout. Under load one of them can cross that line — which used
// to throw away the entire pulse for the biggest brand on the instance. A
// timeout is transient by nature, so retry it a couple of times with a short
// backoff before giving up.
const RPC_RETRIES = 2;
const RPC_RETRY_DELAY_MS = 3_000;

export function isTransientDbError(message) {
  return /statement timeout|canceling statement|deadlock detected/i.test(message || '');
}

function rpc(name, params) {
  return retried(name, () => supabaseAdmin.rpc(name, params));
}

/**
 * Every row of a set-returning RPC, in `key` order (see lib/rpcPages.js):
 * one response stops at 1000 rows. A timeout on any page retries the read
 * from its first page.
 */
function rpcRows(name, params, key) {
  return retried(name, () =>
    readAllRpcRows(name, (from, to) =>
      supabaseAdmin.rpc(name, params).order(key, { ascending: true }).range(from, to),
    ),
  );
}

async function retried(name, read, attempt = 0) {
  const { data, error } = await read();
  if (error) {
    if (attempt < RPC_RETRIES && isTransientDbError(error.message)) {
      logger.warn({ rpc: name, attempt: attempt + 1 }, 'pulse rpc timed out, retrying');
      await new Promise((r) => setTimeout(r, RPC_RETRY_DELAY_MS * (attempt + 1)));
      return retried(name, read, attempt + 1);
    }
    throw new Error(`${name} failed: ${error.message}`);
  }
  return data;
}

/**
 * A window the rollups can answer, or the raw timestamps.
 *
 * `days` is a whole-UTC-day window ({ from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' },
 * inclusive on both ends). When one is given the call is served from the
 * pre-aggregated daily tables (00066), whose cost scales with the number of
 * days rather than with everything the brand has ever collected. Without one
 * the raw RPC answers, which is what a window that does not fall on day
 * boundaries — the 24-hour run-anchored one — needs.
 */
export function windowParams(brandId, from, to, days) {
  return days
    ? { p_brand_id: brandId, p_day_from: days.from, p_day_to: days.to }
    : { p_brand_id: brandId, p_date_from: from.toISOString(), p_date_to: to.toISOString() };
}

export const daily = (name, days) => (days ? `${name}_daily` : name);

async function visibilityRate(brandId, from, to, days = null) {
  const params = windowParams(brandId, from, to, days);
  const [stats, tracked, vis] = await Promise.all([
    rpc(daily('visible_prompt_stats', days), params),
    rpc(daily('tracked_prompt_count', days), params),
    rpc(daily('ai_visibility_aggregates', days), params),
  ]);
  const visible = stats?.visible_prompts ?? 0;
  const total = tracked ?? 0;
  // `rate` carries the AI Visibility Score (0-100) — the same blend every
  // dashboard surface shows; coverage stays available as visible/total.
  const score =
    computeAiVisibilityScore({
      answers: vis?.answers ?? 0,
      mentionAnswers: vis?.mention_answers ?? 0,
      citationAnswers: vis?.citation_answers ?? 0,
      positionFactor: vis?.position_factor ?? null,
    }) ?? 0;
  return { visible, total, rate: score };
}

/**
 * Positive answers over the answers that name the brand (00191's
 * `mention_results`), the base Insights and Action Center use. Before 00191
 * the aggregates carry only answers that name or cite it, so fall back.
 */
export function positiveSentimentPct(agg) {
  const named = agg?.mention_results ?? agg?.mentioning_results ?? 0;
  return named > 0 ? Math.round(((agg?.positive_count ?? 0) / named) * 100) : 0;
}

async function insightsWindow(brandId, from, to, days = null) {
  const agg = await rpc(daily('insights_aggregates', days), windowParams(brandId, from, to, days));
  return {
    totalResults: agg?.total_results ?? 0,
    mentions: agg?.total_mentions ?? 0,
    citations: agg?.total_citations ?? 0,
    sentimentPct: positiveSentimentPct(agg),
  };
}

async function competitorRates(brandId, from, to, days = null) {
  const agg = await rpc(
    daily('ai_visibility_aggregates', days),
    windowParams(brandId, from, to, days),
  );
  // Shared denominator (the brand's answers), same as the web leaderboard.
  const answers = agg?.answers ?? 0;
  const brandRate =
    computeAiVisibilityScore({
      answers,
      mentionAnswers: agg?.mention_answers ?? 0,
      citationAnswers: agg?.citation_answers ?? 0,
      positionFactor: agg?.position_factor ?? null,
    }) ?? 0;
  const competitors = new Map();
  for (const c of agg?.by_competitor ?? []) {
    competitors.set(c.competitor_id, {
      id: c.competitor_id,
      name: c.name,
      rate:
        computeAiVisibilityScore({
          answers,
          mentionAnswers: c.mention_answers ?? 0,
          citationAnswers: c.citation_answers ?? 0,
          positionFactor: c.position_factor ?? null,
        }) ?? 0,
    });
  }
  return { brandRate, competitors };
}

/**
 * Per-prompt AI Visibility Score over a window (movers highlight). One row per
 * prompt, so a brand past 1000 prompts needs more than one page.
 *
 * Exported for the test that pins the paging behaviour.
 */
export async function promptScores(brandId, from, to) {
  const rows = await rpcRows(
    'prompt_visibility_summaries',
    {
      p_brand_id: brandId,
      p_date_from: from.toISOString(),
      p_date_to: to.toISOString(),
    },
    'prompt_id',
  );
  const map = new Map();
  for (const row of rows ?? []) {
    if (!row.runs) continue;
    map.set(row.prompt_id, {
      score:
        computeAiVisibilityScore({
          answers: Number(row.runs),
          mentionAnswers: Number(row.mention_answers ?? 0),
          citationAnswers: Number(row.citation_answers ?? 0),
          positionFactor: row.position_factor ?? null,
        }) ?? 0,
    });
  }
  return map;
}

/** All prompt ids (and texts) belonging to a brand. */
async function brandPrompts(brandId) {
  const { data: sets } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  const setIds = (sets ?? []).map((s) => s.id);
  if (!setIds.length) return [];
  const { data: prompts } = await supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('prompt_set_id', setIds);
  return prompts ?? [];
}

/** Target URLs cited for the first time inside the window. */
async function firstTimeCitations(promptById, from) {
  const promptIds = [...promptById.keys()];
  if (!promptIds.length) return [];
  const { data } = await selectInChunks(promptIds, (chunk) =>
    supabaseAdmin
      .from('prompt_target_urls')
      .select('url, label, prompt_id, first_cited_at')
      .in('prompt_id', chunk)
      .gte('first_cited_at', from.toISOString())
      .order('first_cited_at', { ascending: false })
      .limit(5),
  );
  // Each chunk brings back its own five, so the global five is taken here —
  // the `.limit(5)` above only narrows what each request has to carry.
  return (data ?? [])
    .slice()
    .sort((a, b) => String(b.first_cited_at).localeCompare(String(a.first_cited_at)))
    .slice(0, 5)
    .map((row) => ({
      url: row.url,
      label: row.label,
      promptText: promptById.get(row.prompt_id)?.text ?? '',
    }));
}

/** Platforms where the brand became visible for the first time ever. */
async function newEngineAppearances(brandId, from) {
  const { data: recent } = await supabaseAdmin
    .from('prompt_results')
    .select('platform')
    .eq('brand_id', brandId)
    .neq('platform', 'chatgpt-shopping')
    .gte('created_at', from.toISOString())
    .or('mention_count.gt.0,citation_count.gt.0')
    .limit(1000);
  const platforms = [...new Set((recent ?? []).map((r) => r.platform).filter(Boolean))];
  const firsts = [];
  for (const platform of platforms) {
    const { count } = await supabaseAdmin
      .from('prompt_results')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('platform', platform)
      .lt('created_at', from.toISOString())
      .or('mention_count.gt.0,citation_count.gt.0');
    if (!count) firsts.push(platform);
  }
  return firsts;
}

/** How far back the lost-citation detector looks, in days. */
export const LOST_CITATION_WINDOW_DAYS = 14;

/**
 * High-volume prompts that stopped being cited: cited on >= 60% of the
 * days with results over the last 14 days, but 0 citations on the most
 * recent 3 result-days. "Runs" are bucketed per UTC day because a daily
 * run inserts one row per platform.
 */
async function lostCitationPrompts(brandId, promptById, now) {
  const promptIds = [...promptById.keys()];
  if (!promptIds.length) return [];
  const { data: volumes } = await selectInChunks(promptIds, (chunk) =>
    supabaseAdmin
      .from('prompt_volumes')
      .select('prompt_id')
      .in('prompt_id', chunk)
      .gt('est_ai_volume', 0),
  );
  const volumeIds = (volumes ?? []).map((v) => v.prompt_id);
  if (!volumeIds.length) return [];

  const since = new Date(now.getTime() - LOST_CITATION_WINDOW_DAYS * DAY_MS).toISOString();
  const PAGE = 1000;
  const rows = [];
  // Paging runs inside each id chunk rather than across the whole list: the
  // id filter has to stay a manageable URL (see lib/chunkedIn.js), and the
  // day-bucketing below is order-independent, so scanning brand by chunk
  // instead of strictly by date changes nothing downstream.
  for (const idChunk of chunkIds(volumeIds)) {
    for (let pageStart = 0; pageStart < 20000; pageStart += PAGE) {
      const { data: page, error } = await supabaseAdmin
        .from('prompt_results')
        .select('prompt_id, citation_count, created_at')
        .eq('brand_id', brandId)
        .neq('platform', 'chatgpt-shopping')
        .in('prompt_id', idChunk)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .range(pageStart, pageStart + PAGE - 1);
      if (error) throw new Error(`lost-citations scan failed: ${error.message}`);
      rows.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }
  }

  const byPrompt = new Map();
  for (const row of rows) {
    if (!row.prompt_id) continue;
    const day = row.created_at.slice(0, 10);
    const days = byPrompt.get(row.prompt_id) ?? new Map();
    days.set(day, (days.get(day) ?? false) || (row.citation_count ?? 0) > 0);
    byPrompt.set(row.prompt_id, days);
  }

  const lost = [];
  for (const [promptId, days] of byPrompt) {
    const ordered = [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (ordered.length < detection.lostCitationQuietDays + 2) continue;
    const tail = ordered.slice(-detection.lostCitationQuietDays);
    if (tail.some(([, cited]) => cited)) continue;
    const head = ordered.slice(0, -detection.lostCitationQuietDays);
    const citedDays = head.filter(([, cited]) => cited).length;
    if (citedDays / head.length >= detection.lostCitationCitedRatio) {
      lost.push({ promptId, promptText: promptById.get(promptId)?.text ?? '' });
    }
  }
  return lost;
}

/**
 * Platform-outage guard: platforms whose result volume across ALL orgs
 * collapsed today vs their trailing 7-day daily average — a
 * data-collection incident on our side, not a real visibility change.
 */
async function degradedPlatforms(now) {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  const weekAgo = new Date(now.getTime() - 8 * DAY_MS).toISOString();
  const degraded = [];
  for (const platform of TRACKED_PLATFORMS) {
    const [{ count: today }, { count: baseline }] = await Promise.all([
      supabaseAdmin
        .from('prompt_results')
        .select('id', { count: 'exact', head: true })
        .eq('platform', platform)
        .gte('created_at', dayAgo),
      supabaseAdmin
        .from('prompt_results')
        .select('id', { count: 'exact', head: true })
        .eq('platform', platform)
        .gte('created_at', weekAgo)
        .lt('created_at', dayAgo),
    ]);
    const dailyBaseline = (baseline ?? 0) / 7;
    if (
      dailyBaseline >= noise.outageMinBaseline &&
      (today ?? 0) < dailyBaseline * noise.outageCollapseRatio
    ) {
      degraded.push(platform);
    }
  }
  return degraded;
}

/**
 * The last completed tracking runs' stamps, newest first (00044 ledger).
 * Empty when the brand has never completed a full run.
 */
async function latestCompletedRunTimes(brandId, limit = 3) {
  const { data, error } = await supabaseAdmin
    .from('tracking_runs')
    .select('completed_at')
    .eq('brand_id', brandId)
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => new Date(r.completed_at));
}

/**
 * Compute the full pulse payload for a brand.
 *
 * @param {string} brandId
 * @param {{ windowDays?: number, now?: Date }} [options] windowDays is 1 for
 *   daily pulses, 7 for weekly ones — it stretches the KPI comparison
 *   windows, while the detector windows (7d vs previous 7d, 14d citation
 *   history) stay fixed per the issue spec.
 */
/**
 * How far visibility fell, and which grade of signal that is.
 *
 * A brand's visible-prompt rate is whatever its own level happens to be —
 * measured across live brands it ranges from under 1% to 88% — so judging a
 * fall by a fixed number of points decides which customers are allowed to
 * have the signal at all. Requiring 15 points meant a brand sitting at 12%
 * could lose four fifths of its visibility unreported, never having had 15
 * points to lose. That is why this detector had not fired once in production.
 *
 * Severity is therefore led by the relative loss, with an absolute floor only
 * to clear measurement noise — week-to-week movement averages 1.3 points
 * across live brands, so three sits above the wobble without excluding much.
 *
 * The two grades are exclusive and ordered: a fall severe enough to be a
 * collapse is that, not an early warning. Recover asks what was lost and how
 * to win it back; Protect asks what is slipping and how to hold it while the
 * position still exists to hold.
 *
 * Returns null when nothing is worth reporting.
 */
export function classifyVisibilityFall({ from, to, promptCount, outage = false }) {
  if (outage) return null;
  if (promptCount < detection.visibilityDropMinPrompts) return null;

  const drop = round1(from - to);
  if (drop < detection.visibilityDropFloorPoints) return null;

  const relative = from > 0 ? drop / from : 0;
  if (relative >= detection.visibilityDropRatio) return { type: 'sharp_drop', drop };

  if (from >= detection.slippingMinBaseline && relative >= detection.slippingMinRatio) {
    return { type: 'visibility_slipping', drop };
  }
  return null;
}

export async function computePulseMetrics(brandId, { windowDays = 1, now = new Date() } = {}) {
  // Daily KPI windows anchor to the tracking-run ledger — the exact same
  // windows the Insights 24h view resolves (getTrackingWindow) — so the
  // email can never disagree with the dashboard. A wall-clock [now-24h]
  // window double-counts whenever two runs land within 24h of each other
  // (e.g. the day the cron time moved earlier). Brands with no completed run
  // yet fall back to the clock window. Everything wider than a day is read in
  // whole UTC days instead — see below.
  let curTo = now;
  let curFrom = new Date(now.getTime() - windowDays * DAY_MS);
  let prevTo = curFrom;
  let prevFrom = new Date(now.getTime() - 2 * windowDays * DAY_MS);
  let runAnchored = false;

  if (windowDays === 1) {
    const [latest, prev, prevPrev] = await latestCompletedRunTimes(brandId, 3);
    if (latest) {
      runAnchored = true;
      curTo = latest;
      curFrom = new Date(Math.max(latest.getTime() - DAY_MS, prev ? prev.getTime() + 1 : 0));
      prevTo = prev ?? curFrom;
      prevFrom = prev
        ? new Date(Math.max(prev.getTime() - DAY_MS, prevPrev ? prevPrev.getTime() + 1 : 0))
        : new Date(curFrom.getTime() - DAY_MS);
    }
  }

  // Everything measured in days is read from the daily rollups, and is
  // therefore expressed in whole UTC days rather than in clock offsets.
  //
  // This is the fix for a silent failure, not a tidy-up. `insights_aggregates`
  // and `ai_visibility_aggregates` rescan every result a brand has ever
  // collected; past roughly 25k results that exceeds PostgREST's 8s statement
  // timeout, and on the largest brand it did so on every single call. The
  // pulse survived on its retries and its catch-up sweep. Signal recording,
  // which shares this function, had neither — so that brand recorded no
  // signals at all for six days, and with them no actions. The rollup answers
  // the same window in a tenth of a second.
  //
  // The 24-hour window stays on the raw RPCs: it is anchored to the
  // tracking-run ledger rather than to midnight, so no whole-day window can
  // express it, and it is cheap for exactly the same reason the wide ones
  // are not.
  const week = trailingDayWindows(now, 7);
  const detector = windowDays === 1 ? null : trailingDayWindows(now, windowDays);
  const [weekFrom, weekTo] = dayWindowBounds(week.cur);
  const [twoWeekFrom, twoWeekTo] = dayWindowBounds(week.prev);

  const prompts = await brandPrompts(brandId);
  const promptById = new Map(prompts.map((p) => [p.id, p]));

  const [
    curRate,
    weekRate,
    prevWeekRate,
    curInsights,
    prevInsights,
    weekComp,
    prevWeekComp,
    weekPromptAvg,
    prevWeekPromptAvg,
    firstCited,
    newEngines,
    lostCitations,
    degraded,
  ] = await series([
    () => visibilityRate(brandId, curFrom, curTo, detector?.cur ?? null),
    () => visibilityRate(brandId, weekFrom, weekTo, week.cur),
    () => visibilityRate(brandId, twoWeekFrom, twoWeekTo, week.prev),
    () => insightsWindow(brandId, curFrom, curTo, detector?.cur ?? null),
    () => insightsWindow(brandId, prevFrom, prevTo, detector?.prev ?? null),
    () => competitorRates(brandId, weekFrom, weekTo, week.cur),
    () => competitorRates(brandId, twoWeekFrom, twoWeekTo, week.prev),
    // No daily variant exists for the per-prompt summaries, so these stay on
    // the raw RPC — but over the same days as everything above, so the
    // movers cannot describe a different week from the rates beside them.
    () => promptScores(brandId, weekFrom, weekTo),
    () => promptScores(brandId, twoWeekFrom, twoWeekTo),
    () => firstTimeCitations(promptById, curFrom),
    () => newEngineAppearances(brandId, curFrom),
    () => lostCitationPrompts(brandId, promptById, now),
    () => degradedPlatforms(now),
  ]);

  const kpis = {
    visibilityRate: curRate.rate,
    visiblePrompts: curRate.visible,
    promptCount: curRate.total,
    weekRate: weekRate.rate,
    prevWeekRate: prevWeekRate.rate,
    weekTrend: round1(weekRate.rate - prevWeekRate.rate),
    mentions: curInsights.mentions,
    mentionsChange: curInsights.mentions - prevInsights.mentions,
    citations: curInsights.citations,
    citationsChange: curInsights.citations - prevInsights.citations,
    sentimentPct: curInsights.sentimentPct,
    sentimentChange: curInsights.sentimentPct - prevInsights.sentimentPct,
    totalResults: curInsights.totalResults,
  };

  // ── Highlights ─────────────────────────────────────────────────────────
  const highlights = [];
  for (const cite of firstCited) {
    highlights.push({
      type: 'first_citation',
      key: `first_citation:${cite.url}`,
      url: cite.url,
      label: cite.label,
      promptText: cite.promptText,
    });
  }

  const movers = [];
  for (const [promptId, cur] of weekPromptAvg) {
    const prev = prevWeekPromptAvg.get(promptId);
    if (!prev) continue;
    const gain = round1(cur.score - prev.score);
    if (gain >= detection.moverMinGain) {
      movers.push({ promptId, text: promptById.get(promptId)?.text ?? '', gain });
    }
  }
  movers.sort((a, b) => b.gain - a.gain);
  for (const mover of movers.slice(0, MOVER_LIMIT)) {
    highlights.push({
      type: 'prompt_gain',
      key: `prompt_gain:${mover.promptId}`,
      promptText: mover.text,
      gain: mover.gain,
    });
  }

  for (const [id, comp] of weekComp.competitors) {
    const prev = prevWeekComp.competitors.get(id);
    if (!prev) continue;
    if (prevWeekComp.brandRate <= prev.rate && weekComp.brandRate > comp.rate) {
      highlights.push({
        type: 'competitor_overtaken',
        key: `competitor_overtaken:${id}`,
        competitorName: comp.name,
        brandRate: weekComp.brandRate,
        competitorRate: comp.rate,
      });
    }
  }

  for (const platform of newEngines) {
    highlights.push({ type: 'new_engine', key: `new_engine:${platform}`, platform });
  }

  // ── Warnings ───────────────────────────────────────────────────────────
  const warnings = [];
  const outage = degraded.length > 0;

  const fall = classifyVisibilityFall({
    from: prevWeekRate.rate,
    to: weekRate.rate,
    promptCount: weekRate.total,
    outage,
  });
  if (fall) {
    warnings.push({
      type: fall.type,
      key: fall.type,
      from: prevWeekRate.rate,
      to: weekRate.rate,
      drop: fall.drop,
    });
  }

  for (const [id, comp] of weekComp.competitors) {
    const prev = prevWeekComp.competitors.get(id);
    if (!prev) continue;
    const surge = round1(comp.rate - prev.rate);
    if (surge >= detection.competitorSurgePoints) {
      warnings.push({
        type: 'competitor_surge',
        key: `competitor_surge:${id}`,
        competitorName: comp.name,
        from: prev.rate,
        to: comp.rate,
      });
    } else if (prev.rate <= prevWeekComp.brandRate && comp.rate > weekComp.brandRate) {
      warnings.push({
        type: 'competitor_crossed',
        key: `competitor_crossed:${id}`,
        competitorName: comp.name,
        competitorRate: comp.rate,
        brandRate: weekComp.brandRate,
      });
    }
  }

  if (!outage) {
    for (const lost of lostCitations) {
      warnings.push({
        type: 'lost_citations',
        key: `lost_citations:${lost.promptId}`,
        promptText: lost.promptText,
      });
    }
  }

  return {
    windowDays,
    computedAt: now.toISOString(),
    // The window these numbers describe, recorded so a second pulse can tell
    // that it would repeat an already-sent one (#701). `runAnchored` marks the
    // case where `to` is a tracking-run stamp rather than the wall clock —
    // only then is the value stable enough to dedupe on.
    window: {
      from: curFrom.toISOString(),
      to: curTo.toISOString(),
      runAnchored,
    },
    kpis,
    highlights,
    warnings,
    degradedPlatforms: degraded,
  };
}
