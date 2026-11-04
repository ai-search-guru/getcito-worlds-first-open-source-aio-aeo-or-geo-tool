import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));

import {
  PERCEPTION_SNAPSHOT_DAYS,
  refreshMentionHistory,
  refreshMentionTermsDaily,
  refreshMentionTermsHistory,
  refreshMentionsDaily,
  refreshPerceptionSnapshots,
} from './mentionsRollups.js';

/** A day-bound query on `expected`: first call ascending (first day), then descending. */
function bounds(expected, first, last) {
  const days = [first, last];
  from.mockImplementation((table) => {
    if (table !== expected) throw new Error(`unexpected table ${table}`);
    const day = days.shift();
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () =>
        Promise.resolve({ data: day ? [{ created_at: `${day}T04:00:00Z` }] : [], error: null }),
    };
    return q;
  });
}
const resultBounds = (first, last) => bounds('prompt_results', first, last);

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('refreshMentionsDaily', () => {
  it('refreshes the rollups for the range, then the terms a day at a time', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(refreshMentionsDaily('brand-1', '2026-10-15', '2026-10-17')).resolves.toBe(true);
    const args = (from, to) => ({ p_brand_id: 'brand-1', p_day_from: from, p_day_to: to });
    expect(rpc.mock.calls).toEqual([
      ['refresh_mentions_daily', args('2026-10-15', '2026-10-17')],
      ['refresh_mention_terms', args('2026-10-15', '2026-10-15')],
      ['refresh_mention_terms', args('2026-10-16', '2026-10-16')],
      ['refresh_mention_terms', args('2026-10-17', '2026-10-17')],
    ]);
  });

  it('refreshes the terms in longer chunks when asked (a small brand)', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(
      refreshMentionsDaily('brand-1', '2026-10-01', '2026-10-17', { termDays: 31 }),
    ).resolves.toBe(true);
    const args = (from, to) => ({ p_brand_id: 'brand-1', p_day_from: from, p_day_to: to });
    expect(rpc.mock.calls).toEqual([
      ['refresh_mentions_daily', args('2026-10-01', '2026-10-17')],
      ['refresh_mention_terms', args('2026-10-01', '2026-10-17')],
    ]);
  });

  it('refreshes the rollups beside the terms when asked', async () => {
    const started = [];
    let finishRollups = () => {};
    rpc.mockImplementation((fn) => {
      started.push(fn);
      if (fn === 'refresh_mentions_daily') {
        return new Promise((resolve) => (finishRollups = () => resolve({ error: null })));
      }
      return Promise.resolve({ error: null });
    });
    const done = refreshMentionsDaily('brand-1', '2026-10-01', '2026-10-17', {
      termDays: 31,
      together: true,
    });
    await Promise.resolve();
    // The terms started without waiting for the rollups.
    expect(started).toEqual(['refresh_mentions_daily', 'refresh_mention_terms']);
    finishRollups();
    await expect(done).resolves.toBe(true);

    rpc
      .mockReset()
      .mockImplementation(async (fn) =>
        fn === 'refresh_mention_terms' ? { error: { message: 'x' } } : { error: null },
      );
    await expect(
      refreshMentionsDaily('brand-1', '2026-10-17', '2026-10-17', { together: true }),
    ).resolves.toBe(false);
  });

  // Derived state: a failed refresh costs freshness until the next sweep and
  // must never throw into a tracking run's finalize path.
  it('reports failure without throwing', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(refreshMentionsDaily('brand-1', '2026-10-17', '2026-10-17')).resolves.toBe(false);
  });

  it('reports a failed terms refresh too', async () => {
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionsDaily('brand-1', '2026-10-17', '2026-10-17')).resolves.toBe(false);
  });
});

