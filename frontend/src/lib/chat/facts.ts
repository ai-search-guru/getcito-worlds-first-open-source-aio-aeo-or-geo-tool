import type { Json } from '@/types/supabase';

/**
 * Chat's fact check on its answers (CHAT-05 item 11, CHAT-20 §19
 * "Groundedness"): every figure in an answer must come from this run's
 * reads, the person's words or the chat so far. A figure that doesn't is
 * taken out and a placeholder put in its place ("[real metric]",
 * "[price]"), before the text reaches the browser, and the run records it.
 *
 * What a figure is, and the placeholders, mirror the Site Audit's
 * recommendation guard (backend/src/lib/audit/recommendationGuard.js:
 * VALUE_RE, MASK_RE, PLACEHOLDER): the web can't import the API server's
 * code, so keep the two in sync (facts.test.ts checks the placeholders
 * against it). What differs is what counts as known: an answer works
 * figures out of what it read, so a figure is known when it is one read
 * (rounded as the answer writes it), a column's total or average, a list's
 * length, or, inside one row or one column, a difference, a percent change
 * or a share; small counts (0–10), numbering ("Step 2", "1."), dates,
 * times, this or last year and names with a number ("Claude 3.5") pass.
 *
 * Chat's own, not the audit's: a figure written with a time unit ("the last
 * 30 days", "a 30-day window", "son 30 gün", "14 months old") is a period,
 * not a metric. It is known, too, when it is one of the app's own periods
 * (a read's 30 days), a span one read states (its date_from to date_to,
 * its first to its last date) or the age today of a read's first or last
 * date, in days, weeks, months or years as the answer rounds it. Any other
 * duration ("cited within 45 days") is checked as before. A word or
 * character count ("80-word", "155 characters") is known, too, when a
 * loaded skill sets it as a target.
 * Pure.
 */

/** Mirrors recommendationGuard.js' PLACEHOLDER (the ones an answer uses). */
export const PLACEHOLDER = {
  metric: '[real metric]',
  price: '[price]',
  date: '[date]',
} as const;

// ─── What the run knows ─────────────────────────────────────────────────────

export interface KnownFigures {
  /** Every number read, said or worked out from a column. */
  values: ReadonlySet<number>;
  /** Numbers that belong together, a row's or a column's: what may be compared. */
  groups: readonly (readonly number[])[];
  /**
   * Days a period may name: the app's periods, the spans one source states
   * and its first and last date's age today.
   */
  spans: ReadonlySet<number>;
  /** Word and character counts a loaded skill sets as targets. */
  targets: ReadonlySet<number>;
}

/** Values kept, at most, and groups: a run's reads are capped well under this. */
const MAX_VALUES = 20_000;
const MAX_GROUPS = 500;
const MAX_GROUP = 50;

const DIGITS = /\d+(?:[.,]\d+)*/g;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

// Keys an object states a range's two ends under (a read's input, the page's scope).
const RANGE_KEYS = [
  ['date_from', 'date_to'],
  ['from', 'to'],
] as const;

// A date written in full: "2025-02-14" (a timestamp's too), "February 14, 2025", "14 Feb 2025".
const FULL_DATE_RE = new RegExp(
  [
    String.raw`\b(\d{4})-(\d{2})-(\d{2})(?!\d)`,
    String.raw`\b(${MONTH})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
    String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH})\.?,?\s+(\d{4})\b`,
  ].join('|'),
  'gi',
);

/** The day of each full date in a text. */
function datesIn(text: string): number[] {
  const days: number[] = [];
  for (const m of text.matchAll(FULL_DATE_RE)) {
    const day = m[1]
      ? dayOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : m[4]
        ? dayOf(Number(m[6]), monthOf(m[4]), Number(m[5]))
        : dayOf(Number(m[9]), monthOf(m[8]), Number(m[7]));
    if (day !== null) days.push(day);
  }
  return days;
}

/** A date's day (days since 1970-01-01), or null when there is no such day. */
function dayOf(year: number, month: number, day: number): number | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const at = Date.UTC(year, month, day);
  return new Date(at).getUTCDate() === day ? at / DAY_MS : null;
}

const monthOf = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase());

