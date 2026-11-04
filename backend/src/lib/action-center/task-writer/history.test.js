import { describe, expect, it, vi } from 'vitest';
import { pastRound } from './history.js';

// pastRound reads nothing; the client only has to load without credentials.
vi.mock('../../../config/supabase.js', () => ({ default: {} }));

/**
 * An earlier round as the task writer reads it (learning B5): what was done,
 * what was left, and what the result read; a dismissed one, why.
 */
describe('pastRound', () => {
  it('reads a completed round: its result, its main metric and its tasks', () => {
    expect(
      pastRound(
        {
          status: 'completed',
          outcome: 'improved',
          validation: {
            primary: 'citations',
            readings: [{ day: 7, outcome: 'improved' }],
            metrics: [
              { metric: 'mentions', before: 1, after: 2 },
              { metric: 'citations', before: 4, after: 9 },
            ],
          },
          completed_at: '2026-09-12T08:00:00Z',
        },
        [
          { task_key: 'refresh_content', title: null, status: 'completed' },
          { task_key: null, title: 'Pitch seriouseats.com', status: 'skipped' },
          { task_key: null, title: '  ', status: 'todo' },
        ],
      ),
    ).toEqual({
      closed: '2026-09-12',
      result: 'improved',
      final: false,
      mainMetric: { metric: 'citations', before: 4, after: 9 },
      done: ['Refresh content'],
      notDone: ['Pitch seriouseats.com'],
    });
  });

  it('reads a round not measured yet, and one with no main metric read', () => {
    expect(
      pastRound({ status: 'completed', outcome: null, validation: null, completed_at: null }, []),
    ).toEqual({
      closed: null,
      result: 'pending_measurement',
      final: false,
      mainMetric: null,
      done: [],
      notDone: [],
    });
  });

  it('reads a round as final once read on day 30, or measured once before readings began', () => {
    const round = (validation) =>
      pastRound({ status: 'completed', outcome: 'declined', validation, completed_at: null }, []);
    expect(round({ readings: [{ day: 30, outcome: 'declined' }], final: true }).final).toBe(true);
    // Measured before readings began (learning B1): the sweep never reads it
    // again, so History and the MCP take it as the result too.
    expect(round({ primary: 'citations', metrics: [] }).final).toBe(true);
    expect(round({ readings: [{ day: 14, outcome: 'declined' }] }).final).toBe(false);
  });

  it('reads a dismissed round as why it was turned down', () => {
    expect(
      pastRound(
        { status: 'dismissed', dismiss_reason: 'wrong_data', updated_at: '2026-08-02T00:00:00Z' },
        [{ task_key: 'refresh_content', status: 'todo' }],
      ),
    ).toEqual({ closed: '2026-08-02', dismissed: true, reason: 'wrong_data' });
  });
});
