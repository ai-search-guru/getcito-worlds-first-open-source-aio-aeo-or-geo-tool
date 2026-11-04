import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-017 (spec §3.01): the trend reads the 24-hour range hour by hour, and
 * longer ranges by day.
 */

const ROWS = [
  { source_platform: 'gemini.google.com', created_at: '2026-10-18T09:05:00+00:00', id: '1' },
  { source_platform: 'gemini.google.com', created_at: '2026-10-18T09:40:00+00:00', id: '2' },
  { source_platform: 'chatgpt.com', created_at: '2026-10-18T11:10:00+00:00', id: '3' },
];

function query() {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'order', 'range', 'gte', 'lte', 'lt']) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: ROWS, error: null });
  return builder;
}

// Longer windows read the snippet and Google Analytics day by day (AT-004).
const rpc = vi.fn(async () => ({
  data: {
    days: [
      { day: '2026-10-12', platform: 'chatgpt.com', visits: 5 },
      { day: '2026-10-18', platform: 'gemini.google.com', visits: 2 },
      { day: '2026-10-18', platform: 'chatgpt.com', visits: 1 },
    ],
  },
  error: null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: () => query(), rpc }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficTrend } from './traffic';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getTrafficTrend', () => {
  it('reads the last 24 hours hour by hour', async () => {
    const points = await getTrafficTrend('b1', { dateFrom: '2026-10-17T12:30:00.000Z' });

    expect(points).toHaveLength(25);
    expect(points[0].date).toBe('2026-10-17T12:00:00.000Z');
    expect(points.at(-1)!.date).toBe('2026-10-18T12:00:00.000Z');
    const hour = (h: string) => points.find((p) => p.date === h)!;
    expect(hour('2026-10-18T09:00:00.000Z')).toEqual({
      date: '2026-10-18T09:00:00.000Z',
      'gemini.google.com': 2,
      'chatgpt.com': 0,
    });
    expect(hour('2026-10-18T11:00:00.000Z')['chatgpt.com']).toBe(1);
  });

  it('reads 7 days day by day, from the snippet or Google Analytics', async () => {
    const points = await getTrafficTrend('b1', { dateFrom: '2026-10-11T12:30:00.000Z' });

    expect(rpc).toHaveBeenCalledWith('ai_traffic_merged', {
      p_brand_id: 'b1',
      p_from: '2026-10-11T12:30:00.000Z',
      p_to: '2026-10-18T12:30:00.000Z',
      p_to_inclusive: true,
      p_analytics: true,
    });
    expect(points.map((p) => p.date)).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(points[1]).toEqual({ date: '2026-10-12', 'chatgpt.com': 5, 'gemini.google.com': 0 });
    expect(points.at(-1)).toEqual({
      date: '2026-10-18',
      'chatgpt.com': 1,
      'gemini.google.com': 2,
    });
  });

  it('reads 24 hours from the snippet alone: Google Analytics has no hours', async () => {
    rpc.mockClear();
    await getTrafficTrend('b1', { dateFrom: '2026-10-17T12:30:00.000Z' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
