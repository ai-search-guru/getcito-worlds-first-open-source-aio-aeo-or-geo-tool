import type { Json } from '@/types/supabase';

/**
 * Chat's data budgets on what a tool returns (CHAT-04 items 5–6, Rule 1): a
 * result over its share of the run's budget is made smaller on the server,
 * before the model sees it, never cut silently. In order: long texts in its
 * rows are shortened; then its longest lists keep their first rows (a series
 * oldest first: its latest), with how
 * many were left out (`{list}_more`) and what those rows add up to
 * (`{list}_rest`: "+132 more rows, 9% of citations"); only then is the rest
 * cut as text. Every cut says `truncated: true`. No model: the numbers are
 * the rows' own. Pure, so the engine and its tests share it.
 */

/** A long text in a row (an answer, a page's text) is shortened to this, when a result is over. */
export const TEXT_FIELD_CHARS = 400;

/** The count-like fields a rest line adds up: never a rate, a score or a position. */
const COUNT_FIELD =
  /(count|mentions|citations|answers|clicks|impressions|sessions|visits|volume|searched|times|results|prompts|rows|total|conversions|revenue)/i;
const NOT_A_COUNT =
  /(avg|average|rate|pct|percent|share|score|position|rank|ratio|delta|change|_id$|^id$)/i;
/** Fields a rest line names at most. */
const REST_FIELDS = 4;

export const toJson = (value: unknown): Json =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);

const size = (value: Json) => JSON.stringify(value).length;

/**
 * A text's first `max` UTF-16 units, never ending in half of a character
 * outside the BMP (an emoji): a lone surrogate makes the request body
 * invalid JSON for the model's API, which turns the step away.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}
const isRecord = (value: Json): value is Record<string, Json> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** A row's day (`date` or `day`), for a series. */
const dayOfRow = (row: Json | undefined): string | null => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const value = (row as Record<string, Json>).date ?? (row as Record<string, Json>).day;
  return typeof value === 'string' ? value : null;
};

/** A series oldest first (a trend's days or weeks): a cut keeps its latest rows, not its first. */
export function oldestFirst(list: readonly Json[]): boolean {
  const first = dayOfRow(list[0]);
  const last = dayOfRow(list[list.length - 1]);
  return first !== null && last !== null && first < last;
}

/**
 * What the left-out rows of a list add up to, for its count-like fields:
 * each field's sum and its share of the whole list's. Null when the rows
 * have no such field.
 */
export function restOf(all: Json[], kept: number, latest = false): Record<string, Json> | null {
  // Left out: the rows after the first `kept`, or (a series' latest kept) the ones before.
  const left = latest ? all.slice(0, all.length - kept) : all.slice(kept);
  const isLeft = (i: number) => (latest ? i < left.length : i >= kept);
  if (left.length === 0) return null;
  const fields = new Map<string, { rest: number; whole: number; seen: number }>();
  all.forEach((row, i) => {
    if (!isRecord(row)) return;
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if (!COUNT_FIELD.test(key) || NOT_A_COUNT.test(key)) continue;
      const field = fields.get(key) ?? { rest: 0, whole: 0, seen: 0 };
      field.whole += value;
      if (isLeft(i)) {
        field.rest += value;
        field.seen += 1;
      }
      fields.set(key, field);
    }
  });
  const named = [...fields.entries()]
    .filter(([, field]) => field.seen * 2 >= left.length && field.whole > 0)
    .slice(0, REST_FIELDS);
  if (named.length === 0) return null;
  const rest: Record<string, Json> = {};
  for (const [key, field] of named) {
    rest[key] = { sum: field.rest, share_pct: Math.round((field.rest / field.whole) * 100) };
  }
  return rest;
}

