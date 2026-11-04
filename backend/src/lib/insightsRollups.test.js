import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The module reaches the supabase admin client at import time, whose config
// hard-exits when SUPABASE_* env is absent (as in CI).
const rpc = vi.fn();
const from = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: { rpc: (...a) => rpc(...a), from: (...a) => from(...a) },
}));

// The Citations rollups ride on the same callers; their own behavior is
// covered in citationsRollups.test.js.
const refreshCitationsDaily = vi.fn();
const rebuildQueuedCitationRollups = vi.fn();
vi.mock('./citationsRollups.js', () => ({
  refreshCitationsDaily: (...a) => refreshCitationsDaily(...a),
  rebuildQueuedCitationRollups: (...a) => rebuildQueuedCitationRollups(...a),
}));

// The Mentions rollups ride on them too (mentionsRollups.test.js).
const refreshMentionsDaily = vi.fn();
const refreshMentionTermsDaily = vi.fn();
const refreshPerceptionSnapshots = vi.fn();
vi.mock('./mentionsRollups.js', () => ({
  refreshMentionsDaily: (...a) => refreshMentionsDaily(...a),
  refreshMentionTermsDaily: (...a) => refreshMentionTermsDaily(...a),
  refreshPerceptionSnapshots: (...a) => refreshPerceptionSnapshots(...a),
}));

import {
  rebuildQueuedInsightsRollups,
  refreshInsightsDaily,
  refreshForCompletedRun,
  sweepInsightsRollups,
  utcDay,
  REBUILD_CHUNK_DAYS,
  SWEEP_DAYS,
} from './insightsRollups.js';

/**
 * The admin client's from(): the brands list, and the rebuild queue (00192)
 * with the deletes made on it.
 */
let brandRows = [];
let brandsError = null;
const brandFilters = [];
let queueRows = [];
const queueDeletes = [];
function tables() {
  from.mockImplementation((table) => {
    if (table === 'brands') {
      return {
        select: () => ({
          eq: (...a) => {
            brandFilters.push(a);
            return Promise.resolve({ data: brandRows, error: brandsError });
          },
        }),
      };
    }
    const filters = [];
    const chain = {
      eq: (...a) => (filters.push(['eq', ...a]), chain),
      lte: (...a) => {
        filters.push(['lte', ...a]);
        queueDeletes.push(filters);
        return Promise.resolve({ error: null });
      },
    };
    return {
      select: () => Promise.resolve({ data: queueRows, error: null }),
      delete: () => chain,
    };
  });
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  brandRows = [];
  brandsError = null;
  queueRows = [];
  queueDeletes.length = 0;
  tables();
  refreshCitationsDaily.mockReset().mockResolvedValue(true);
  refreshMentionsDaily.mockReset().mockResolvedValue(true);
  refreshPerceptionSnapshots.mockReset().mockResolvedValue(true);
  refreshMentionTermsDaily.mockReset().mockResolvedValue(true);
  rebuildQueuedCitationRollups.mockReset().mockResolvedValue({ rebuilt: 0, failed: 0 });
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-21T05:30:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('utcDay', () => {
  it('returns the UTC calendar day of an ISO timestamp', () => {
    expect(utcDay('2026-08-20T23:59:59Z')).toBe('2026-08-20');
    expect(utcDay('2026-08-21T00:00:01Z')).toBe('2026-08-21');
  });

  // A timestamp carrying a positive offset belongs to the previous UTC day —
  // days in the rollup tables are UTC, whatever wrote the string.
  it('normalizes offsets to UTC', () => {
    expect(utcDay('2026-08-21T01:30:00+03:00')).toBe('2026-08-20');
  });

  it('defaults to today (UTC)', () => {
    expect(utcDay()).toBe('2026-08-21');
  });
});

describe('refreshInsightsDaily', () => {
  it('calls the refresh function with the brand and inclusive day range', async () => {
    rpc.mockResolvedValue({ error: null });
    const ok = await refreshInsightsDaily('brand-1', '2026-08-19', '2026-08-21');
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-19',
      p_day_to: '2026-08-21',
    });
  });

  // The rollups are derived state: a failed refresh costs freshness until the
  // next sweep, and must never throw into a tracking run's finalize path.
  it('reports failure without throwing', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } });
    await expect(refreshInsightsDaily('brand-1', '2026-08-21', '2026-08-21')).resolves.toBe(false);
  });
});

