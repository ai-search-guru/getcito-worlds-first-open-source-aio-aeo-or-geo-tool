/**
 * Real demand for a tracked prompt (PROMPT-014, 00370): proof that people
 * ask it, beside the estimate of its AI searches (PROMPT-013).
 *
 * Four signals, each kept with the day it was read:
 *
 *   gsc      the brand's Search Console queries that match the prompt, over
 *            the last 28 days: impressions, clicks, how many queries and the
 *            most seen one. Free, from gsc_query_stats, every night. A query
 *            goes to the prompt the Action Center would map it to
 *            (classify.js matchPrompt, `gscMatchOverlap`).
 *   trends   Google Trends for the prompt's keyword, 12 months: the weekly
 *            line, rising, steady or falling, and the change on a year ago.
 *   paa      the People Also Ask questions Google shows for the keyword.
 *   youtube  the videos YouTube lists for the keyword and their views.
 *
 * The last three are DataForSEO's queued (Standard) tasks, read once a week
 * per prompt, at most NIGHTLY_LIMIT prompts a night, and only with
 * DEMAND_SIGNALS=true. The keyword is the prompt's volume analysis's own
 * (prompt_volumes): its keyword with the most Google searches, with that
 * analysis's location and language. A prompt never analysed, or whose
 * keywords Google has no searches for, has none of them. A task is set one
 * night and read once it's done: an hour later (scheduleDemandCollect), or
 * the next night.
 *
 * The level weighs the signals read (demandLevel). The Demand card on the
 * prompt's page shows all of it (GET /api/prompts/:id/demand), and the
 * Action Center's priority reads the level: a brand whose levels changed
 * has its open actions scored again (rescoreDemandBrands).
 *
 * A workspace whose plan has ended is skipped (2026-10-27, #1608): nothing
 * is matched, set or read for it.
 */

import supabaseAdmin from '../config/supabase.js';
import { resolve } from '../config/actionEngine.js';
import { activeBrandFilter, activeOrgFilter } from './activeSubscriptions.js';
import { getTask, isDataForSeoConfigured, postTasks, readyTasks } from './dataforseo.js';
import { matchPrompt, tokens } from './signals/library/classify.js';
import { logger } from './logger.js';
import { rescoreBrandActions } from './action-center/priorityData.js';

const DAY_MS = 86_400_000;

/** Search Console's window, in days up to today. */
export const GSC_WINDOW_DAYS = 28;
/** Search Console queries read per brand, the most seen first. */
export const GSC_QUERY_LIMIT = 5000;
/** Days before a prompt's paid signals are set to be read again. */
export const REFRESH_DAYS = 7;
/** Prompts whose paid signals one night sets, so a night's cost has a ceiling. */
export const NIGHTLY_LIMIT = 500;
/** A task not read by then is given up (DataForSEO lists a done task for three days). */
export const TASK_EXPIRE_DAYS = 3;
/** When the night's tasks are read: Standard tasks take up to about 45 minutes. */
export const COLLECT_DELAY_MS = 60 * 60_000;
/**
 * How long one sweep matches brands. The brands it doesn't reach are counted
 * (`unfinished`) and go first the next night: a night takes the brands whose
 * rows were written longest ago first (prompt_demand_brand_updates).
 */
export const SWEEP_DEADLINE_MS = 20 * 60_000;
/**
 * A sweep claims a prompt before it sets its tasks (prompt_demand_claim). A
 * claim older than this is one whose sweep died, and may be taken again.
 */
export const CLAIM_STALE_MINUTES = 120;
/** People Also Ask questions kept per prompt. */
export const MAX_PAA_QUESTIONS = 8;
/** Task results read at once. */
const READ_CONCURRENCY = 5;
/** Rows per write. */
const WRITE_CHUNK = 500;
/** Ids per `.in()` filter. */
const ID_CHUNK = 100;
/** SERP tasks need a location: the United States in English, when the analysis had none. */
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = 'en';

const { library: matching } = resolve();

/** The paid signals, in the order the card shows them. */
export const PAID_SIGNALS = ['trends', 'paa', 'youtube'];
const ALL_SIGNALS = ['gsc', ...PAID_SIGNALS];

/** Whether the weekly DataForSEO reads run: DEMAND_SIGNALS=true and DataForSEO's keys. */
export function paidSignalsEnabled() {
  return process.env.DEMAND_SIGNALS === 'true' && isDataForSeoConfigured();
}

// ─── The level ──────────────────────────────────────────────────────────────

/**
 * What each signal is worth toward the level: 2 points when it's strong, 1
 * when there is some, 0 otherwise.
 *
 *   gsc      impressions over 28 days: 1,000 and up 2, 100 and up 1.
 *   trends   rising 2, steady 1, falling or too little data 0. Trends is
 *            relative to the keyword's own peak, so only the direction says
 *            anything.
 *   paa      questions Google lists: 4 and up 2, 1 and up 1.
 *   youtube  views across the videos read: 100,000 and up 2, 5,000 and up 1.
 */
