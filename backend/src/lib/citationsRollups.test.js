import { beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));

import {
  addDays,
  dayChunks,
  rebuildQueuedCitationRollups,
  refreshCitationHistory,
  refreshCitationsDaily,
} from './citationsRollups.js';

/** A prompt_results bound query: first call ascending (first day), then descending. */
function resultBounds(first, last) {
  const days = [first, last];
  from.mockImplementation((table) => {
    if (table !== 'prompt_results') throw new Error(`unexpected table ${table}`);
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

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe('dayChunks', () => {
  it('covers the range in inclusive chunks, the last one short', () => {
    expect(dayChunks('2026-08-01', '2026-08-30', 14)).toEqual([
      ['2026-08-01', '2026-08-14'],
      ['2026-08-15', '2026-08-28'],
      ['2026-08-29', '2026-08-30'],
    ]);
  });

  it('returns one chunk for a single day', () => {
    expect(dayChunks('2026-08-01', '2026-08-01')).toEqual([['2026-08-01', '2026-08-01']]);
  });

  it('crosses month ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});

describe('refreshCitationsDaily', () => {
  it('calls the refresh function with the brand and inclusive day range', async () => {
    rpc.mockResolvedValue({ error: null });
    await expect(refreshCitationsDaily('brand-1', '2026-08-19', '2026-08-21')).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('refresh_citations_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-19',
      p_day_to: '2026-08-21',
    });
  });

  it('reports failure without throwing', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(refreshCitationsDaily('brand-1', '2026-08-21', '2026-08-21')).resolves.toBe(false);
  });
});

describe('refreshCitationHistory', () => {
  it('refreshes every chunk from the first to the last result day', async () => {
    resultBounds('2026-08-01', '2026-08-20');
    rpc.mockResolvedValue({ error: null });

    await expect(refreshCitationHistory('brand-1')).resolves.toBe(2);
    expect(rpc.mock.calls.map((c) => [c[1].p_day_from, c[1].p_day_to])).toEqual([
      ['2026-08-01', '2026-08-14'],
      ['2026-08-15', '2026-08-20'],
    ]);
  });

  it('does nothing for a brand without results', async () => {
    resultBounds(null, null);
    await expect(refreshCitationHistory('brand-1')).resolves.toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('throws when a chunk fails', async () => {
    resultBounds('2026-08-01', '2026-08-02');
    rpc.mockResolvedValue({ error: { message: 'timeout' } });
    await expect(refreshCitationHistory('brand-1')).rejects.toThrow(/refresh failed/);
  });
});

describe('rebuildQueuedCitationRollups', () => {
  it('rebuilds each queued brand and clears its entry only up to the time it read', async () => {
    const deleted = [];
    const boundDays = ['2026-08-01', '2026-08-02'];
    from.mockImplementation((table) => {
      if (table === 'citation_rollup_rebuilds') {
        return {
          select: () =>
            Promise.resolve({
              data: [{ brand_id: 'brand-1', requested_at: '2026-08-21T01:00:00Z' }],
              error: null,
            }),
          delete: () => ({
            eq: (_c, brandId) => ({
              lte: (_c2, at) => {
                deleted.push([brandId, at]);
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      const day = boundDays.shift();
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => Promise.resolve({ data: [{ created_at: `${day}T04:00:00Z` }], error: null }),
      };
      return q;
    });
    rpc.mockResolvedValue({ error: null });

    await expect(rebuildQueuedCitationRollups()).resolves.toEqual({ rebuilt: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith('refresh_citations_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-01',
      p_day_to: '2026-08-02',
    });
    expect(deleted).toEqual([['brand-1', '2026-08-21T01:00:00Z']]);
  });

  it('keeps the queue entry when the rebuild fails', async () => {
    let deletes = 0;
    from.mockImplementation((table) => {
      if (table === 'citation_rollup_rebuilds') {
        return {
          select: () =>
            Promise.resolve({ data: [{ brand_id: 'b', requested_at: 'x' }], error: null }),
          delete: () => {
            deletes++;
            return { eq: () => ({ lte: () => Promise.resolve({ error: null }) }) };
          },
        };
      }
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () =>
          Promise.resolve({ data: [{ created_at: '2026-08-01T04:00:00Z' }], error: null }),
      };
      return q;
    });
    rpc.mockResolvedValue({ error: { message: 'boom' } });

    await expect(rebuildQueuedCitationRollups()).resolves.toEqual({ rebuilt: 0, failed: 1 });
    expect(deletes).toBe(0);
  });

  it('skips a call made while a run is in progress, then runs again once it ends', async () => {
    let releaseQueue;
    let reads = 0;
    from.mockImplementation(() => ({
      select: () => {
        reads++;
        if (reads > 1) return Promise.resolve({ data: [], error: null });
        return new Promise((resolve) => {
          releaseQueue = () => resolve({ data: [], error: null });
        });
      },
    }));

    const first = rebuildQueuedCitationRollups();
    await expect(rebuildQueuedCitationRollups()).resolves.toEqual({
      rebuilt: 0,
      failed: 0,
      skipped: true,
    });
    expect(reads).toBe(1);

    releaseQueue();
    await expect(first).resolves.toEqual({ rebuilt: 0, failed: 0 });
    await expect(rebuildQueuedCitationRollups()).resolves.toEqual({ rebuilt: 0, failed: 0 });
    expect(reads).toBe(2);
  });

  it('runs again after a run that threw', async () => {
    from.mockImplementationOnce(() => {
      throw new Error('client down');
    });
    await expect(rebuildQueuedCitationRollups()).rejects.toThrow('client down');

    from.mockImplementation(() => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }));
    await expect(rebuildQueuedCitationRollups()).resolves.toEqual({ rebuilt: 0, failed: 0 });
  });

  it('costs a single query when the queue is empty', async () => {
    from.mockImplementation(() => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }));
    await rebuildQueuedCitationRollups();
    expect(from).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
  });
});
