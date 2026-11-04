import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

import { getActionScorecard } from './actionScorecard';

beforeEach(() => {
  rpc.mockReset();
});

describe('getActionScorecard', () => {
  it("reads the brand's scorecard since a day, busiest kinds first", async () => {
    rpc.mockResolvedValue({
      data: [
        { kind: 'fix_low_scores', completed: 1, dismissed: 0 },
        { kind: 'recover_lost_citations', completed: 3, improved: 3, dismissed: 1 },
        { completed: 9 },
      ],
      error: null,
    });

    const rows = await getActionScorecard('brand-1', { from: '2026-10-01T00:00:00.000Z' });

    expect(rpc).toHaveBeenCalledWith('action_scorecard', {
      p_brand_id: 'brand-1',
      p_since: '2026-10-01T00:00:00.000Z',
    });
    expect(rows.map((row) => row.kind)).toEqual(['recover_lost_citations', 'fix_low_scores']);
  });

  it('reads every action when no range is set, and fails loudly', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getActionScorecard('brand-1')).rejects.toThrow('boom');
    expect(rpc).toHaveBeenCalledWith('action_scorecard', { p_brand_id: 'brand-1', p_since: null });
  });
});
