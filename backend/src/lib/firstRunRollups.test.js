import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A brand's first run fills the rollups while its answers land, instead of
 * leaving Citations, Mentions and the wider Visibility ranges empty until it
 * stamps.
 */

const runs = vi.hoisted(() => ({ rows: [], error: null, filters: [] }));
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args) => {
          runs.filters.push(['eq', ...args]);
          return chain;
        },
        not: (...args) => {
          runs.filters.push(['not', ...args]);
          return chain;
        },
        limit: () => Promise.resolve({ data: runs.error ? null : runs.rows, error: runs.error }),
      };
      return chain;
    },
  },
}));

// Each refresh stays running until released.
const refresh = vi.hoisted(() => ({ calls: [], releases: [] }));
vi.mock('./insightsRollups.js', () => ({
  refreshRunDays: vi.fn(
    (...args) =>
      new Promise((resolve) => {
        refresh.calls.push(args);
        refresh.releases.push(() => resolve(true));
      }),
  ),
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const { isFirstRun, progressiveRollups, PROGRESSIVE_REFRESH_MS } =
  await import('./firstRunRollups.js');

const STARTED = '2026-10-29T10:00:00.000Z';
const MINUTE = 60_000;
let clock;
const make = (enabled = true) =>
  progressiveRollups({ brandId: 'b1', startedAt: STARTED, enabled, now: () => clock });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const releaseAll = async () => {
  refresh.releases.splice(0).forEach((release) => release());
  await tick();
};

beforeEach(() => {
  clock = 0;
  refresh.calls.length = 0;
  refresh.releases.length = 0;
  runs.rows = [];
  runs.error = null;
  runs.filters.length = 0;
});

describe('progressiveRollups', () => {
  it('refreshes the run days as soon as the first answers land', () => {
    const rollups = make();
    rollups.note(0);
    expect(refresh.calls).toEqual([]);

    rollups.note(3);
    expect(refresh.calls).toEqual([['b1', STARTED]]);
  });

  it('refreshes at most once per interval, and only when more have landed', async () => {
    const rollups = make();
    rollups.note(3);
    await releaseAll();

    clock += PROGRESSIVE_REFRESH_MS - 1;
    rollups.note(10);
    expect(refresh.calls).toHaveLength(1);

    clock += 1;
    rollups.note(10);
    expect(refresh.calls).toHaveLength(2);
    await releaseAll();

    // Nothing new since: no refresh, however long it has been.
    clock += 10 * PROGRESSIVE_REFRESH_MS;
    rollups.note(10);
    expect(refresh.calls).toHaveLength(2);
  });

  it('waits five times as long as a slow refresh took before the next', async () => {
    const rollups = make();
    rollups.note(3);
    // This brand's refresh takes a minute.
    clock += MINUTE;
    await releaseAll();

    // Two minutes since it started is not enough: five minutes are.
    clock += 3 * MINUTE;
    rollups.note(10);
    expect(refresh.calls).toHaveLength(1);

    clock += MINUTE;
    rollups.note(10);
    expect(refresh.calls).toHaveLength(2);
  });

  it('never starts a refresh while one is running', () => {
    const rollups = make();
    rollups.note(3);
    clock += 10 * PROGRESSIVE_REFRESH_MS;
    rollups.note(20);
    expect(refresh.calls).toHaveLength(1);
  });

  it('is idle only once the running refresh is done', async () => {
    const rollups = make();
    rollups.note(3);

    let idle = false;
    const waiting = rollups.idle().then(() => {
      idle = true;
    });
    await tick();
    expect(idle).toBe(false);

    await releaseAll();
    await waiting;
    expect(idle).toBe(true);
    // No refresh of its own.
    expect(refresh.calls).toHaveLength(1);
  });

  it('on flush, waits for the running refresh, then refreshes at once', async () => {
    const rollups = make();
    rollups.note(3);

    let flushed = false;
    const flushing = rollups.flush(3).then(() => {
      flushed = true;
    });
    await tick();
    expect(refresh.calls).toHaveLength(1);

    await releaseAll();
    // Within the interval and with the same count: refreshed all the same.
    expect(refresh.calls).toHaveLength(2);
    expect(flushed).toBe(false);

    await releaseAll();
    await flushing;
    expect(flushed).toBe(true);
  });

  it('follows a new count after a flush, as the late answers land', async () => {
    const rollups = make();
    const flushing = rollups.flush(40);
    await tick();
    await releaseAll();
    await flushing;

    clock += PROGRESSIVE_REFRESH_MS;
    rollups.note(40);
    expect(refresh.calls).toHaveLength(1);
    rollups.note(44);
    expect(refresh.calls).toHaveLength(2);
  });

  it('does nothing for a run that is not a first run', async () => {
    const rollups = make(false);
    rollups.note(5);
    await rollups.flush(9);
    await rollups.idle();
    expect(refresh.calls).toEqual([]);
  });

  it('does nothing without the run row to date it', async () => {
    const rollups = progressiveRollups({ brandId: 'b1', startedAt: null, enabled: true });
    rollups.note(5);
    await rollups.flush(9);
    expect(refresh.calls).toEqual([]);
  });
});

describe('isFirstRun', () => {
  it('is true for a brand with no stamped run', async () => {
    expect(await isFirstRun('b1')).toBe(true);
    expect(runs.filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['not', 'completed_at', 'is', null],
    ]);
  });

  it('is false once a run has stamped', async () => {
    runs.rows = [{ id: 'run1' }];
    expect(await isFirstRun('b1')).toBe(false);
  });

  it('is false when the ledger cannot be read', async () => {
    runs.error = { message: 'timeout' };
    expect(await isFirstRun('b1')).toBe(false);
  });
});