export const LEVEL_RULE = Object.freeze({
  gscImpressions: { strong: 1000, some: 100 },
  paaQuestions: { strong: 4, some: 1 },
  youtubeViews: { strong: 100_000, some: 5000 },
  /** Share of the points read for high (with at least two signals read), and for medium. */
  high: 0.6,
  medium: 0.3,
  highMinSignals: 2,
});

function byThreshold(value, { strong, some }) {
  if (value >= strong) return 2;
  if (value >= some) return 1;
  return 0;
}

/** A signal's points (0–2); its value is what is stored for it. */
export function signalPoints(name, value) {
  if (!value) return 0;
  if (name === 'gsc') return byThreshold(Number(value.impressions) || 0, LEVEL_RULE.gscImpressions);
  if (name === 'paa') {
    return byThreshold(
      Array.isArray(value.questions) ? value.questions.length : 0,
      LEVEL_RULE.paaQuestions,
    );
  }
  if (name === 'youtube') return byThreshold(Number(value.views) || 0, LEVEL_RULE.youtubeViews);
  if (name === 'trends') return value.trend === 'rising' ? 2 : value.trend === 'steady' ? 1 : 0;
  return 0;
}

/**
 * The level of a prompt's demand and how many of the four signals were read.
 * Each signal read counts, whatever it found (a read that found nothing is
 * evidence too); a signal never read doesn't. The level is the share of the
 * points the read signals could give: high at LEVEL_RULE.high and above
 * with two signals or more, medium at LEVEL_RULE.medium and above, low
 * below. Nothing read: no level.
 *
 * @param {{ gsc?: object|null, trends?: object|null, paa?: object|null, youtube?: object|null }} row
 * @returns {{ level: 'high'|'medium'|'low'|null, signals: number }}
 */
export function demandLevel(row) {
  let signals = 0;
  let points = 0;
  for (const name of ALL_SIGNALS) {
    if (!row?.[name]) continue;
    signals += 1;
    points += signalPoints(name, row[name]);
  }
  if (signals === 0) return { level: null, signals: 0 };
  const share = points / (2 * signals);
  const level =
    share >= LEVEL_RULE.high && signals >= LEVEL_RULE.highMinSignals
      ? 'high'
      : share >= LEVEL_RULE.medium
        ? 'medium'
        : 'low';
  return { level, signals };
}

// ─── Search Console ─────────────────────────────────────────────────────────

/**
 * Each prompt's Search Console demand: the queries matched to it, summed.
 * A query goes to one prompt at most, the closest (matchPrompt). Null when
 * the brand has no query in the window: nothing was read, not "no demand".
 * A prompt with no matching query gets zeros.
 *
 * @param {Array<{ query: string, clicks: number, impressions: number }>} queries
 * @param {Array<{ id: string, text: string }>} prompts
 * @param {string} at when it was read
 * @returns {Map<string, { impressions: number, clicks: number, queries: number, top: object|null, at: string }> | null}
 */
export function gscDemand(queries, prompts, at) {
  if (!Array.isArray(queries) || queries.length === 0) return null;
  const promptTokens = new Map(prompts.map((p) => [p.id, tokens(p.text)]));
  const demand = new Map(
    prompts.map((p) => [p.id, { impressions: 0, clicks: 0, queries: 0, top: null, at }]),
  );
  for (const q of queries) {
    const match = matchPrompt(tokens(q.query), promptTokens, matching);
    if (!match) continue;
    const d = demand.get(match.id);
    const impressions = Number(q.impressions) || 0;
    const clicks = Number(q.clicks) || 0;
    d.impressions += impressions;
    d.clicks += clicks;
    d.queries += 1;
    if (!d.top || impressions > d.top.impressions) d.top = { query: q.query, impressions, clicks };
  }
  return demand;
}