describe('refreshForCompletedRun', () => {
  it('spans from the run start day through today', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-21T03:10:00Z');
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-21',
      p_day_to: '2026-08-21',
    });
  });

  // A run that started before UTC midnight lands rows on two calendar days;
  // refreshing only "today" would leave yesterday's tail stale until the
  // sweep.
  it('covers both days of a run that crossed midnight', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-20T23:45:00Z');
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'brand-1',
      p_day_from: '2026-08-20',
      p_day_to: '2026-08-21',
    });
  });

  it('refreshes the Citations and Mentions rollups for the same days', async () => {
    rpc.mockResolvedValue({ error: null });
    await refreshForCompletedRun('brand-1', '2026-08-20T23:45:00Z');
    expect(refreshCitationsDaily).toHaveBeenCalledWith('brand-1', '2026-08-20', '2026-08-21');
    expect(refreshMentionsDaily).toHaveBeenCalledWith('brand-1', '2026-08-20', '2026-08-21');
    // Then the Perception tab's precomputed view (00241), from the fresh rollups.
    expect(refreshPerceptionSnapshots).toHaveBeenCalledWith('brand-1');
  });

  it('refreshes the Perception view as the rollups now are, even after a failure', async () => {
    rpc.mockResolvedValue({ error: null });
    refreshMentionsDaily.mockResolvedValue(false);
    await refreshForCompletedRun('brand-1', '2026-08-20T23:45:00Z');
    expect(refreshPerceptionSnapshots).toHaveBeenCalledWith('brand-1');
  });
});

