import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getTrackingWindow's run times for the Insights header (VIS-012): the last
 * run is the newest completed run of any kind, and the next one is worked
 * out from the scheduled (cron) runs only, so a Run All never moves it.
 */

interface Run {
  source: string;
  started_at: string;
  completed_at: string | null;
}

let runs: Run[] = [];

function trackingRuns() {
  const filters: { eq: Record<string, unknown>; notNull?: string; isNull?: string } = { eq: {} };
  let order: string | null = null;
  let limit = Infinity;
  const result = () => {
    const rows = runs
      .filter((r) =>
        Object.entries(filters.eq).every(([k, v]) => k === 'brand_id' || r[k as keyof Run] === v),
      )
      .filter((r) => !filters.notNull || r[filters.notNull as keyof Run] !== null)
      .filter((r) => !filters.isNull || r[filters.isNull as keyof Run] === null)
      .sort((a, b) =>
        order ? String(b[order as keyof Run]).localeCompare(String(a[order as keyof Run])) : 0,
      )
      .slice(0, limit);
    return { data: rows, error: null };
  };
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      filters.eq[col] = val;
      return b;
    },
    not: (col: string) => {
      filters.notNull = col;
      return b;
    },
    is: (col: string) => {
      filters.isNull = col;
      return b;
    },
    gte: () => b,
    order: (col: string) => {
      order = col;
      return b;
    },
    limit: (n: number) => {
      limit = n;
      return b;
    },
    then: (resolve: (r: unknown) => void) => resolve(result()),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => trackingRuns() }),
}));
vi.mock('@/lib/actions/topic', () => ({ getTopicById: vi.fn() }));

const { getTrackingWindow } = await import('./tracking');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T13:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrackingWindow run times', () => {
  it('takes the last run from any completed run and the next from the scheduled ones', async () => {
    runs = [
      {
        source: 'cron',
        started_at: '2026-10-14T02:00:00.000Z',
        completed_at: '2026-10-14T02:50:00.000Z',
      },
      {
        source: 'cron',
        started_at: '2026-10-15T02:00:00.000Z',
        completed_at: '2026-10-15T02:50:00.000Z',
      },
      // A Run All at lunchtime: the latest run, but not the schedule.
      {
        source: 'manual',
        started_at: '2026-10-15T11:30:00.000Z',
        completed_at: '2026-10-15T12:10:00.000Z',
      },
    ];

    expect(await getTrackingWindow('b1')).toMatchObject({
      lastRunAt: '2026-10-15T12:10:00.000Z',
      nextRunAt: '2026-10-16T02:00:00.000Z',
    });
  });

  it('knows no next run without scheduled runs, and no last run without completed ones', async () => {
    runs = [{ source: 'manual', started_at: '2026-10-15T12:55:00.000Z', completed_at: null }];

    expect(await getTrackingWindow('b1')).toMatchObject({ lastRunAt: null, nextRunAt: null });
  });
});