/** YYYY-MM-DD, `daysAgo` days before `now`, in UTC. */
function isoDay(now, daysAgo) {
  return new Date(now - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

async function readGscQueries(brandId, now) {
  const { data, error } = await supabaseAdmin.rpc('prompt_demand_gsc_queries', {
    p_brand_id: brandId,
    p_from: isoDay(now, GSC_WINDOW_DAYS - 1),
    p_to: isoDay(now, 0),
    p_limit: GSC_QUERY_LIMIT,
  });
  if (error) throw new Error(`gsc queries read failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

// ─── The paid signals' keyword ──────────────────────────────────────────────

/**
 * What the paid signals are read for: the analysis's keyword with the most
 * Google searches, and the analysis's location and language. Null without
 * an analysis or a keyword Google has searches for.
 *
 * @param {{ keywords?: string[], google_volumes?: Record<string, number>, location_code?: number|null, language_code?: string|null } | null} volume
 */
export function topKeyword(volume) {
  if (!volume) return null;
  let best = null;
  for (const [keyword, searches] of Object.entries(volume.google_volumes ?? {})) {
    const n = Number(searches) || 0;
    if (n > 0 && keyword.trim() && (!best || n > best.searches)) {
      best = { keyword: keyword.trim(), searches: n };
    }
  }
  if (!best) return null;
  return {
    keyword: best.keyword,
    locationCode: Number.isInteger(volume.location_code) ? volume.location_code : null,
    languageCode: volume.language_code || null,
  };
}

/**
 * Google Trends refuses a keyword over 100 characters or with any of
 * < > | " - + : *. Those are read as spaces; a keyword still too long has
 * no Trends.
 */
export function trendsKeyword(keyword) {
  const clean = String(keyword ?? '')
    .replace(/[<>|"\-+:*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean && clean.length <= 100 ? clean : null;
}

// ─── Reading the tasks' results ─────────────────────────────────────────────

const round = (n) => Math.round(n);
const average = (values) =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

/** Weeks averaged at each end of the year for the change on a year ago. */
const TREND_EDGE_WEEKS = 4;
/** A change of this many percent or more is rising (or, down, falling). */
export const TREND_CHANGE_PERCENT = 20;

/**
 * Google Trends' 12 months (Explore, google_trends_graph): its weekly
 * values (0–100, relative to the keyword's own peak), the change between
 * the first and the last four weeks, and rising, steady or falling. No week
 * with interest: trend null, too little data.
 */
export function trendsSignal(result, at) {
  const graph = (result?.items ?? []).find((item) => item?.type === 'google_trends_graph');
  const weeks = (graph?.data ?? []).filter((week) => week && !week.missing_data);
  const points = weeks.map((week) => {
    const value = Array.isArray(week.values) ? Number(week.values[0]) : NaN;
    return Number.isFinite(value) ? Math.max(0, Math.min(100, round(value))) : 0;
  });
  const base = { points, from: weeks[0]?.date_from ?? null, to: weeks.at(-1)?.date_to ?? null, at };
  if (!points.some((p) => p > 0)) return { ...base, trend: null, change: null };
  const first = average(points.slice(0, TREND_EDGE_WEEKS));
  const last = average(points.slice(-TREND_EDGE_WEEKS));
  if (first === 0) return { ...base, trend: last > 0 ? 'rising' : 'steady', change: null };
  const change = round(((last - first) / first) * 100);
  const trend =
    change >= TREND_CHANGE_PERCENT
      ? 'rising'
      : change <= -TREND_CHANGE_PERCENT
        ? 'falling'
        : 'steady';
  return { ...base, trend, change };
}

/** A link the provider gave, kept only when it's an http(s) URL; null otherwise. */
export function webUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * People Also Ask on Google's first page (SERP organic, advanced): each
 * question (people_also_ask_element's title) and the page Google answers it
 * with (its first expanded element's url and domain), once each, at most
 * MAX_PAA_QUESTIONS.
 */
export function paaSignal(result, at) {
  const questions = [];
  const seen = new Set();
  for (const item of result?.items ?? []) {
    if (item?.type !== 'people_also_ask') continue;
    for (const element of item.items ?? []) {
      if (element?.type !== 'people_also_ask_element') continue;
      const question = String(element.title ?? element.seed_question ?? '')
        .trim()
        .slice(0, 300);
      const key = question.toLowerCase();
      if (!question || seen.has(key)) continue;
      seen.add(key);
      const expanded = Array.isArray(element.expanded_element)
        ? element.expanded_element[0]
        : element.expanded_element;
      questions.push({
        question,
        url: webUrl(expanded?.url),
        domain: typeof expanded?.domain === 'string' ? expanded.domain : null,
      });
    }
  }
  return { questions: questions.slice(0, MAX_PAA_QUESTIONS), at };
}

/**
 * YouTube's results for the keyword (SERP YouTube organic, advanced): the
 * videos read (youtube_video, the first 20 results), their views summed, the
 * most viewed, and how many results YouTube says it has (se_results_count).
 */
export function youtubeSignal(result, at) {
  const videos = (result?.items ?? []).filter((item) => item?.type === 'youtube_video');
  let views = 0;
  let top = null;
  for (const video of videos) {
    const count = Number(video.views_count) || 0;
    views += count;
    if (!top || count > top.views) {
      top = {
        title: String(video.title ?? '').slice(0, 300),
        url: webUrl(video.url),
        channel: typeof video.channel_name === 'string' ? video.channel_name : null,
        views: count,
        published: typeof video.timestamp === 'string' ? video.timestamp : null,
      };
    }
  }
  const results = Number(result?.se_results_count);
  return {
    videos: videos.length,
    views,
    results: Number.isFinite(results) && results > 0 ? results : null,
    top,
    at,
  };
}

// ─── The DataForSEO tasks ───────────────────────────────────────────────────

/**
 * Each paid signal's endpoint: where its tasks are set, listed when done and
 * read, what a task asks (null: this keyword can't be asked) and how its
 * result is read.
 */
export const SOURCES = Object.freeze({
  trends: {
    path: '/v3/keywords_data/google_trends/explore',
    getPath: (id) => `/v3/keywords_data/google_trends/explore/task_get/${id}`,
    task: ({ keyword, locationCode, languageCode, tag }) => {
      const asked = trendsKeyword(keyword);
      if (!asked) return null;
      return {
        keywords: [asked],
        // Worldwide when the analysis had no location.
        ...(locationCode ? { location_code: locationCode } : {}),
        language_code: languageCode || DEFAULT_LANGUAGE_CODE,
        type: 'web',
        time_range: 'past_12_months',
        item_types: ['google_trends_graph'],
        tag,
      };
    },
    read: trendsSignal,
  },
  paa: {
    path: '/v3/serp/google/organic',
    getPath: (id) => `/v3/serp/google/organic/task_get/advanced/${id}`,
    task: ({ keyword, locationCode, languageCode, tag }) => ({
      keyword: keyword.slice(0, 700),
      location_code: locationCode || DEFAULT_LOCATION_CODE,
      language_code: languageCode || DEFAULT_LANGUAGE_CODE,
      device: 'desktop',
      depth: 10,
      tag,
    }),
    read: paaSignal,
  },
  youtube: {
    path: '/v3/serp/youtube/organic',
    getPath: (id) => `/v3/serp/youtube/organic/task_get/advanced/${id}`,
    task: ({ keyword, locationCode, languageCode, tag }) => ({
      keyword: keyword.slice(0, 700),
      location_code: locationCode || DEFAULT_LOCATION_CODE,
      language_code: languageCode || DEFAULT_LANGUAGE_CODE,
      block_depth: 20,
      tag,
    }),
    read: youtubeSignal,
  },
});

/**
 * A prompt is due again once its paid signals were set REFRESH_DAYS ago, or
 * for a new keyword. Never while its tasks wait, or while another sweep's
 * claim on it holds (CLAIM_STALE_MINUTES).
 */
export function isDue(row, keyword, now) {
  if (!row) return true;
  if (row.tasks) return false;
  if (row.claimed_at && now - Date.parse(row.claimed_at) < CLAIM_STALE_MINUTES * 60_000) {
    return false;
  }
  if (row.keyword !== keyword.keyword) return true;
  if (!row.posted_at) return true;
  return now - Date.parse(row.posted_at) >= REFRESH_DAYS * DAY_MS;
}

/** Never read first, then the longest waiting; at most `limit`. */
export function pickDue(candidates, limit = NIGHTLY_LIMIT) {
  const at = (c) => (c.postedAt ? Date.parse(c.postedAt) || 0 : null);
  return [...candidates]
    .sort((a, b) => {
      const x = at(a);
      const y = at(b);
      if (x === null || y === null) return (x === null ? 0 : 1) - (y === null ? 0 : 1);
      return x - y;
    })
    .slice(0, limit);
}

/** Runs `fn` over `items`, `concurrency` at a time. */
async function eachLimited(items, concurrency, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/** Postgres' foreign key violation: here, a prompt deleted since it was read. */
const FOREIGN_KEY_VIOLATION = '23503';

/** The ids, of those given, whose prompts are still there. */
async function existingPromptIds(ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('prompts')
      .select('id')
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (error) throw new Error(`prompts read failed: ${error.message}`);
    for (const row of data ?? []) found.add(row.id);
  }
  return found;
}

/**
 * Writes the rows, WRITE_CHUNK at a time. A prompt deleted since it was read
 * fails its whole chunk (the foreign key): the chunk is written again
 * without the prompts that are gone, so the others' reads (paid for) aren't
 * lost with it.
 */
async function upsertRows(rows) {
  const write = async (chunk) =>
    (await supabaseAdmin.from('prompt_demand').upsert(chunk, { onConflict: 'prompt_id' })).error;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    let error = await write(chunk);
    if (error?.code === FOREIGN_KEY_VIOLATION) {
      const kept = await existingPromptIds(chunk.map((r) => r.prompt_id));
      const left = chunk.filter((r) => kept.has(r.prompt_id));
      logger.warn(
        { promptIds: chunk.filter((r) => !kept.has(r.prompt_id)).map((r) => r.prompt_id) },
        '[prompt-demand] rows of deleted prompts not written',
      );
      error = left.length ? await write(left) : null;
    }
    if (error) throw new Error(`prompt demand write failed: ${error.message}`);
  }
}

/**
 * Claims the prompts due before their tasks are set (prompt_demand_claim):
 * only those claimed are set, so a second sweep running at once sets none
 * of them again.
 */
async function claimDue(due) {
  const { data, error } = await supabaseAdmin.rpc('prompt_demand_claim', {
    p_rows: due.map((d) => ({ prompt_id: d.promptId, brand_id: d.brandId })),
    p_stale_minutes: CLAIM_STALE_MINUTES,
  });
  if (error) throw new Error(`prompt demand claim failed: ${error.message}`);
  const claimed = new Set(Array.isArray(data) ? data : []);
  return due.filter((d) => claimed.has(d.promptId));
}

/**
 * Sets the paid signals' tasks for the prompts due: one task per signal and
 * prompt, tagged with the prompt's id. The prompts are claimed first, and
 * only those claimed are set (claimDue). Each request's task ids are
 * written as soon as it's back, so a failure later on loses none that were
 * paid for. A request that fails is set again next week; a prompt none
 * could be set for stays due once its claim lapses.
 *
 * @param {Array<{ promptId: string, brandId: string, keyword: string, locationCode: number|null, languageCode: string|null }>} due
 * @returns {Promise<number>} prompts with at least one task set
 */
export async function postDemandTasks(due, { now = Date.now() } = {}) {
  if (due.length === 0) return 0;
  const claimed = await claimDue(due);
  if (claimed.length === 0) return 0;
  const at = new Date(now).toISOString();
  const byPrompt = new Map(claimed.map((d) => [d.promptId, d]));
  // What each prompt's row holds so far: a request's ids are added to it.
  const rows = new Map();
  for (const name of PAID_SIGNALS) {
    const source = SOURCES[name];
    const tasks = claimed.map((d) => source.task({ ...d, tag: d.promptId })).filter(Boolean);
    if (tasks.length === 0) continue;
    const { failed, errors } = await postTasks(source.path, tasks, {
      onChunk: async (ids) => {
        const written = [];
        for (const [promptId, id] of ids) {
          const d = byPrompt.get(promptId);
          if (!d) continue;
          const row = rows.get(promptId) ?? {
            prompt_id: d.promptId,
            brand_id: d.brandId,
            keyword: d.keyword,
            location_code: d.locationCode,
            language_code: d.languageCode,
            tasks: { posted_at: at, trends: null, paa: null, youtube: null },
            posted_at: at,
          };
          const next = { ...row, tasks: { ...row.tasks, [name]: id } };
          rows.set(promptId, next);
          written.push(next);
        }
        await upsertRows(written);
      },
    });
    if (failed > 0) {
      logger.warn({ signal: name, failed, errors }, '[prompt-demand] tasks not set');
    }
  }
  return rows.size;
}

const DEMAND_ROW_COLUMNS =
  'prompt_id, brand_id, gsc, trends, paa, youtube, tasks, posted_at, level';

/** The prompt_demand rows with tasks waiting, paged. */
async function waitingRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('prompt_demand')
      .select(DEMAND_ROW_COLUMNS)
      .not('tasks', 'is', null)
      .order('prompt_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`prompt demand read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Done tasks no row knows: set, and their ids never written (a request that
 * timed out after DataForSEO took it, a write that failed). Their tag is
 * their prompt's id, so each goes back to its prompt's row, where that
 * signal has no task waiting. Rows already waiting are given theirs in
 * place; the rest are read and returned.
 */
async function orphanRows(ready, waiting) {
  const known = new Set();
  for (const row of waiting) {
    for (const name of PAID_SIGNALS) if (row.tasks?.[name]) known.add(row.tasks[name]);
  }
  const byPrompt = new Map(waiting.map((r) => [r.prompt_id, r]));
  const found = new Map();
  for (const name of PAID_SIGNALS) {
    for (const [id, tag] of ready[name]) {
      if (known.has(id) || !tag || !UUID.test(tag)) continue;
      const row = byPrompt.get(tag);
      if (row) {
        if (!row.tasks[name]) row.tasks = { ...row.tasks, [name]: id };
        continue;
      }
      found.set(tag, { ...found.get(tag), [name]: id });
    }
  }
  if (found.size === 0) return [];
  const ids = [...found.keys()];
  const rows = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('prompt_demand')
      .select(DEMAND_ROW_COLUMNS)
      .in('prompt_id', ids.slice(i, i + ID_CHUNK));
    if (error) throw new Error(`prompt demand read failed: ${error.message}`);
    for (const row of data ?? []) {
      rows.push({
        ...row,
        tasks: { posted_at: row.posted_at ?? null, ...row.tasks, ...found.get(row.prompt_id) },
      });
    }
  }
  return rows;
}

/**
 * Reads the tasks that are done: each endpoint's ready list first, then
 * each of ours on it, and the done ones no row knew (orphanRows). A task
 * older than TASK_EXPIRE_DAYS is read whether listed or not, and given up
 * if it still has nothing; the prompt is set again when it's next due. The
 * level is worked out again for each prompt read; `brands` are those where
 * a level changed. Workspaces whose plan has ended are left out.
 *
 * @returns {Promise<{ read: number, waiting: number, brands: string[], skipped?: 'off' }>}
 */
export async function collectDemandTasks({ now = Date.now() } = {}) {
  if (!paidSignalsEnabled()) return { read: 0, waiting: 0, brands: [], skipped: 'off' };
  const ready = {};
  for (const name of PAID_SIGNALS) {
    try {
      ready[name] = await readyTasks(SOURCES[name].path);
    } catch (err) {
      ready[name] = new Map();
      logger.warn(
        { err: { message: err?.message }, signal: name },
        '[prompt-demand] ready list not read',
      );
    }
  }
  const waitingNow = await waitingRows();
  const rows = [...waitingNow, ...(await orphanRows(ready, waitingNow))];
  if (rows.length === 0) return { read: 0, waiting: 0, brands: [] };
  const isActive = await activeBrandFilter(rows.map((r) => r.brand_id));
  const mine = rows.filter((r) => isActive(r.brand_id));
  if (mine.length === 0) return { read: 0, waiting: 0, brands: [] };

  const at = new Date(now).toISOString();
  const writes = [];
  const brands = new Set();
  let waiting = 0;
  await eachLimited(mine, READ_CONCURRENCY, async (row) => {
    const tasks = { ...row.tasks };
    const next = {
      prompt_id: row.prompt_id,
      brand_id: row.brand_id,
      gsc: row.gsc,
      trends: row.trends,
      paa: row.paa,
      youtube: row.youtube,
    };
    const expired = now - (Date.parse(tasks.posted_at ?? '') || 0) >= TASK_EXPIRE_DAYS * DAY_MS;
    let changed = false;
    for (const name of PAID_SIGNALS) {
      const id = tasks[name];
      if (!id) continue;
      if (!ready[name].has(id) && !expired) continue;
      try {
        const got = await getTask(SOURCES[name].getPath(id));
        if (got.status === 'pending' && !expired) continue;
        if (got.status === 'done') next[name] = SOURCES[name].read(got.result, at);
      } catch (err) {
        logger.warn(
          { err: { message: err?.message }, signal: name, promptId: row.prompt_id },
          '[prompt-demand] task not read',
        );
        if (!expired) continue;
      }
      tasks[name] = null;
      changed = true;
    }
    const left = PAID_SIGNALS.some((name) => tasks[name]);
    if (left) waiting += 1;
    if (!changed) return;
    const { level, signals } = demandLevel(next);
    if (level !== (row.level ?? null)) brands.add(row.brand_id);
    writes.push({
      ...next,
      tasks: left ? tasks : null,
      level,
      signals,
      updated_at: at,
    });
  });
  await upsertRows(writes);
  return { read: writes.length, waiting, brands: [...brands] };
}

/**
 * The brands whose demand levels changed, their open actions scored again
 * (AC-006): the priority reads the levels, and shows the change the same
 * night. Best effort, one brand at a time. An action whose score comes out
 * as stored isn't written again (rescoreBrandActions).
 *
 * @returns {Promise<number>} actions whose scores changed
 */
export async function rescoreDemandBrands(brandIds, { now = Date.now() } = {}) {
  let scored = 0;
  for (const brandId of new Set(brandIds)) {
    try {
      scored += await rescoreBrandActions(brandId, { now: new Date(now) });
    } catch (err) {
      logger.warn(
        { err: { message: err?.message }, brandId },
        '[prompt-demand] actions not scored again',
      );
    }
  }
  return scored;
}

// ─── The nightly sweep ──────────────────────────────────────────────────────

/** A select paged past PostgREST's 1,000 rows. */
async function selectAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) return rows;
  }
}