/** A digit group as a number: "1,234" → 1234, "12.5" → 12.5, "12,5" → 12.5 (a decimal comma). */
export function parseFigure(raw: string): number | null {
  let text = raw;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(',', '.');
  else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(text)) text = text.replace(/\./g, '');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * The figures a run may state: from its reads' JSON (numbers, numbers in
 * texts, list lengths, each column's total and average, rows and columns as
 * groups) and from texts (the question, the chat so far). The spans a
 * period may name: `periods` (the app's, in days), the ranges a source
 * states under RANGE_KEYS, its first to its last date, and those two
 * dates' age on `now`. Never every pair of a source's dates: a daily series
 * would make almost any number of days known.
 */
export function knownFigures(
  sources: readonly unknown[],
  options: { periods?: readonly number[]; now?: Date } = {},
): KnownFigures {
  const values = new Set<number>();
  const groups: number[][] = [];
  const spans = new Set<number>(options.periods);
  let first = Infinity;
  let last = -Infinity;
  const add = (n: number) => {
    if (Number.isFinite(n) && values.size < MAX_VALUES) values.add(n);
  };
  const addText = (text: string) => {
    for (const match of text.matchAll(DIGITS)) {
      const n = parseFigure(match[0]);
      if (n !== null) add(n);
    }
    for (const day of datesIn(text)) {
      first = Math.min(first, day);
      last = Math.max(last, day);
    }
  };
  const addRanges = (node: Record<string, unknown>) => {
    for (const [fromKey, toKey] of RANGE_KEYS) {
      const from = node[fromKey];
      const to = node[toKey];
      if (typeof from !== 'string' || typeof to !== 'string') continue;
      const [start] = datesIn(from);
      const [end] = datesIn(to);
      if (start !== undefined && end !== undefined) spans.add(Math.abs(end - start));
    }
  };
  const group = (list: number[]) => {
    if (list.length > 1 && groups.length < MAX_GROUPS) groups.push(list.slice(0, MAX_GROUP));
  };
  const walk = (node: unknown, depth: number) => {
    if (typeof node === 'number') return add(node);
    if (typeof node === 'string') return addText(node);
    if (depth > 10 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      add(node.length);
      const columns = new Map<string, number[]>();
      for (const item of node) {
        walk(item, depth + 1);
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          for (const [key, field] of Object.entries(item)) {
            if (typeof field !== 'number' || !Number.isFinite(field)) continue;
            const column = columns.get(key) ?? [];
            column.push(field);
            columns.set(key, column);
          }
        }
      }
      for (const column of columns.values()) {
        const total = column.reduce((sum, n) => sum + n, 0);
        add(total);
        add(total / column.length);
        group([...column, total]);
      }
      return;
    }
    addRanges(node as Record<string, unknown>);
    const siblings: number[] = [];
    for (const field of Object.values(node as Record<string, unknown>)) {
      if (typeof field === 'number' && Number.isFinite(field)) siblings.push(field);
      walk(field, depth + 1);
    }
    group(siblings);
  };
  const today = Math.floor((options.now ?? new Date()).getTime() / DAY_MS);
  for (const source of sources) {
    first = Infinity;
    last = -Infinity;
    walk(source, 0);
    // Within one source only, as a row's or a column's numbers are compared.
    if (first > last) continue;
    spans.add(last - first);
    spans.add(Math.abs(today - first));
    spans.add(Math.abs(today - last));
  }
  return { values, groups, spans, targets: new Set() };
}

// ─── Figures in an answer ───────────────────────────────────────────────────

// Mirrors recommendationGuard.js' MASK_RE: URLs, domains and placeholders stay as they are.
const PLACEHOLDER_SOURCE = String.raw`\[[A-Za-z][A-Za-z ]{1,38}\]`;
const MASK_RE = new RegExp(
  [
    String.raw`\bhttps?:\/\/[^\s"'<>)]+`,
    String.raw`\bwww\.[^\s"'<>)]+`,
    // Tried from a word's start only, so a long run of "a-a-a…" is read once, not once per letter.
    String.raw`(?<![\w.-])[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|ai|co|dev|app|edu|gov|info)\b(?:\/[^\s"'<>)]*)?`,
    PLACEHOLDER_SOURCE,
  ].join('|'),
  'gi',
);

