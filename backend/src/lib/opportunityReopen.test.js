import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));

const { GAIN_LOST_RATIO, SCORE_RISE, measuredAfter, reopenReason, reopenStrengthened } =
  await import('./opportunityReopen.js');

describe('reopenReason', () => {
  it('re-opens when the score rose enough', () => {
    expect(
      reopenReason(
        { score: 70 + SCORE_RISE, visibility: 20 },
        { previousScore: 70, visibilityAfter: 20 },
      ),
    ).toBe('score_rose');
    expect(
      reopenReason(
        { score: 70 + SCORE_RISE - 0.1, visibility: 20 },
        { previousScore: 70, visibilityAfter: 20 },
      ),
    ).toBeNull();
  });

  it('re-opens when the measured gain was lost', () => {
    const after = 20;
    expect(
      reopenReason(
        { score: 70, visibility: after * GAIN_LOST_RATIO - 0.1 },
        { previousScore: 70, visibilityAfter: after },
      ),
    ).toBe('gain_lost');
    expect(
      reopenReason(
        { score: 70, visibility: after * GAIN_LOST_RATIO },
        {
          previousScore: 70,
          visibilityAfter: after,
        },
      ),
    ).toBeNull();
  });

  it('has no gain to lose without a measured visibility', () => {
    expect(
      reopenReason({ score: 70, visibility: 0 }, { previousScore: 70, visibilityAfter: null }),
    ).toBeNull();
    expect(
      reopenReason({ score: 70, visibility: 0 }, { previousScore: 70, visibilityAfter: 0 }),
    ).toBeNull();
  });
});

describe('measuredAfter', () => {
  const basket = (after) => ({
    status: 'completed',
    outcome: 'improved',
    validation: {
      scope: { kind: 'basket' },
      metrics: [
        { metric: 'mentions', after: 9 },
        { metric: 'ai_visibility', after },
      ],
    },
  });

  it('waits until every action is completed and measured', () => {
    expect(measuredAfter([])).toBeUndefined();
    expect(
      measuredAfter([basket(10), { status: 'in_progress', outcome: 'pending_measurement' }]),
    ).toBeUndefined();
    expect(measuredAfter([{ ...basket(10), outcome: 'pending_measurement' }])).toBeUndefined();
  });

  it('takes the best basket visibility measured afterwards', () => {
    expect(measuredAfter([basket(10), basket(25)])).toBe(25);
  });

  it('is null when measured on something other than the basket', () => {
    expect(
      measuredAfter([
        { ...basket(10), validation: { metrics: [{ metric: 'ai_visibility', after: 10 }] } },
      ]),
    ).toBeNull();
  });
});

describe('reopenStrengthened', () => {
  it('keeps closed the ones the caller skips, as when another open one answers their question', async () => {
    const measure = vi.fn();
    const done = [{ id: 'o1', status: 'done', cluster_id: 'c1' }];
    // Nothing is read: the database client here has no tables.
    expect(await reopenStrengthened('b1', done, measure, { skip: () => true })).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });
});
