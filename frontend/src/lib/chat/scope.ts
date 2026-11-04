import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';
import type { PlanLimits } from '@/config/plans';
import { platformFamily, platformName } from '@/lib/signals/names';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { oldestFirst } from './fit';
import type { ChatTool } from './registry/defineTool';

/**
 * Chat's scope decisions, in one place (CHAT-04 items 2–4, Rule 1; CHAT-20
 * §7 "Platforms by plan"): which dates, platforms and how many rows a read
 * covers. The server sets them, not the model: a read with no dates gets the
 * last 30 days unless the person asked for all time, a plan that tracks some
 * platforms reads only those, and every list stops at its row limit and says
 * it was cut (`truncated`). The engine scopes each read here before it runs
 * (scopeRead) and cuts its rows after (capRows). Server only.
 */

/** A read with no dates covers this many days back (CHAT-04 item 2). */
export const DEFAULT_RANGE_DAYS = 30;

/** No list a model reads is longer than this (CHAT-04 Rule 1: "at most ~50 rows"). */
export const ROW_CAP = 50;

/**
 * Rows per read, by tool: `default` when the model names none, `max` the
 * most it may ask for. A tool with a `limit` input reads `default` (or what
 * the model asked, up to `max`); one without has its lists cut to `default`
 * after it runs. Tools not named here: ROW_CAP.
 */
export const ROW_LIMITS: Readonly<Record<string, { default: number; max: number }>> = {
  list_prompts: { default: 25, max: ROW_CAP },
  get_prompt_performance: { default: 10, max: ROW_CAP },
  get_prompt_volumes: { default: 25, max: ROW_CAP },
  get_prompt_insights: { default: 10, max: 24 },
  list_ai_answers: { default: 5, max: 9 },
  list_citations: { default: 20, max: ROW_CAP },
  list_action_center_tasks: { default: 10, max: ROW_CAP },
  list_signals: { default: 10, max: ROW_CAP },
  get_action_history: { default: 10, max: ROW_CAP },
  list_content_opportunities: { default: 10, max: ROW_CAP },
  get_reports: { default: 5, max: 20 },
  // What's new shows 3 updates at most (CHAT-11 item 10).
  get_whats_new: { default: 3, max: 3 },
  // No `limit` input: a page of up to 100 answers, cut after the read (CHAT-04 §B 20 / 100).
  list_mentions: { default: 20, max: 20 },
};

/**
 * The days a `days` read covers when the model names none: Google's
 * reads keep their pages' 28 days; anything else DEFAULT_RANGE_DAYS.
 */
export const DAYS_DEFAULTS: Readonly<Record<string, number>> = {
  get_gsc_summary: 28,
  get_ga_summary: 28,
};

/** The most days back a `days` read reaches, the Query Fan-out tab's 90 (promptOptions.ts). */
export const DAYS_MAX = 90;

// ─── All time ───────────────────────────────────────────────────────────────

const ALL_TIME = [
  /\ball[- ]time\b/i,
  /\bof all time\b/i,
  /\blifetime\b/i,
  /\bsince (?:we|i) (?:started|began|joined|signed up|launched)\b/i,
  /\bsince (?:the )?(?:start|beginning|launch|day one)\b/i,
  /\bfrom (?:the )?(?:start|beginning|day one)\b/i,
  /\bever since\b/i,
  /\b(?:whole|entire|full) history\b/i,
  /tüm zamanlar/i,
  /başından beri|baştan beri|en baştan/i,
  /başladığımız(?:dan)? beri|ilk günden beri/i,
  /şimdiye kadar|bugüne kadar/i,
  /(?:tüm|bütün) geçmiş/i,
];

