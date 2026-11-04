import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The report's AI traffic change follows the AI Traffic page's rule
 * (AT-003): a % only when both periods have at least 30 visits. A report
 * showed "+62400%" for 1,250 visits against 2 the week before.
 */

type Call = [string, ...unknown[]];

let current = 0;
let previous = 0;
const inserted: Record<string, unknown>[] = [];

function answer(table: string, calls: Call[]) {
  if (table === 'ai_traffic_logs') {
    const select = calls.find(([m]) => m === 'select');
    if ((select?.[2] as { head?: boolean } | undefined)?.head) {
      // The previous period ends where the report starts (an exclusive end).
      return {
        data: null,
        count: calls.some(([m]) => m === 'lt') ? previous : current,
        error: null,
      };
    }
    return { data: [], error: null };
  }
  if (table === 'brands')
    return { data: { id: 'b1', name: 'Acme', shopping_mode_enabled: false }, error: null };
  if (table === 'reports') return { data: { id: 'report-1' }, error: null };
  return { data: [], error: null };
}

function query(table: string) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'is',
    'in',
    'gte',
    'lte',
    'lt',
    'order',
    'range',
    'limit',
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.insert = (row: Record<string, unknown>) => {
    inserted.push(row);
    return builder;
  };
  builder.single = async () => answer(table, calls);
  builder.maybeSingle = async () => answer(table, calls);
  builder.then = (resolve: (a: unknown) => unknown) => resolve(answer(table, calls));
  return builder;
}

const client = {
  from: (table: string) => query(table),
  rpc: async () => ({ data: [], error: null }),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'tok', user: { id: 'u1' } } } }),
  },
};
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { createReport } = await import('./reports');

beforeEach(() => {
  inserted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ summary: '' }), { status: 200 })),
  );
});

async function aiTraffic(now: number, before: number) {
  current = now;
  previous = before;
  inserted.length = 0;
  await createReport('b1', {
    dateFrom: '2026-10-11T00:00:00.000Z',
    dateTo: '2026-10-17T23:59:59.999Z',
    sections: ['aiTraffic'],
  });
  return (inserted[0].payload as { aiTraffic: Record<string, unknown> }).aiTraffic;
}

describe("the report's AI traffic change", () => {
  it('gives a % once both periods have 30 visits', async () => {
    expect(await aiTraffic(45, 30)).toMatchObject({ totalVisits: 45, change: 50 });
    expect((await aiTraffic(45, 30)).changeNote).toBeUndefined();
  });

  it('says Low sample instead of a % below 30 visits on either side', async () => {
    // The live case: 1,250 visits against 2 read "+62400%".
    expect(await aiTraffic(1250, 2)).toMatchObject({ change: null, changeNote: 'lowSample' });
    expect(await aiTraffic(12, 40)).toMatchObject({ change: null, changeNote: 'lowSample' });
  });

  it('says new when there were no visits before, and nothing with none at all', async () => {
    expect(await aiTraffic(5, 0)).toMatchObject({ change: null, changeNote: 'new' });
    const none = await aiTraffic(0, 0);
    expect(none.change).toBeNull();
    expect(none.changeNote).toBeUndefined();
  });

  it('keeps a change that rounds to nothing as 0%', async () => {
    expect(await aiTraffic(1000, 1000)).toMatchObject({ change: 0 });
  });
});
