import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * PostgREST answers an un-paginated select with its first 1,000 rows and no
 * sign that more exist. The report's AI traffic section and the MCP / API
 * traffic tool read that way, so a brand past 1,000 visits read as 1,000.
 * Both now count their totals and page through the breakdowns, as the AI
 * Traffic page does (lib/trafficScan.ts).
 */

type Call = [string, ...unknown[]];

// 2,500 visits: 1,500 from ChatGPT to /menu, 1,000 from Gemini to /pricing.
const VISITS = Array.from({ length: 2500 }, (_, i) => ({
  id: `v${String(i).padStart(4, '0')}`,
  url: i < 1500 ? 'https://acme.example/menu' : 'https://acme.example/pricing',
  source_platform: i < 1500 ? 'chatgpt' : 'gemini',
  country: i < 1500 ? 'US' : 'DE',
  created_at: '2026-10-15T09:00:00Z',
}));
const PREVIOUS_VISITS = 1200;
const POSTGREST_MAX_ROWS = 1000;

const queries: { table: string; calls: Call[] }[] = [];
const inserted: Record<string, unknown>[] = [];

function answer(table: string, calls: Call[]) {
  if (table === 'ai_traffic_logs') {
    const select = calls.find(([m]) => m === 'select');
    const head = (select?.[2] as { head?: boolean } | undefined)?.head;
    // The previous period (an exclusive end) has its own, smaller total.
    const previous = calls.some(([m]) => m === 'lt');
    if (head) return { data: null, count: previous ? PREVIOUS_VISITS : VISITS.length, error: null };
    const range = calls.find(([m]) => m === 'range') as [string, number, number] | undefined;
    // Without .range(), PostgREST stops at its cap, as in production.
    const [from, to] = range ? [range[1], range[2]] : [0, POSTGREST_MAX_ROWS - 1];
    return {
      data: VISITS.slice(from, Math.min(to, from + POSTGREST_MAX_ROWS - 1) + 1),
      error: null,
    };
  }
  if (table === 'brands')
    return { data: { id: 'b1', name: 'Acme', shopping_mode_enabled: false }, error: null };
  if (table === 'brand_domains') return { data: [{ domain: 'acme.example' }], error: null };
  if (table === 'reports') return { data: { id: 'report-1' }, error: null };
  return { data: [], error: null };
}

function query(table: string) {
  const calls: Call[] = [];
  queries.push({ table, calls });
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
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: client }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { createReport } = await import('./reports');
const { getAiTrafficFor } = await import('@/lib/mcp/data');

/** The pages each scan asked for, as [first, last] row. */
const scannedRanges = () =>
  queries
    .filter((q) => q.table === 'ai_traffic_logs')
    .flatMap((q) => q.calls.filter(([m]) => m === 'range').map(([, from, to]) => [from, to]));

beforeEach(() => {
  queries.length = 0;
  inserted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ summary: '' }), { status: 200 })),
  );
});

describe('traffic reads past 1,000 visits', () => {
  it("the report's AI traffic section counts every visit and its change", async () => {
    await createReport('b1', {
      dateFrom: '2026-10-11T00:00:00.000Z',
      dateTo: '2026-10-17T23:59:59.999Z',
      sections: ['aiTraffic'],
    });

    const payload = inserted[0].payload as { aiTraffic: Record<string, unknown> };
    expect(payload.aiTraffic.totalVisits).toBe(2500);
    // 2,500 against 1,200: no longer 1,000 against 1,000.
    expect(payload.aiTraffic.change).toBe(108.3);
    expect(payload.aiTraffic.platformBreakdown).toEqual([
      { platform: 'chatgpt', visits: 1500 },
      { platform: 'gemini', visits: 1000 },
    ]);
    expect(payload.aiTraffic.topPages).toEqual([
      { url: 'https://acme.example/menu', visits: 1500 },
      { url: 'https://acme.example/pricing', visits: 1000 },
    ]);
    expect(scannedRanges()).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('the MCP and API traffic tool counts every visit in each breakdown', async () => {
    // A key's owner with All brands, as every key carries its owner's access (BRAND-ACCESS).
    const auth = { organizationId: 'org-1', brandAccess: 'all' } as McpAuthContext;
    const result = await getAiTrafficFor(auth, { brandId: 'b1', dateTo: '2026-10-17' });

    expect(result?.total_visits).toBe(2500);
    expect(result?.platform_breakdown).toEqual([
      { platform: 'chatgpt', visits: 1500 },
      { platform: 'gemini', visits: 1000 },
    ]);
    expect(result?.top_pages).toEqual([
      { url: '/menu', visits: 1500 },
      { url: '/pricing', visits: 1000 },
    ]);
    expect(result?.country_breakdown).toEqual([
      { country: 'US', visits: 1500 },
      { country: 'DE', visits: 1000 },
    ]);
    // A bare day still reads to its end.
    const scan = queries.find(
      (q) => q.table === 'ai_traffic_logs' && q.calls.some(([m]) => m === 'range'),
    )!;
    expect(scan.calls).toContainEqual(['lte', 'created_at', '2026-10-17T23:59:59.999Z']);
  });
});