const NUM = String.raw`\d+(?:[.,]\d+)*`;

// Mirrors recommendationGuard.js' VALUE_RE, with a time ("09:14") read as a date and ":" kept off a number.
const VALUE_RE = new RegExp(
  [
    `(?<date>\\b\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?(?![\\w-])|\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:\\s+\\d{4})?\\b|\\b${MONTH}\\.?\\s+\\d{4}\\b|\\b\\d{1,2}:\\d{2}\\b)`,
    // A figure followed by its unit is tried from its first digit only (linear on "1.1.1…").
    `(?<price>[$€£¥₹₺]\\s?${NUM}(?:\\s?(?:k|m|bn)\\b)?|(?<![\\d.,])\\b${NUM}\\s?(?:usd|eur|gbp|try|dollars?|euros?|pounds?)\\b)`,
    `(?<percent>(?<![\\d.,])\\b${NUM}\\s?(?:%|percent\\b|per cent\\b))`,
    `(?<year>\\b(?:19|20)\\d{2}\\b)`,
    `(?<number>(?<![\\w.#/:-])${NUM}(?:\\s?[–-]\\s?${NUM})?(?:[kmx×+](?![a-z])|\\s?(?:million|billion|thousand)\\b)?(?![\\w%:]))`,
  ].join('|'),
  'gi',
);

// "Step 2", "Top 10", "#3": numbering, not data. "1." at a line's start too.
const NUMBERING_WORD_RE =
  /\b(?:step|part|phase|tier|level|top|no\.|number|rank(?:ed)?|position)\s*$/i;
const NUMBERING_AFTER_RE = /^[.)]\s/;
// "Claude 3.5", "GPT 4.1": a name's version, right after it.
const NAME_BEFORE_RE = /\b[A-Z][\w-]*\s$/;
const VERSION_RE = /^\d{1,2}\.\d{1,2}$/;

// A period: its time unit right after the figure, in English or Turkish
// ("30 days", "30-day", "14 months old", "son 30 gün", "30 günlük", "12 ayda").
const PERIOD_RE = new RegExp(
  [
    String.raw`^\s?[-–]?\s?(?:(?<day>days?|gün(?:lük|de|den|dür|ü|e|ün)?)`,
    String.raw`(?<week>weeks?|hafta(?:lık|da|dan|dır|ya|yı|nın)?)`,
    String.raw`(?<month>months?|ay(?:lık|da|dan|dır|a|ı|ın)?)`,
    String.raw`(?<year>years?|yrs?|yıl(?:lık|da|dan|dır|a|ı|ın)?|sene(?:lik|de|den|dir|ye|yi|nin)?))(?![\p{L}\d])`,
  ].join('|'),
  'iu',
);

type PeriodUnit = 'day' | 'week' | 'month' | 'year';
const PERIOD_UNITS: readonly PeriodUnit[] = ['day', 'week', 'month', 'year'];
/** A unit's days, as a span is written in it. */
const UNIT_DAYS: Record<PeriodUnit, number> = {
  day: 1,
  week: 7,
  month: 365.25 / 12,
  year: 365.25,
};

/** The time unit a figure is written with, from the text right after it, or null. */
function periodUnit(tail: string): PeriodUnit | null {
  const groups = PERIOD_RE.exec(tail)?.groups;
  return groups ? (PERIOD_UNITS.find((unit) => groups[unit] !== undefined) ?? null) : null;
}

/**
 * Whether a period is known: a small count, or a known span in its unit,
 * in days exactly or counting both ends, in weeks, months or years rounded
 * down or up ("almost 21 months" or "over 20 months" for 20.5), never
 * further.
 */
function isKnownPeriod(
  figure: { value: number; tolerance: number },
  unit: PeriodUnit,
  known: KnownFigures,
): boolean {
  if (Number.isInteger(figure.value) && figure.value <= 10) return true;
  for (const span of known.spans) {
    if (unit === 'day') {
      if (Math.abs(figure.value - span) <= figure.tolerance) return true;
      if (Math.abs(figure.value - (span + 1)) <= figure.tolerance) return true;
    } else {
      const ratio = span / UNIT_DAYS[unit];
      if (figure.value === Math.floor(ratio) || figure.value === Math.ceil(ratio)) return true;
      if (Math.abs(figure.value - ratio) <= figure.tolerance) return true;
    }
  }
  return false;
}