async function activePrompts(brandId) {
  const rows = await selectAll(() =>
    supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .eq('is_active', true)
      .order('id', { ascending: true }),
  );
  return rows.map((r) => ({ id: r.id, text: r.text }));
}

async function brandDemandRows(brandId) {
  return selectAll(() =>
    supabaseAdmin
      .from('prompt_demand')
      .select('*')
      .eq('brand_id', brandId)
      .order('prompt_id', { ascending: true }),
  );
}

/** Each prompt's newest volume analysis. */
async function promptVolumes(promptIds) {
  const volumes = new Map();
  for (let i = 0; i < promptIds.length; i += ID_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('prompt_volumes')
      .select('prompt_id, google_volumes, location_code, language_code, fetched_at')
      .in('prompt_id', promptIds.slice(i, i + ID_CHUNK))
      .order('fetched_at', { ascending: false });
    if (error) throw new Error(`prompt volumes read failed: ${error.message}`);
    for (const row of data ?? []) if (!volumes.has(row.prompt_id)) volumes.set(row.prompt_id, row);
  }
  return volumes;
}

/**
 * One brand's night: each active prompt's Search Console demand and level
 * written where they changed, and the prompts whose paid signals are due.
 * Rows are only made for a prompt with something read. `levelsChanged`:
 * a prompt's level is not what it was.
 */
