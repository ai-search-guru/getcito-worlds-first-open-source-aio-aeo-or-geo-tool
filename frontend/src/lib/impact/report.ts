import { csvLine } from '@/lib/csv';

/**
 * Reports › "What GetCito did for you" (CHAT-22 feature 2 item 5, mockup
 * signature #f-impact): what a month's shipped changes did, read as W2-20's
 * measuring job keeps them (ship_events, impact_measurements, 00421), the
 * one source Action Center › History reads too. Pure: the server action in
 * lib/actions/impactReport.ts reads, the page words. Nothing here judges:
 * every outcome, effect and confidence is the job's.
 */

export const OUTCOMES = [
  'improved',
  'pending',
  'no_meaningful_change',
  'declined',
  'not_measurable',
] as const;
export type ImpactOutcome = (typeof OUTCOMES)[number];

export const CHECKPOINTS = ['d7', 'd14', 'd30', 'd90'] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

/** The day each checkpoint comes after the ship, and what it is (CHAT-22 §2 item 6). */
export const CHECKPOINT_DAYS: Record<Checkpoint, number> = { d7: 7, d14: 14, d30: 30, d90: 90 };

const DAY_MS = 86_400_000;

/** One checkpoint on a row's strip: measured, or still to come on its day. */
export type CheckpointMark =
  | {
      checkpoint: Checkpoint;
      state: 'measured';
      outcome: ImpactOutcome;
      /** The effect against the control, in points; null without one, and at day 7 (a direction only). */
      effect: number | null;
      /** Day 7's direction, when it has no verdict. */
      direction: 'up' | 'flat' | 'down' | null;
      /** Day 90's: whether it held the verdict before it, as the job kept it (lastingOf); else null. */
      lasting: 'held' | 'faded' | null;
      measuredAt: string | null;
    }
  | { checkpoint: Checkpoint; state: 'due'; dueOn: string }
  | { checkpoint: Checkpoint; state: 'none' };

/** A shipped change as the page lists it. */
export interface ImpactRow {
  /** The row's handle on the page (its ship event's place in the read): never shown. */
  key: string;
  title: string;
  kind: 'cms_publish' | 'pr_merged' | 'manual' | 'third_party_observed';
  source: 'chat' | 'action_center' | 'content_editor';
  shippedAt: string;
  /** The action it belongs to, as AC-1241; null for none. */
  actionNo: number | null;
  /** Who shipped it: the person reading, a teammate (named), or no one (an integration or an agent). */
  by: { who: 'you' | 'teammate' | 'automation'; name: string | null };
  executionMode: 'manual' | 'assisted' | 'automated';
  targetPrompts: number;
  /** The pages its targets name. */
  pages: string[];
  outcome: ImpactOutcome;
  confidence: 'low' | 'medium' | 'high' | null;
  checkpoint: Checkpoint | null;
  /** The primary metric (visibility, or citations for citation work), as the latest checkpoint read it. */
  metric: 'visibility' | 'citations' | null;
  before: number | null;
  after: number | null;
  controlBefore: number | null;
  controlAfter: number | null;
  /** The effect against the control, in points; null at day 7, which shows its direction only. */
  effect: number | null;
  /** Day 7's direction, as the job read it; null from day 14. */
  direction: 'up' | 'flat' | 'down' | null;
  window: { preStart: string; preEnd: string; postStart: string; postEnd: string } | null;
  notMeasurableReason: string | null;
  /** Other shipped changes on the same targets in its window. */
  concurrent: { title: string; shippedAt: string | null; sharedTargets: number }[];
  checkpoints: CheckpointMark[];
}

/** The month's headline (item 5): only Medium and High confidence verdicts count. */
export interface ImpactSummary {
  shipped: number;
  /** Changes shipped the month before, for "Sep: 10"; null when it couldn't be read. */
  previous: number | null;
  improved: number;
  /** Medium and High confidence verdicts: the "of" in "9 of 10". */
  judged: number;
  pending: number;
}

