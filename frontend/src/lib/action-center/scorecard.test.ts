import { describe, expect, it } from 'vitest';
import {
  MIN_SCORECARD_VERDICTS,
  parseScorecardRow,
  sortScorecard,
  successRate,
  topDismissReason,
  type ScorecardRow,
} from './scorecard';

const row = (overrides: Partial<ScorecardRow> = {}): ScorecardRow => ({
  kind: 'recover_lost_citations',
  completed: 0,
  improved: 0,
  mixed: 0,
  noChange: 0,
  declined: 0,
  notMeasurable: 0,
  pending: 0,
  final: 0,
  medianChange: null,
  dismissed: 0,
  dismissReasons: {},
  ...overrides,
});

describe('parseScorecardRow', () => {
  it('reads an RPC row into the table shape', () => {
    expect(
      parseScorecardRow({
        kind: 'recover_lost_citations',
        completed: 4,
        improved: 1,
        mixed: 1,
        no_change: 0,
        declined: 1,
        not_measurable: 0,
        pending: 1,
        final: 1,
        median_change: '0.1500',
        dismissed: 2,
        dismiss_reasons: { not_now: 1, none: 1, made_up: 3 },
      }),
    ).toEqual(
      row({
        completed: 4,
        improved: 1,
        mixed: 1,
        declined: 1,
        pending: 1,
        final: 1,
        medianChange: 0.15,
        dismissed: 2,
        dismissReasons: { not_now: 1, none: 1 },
      }),
    );
  });

  it('drops a row with no kind, and keeps an unread median empty', () => {
    expect(parseScorecardRow({ completed: 2 })).toBeNull();
    expect(parseScorecardRow(null)).toBeNull();
    expect(parseScorecardRow({ kind: 'fix_low_scores', median_change: null })?.medianChange).toBe(
      null,
    );
  });
});

describe('successRate', () => {
  /** Two results can't tell whether a kind of work pays off here. */
  it('gives no rate below the minimum results with a verdict', () => {
    expect(successRate(row({ improved: MIN_SCORECARD_VERDICTS - 1 }))).toBeNull();
    // Results with no verdict don't count towards it.
    expect(successRate(row({ improved: 1, notMeasurable: 5, pending: 5 }))).toBeNull();
  });

  it('is the share of verdicts that improved', () => {
    expect(successRate(row({ improved: 2, mixed: 1, declined: 1 }))).toBe(50);
    expect(successRate(row({ improved: 1, noChange: 2 }))).toBe(33);
  });
});

describe('topDismissReason', () => {
  it('names the reason given most often, never the dismissals without one', () => {
    expect(topDismissReason(row({ dismissReasons: { not_now: 1, wrong_data: 2, none: 5 } }))).toBe(
      'wrong_data',
    );
    expect(topDismissReason(row({ dismissReasons: { none: 3 } }))).toBeNull();
  });

  it('breaks a tie by the order the dialog lists them', () => {
    expect(topDismissReason(row({ dismissReasons: { not_now: 2, not_relevant: 2 } }))).toBe(
      'not_relevant',
    );
  });
});

describe('sortScorecard', () => {
  it('puts the busiest kinds first, then the better rate', () => {
    const quiet = row({ kind: 'fix_low_scores', dismissed: 1 });
    const busy = row({ kind: 'recover_visibility', completed: 3, declined: 3 });
    const better = row({ kind: 'recover_lost_citations', completed: 3, improved: 3 });
    expect(sortScorecard([quiet, busy, better]).map((r) => r.kind)).toEqual([
      'recover_lost_citations',
      'recover_visibility',
      'fix_low_scores',
    ]);
  });
});
