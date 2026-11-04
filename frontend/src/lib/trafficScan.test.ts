import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  TRAFFIC_MAX_ROWS,
  TRAFFIC_PAGE_SIZE,
  countTrafficLogs,
  scanTrafficLogs,
} from './trafficScan';

/**
 * Reading AI-referred visits past PostgREST's 1,000-row cap: totals by an
 * exact count, breakdowns a page at a time in a fixed order.
 */

type Call = [string, ...unknown[]];

/** A client whose ai_traffic_logs holds `total` visits, answering at most a page per request. */
function fakeClient(total: number, count = total) {
  const queries: Call[][] = [];
  const client = {
    from: () => {
      const calls: Call[] = [];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'gte', 'lte', 'lt', 'order', 'range']) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve: (a: unknown) => unknown) => {
        const range = calls.find(([m]) => m === 'range') as [string, number, number] | undefined;
        if (!range) return resolve({ data: null, count, error: null });
        const [, from, to] = range;
        const size = Math.max(0, Math.min(to, total - 1) - from + 1);
        return resolve({
          data: Array.from({ length: size }, (_, i) => ({ id: `v${from + i}` })),
          error: null,
        });
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe('countTrafficLogs', () => {
  it('counts the visits in a window without reading a row', async () => {
    const { client, queries } = fakeClient(0, 4321);
    await expect(
      countTrafficLogs(client, 'b1', { from: '2026-10-01', to: '2026-10-08' }),
    ).resolves.toBe(4321);

    expect(queries[0]).toEqual([
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'brand_id', 'b1'],
      ['is', 'visit_of', null],
      ['gte', 'created_at', '2026-10-01'],
      // The window's end is its first moment after: exclusive.
      ['lt', 'created_at', '2026-10-08'],
    ]);
  });

  it('counts every pageview when asked, up to an inclusive end', async () => {
    const { client, queries } = fakeClient(0, 9);
    await countTrafficLogs(
      client,
      'b1',
      { to: '2026-10-08T23:59:59.999Z', toInclusive: true },
      { visits: false },
    );
    expect(queries[0]).not.toContainEqual(['is', 'visit_of', null]);
    expect(queries[0]).toContainEqual(['lte', 'created_at', '2026-10-08T23:59:59.999Z']);
  });
});

describe('scanTrafficLogs', () => {
  it('reads every visit a page at a time, in a fixed order', async () => {
    const { client, queries } = fakeClient(2500);
    const seen: unknown[] = [];
    await scanTrafficLogs(client, 'b1', { columns: 'id', from: '2026-10-01' }, (r) =>
      seen.push(r.id),
    );

    expect(seen).toHaveLength(2500);
    expect(new Set(seen).size).toBe(2500);
    expect(queries.map((q) => q.find(([m]) => m === 'range')?.slice(1))).toEqual([
      [0, TRAFFIC_PAGE_SIZE - 1],
      [1000, 1999],
      [2000, 2999],
    ]);
    // Created time, then id: pages never overlap or skip a row.
    expect(queries[0]).toContainEqual(['order', 'created_at', { ascending: true }]);
    expect(queries[0]).toContainEqual(['order', 'id', { ascending: true }]);
    expect(queries[0]).toContainEqual(['is', 'visit_of', null]);
  });

  it('stops at its ceiling', async () => {
    const { client, queries } = fakeClient(TRAFFIC_MAX_ROWS + 5000);
    let rows = 0;
    await scanTrafficLogs(client, 'b1', { columns: 'id' }, () => rows++);
    expect(rows).toBe(TRAFFIC_MAX_ROWS);
    expect(queries).toHaveLength(TRAFFIC_MAX_ROWS / TRAFFIC_PAGE_SIZE);
  });
});