/** The person asked for all of the data, not a recent window (CHAT-04 item 4). */
export function asksAllTime(question: string | null | undefined): boolean {
  return !!question && ALL_TIME.some((pattern) => pattern.test(question));
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

/** A date the model gave, as a timestamp; null when it isn't one. */
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/** How a read's dates were chosen, for its step and its record. */
export type DateChoice = 'asked' | 'default' | 'all_time' | 'days' | 'none';

interface DatesUsed {
  dateFrom: string | null;
  dateTo: string | null;
  dates: DateChoice;
  days?: number;
}

/**
 * A read's dates: the model's when it gave valid ones (a missing end is
 * today, a missing start the default window before the end, the end never
 * past today); none when the person asked for all time; else the last
 * DEFAULT_RANGE_DAYS.
 */
export function resolveDates(
  from: unknown,
  to: unknown,
  allTime: boolean,
  now: Date,
): Pick<DatesUsed, 'dateFrom' | 'dateTo' | 'dates'> & { values: Record<string, string> } {
  const today = now.getTime();
  let start = parseDate(from);
  let end = parseDate(to);
  if (start === null && end === null) {
    if (allTime) return { dateFrom: null, dateTo: null, dates: 'all_time', values: {} };
    const dateFrom = dayOf(today - DEFAULT_RANGE_DAYS * DAY_MS);
    const dateTo = dayOf(today);
    return { dateFrom, dateTo, dates: 'default', values: { date_from: dateFrom, date_to: dateTo } };
  }
  // The model's own strings where they stand, so a timestamp keeps its time.
  let fromText = start === null ? null : (from as string);
  let toText = end === null ? null : (to as string);
  if (start !== null && start > today) [start, fromText] = [today, dayOf(today)];
  if (end !== null && end > today) [end, toText] = [today, dayOf(today)];
  if (start !== null && end !== null && start > end) {
    [start, end] = [end, start];
    [fromText, toText] = [toText, fromText];
  }
  if (end === null) [end, toText] = [today, dayOf(today)];
  if (start === null && !allTime) fromText = dayOf(end - DEFAULT_RANGE_DAYS * DAY_MS);
  const values: Record<string, string> = { date_to: toText! };
  if (fromText) values.date_from = fromText;
  return { dateFrom: fromText, dateTo: toText, dates: 'asked', values };
}

// ─── Platforms ──────────────────────────────────────────────────────────────

/** The platforms a plan reads (CHAT-20 §7), as scraper ids and AI models; null for every one. */
export interface PlanPlatforms {
  /** The scraped apps it tracks ("chatgpt-web"). */
  scrapers: readonly string[];
  /** The API models it tracks ("claude-sonnet-5"). */
  models: readonly string[];
  /** Their engines ("openai", "copilot"): what a model slug or platform id is checked by. */
  families: ReadonlySet<string>;
  /** It keeps to some scraped apps, not all (Starter): a read with no platform is held to them. */
  someScrapers: boolean;
}

type PlatformLimits = Pick<PlanLimits, 'allowedScrapers' | 'allowedModels'>;

/** What the plan tracks; null when it tracks every platform and model (self-hosted). */
export function planPlatforms(limits: PlatformLimits | null | undefined): PlanPlatforms | null {
  if (!limits || (!limits.allowedScrapers && !limits.allowedModels)) return null;
  const scrapers = limits.allowedScrapers
    ? ALL_SCRAPERS.filter((s) => limits.allowedScrapers!.includes(s.id)).map((s) => s.id)
    : ALL_SCRAPERS.map((s) => s.id);
  const models = limits.allowedModels
    ? ALL_MODELS.filter((m) => limits.allowedModels!.includes(m.id)).map((m) => m.id)
    : ALL_MODELS.map((m) => m.id);
  const families = new Set<string>();
  for (const slug of [...scrapers, ...models]) {
    const family = platformFamily(slug);
    if (family) families.add(family);
  }
  return { scrapers, models, families, someScrapers: !!limits.allowedScrapers };
}

/** Whether the plan tracks a platform id or a model slug (by its engine). */
export function onPlan(plan: PlanPlatforms, slug: string): boolean {
  if (plan.scrapers.includes(slug) || plan.models.includes(slug)) return true;
  const family = platformFamily(slug);
  return family !== null && plan.families.has(family);
}

/** The plan's platforms by name, each once ("ChatGPT", "Microsoft Copilot"). */
export function planPlatformNames(plan: PlanPlatforms): string[] {
  return [...new Set([...plan.scrapers, ...plan.models].map(platformName))];
}

const slugsOf = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((slug) => slug.trim())
        .filter(Boolean)
    : [];

/**
 * The AI models a brand's answers name (prompt_results.model_used), which a
 * `model` filter matches: what holds a read to the plan's platforms. Null
 * when it can't be read: the read then fails rather than reading nothing.
 */
export async function brandModels(brandId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin.rpc('insights_filter_options', {
    p_brand_id: brandId,
  });
  if (error) {
    console.error('[chat/scope] could not read the brand’s models:', error.message);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { models?: unknown } | null;
  return Array.isArray(row?.models)
    ? row.models.filter((m): m is string => typeof m === 'string')
    : [];
}

// ─── A read's scope ─────────────────────────────────────────────────────────

/** The scope a read ran with, kept on its step (CHAT-04 item 4, `scope_json.used`). */
export interface ScopeUsed extends DatesUsed {
  /** The platforms the plan held it to (ids and models); null when it wasn't held. */
  platforms: string[] | null;
  /** The rows it asked for, or its lists were cut to. */
  rows: number;
}

/** A read the plan doesn't cover: the model says so, it doesn't run (CHAT-04 item 2). */
export interface NotOnPlan {
  code: 'not_on_plan';
  plan: string;
  /** What was asked for, by name. */
  asked: string[];
  /** What the plan tracks, by name. */
  on_plan: string[];
}

export interface ScopeFacts {
  /** The person's question: an all-time ask lifts the default window. */
  question: string | null | undefined;
  /** The plan's platform limits; null when they couldn't be read. */
  limits: PlatformLimits | null;
  planName: string;
  now?: Date;
  /** The brand's AI models (brandModels); a test's own. Null: they couldn't be read. */
  modelsOf?: (brandId: string) => Promise<readonly string[] | null>;
}

export type ScopedRead =
  | {
      kind: 'read';
      input: Record<string, unknown>;
      used: ScopeUsed;
      /** The step's platform names when the plan picked them; else the input's. */
      platformNames: string[] | null;
      /** The rows its lists are cut to, and whether a longer list means "more, count unknown". */
      cap: RowCap;
    }
  | { kind: 'not_on_plan'; result: NotOnPlan }
  /** The plan's platforms couldn't be matched to the brand's rows: not read, never read as empty. */
  | { kind: 'failed' };

export interface RowCap {
  rows: number;
  /** A list of this length was read one past the cap to see if there were more. */
  probe: number | null;
}

const hasField = (tool: Pick<ChatTool, 'inputSchema'>, field: string) =>
  field in (tool.inputSchema.shape as Record<string, unknown>);

/** Whether the tool's input takes these values (its schema's own limits). */
const accepts = (tool: Pick<ChatTool, 'inputSchema'>, input: Record<string, unknown>) =>
  tool.inputSchema.safeParse(input).success;

/**
 * A read's input with the server's scope (CHAT-04 item 4): its dates, its
 * platforms and its rows. A platform the plan doesn't track is refused
 * (`not_on_plan`) rather than read empty or read anyway.
 */
export async function scopeRead(
  tool: Pick<ChatTool, 'name' | 'inputSchema' | 'planGate'>,
  raw: Record<string, unknown>,
  facts: ScopeFacts,
): Promise<ScopedRead> {
  const now = facts.now ?? new Date();
  const allTime = asksAllTime(facts.question);
  const input: Record<string, unknown> = { ...raw };

  // Platforms: what was asked must be on the plan; nothing asked, the plan's.
  const plan = planPlatforms(facts.limits);
  let platforms: string[] | null = null;
  let platformNames: string[] | null = null;
  if (plan) {
    for (const field of ['platform', 'model'] as const) {
      if (!hasField(tool, field)) continue;
      const asked = slugsOf(input[field]);
      if (asked.length === 0) continue;
      const kept = asked.filter((slug) => onPlan(plan, slug));
      if (kept.length === 0) {
        return {
          kind: 'not_on_plan',
          result: {
            code: 'not_on_plan',
            plan: facts.planName,
            asked: [...new Set(asked.map(platformName))],
            on_plan: planPlatformNames(plan),
          },
        };
      }
      if (kept.length < asked.length) input[field] = kept.join(',');
      platforms = kept;
    }
    // A read that names no platform, on a plan that tracks some: held to the plan's.
    if (!platforms && plan.someScrapers && tool.planGate?.platforms && hasField(tool, 'model')) {
      const seen =
        input.brand_id && facts.modelsOf ? await facts.modelsOf(String(input.brand_id)) : [];
      // Not read: holding to the plan's ids below would make the read come back empty.
      if (seen === null) return { kind: 'failed' };
      const own = seen.filter((slug) => onPlan(plan, slug));
      // None of theirs seen yet: the plan's own ids, which match its rows or none.
      platforms = own.length > 0 ? own : [...plan.scrapers, ...plan.models];
      input.model = platforms.join(',');
      platformNames = planPlatformNames(plan);
    }
  }

  // Dates.
  let dates: DatesUsed = { dateFrom: null, dateTo: null, dates: 'none' };
  if (hasField(tool, 'date_from') || hasField(tool, 'date_to')) {
    const resolved = resolveDates(input.date_from, input.date_to, allTime, now);
    delete input.date_from;
    delete input.date_to;
    for (const [key, value] of Object.entries(resolved.values)) {
      if (hasField(tool, key)) input[key] = value;
    }
    dates = { dateFrom: resolved.dateFrom, dateTo: resolved.dateTo, dates: resolved.dates };
  } else if (hasField(tool, 'days')) {
    const asked = typeof input.days === 'number' ? input.days : null;
    const days = asked ?? (allTime ? DAYS_MAX : (DAYS_DEFAULTS[tool.name] ?? DEFAULT_RANGE_DAYS));
    const fits = accepts(tool, { ...input, days }) ? days : DEFAULT_RANGE_DAYS;
    input.days = fits;
    dates = {
      dateFrom: dayOf(now.getTime() - fits * DAY_MS),
      dateTo: dayOf(now.getTime()),
      dates: asked === null && allTime ? 'all_time' : 'days',
      days: fits,
    };
  }

  // Rows: the model's count, held to the tool's max; one more read to see if there are more.
  const limits = ROW_LIMITS[tool.name];
  let cap: RowCap = { rows: limits?.default ?? ROW_CAP, probe: null };
  if (hasField(tool, 'limit')) {
    const max = limits?.max ?? ROW_CAP;
    const asked = typeof input.limit === 'number' ? input.limit : null;
    const rows = Math.max(1, Math.min(asked ?? limits?.default ?? ROW_CAP, max));
    const probe = rows + 1;
    const probes = accepts(tool, { ...input, limit: probe });
    input.limit = probes ? probe : rows;
    cap = { rows, probe: probes ? probe : null };
  }

  return {
    kind: 'read',
    input,
    used: { ...dates, platforms, rows: cap.rows },
    platformNames,
    cap,
  };
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/** Cuts one list; how many it left out, null when a probe says "more" without a count. */
function cutList(list: Json[], cap: RowCap): { items: Json[]; more: number | null } | null {
  if (list.length <= cap.rows) return null;
  const more = cap.probe !== null && list.length === cap.probe ? null : list.length - cap.rows;
  const items = oldestFirst(list) ? list.slice(-cap.rows) : list.slice(0, cap.rows);
  return { items, more };
}

/**
 * A read's output with every list cut to its row limit (CHAT-04 item 6):
 * the first rows (a series oldest first: its latest), `{list}_more` (how
 * many were left out; null when there
 * were more but their count isn't known) and `truncated: true`. Lists one
 * level down (a `totals` or `data` object's) are cut too; lists inside rows
 * stay as they are.
 */
export function capRows(value: Json, cap: RowCap): { value: Json; cut: boolean } {
  if (Array.isArray(value)) {
    const cut = cutList(value, cap);
    return cut
      ? { value: { items: cut.items, more: cut.more, truncated: true }, cut: true }
      : { value, cut: false };
  }
  if (!value || typeof value !== 'object') return { value, cut: false };
  let cut = false;
  const capObject = (record: Record<string, Json>, depth: number): Record<string, Json> => {
    const out: Record<string, Json> = { ...record };
    for (const [key, field] of Object.entries(record)) {
      if (Array.isArray(field)) {
        const list = cutList(field, cap);
        if (!list) continue;
        out[key] = list.items;
        out[`${key}_more`] = list.more;
        cut = true;
      } else if (depth === 0 && field && typeof field === 'object') {
        out[key] = capObject(field as Record<string, Json>, depth + 1);
      }
    }
    return out;
  };
  const capped = capObject(value as Record<string, Json>, 0);
  if (cut) capped.truncated = true;
  return { value: cut ? capped : value, cut };
}