// A length: "80 words", "80-word", "155 characters", "300 kelime", "155 karakterlik".
const LENGTH_UNIT = String.raw`\s?[-–]?\s?(?:words?|char(?:acter)?s?|kelime\p{L}*|karakter\p{L}*)(?![\p{L}\d])`;
const LENGTH_RE = new RegExp(`^${LENGTH_UNIT}`, 'iu');
// A skill's target with its unit, a range's two ends too ("40 to 80 words", "50–60 characters").
const TARGET_RE = new RegExp(
  String.raw`(${NUM})(?:\s*(?:to|and|or|-|–|ile|ila|veya)\s*(${NUM}))?${LENGTH_UNIT}`,
  'giu',
);

/** The word and character targets in a skill's text. */
function targetsIn(texts: readonly string[]): Set<number> {
  const targets = new Set<number>();
  for (const text of texts) {
    for (const m of text.matchAll(TARGET_RE)) {
      for (const raw of [m[1], m[2]]) {
        const n = raw === undefined ? null : parseFigure(raw);
        if (n !== null) targets.add(n);
      }
    }
  }
  return targets;
}

const SCALE: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  bn: 1e9,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
};

/** How many decimals a written figure has: none for thousands ("1,234", "1.234.567"). */
function decimalsOf(raw: string): number {
  if (/^\d{1,3}(?:,\d{3})+$/.test(raw) || /^\d{1,3}(?:\.\d{3}){2,}$/.test(raw)) return 0;
  return /[.,](\d+)$/.exec(raw)?.[1].length ?? 0;
}

/** A figure as the answer wrote it: its value and how closely it was rounded. */
function figuresOf(match: string): { value: number; tolerance: number }[] {
  const scaleWord = /(k|m|bn|thousand|million|billion)\b\s*$/i.exec(match)?.[1]?.toLowerCase();
  const scale = scaleWord ? SCALE[scaleWord] : 1;
  return [...match.matchAll(DIGITS)].flatMap((m) => {
    const value = parseFigure(m[0]);
    if (value === null) return [];
    const decimals = decimalsOf(m[0]);
    return [{ value: value * scale, tolerance: (0.5 / 10 ** decimals) * scale + 1e-9 }];
  });
}

/** Whether a figure is known, or worked out of known ones, at the answer's rounding. */
function isKnown(
  figure: { value: number; tolerance: number },
  known: KnownFigures,
  percent: boolean,
): boolean {
  const close = (x: number) => Math.abs(Math.abs(x) - figure.value) <= figure.tolerance;
  for (const x of known.values) {
    if (close(x)) return true;
    // A share read as a ratio: 0.42 is 42%.
    if (percent && Math.abs(x) <= 1 && close(x * 100)) return true;
  }
  for (const group of known.groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const [a, b] = [group[i], group[j]];
        if (close(a - b)) return true;
        if (percent && a !== 0 && (close(((b - a) / a) * 100) || close((b / a) * 100))) {
          return true;
        }
      }
    }
  }
  return false;
}

/** How far either side of a figure its rules read ("Step", "Claude", "1." at a line's start). */
const AROUND = 80;

export interface FactCheck {
  /** The text with figures not in the data replaced. */
  text: string;
  /** Figures checked (beyond small counts, numbering, dates). */
  checked: number;
  /** The figures taken out, as written. */
  replaced: string[];
}

/** Runs `fn` on the stretches of `text` outside URLs, domains and placeholders. */
function outsideMasks(text: string, fn: (chunk: string, offset: number) => string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MASK_RE)) {
    out += fn(text.slice(last, m.index), last);
    out += m[0];
    last = m.index + m[0].length;
  }
  return out + fn(text.slice(last), last);
}

/**
 * The text with each figure the run doesn't know replaced by a placeholder.
 * `before` and `after` are the text around it (already sent, still held):
 * read for context, never changed.
 */