export async function refreshBrandDemand(brand, { now = Date.now(), paid = false } = {}) {
  const prompts = await activePrompts(brand.id);
  if (prompts.length === 0) return { written: 0, due: [], levelsChanged: false };
  const at = new Date(now).toISOString();
  const [existing, gsc, volumes] = await Promise.all([
    brandDemandRows(brand.id).then((rows) => new Map(rows.map((r) => [r.prompt_id, r]))),
    brand.gsc_property
      ? readGscQueries(brand.id, now).then((queries) => gscDemand(queries, prompts, at))
      : null,
    paid ? promptVolumes(prompts.map((p) => p.id)) : new Map(),
  ]);

  const writes = [];
  const due = [];
  let levelsChanged = false;
  for (const prompt of prompts) {
    const row = existing.get(prompt.id);
    const signals = {
      gsc: gsc?.get(prompt.id) ?? null,
      trends: row?.trends ?? null,
      paa: row?.paa ?? null,
      youtube: row?.youtube ?? null,
    };
    const level = demandLevel(signals);
    if (level.level !== (row?.level ?? null)) levelsChanged = true;
    // Search Console is read again every night, and says so (its `at`).
    const changed =
      signals.gsc !== null ||
      (row
        ? row.gsc !== null || row.level !== level.level || row.signals !== level.signals
        : level.signals > 0);
    if (changed) {
      writes.push({
        prompt_id: prompt.id,
        brand_id: brand.id,
        gsc: signals.gsc,
        level: level.level,
        signals: level.signals,
        updated_at: at,
      });
    }
    if (paid) {
      const keyword = topKeyword(volumes.get(prompt.id));
      if (keyword && isDue(row, keyword, now)) {
        due.push({
          promptId: prompt.id,
          brandId: brand.id,
          ...keyword,
          postedAt: row?.posted_at ?? null,
        });
      }
    }
  }
  await upsertRows(writes);
  return { written: writes.length, due, levelsChanged };
}