describe('refreshMentionTermsDaily (00231)', () => {
  it('rebuilds the Perception rollups a week at a time', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(refreshMentionTermsDaily('brand-1', '2026-10-01', '2026-10-16')).resolves.toBe(
      true,
    );
    const args = (from, to) => ({ p_brand_id: 'brand-1', p_day_from: from, p_day_to: to });
    expect(rpc.mock.calls).toEqual([
      ['refresh_mention_terms_daily', args('2026-10-01', '2026-10-07')],
      ['refresh_mention_terms_daily', args('2026-10-08', '2026-10-14')],
      ['refresh_mention_terms_daily', args('2026-10-15', '2026-10-16')],
    ]);
  });

  it('stops at a failed week and says so, without throwing', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'timeout' } });
    await expect(refreshMentionTermsDaily('brand-1', '2026-10-01', '2026-10-16')).resolves.toBe(
      false,
    );
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('refreshPerceptionSnapshots (00241)', () => {
  it('computes the 7, 30 and 90 days, a window per call', async () => {
    rpc.mockResolvedValue({ error: null });
    expect(await refreshPerceptionSnapshots('b1')).toBe(true);
    expect(PERCEPTION_SNAPSHOT_DAYS).toEqual([7, 30, 90]);
    expect(rpc.mock.calls).toEqual(
      [7, 30, 90].map((days) => [
        'refresh_mentions_perception_snapshot',
        { p_brand_id: 'b1', p_days: days },
      ]),
    );
  });

  it('stops at the first failure without throwing', async () => {
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    expect(await refreshPerceptionSnapshots('b1')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('is quietly false before 00241 is applied', async () => {
    rpc.mockResolvedValue({ error: { code: 'PGRST202', message: 'not found' } });
    expect(await refreshPerceptionSnapshots('b1')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('refreshMentionHistory', () => {
  it('recomputes the whole history a day at a time', async () => {
    resultBounds('2026-10-01', '2026-10-03');
    rpc.mockResolvedValue({ error: null });

    await expect(refreshMentionHistory('brand-1')).resolves.toBe(3);
    expect(rpc.mock.calls.map(([fn, args]) => [fn, args.p_day_from, args.p_day_to])).toEqual([
      ['refresh_mentions_daily', '2026-10-01', '2026-10-01'],
      ['refresh_mention_terms', '2026-10-01', '2026-10-01'],
      ['refresh_mentions_daily', '2026-10-02', '2026-10-02'],
      ['refresh_mention_terms', '2026-10-02', '2026-10-02'],
      ['refresh_mentions_daily', '2026-10-03', '2026-10-03'],
      ['refresh_mention_terms', '2026-10-03', '2026-10-03'],
    ]);
  });

  it('skips a brand with no results', async () => {
    resultBounds(null, null);
    await expect(refreshMentionHistory('brand-1')).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stops at a failed chunk so the backfill can be run again', async () => {
    resultBounds('2026-09-01', '2026-10-17');
    rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionHistory('brand-1')).rejects.toThrow(
      'mention rollup refresh failed for brand-1 2026-09-02..2026-09-02',
    );
  });
});

describe('refreshMentionTermsHistory (00231 backfill)', () => {
  it("rebuilds the rollups over the brand's terms history, a week at a time", async () => {
    bounds('mentions_answer_terms', '2026-10-01', '2026-10-16');
    rpc.mockResolvedValue({ error: null });

    await expect(refreshMentionTermsHistory('brand-1')).resolves.toBe(3);
    expect(rpc.mock.calls.map(([fn, args]) => [fn, args.p_day_from, args.p_day_to])).toEqual([
      ['refresh_mention_terms_daily', '2026-10-01', '2026-10-07'],
      ['refresh_mention_terms_daily', '2026-10-08', '2026-10-14'],
      ['refresh_mention_terms_daily', '2026-10-15', '2026-10-16'],
    ]);
  });

  it('skips a brand with no terms', async () => {
    bounds('mentions_answer_terms', null, null);
    await expect(refreshMentionTermsHistory('brand-1')).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('stops at a failed week so the backfill can be run again', async () => {
    bounds('mentions_answer_terms', '2026-10-01', '2026-10-16');
    rpc.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(refreshMentionTermsHistory('brand-1')).rejects.toThrow(
      'mention terms rollup refresh failed for brand-1 2026-10-08..2026-10-14',
    );
  });
});