export function checkFigures(
  text: string,
  known: KnownFigures,
  context: { before?: string; after?: string; now?: Date } = {},
): FactCheck {
  const before = context.before ?? '';
  const after = context.after ?? '';
  const year = (context.now ?? new Date()).getUTCFullYear();
  let checked = 0;
  const replaced: string[] = [];
  // What was sent is read with the text, so a link, "#12" or "Oct 17" cut
  // across two chunks reads as one; only `text`'s own figures change.
  const full = before + text;
  const from = before.length;
  const out = outsideMasks(full, (chunk, offset) =>
    chunk.replace(VALUE_RE, (match, ...args) => {
      const groups = args.at(-1) as Record<string, string | undefined>;
      const at = offset + (args.at(-3) as number);
      if (at < from) return match;
      // The rules read a few words either side, so a long text stays linear.
      const lead = full.slice(Math.max(0, at - AROUND), at);
      const end = at + match.length;
      const tail = full.slice(end, end + AROUND) + after.slice(0, AROUND);
      if (groups.date) return match;
      if (groups.year && !groups.number) {
        const y = Number(match);
        if (y === year || y === year - 1 || known.values.has(y)) return match;
        checked += 1;
        replaced.push(match);
        return PLACEHOLDER.date;
      }
      const figures = figuresOf(match);
      const percent = !!groups.percent;
      let period: PeriodUnit | null = null;
      let length = false;
      if (groups.number) {
        if (figures.every((f) => Number.isInteger(f.value) && f.value <= 10)) return match;
        const line = lead.slice(lead.lastIndexOf('\n') + 1);
        if (NUMBERING_WORD_RE.test(lead)) return match;
        if (/^\s*$/.test(line) && NUMBERING_AFTER_RE.test(tail)) return match;
        if (NAME_BEFORE_RE.test(lead) && VERSION_RE.test(match)) return match;
        period = periodUnit(tail);
        length = LENGTH_RE.test(tail);
      }
      checked += 1;
      const isFact = (f: { value: number; tolerance: number }) =>
        isKnown(f, known, percent) ||
        (period !== null && isKnownPeriod(f, period, known)) ||
        (length && known.targets.has(f.value));
      if (figures.every(isFact)) return match;
      replaced.push(match);
      return groups.price ? PLACEHOLDER.price : PLACEHOLDER.metric;
    }),
  );
  return { text: out.slice(from), checked, replaced };
}

/** Where a streamed text may be cut so no figure is checked without what follows it. */
export const FIGURE_CONTEXT = 16;

/**
 * The most a stream holds back (a uuid, or a figure and its unit, fit well
 * inside), so each check reads a short text however long the answer runs.
 */
export const HOLD_MAX = 120;

/**
 * The start of a figure still near the end of `text`: hold from there until
 * FIGURE_CONTEXT more characters come, so the figure is checked whole and
 * with its unit ("12" + "%", "1.2" + "k"). Null when nothing needs holding.
 */
export function figureHold(text: string): number | null {
  let last = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\d/.test(text[i])) {
      last = i;
      break;
    }
  }
  if (last < 0 || text.length - last - 1 >= FIGURE_CONTEXT) return null;
  let start = last;
  while (start > 0 && /[\d.,$€£¥₹₺\s–-]/.test(text[start - 1])) start -= 1;
  // The words before it ("Step", "Oct") are read from what was sent; spaces stay with them.
  while (start < last && /\s/.test(text[start])) start += 1;
  return start;
}

/**
 * The figures a run's reads and messages make known: what checkFigures
 * checks against. `given` is what else the answer was written from (the
 * page's scope); `skills` the loaded skills' text, of which only the word
 * and character targets count, and only as lengths ("80 words", never
 * "80 visits"); `periods` the app's own, in days.
 */
export function figuresOfRun(parts: {
  question: string;
  history: readonly unknown[];
  reads: readonly Json[];
  given?: readonly unknown[];
  skills?: readonly string[];
  periods?: readonly number[];
  now?: Date;
}): KnownFigures {
  const known = knownFigures(
    [parts.question, ...parts.history, ...parts.reads, ...(parts.given ?? [])],
    { periods: parts.periods, now: parts.now },
  );
  return { ...known, targets: targetsIn(parts.skills ?? []) };
}