/**
 * When each brand's rows were last written (prompt_demand_brand_updates),
 * as times. A brand with none isn't in it. When it can't be read, every
 * brand counts as never written: the night goes in the brands' id order.
 */
async function brandUpdates() {
  const { data, error } = await supabaseAdmin.rpc('prompt_demand_brand_updates');
  if (error) {
    logger.warn({ err: { message: error.message } }, '[prompt-demand] brand order not read');
    return new Map();
  }
  return new Map(Object.entries(data ?? {}).map(([brandId, at]) => [brandId, Date.parse(at) || 0]));
}

/** The brands never written first, then the longest since their last write. */
export function sweepOrder(brands, updates) {
  // A time is 0 or more: never written (-1) goes first.
  const at = (brand) => updates.get(brand.id) ?? -1;
  return [...brands].sort((a, b) => at(a) - at(b) || String(a.id).localeCompare(String(b.id)));
}

/**
 * The night's demand (server.js daily run): last night's tasks read, every
 * active brand's prompts matched to its Search Console queries and their
 * levels kept, then the paid signals set for the prompts due, the
 * NIGHTLY_LIMIT waiting longest. The brands whose levels changed have
 * their actions scored again. Brands whose workspace's plan has ended are
 * skipped; one brand's failure is logged and the rest go on.
 *
 * The brands go in sweepOrder, for SWEEP_DEADLINE_MS at most: the ones not
 * reached are `unfinished`, logged, and go first the next night. `due`:
 * the prompts whose paid signals were due, before the cap.
 *
 * @returns {Promise<{ brands: number, written: number, skipped: number, failed: number, unfinished: number, due: number, posted: number, read: number, rescored: number, paid: boolean }>}
 */
