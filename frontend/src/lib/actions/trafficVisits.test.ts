import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AT-003: the AI Traffic page counts visits, one per session, and pageviews
 * on their own (F5). A row starts a visit when its `visit_of` is null. The
 * summary counts them in the database since AT-004 (trafficMerged.test.ts).
 */

type Call = [string, ...unknown[]];
type Result = { data?: unknown; count?: number | null; error: null };

const queries: Call[][] = [];
let answer: (calls: Call[]) => Result;

// A query builder that records its calls and answers once awaited.
function query(table: string) {
  const calls: Call[] = [['from', table]];
  queries.push(calls);
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'gte',
    'lte',
    'lt',
    'ilike',
    'order',
    'range',
    'in',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (r: Result) => unknown) => resolve(answer(calls));
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from: (table: string) => query(table) })),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { getTrafficLogs } from './traffic';

const has = (calls: Call[], method: string, ...args: unknown[]) =>
  calls.some(([m, ...rest]) => m === method && args.every((a, i) => Object.is(rest[i], a)));
const visitsOnly = (calls: Call[]) => has(calls, 'is', 'visit_of', null);
const head = (calls: Call[]) =>
  calls.some(([m, , opts]) => m === 'select' && (opts as { head?: boolean })?.head === true);

const row = (id: string, url: string, platform = 'gemini.google.com') => ({
  id,
  brand_id: 'b1',
  url,
  referrer: null,
  source_platform: platform,
  country: 'US',
  language: 'en',
  screen: null,
  created_at: '2026-10-17T10:00:00.000Z',
  visit_of: null,
});

beforeEach(() => {
  queries.length = 0;
});

describe('getTrafficLogs', () => {
  beforeEach(() => {
    answer = (calls) => {
      if (has(calls, 'in')) {
        // v1 had two more pageviews, v2 none.
        return { data: [{ visit_of: 'v1' }, { visit_of: 'v1' }], error: null };
      }
      if (head(calls)) return { count: 7, error: null };
      return {
        data: [row('v1', 'https://acme.example/menu/'), row('v2', 'https://acme.example/beans')],
        count: 4,
        error: null,
      };
    };
  });

  it('lists one row per visit with its pageviews (F5)', async () => {
    const result = await getTrafficLogs('b1', { limit: 10, dateFrom: '2026-10-11T00:00:00Z' });

    expect(result.total).toBe(4);
    expect(result.pageviews).toBe(7);
    expect(result.logs.map((log) => [log.id, log.pageviews])).toEqual([
      ['v1', 3],
      ['v2', 1],
    ]);

    const [list, pageviews, repeats] = queries;
    expect(visitsOnly(list)).toBe(true);
    expect(has(list, 'range', 0, 9)).toBe(true);
    // The pageview total counts every row, not just the visits.
    expect(visitsOnly(pageviews)).toBe(false);
    expect(has(repeats, 'select', 'visit_of')).toBe(true);
    expect(repeats.find(([m]) => m === 'in')).toEqual(['in', 'visit_of', ['v1', 'v2']]);
  });

  it('applies the same filters to the visits and the pageview total', async () => {
    await getTrafficLogs('b1', {
      platform: 'gemini.google.com',
      search: 'menu',
      dateFrom: '2026-10-11T00:00:00Z',
    });
    for (const calls of queries.slice(0, 2)) {
      expect(has(calls, 'eq', 'source_platform', 'gemini.google.com')).toBe(true);
      expect(has(calls, 'ilike', 'url', '%menu%')).toBe(true);
      expect(has(calls, 'gte', 'created_at', '2026-10-11T00:00:00Z')).toBe(true);
    }
  });

  it('skips the pageview lookup when there are no visits', async () => {
    answer = (calls) =>
      head(calls) ? { count: 0, error: null } : { data: [], count: 0, error: null };
    const result = await getTrafficLogs('b1');
    expect(result).toEqual({ logs: [], total: 0, pageviews: 0 });
    expect(queries).toHaveLength(2);
  });
});