/** A copy with every string over `max` characters shortened; whether any was. */
function shortenTexts(value: Json, max: number): { value: Json; shortened: boolean } {
  let shortened = false;
  const walk = (node: Json, depth: number): Json => {
    if (typeof node === 'string') {
      if (node.length <= max) return node;
      shortened = true;
      return `${cutText(node, max - 1)}…`;
    }
    if (depth > 6 || !node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((item) => walk(item, depth + 1));
    const out: Record<string, Json> = {};
    for (const [key, field] of Object.entries(node)) {
      if (field !== undefined) out[key] = walk(field, depth + 1);
    }
    return out;
  };
  const out = walk(value, 0);
  return { value: out, shortened };
}

/** How many of a list's first items (its last, when `latest`) fit in `room` characters. */
function keepFitting(list: Json[], room: number, latest = false): number {
  let used = 2;
  let kept = 0;
  for (const item of latest ? [...list].reverse() : list) {
    const length = size(item) + 1;
    if (used + length > room) break;
    used += length;
    kept += 1;
  }
  return kept;
}

/** The kept rows: the first `kept`, or a series' latest. */
const keepOf = (list: Json[], kept: number, latest: boolean) =>
  latest ? list.slice(list.length - kept) : list.slice(0, kept);

/** How many a list now leaves out, adding to what an earlier cut said (null: unknown, stays so). */
function moreOf(prior: Json | undefined, dropped: number): Json {
  if (prior === null) return null;
  return (typeof prior === 'number' ? prior : 0) + dropped;
}

/**
 * A tool's output fitted to `maxChars` (CHAT-04 items 5–6): as it is when
 * it fits; else shortened texts, then cut lists with their rest lines, then
 * cut text, each saying `truncated: true`.
 */
export function fitResult(
  value: unknown,
  maxChars: number,
): { value: Json; chars: number; cut: boolean } {
  const json = toJson(value);
  if (size(json) <= maxChars) return { value: json, chars: size(json), cut: false };
  const done = (out: Json) => ({ value: out, chars: size(out), cut: true });

  // 1. Long texts in the rows.
  const short = shortenTexts(json, TEXT_FIELD_CHARS);
  const marked = (out: Json): Json =>
    isRecord(out)
      ? { ...out, truncated: true, ...(short.shortened ? { texts_shortened: true } : {}) }
      : out;
  if (short.shortened && isRecord(short.value) && size(marked(short.value)) <= maxChars) {
    return done(marked(short.value));
  }

  // 2. The longest lists, first rows kept (a series oldest first: its latest), the rest added up.
  const room = Math.max(0, maxChars - 300);
  const base = short.value;
  if (Array.isArray(base)) {
    const latest = oldestFirst(base);
    const kept = keepFitting(base, room, latest);
    const out: Record<string, Json> = {
      items: keepOf(base, kept, latest),
      more: base.length - kept,
    };
    const rest = restOf(base, kept, latest);
    if (rest) out.rest = rest;
    out.truncated = true;
    if (size(out) <= maxChars) return done(out);
  } else if (isRecord(base)) {
    const record = marked(base) as Record<string, Json>;
    const lists = Object.entries(base)
      .filter((entry): entry is [string, Json[]] => Array.isArray(entry[1]))
      .sort((a, b) => size(b[1]) - size(a[1]));
    for (const [key, list] of lists) {
      const others = size({ ...record, [key]: [], [`${key}_more`]: 0, [`${key}_rest`]: {} });
      const latest = oldestFirst(list);
      const kept = keepFitting(list, Math.max(0, room - others), latest);
      if (kept < list.length) {
        record[key] = keepOf(list, kept, latest);
        record[`${key}_more`] = moreOf(base[`${key}_more`], list.length - kept);
        const rest = restOf(list, kept, latest);
        if (rest) record[`${key}_rest`] = rest;
      }
      if (size(record) <= maxChars) return done(record);
    }
  }

  // 3. As text, within maxChars once escaped (its quotes and backslashes grow).
  const text = JSON.stringify(base);
  let cut = cutText(text, room);
  while (cut.length > 0 && size({ text: cut, truncated: true }) > maxChars) {
    cut = cutText(cut, cut.length - (size({ text: cut, truncated: true }) - maxChars));
  }
  return done({ text: cut, truncated: true });
}