export async function sweepPromptDemand({
  now = Date.now(),
  limit = NIGHTLY_LIMIT,
  deadlineMs = SWEEP_DEADLINE_MS,
} = {}) {
  const paid = paidSignalsEnabled();
  const outcome = {
    brands: 0,
    written: 0,
    skipped: 0,
    failed: 0,
    unfinished: 0,
    due: 0,
    posted: 0,
    read: 0,
    rescored: 0,
    paid,
  };
  const changed = new Set();

  if (paid) {
    try {
      const collected = await collectDemandTasks({ now });
      outcome.read = collected.read;
      for (const id of collected.brands) changed.add(id);
    } catch (err) {
      logger.error({ err: { message: err?.message } }, '[prompt-demand] tasks not collected');
    }
  }

  const { data: brands, error } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, gsc_property')
    .eq('is_active', true)
    // A demo brand's prompts (00380) are sample data: nothing is read or paid for them.
    .eq('is_demo', false);
  if (error) throw new Error(`brands read failed: ${error.message}`);
  const isActive = await activeOrgFilter((brands ?? []).map((b) => b.organization_id));
  const active = (brands ?? []).filter((b) => isActive(b.organization_id));
  outcome.skipped = (brands ?? []).length - active.length;
  const ordered = sweepOrder(active, await brandUpdates());

  const due = [];
  const started = Date.now();
  for (const [i, brand] of ordered.entries()) {
    if (Date.now() - started > deadlineMs) {
      outcome.unfinished = ordered.length - i;
      break;
    }
    try {
      const result = await refreshBrandDemand(brand, { now, paid });
      outcome.brands += 1;
      outcome.written += result.written;
      due.push(...result.due);
      if (result.levelsChanged) changed.add(brand.id);
    } catch (err) {
      outcome.failed += 1;
      logger.warn(
        { err: { message: err?.message }, brandId: brand.id },
        '[prompt-demand] a brand was not read',
      );
    }
  }

  if (outcome.unfinished > 0) {
    logger.warn(
      { unfinished: outcome.unfinished, brands: outcome.brands, deadlineMs },
      '[prompt-demand] sweep ran out of time: brands left for the next night',
    );
  }
  outcome.due = due.length;
  if (paid && due.length) outcome.posted = await postDemandTasks(pickDue(due, limit), { now });
  outcome.rescored = await rescoreDemandBrands([...changed], { now });
  logger.info(outcome, '[prompt-demand] nightly sweep done');
  return outcome;
}

