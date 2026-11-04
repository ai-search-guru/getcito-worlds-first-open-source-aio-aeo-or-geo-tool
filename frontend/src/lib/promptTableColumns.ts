import type { LocationMetric } from '@/lib/promptLocationMatrix';

/**
 * The Tracked Prompts table's columns a person can show, hide and order
 * (PROMPT-015a). Prompt and the row's menu always show. A saved view is
 * `{ order, hidden }`, per person and brand, or shared by an admin or
 * manager with everyone on the brand (prompt_table_views, 00363).
 */

/** Today's columns, in today's order: the default view. */
export const PROMPT_COLUMNS = [
  'topic',
  'status',
  'work',
  'visibility',
  'mentions',
  'citations',
  'positions',
  'volume',
  'competition',
  'runs',
  'added',
  'lastRun',
] as const;

export type PromptColumnId = (typeof PROMPT_COLUMNS)[number];

/** A metric in one location, as a column (PROMPT-015b): `loc:<metric>:<location code>`. */
export type LocationColumnId = `loc:${LocationMetric}:${string}`;

export type TableColumnId = PromptColumnId | LocationColumnId;

export interface PromptColumnsView {
  order: TableColumnId[];
  hidden: TableColumnId[];
}

/** Location columns a view holds at most. */
export const MAX_LOCATION_COLUMNS = 8;

const LOCATION_COLUMN = /^loc:(visibility|position|mentions|citations):([A-Za-z0-9~_-]{2,64})$/;

export function locationColumn(metric: LocationMetric, region: string): LocationColumnId {
  return `loc:${metric}:${region}`;
}

/** A location column's metric and location; null for any other column. */
export function parseLocationColumn(id: string): { metric: LocationMetric; region: string } | null {
  const match = LOCATION_COLUMN.exec(id);
  return match ? { metric: match[1] as LocationMetric, region: match[2] } : null;
}

export function isLocationColumn(id: string): id is LocationColumnId {
  return LOCATION_COLUMN.test(id);
}

export const DEFAULT_COLUMNS_VIEW: PromptColumnsView = { order: [...PROMPT_COLUMNS], hidden: [] };

const KNOWN = new Set<string>(PROMPT_COLUMNS);
const isColumn = (id: unknown): id is TableColumnId =>
  typeof id === 'string' && (KNOWN.has(id) || isLocationColumn(id));

/**
 * A saved view, as the table reads it: ids it doesn't know are dropped, and
 * a column added to the table since goes back where the default has it,
 * after the column before it there. Null for anything that isn't a view.
 */
export function readColumnsView(raw: unknown): PromptColumnsView | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { order, hidden } = raw as { order?: unknown; hidden?: unknown };
  if (!Array.isArray(order)) return null;
  const locations = order.filter(
    (id): id is LocationColumnId => typeof id === 'string' && isLocationColumn(id),
  );
  const kept: TableColumnId[] = [
    ...new Set(
      order.filter(
        (id) =>
          isColumn(id) && (!isLocationColumn(id) || locations.indexOf(id) < MAX_LOCATION_COLUMNS),
      ),
    ),
  ] as TableColumnId[];
  for (const [i, id] of PROMPT_COLUMNS.entries()) {
    if (kept.includes(id)) continue;
    const before = PROMPT_COLUMNS.slice(0, i).findLast((prev) => kept.includes(prev));
    kept.splice(before ? kept.indexOf(before) + 1 : 0, 0, id);
  }
  return {
    order: kept,
    hidden: Array.isArray(hidden)
      ? [...new Set(hidden.filter((id): id is TableColumnId => isColumn(id) && kept.includes(id)))]
      : [],
  };
}

/** The columns shown, in order. */
export function visibleColumns(view: PromptColumnsView): TableColumnId[] {
  const hidden = new Set(view.hidden);
  return view.order.filter((id) => !hidden.has(id));
}

export function toggleColumn(
  view: PromptColumnsView,
  id: TableColumnId,
  shown: boolean,
): PromptColumnsView {
  const hidden = view.hidden.filter((h) => h !== id);
  return { ...view, hidden: shown ? hidden : [...hidden, id] };
}

/** Moves a column to `to`'s place (a drop), or one step up or down. */
export function moveColumn(
  view: PromptColumnsView,
  id: TableColumnId,
  to: TableColumnId | -1 | 1,
): PromptColumnsView {
  const order = view.order.filter((c) => c !== id);
  const from = view.order.indexOf(id);
  const at =
    to === -1 || to === 1
      ? Math.min(order.length, Math.max(0, from + to))
      : view.order.indexOf(to) > from
        ? order.indexOf(to) + 1
        : order.indexOf(to);
  if (from < 0 || at < 0) return view;
  order.splice(at, 0, id);
  return { ...view, order };
}

/** Adds a location column at the end, shown; the same one twice stays once. */
export function addLocationColumn(
  view: PromptColumnsView,
  metric: LocationMetric,
  region: string,
): PromptColumnsView {
  const id = locationColumn(metric, region);
  if (view.order.includes(id)) return toggleColumn(view, id, true);
  if (view.order.filter(isLocationColumn).length >= MAX_LOCATION_COLUMNS) return view;
  return { order: [...view.order, id], hidden: view.hidden };
}

/** Takes a location column out of the view. */
export function removeColumn(view: PromptColumnsView, id: LocationColumnId): PromptColumnsView {
  return { order: view.order.filter((c) => c !== id), hidden: view.hidden.filter((c) => c !== id) };
}

export function sameView(a: PromptColumnsView, b: PromptColumnsView): boolean {
  return (
    a.order.join() === b.order.join() && [...a.hidden].sort().join() === [...b.hidden].sort().join()
  );
}

/** The columns that read a prompt's answers in the window: each a dash until it has some. */
export const ANSWER_COLUMNS: readonly PromptColumnId[] = [
  'visibility',
  'mentions',
  'citations',
  'positions',
  'runs',
  'lastRun',
];

/**
 * Where a row with no answers in the window says when they come, or why
 * not (LocationPending): once, in the first answer column shown, rather
 * than in each. Null when it has answers; when the location picked is one
 * it isn't tracked in, so none will come; when it's paused and the Status
 * column already says so; or when no answer column shows.
 */
export function pendingColumn(
  prompt: { isActive: boolean; regions: readonly string[] },
  {
    hasAnswers,
    region,
    columns,
  }: {
    hasAnswers: boolean;
    /** The location picked; empty for every location. */
    region: string;
    columns: readonly TableColumnId[];
  },
): PromptColumnId | null {
  if (hasAnswers) return null;
  if (region && !prompt.regions.includes(region)) return null;
  if (!prompt.isActive && columns.includes('status')) return null;
  return (
    columns.find((id): id is PromptColumnId => ANSWER_COLUMNS.includes(id as PromptColumnId)) ??
    null
  );
}

/** The view a person sees: theirs, else the brand's, else the default. */
export function effectiveView(
  mine: PromptColumnsView | null,
  brand: PromptColumnsView | null,
): PromptColumnsView {
  return mine ?? brand ?? DEFAULT_COLUMNS_VIEW;
}