describe('sweepInsightsRollups', () => {
  function brandsList(rows, error = null) {
    brandRows = rows;
    brandsError = error;
  }

  it('leaves out demo brands (00380), whose rollups their generator refreshes', async () => {
    brandsList([]);
    brandFilters.length = 0;
    await sweepInsightsRollups();
    expect(brandFilters).toEqual([['is_demo', false]]);
  });

  it('refreshes the trailing window for every brand, today included', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }]);
    rpc.mockResolvedValue({ error: null });

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 2, failed: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
    // SWEEP_DAYS trailing days ending today: 3 days → today-2 .. today.
    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'a',
      p_day_from: '2026-08-19',
      p_day_to: '2026-08-21',
    });
    expect(SWEEP_DAYS).toBe(3);
    expect(refreshCitationsDaily).toHaveBeenCalledWith('b', '2026-08-19', '2026-08-21');
    expect(refreshMentionsDaily).toHaveBeenCalledWith('b', '2026-08-19', '2026-08-21');
    expect(refreshPerceptionSnapshots.mock.calls).toEqual([['a'], ['b']]);
    expect(rebuildQueuedCitationRollups).toHaveBeenCalledTimes(1);
  });

  it('counts a brand whose Citations refresh failed', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }]);
    rpc.mockResolvedValue({ error: null });
    refreshCitationsDaily.mockResolvedValueOnce(false);

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 1, failed: 1 });
  });

  it('counts a brand whose Mentions refresh failed', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }]);
    rpc.mockResolvedValue({ error: null });
    refreshMentionsDaily.mockResolvedValueOnce(false);

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 1, failed: 1 });
  });

  // One brand's failure must not stop the sweep — the whole point of the
  // backstop is that no brand silently stays stale.
  it('keeps sweeping past a failing brand and counts it', async () => {
    brandsList([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    rpc.mockResolvedValueOnce({ error: { message: 'boom' } }).mockResolvedValue({ error: null });

    const res = await sweepInsightsRollups();

    expect(res).toEqual({ refreshed: 2, failed: 1 });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it('gives up quietly when the brand list cannot be read', async () => {
    brandsList(null, { message: 'boom' });
    const res = await sweepInsightsRollups();
    expect(res).toEqual({ refreshed: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('rebuildQueuedInsightsRollups (00192)', () => {
  const entry = {
    brand_id: 'b1',
    day_from: '2026-06-01',
    day_to: '2026-08-10',
    requested_at: '2026-08-21T05:00:00.123456+00:00',
  };

  it("refreshes a deleted prompt's days in chunks, then clears the entry", async () => {
    queueRows = [entry];
    rpc.mockResolvedValue({ error: null });

    expect(await rebuildQueuedInsightsRollups()).toEqual({ rebuilt: 1, failed: 0 });

    expect(REBUILD_CHUNK_DAYS).toBe(31);
    expect(rpc.mock.calls.map(([, args]) => [args.p_day_from, args.p_day_to])).toEqual([
      ['2026-06-01', '2026-07-01'],
      ['2026-07-02', '2026-08-01'],
      ['2026-08-02', '2026-08-10'],
    ]);
    // The Perception rollups (00231) lose the deleted prompt's terms too,
    // and so does the view precomputed from them (00241).
    expect(refreshMentionTermsDaily).toHaveBeenCalledWith('b1', '2026-06-01', '2026-08-10');
    expect(refreshPerceptionSnapshots).toHaveBeenCalledWith('b1');
    // Only if nothing re-queued the brand meanwhile.
    expect(queueDeletes).toEqual([
      [
        ['eq', 'brand_id', 'b1'],
        ['lte', 'requested_at', entry.requested_at],
      ],
    ]);
  });

  it('keeps the entry for the next drain when a refresh fails', async () => {
    queueRows = [entry, { ...entry, brand_id: 'b2', day_from: '2026-08-01' }];
    rpc.mockResolvedValueOnce({ error: { message: 'timeout' } }).mockResolvedValue({ error: null });

    expect(await rebuildQueuedInsightsRollups()).toEqual({ rebuilt: 1, failed: 1 });
    // b1 stopped at its first chunk; b2 was refreshed and cleared.
    expect(rpc.mock.calls[0][1].p_brand_id).toBe('b1');
    expect(rpc.mock.calls.slice(1).every(([, args]) => args.p_brand_id === 'b2')).toBe(true);
    expect(queueDeletes).toHaveLength(1);
    expect(queueDeletes[0][0]).toEqual(['eq', 'brand_id', 'b2']);
    // Nothing of b1's was rebuilt: its precomputed views aren't recomputed.
    expect(refreshPerceptionSnapshots.mock.calls).toEqual([['b2']]);
  });

  it('keeps the entry when the Perception rollups fail to rebuild', async () => {
    queueRows = [entry];
    rpc.mockResolvedValue({ error: null });
    refreshMentionTermsDaily.mockResolvedValue(false);

    expect(await rebuildQueuedInsightsRollups()).toEqual({ rebuilt: 0, failed: 1 });
    expect(queueDeletes).toHaveLength(0);
    // The precomputed view still follows what was rebuilt.
    expect(refreshPerceptionSnapshots).toHaveBeenCalledWith('b1');
  });

  it('never runs twice at once', async () => {
    queueRows = [entry];
    let release;
    rpc.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    rpc.mockResolvedValue({ error: null });

    const first = rebuildQueuedInsightsRollups();
    expect(await rebuildQueuedInsightsRollups()).toEqual({ rebuilt: 0, failed: 0, skipped: true });
    release({ error: null });
    expect(await first).toEqual({ rebuilt: 1, failed: 0 });
  });

  it('runs at the end of the nightly sweep', async () => {
    brandRows = [];
    queueRows = [entry];
    rpc.mockResolvedValue({ error: null });

    await sweepInsightsRollups();

    expect(rpc).toHaveBeenCalledWith('refresh_insights_daily', {
      p_brand_id: 'b1',
      p_day_from: '2026-06-01',
      p_day_to: '2026-07-01',
    });
  });
});