/** AI traffic to the month's changed pages (Google Analytics), this month and the one before. */
export interface ChangedPagesTraffic {
  current: number;
  previous: number;
  pages: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const textOr = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;
const oneOf = <T extends string>(value: unknown, list: readonly T[]): T | null =>
  (list as readonly unknown[]).includes(value) ? (value as T) : null;
/**
 * A percentage or an effect in points to one decimal, as the job stores
 * them: every number on the page and in the CSV is rounded the same, so a
 * row's before, after, control and lift add up as shown.
 */
const pointsOr = (value: unknown): number | null => {
  const n = numberOr(value);
  return n === null ? null : Math.round(n * 10) / 10 || 0;
};

/**
 * A day as YYYY-MM-DD in the browser's time: the page's month, and the day
 * a change shipped, on the page and in the CSV alike.
 */
export function localDay(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The baseline's days, YYYY-MM-DD, as the job sets them (checkpointWindow):
 * the 14 UTC days before the ship's UTC day. For a row with no window kept.
 */
export function baselineDays(shippedAt: string): { from: string; to: string } {
  const ship = Date.parse(`${new Date(shippedAt).toISOString().slice(0, 10)}T00:00:00Z`);
  const day = (n: number) => new Date(ship + n * DAY_MS).toISOString().slice(0, 10);
  return { from: day(-14), to: day(-1) };
}

/** The day a checkpoint comes, YYYY-MM-DD, from the ship. */
export function checkpointDue(shippedAt: string, checkpoint: Checkpoint): string {
  return new Date(Date.parse(shippedAt) + CHECKPOINT_DAYS[checkpoint] * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * A row's four checkpoints (the mockup's 7d · 14d · 30d · 90d strip): each
 * one the job measured, read from checkpoints_json; else the day it comes;
 * none after a Not measurable change that won't be measured again.
 */
export function checkpointMarks(
  shippedAt: string,
  entries: unknown,
  measuredOutAt: boolean,
): CheckpointMark[] {
  const list = Array.isArray(entries) ? entries.filter(isRecord) : [];
  return CHECKPOINTS.map((checkpoint): CheckpointMark => {
    const entry = list.filter((e) => e.checkpoint === checkpoint).at(-1);
    if (entry) {
      return {
        checkpoint,
        state: 'measured',
        outcome: oneOf(entry.outcome, OUTCOMES) ?? 'pending',
        // Day 7 is an early signal: its direction only, never a number of points.
        effect: checkpoint === 'd7' ? null : pointsOr(entry.effect),
        direction: oneOf(entry.direction, ['up', 'flat', 'down'] as const),
        lasting: checkpoint === 'd90' ? oneOf(entry.lasting, ['held', 'faded'] as const) : null,
        measuredAt: textOr(entry.measured_at),
      };
    }
    return measuredOutAt
      ? { checkpoint, state: 'none' }
      : { checkpoint, state: 'due', dueOn: checkpointDue(shippedAt, checkpoint) };
  });
}

/** What a ship event and its measurement read as, before the page names who shipped it. */
export interface ShipRowInput {
  key: string;
  title: string;
  kind: string;
  source: string;
  shipped_at: string;
  shipped_by: string | null;
  execution_mode: string;
  url: string | null;
  actionNo: number | null;
  measurement: Record<string, unknown> | null;
}

/**
 * A row from its ship event and measurement, read defensively: a part
 * missing or of another shape reads as none. `viewer` is who reads the
 * page, `names` the teammates who shipped.
 */
export function impactRow(
  input: ShipRowInput,
  viewer: string,
  names: Map<string, string | null>,
): ImpactRow {
  const m = input.measurement ?? {};
  const metrics = Array.isArray(m.metrics) ? m.metrics.filter(isRecord) : [];
  const primary = metrics[0] ?? {};
  const targets = Array.isArray(m.targets) ? m.targets.filter(isRecord) : [];
  const windowJson = isRecord(m.window_json) ? m.window_json : null;
  const outcome = oneOf(m.outcome, OUTCOMES) ?? 'pending';
  const concurrent = Array.isArray(m.concurrent_changes)
    ? m.concurrent_changes.filter(isRecord)
    : [];
  const pages = [
    ...new Set([
      ...targets.filter((t) => t.type === 'url').map((t) => textOr(t.label) ?? textOr(t.id)),
      textOr(input.url),
    ]),
  ].filter((page): page is string => !!page);
  const checkpoint = oneOf(m.checkpoint, CHECKPOINTS);
  const executionMode = oneOf(input.execution_mode, ['manual', 'assisted', 'automated'] as const);
  return {
    key: input.key,
    title: input.title,
    kind:
      oneOf(input.kind, ['cms_publish', 'pr_merged', 'manual', 'third_party_observed'] as const) ??
      'manual',
    source: oneOf(input.source, ['chat', 'action_center', 'content_editor'] as const) ?? 'chat',
    shippedAt: input.shipped_at,
    actionNo: input.actionNo,
    by: !input.shipped_by
      ? { who: 'automation', name: null }
      : input.shipped_by === viewer
        ? { who: 'you', name: null }
        : { who: 'teammate', name: names.get(input.shipped_by) ?? null },
    executionMode: executionMode ?? 'manual',
    targetPrompts: targets.filter((t) => t.type === 'prompt').length,
    pages,
    outcome,
    confidence: oneOf(m.confidence, ['low', 'medium', 'high'] as const),
    checkpoint,
    metric: oneOf(primary.metric, ['visibility', 'citations'] as const),
    before: pointsOr(primary.before),
    after: pointsOr(primary.after),
    controlBefore: pointsOr(primary.control_before),
    controlAfter: pointsOr(primary.control_after),
    effect: checkpoint === 'd7' ? null : pointsOr(primary.effect),
    direction:
      checkpoint === 'd7' ? oneOf(primary.direction, ['up', 'flat', 'down'] as const) : null,
    window:
      windowJson &&
      textOr(windowJson.pre_start) &&
      textOr(windowJson.pre_end) &&
      textOr(windowJson.post_start) &&
      textOr(windowJson.post_end)
        ? {
            preStart: windowJson.pre_start as string,
            preEnd: windowJson.pre_end as string,
            postStart: windowJson.post_start as string,
            postEnd: windowJson.post_end as string,
          }
        : null,
    notMeasurableReason: outcome === 'not_measurable' ? textOr(m.not_measurable_reason) : null,
    concurrent: concurrent.map((c) => ({
      title: textOr(c.title) ?? '',
      shippedAt: textOr(c.shipped_at),
      sharedTargets: numberOr(c.shared_targets) ?? 0,
    })),
    // Not measurable after its verdict window: nothing more comes.
    checkpoints: checkpointMarks(
      input.shipped_at,
      m.checkpoints_json,
      outcome === 'not_measurable' && m.next_check_at == null,
    ),
  };
}

const COUNTED = new Set(['medium', 'high']);
const VERDICTS = new Set<ImpactOutcome>(['improved', 'no_meaningful_change', 'declined']);

/**
 * The headline (item 5): the changes shipped; Improved "X of Y", where only
 * Medium and High confidence verdicts count (Low and Not measurable rows are
 * listed, not summed); and how many still wait on their day-14 verdict.
 */
export function impactSummary(rows: readonly ImpactRow[], previous: number | null): ImpactSummary {
  const judged = rows.filter(
    (row) => VERDICTS.has(row.outcome) && row.confidence !== null && COUNTED.has(row.confidence),
  );
  return {
    shipped: rows.length,
    previous,
    improved: judged.filter((row) => row.outcome === 'improved').length,
    judged: judged.length,
    pending: rows.filter((row) => row.outcome === 'pending').length,
  };
}

/** How many rows each outcome filter holds, All first. */
export function outcomeCounts(rows: readonly ImpactRow[]): Record<'all' | ImpactOutcome, number> {
  const counts = { all: rows.length } as Record<'all' | ImpactOutcome, number>;
  for (const outcome of OUTCOMES)
    counts[outcome] = rows.filter((r) => r.outcome === outcome).length;
  return counts;
}

/** A page's path as Google Analytics keeps its landing page: lower case, no trailing slash. */
export function pageKey(url: string): string | null {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '').toLowerCase();
    return path || '/';
  } catch {
    return url.startsWith('/') ? url.replace(/\/+$/, '').toLowerCase() || '/' : null;
  }
}

/** The words of one CSV export, the page's own (en.json). */
export interface CsvWords {
  headers: string[];
  outcome: (outcome: ImpactOutcome) => string;
  confidence: (confidence: 'low' | 'medium' | 'high') => string;
  source: (source: ImpactRow['source']) => string;
}

/**
 * The month's rows as CSV (Export ▾, CSV only for now): one line a change,
 * numbers as numbers, as the table shows them, and the day it shipped in
 * the browser's time, as the page dates it.
 */
export function impactCsv(rows: readonly ImpactRow[], words: CsvWords): string {
  const lines = rows.map((row) =>
    csvLine([
      row.title,
      localDay(row.shippedAt),
      words.source(row.source),
      row.actionNo !== null ? `AC-${row.actionNo}` : '',
      row.targetPrompts,
      row.metric ?? '',
      row.before,
      row.after,
      row.controlBefore,
      row.controlAfter,
      row.effect,
      row.checkpoint ?? '',
      words.outcome(row.outcome),
      row.confidence ? words.confidence(row.confidence) : '',
    ]),
  );
  return [csvLine(words.headers), ...lines].join('\n');
}
