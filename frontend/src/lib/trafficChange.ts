/**
 * How a visit count compares with the previous period on the AI Traffic page
 * (AT-003, F4).
 *
 * A % change on a handful of visits says more about chance than about a
 * trend: the live page showed +367% on 14 visits. So a % is shown only when
 * both periods have at least LOW_SAMPLE_VISITS; otherwise the change reads
 * "Low sample". The previous period counts too, because 40 visits against 3
 * would read +1,233% — the same problem the other way round.
 */

export const LOW_SAMPLE_VISITS = 30;

export type VisitChange =
  /** Nothing to compare: no visits in either period, no previous period, or no change. */
  | { kind: 'none' }
  /** Visits now, none in the previous period. */
  | { kind: 'new' }
  /** Too few visits in one of the periods for a % to mean anything. */
  | { kind: 'low' }
  | { kind: 'pct'; pct: number };

export function visitChange(
  current: number,
  previous: number,
  { comparable = true }: { comparable?: boolean } = {},
): VisitChange {
  if (!comparable || (current === 0 && previous === 0)) return { kind: 'none' };
  if (previous === 0) return { kind: 'new' };
  if (current < LOW_SAMPLE_VISITS || previous < LOW_SAMPLE_VISITS) return { kind: 'low' };
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct === 0 ? { kind: 'none' } : { kind: 'pct', pct };
}