/**
 * Reads tonight's tasks once they've had time to finish (COLLECT_DELAY_MS
 * after the sweep), so most prompts have their signals the same night.
 * What isn't done by then is read the next night.
 */
export function scheduleDemandCollect(delayMs = COLLECT_DELAY_MS) {
  if (!paidSignalsEnabled()) return null;
  const timer = setTimeout(() => {
    collectDemandTasks()
      .then(({ brands }) => rescoreDemandBrands(brands))
      .catch((err) =>
        logger.error({ err: { message: err?.message } }, '[prompt-demand] late collect failed'),
      );
  }, delayMs);
  timer.unref?.();
  return timer;
}

// ─── What the card reads ────────────────────────────────────────────────────

/**
 * A prompt's text as compared for "already tracked": case, accents,
 * punctuation and spacing don't count ("How do I track my brand in
 * ChatGPT?" is "how do i track my brand in chatgpt"). The web's +Track
 * makes the same check before it adds a question (frontend/src/lib/promptDemand.ts).
 */
export function questionKey(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The brand's prompts' texts, active or paused, as questionKey reads them. */
export async function brandPromptKeys(brandId) {
  const rows = await selectAll(() =>
    supabaseAdmin
      .from('prompts')
      .select('id, text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .order('id', { ascending: true }),
  );
  return new Set(rows.map((r) => questionKey(r.text)).filter(Boolean));
}

/**
 * What GET /api/prompts/:id/demand answers: the signals read, the level,
 * which tasks are still waiting, and what the card needs to say about a
 * missing signal: whether the prompt has a volume analysis and a keyword to
 * read the paid signals for, and whether they're read at all on this server.
 * Each People Also Ask question says whether the brand already tracks it
 * (`trackedKeys`, from brandPromptKeys), so its +Track isn't offered twice.
 */
export function demandResponse(
  row,
  volume,
  { paid = paidSignalsEnabled(), trackedKeys = new Set() } = {},
) {
  const keyword = topKeyword(volume);
  const paa = row?.paa
    ? {
        ...row.paa,
        questions: (row.paa.questions ?? []).map((q) => ({
          ...q,
          tracked: trackedKeys.has(questionKey(q.question)),
        })),
      }
    : null;
  return {
    level: row?.level ?? null,
    signals: row?.signals ?? 0,
    updatedAt: row?.updated_at ?? null,
    keyword: row?.keyword ?? keyword?.keyword ?? null,
    locationCode: row?.keyword ? (row.location_code ?? null) : (keyword?.locationCode ?? null),
    languageCode: row?.keyword ? (row.language_code ?? null) : (keyword?.languageCode ?? null),
    gsc: row?.gsc ?? null,
    trends: row?.trends ?? null,
    paa,
    youtube: row?.youtube ?? null,
    pending: Object.fromEntries(PAID_SIGNALS.map((name) => [name, Boolean(row?.tasks?.[name])])),
    hasVolume: Boolean(volume),
    hasKeyword: Boolean(keyword),
    paidSignals: paid,
  };
}
