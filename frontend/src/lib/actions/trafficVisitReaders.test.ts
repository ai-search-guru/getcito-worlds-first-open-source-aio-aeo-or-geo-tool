import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * Every reader of the tracking snippet's rows counts visits, as the AI
 * Traffic page does since 00172: a row whose visit_of is null starts a visit,
 * and the rows pointing at it are its reloads. The report, the brand cards,
 * a citation's page detail and the MCP / API traffic tool must say the same
 * number as the page for the same days.
 */

type Call = [string, ...unknown[]];
type Answer = { data?: unknown; count?: number; error: null };

const queries: { table: string; calls: Call[] }[] = [];
const inserted: Record<string, unknown>[] = [];

// One visit to /menu with two reloads, and one visit to /pricing: two
// visits, four pageviews.
const PAGEVIEWS = [
  {
    id: 'v1',
    brand_id: 'b1',
    url: 'https://acme.example/menu',
    source_platform: 'gemini',
    country: 'US',
    created_at: '2026-10-15T09:00:00Z',
    visit_of: null,
  },
  {
    id: 'r1',
    brand_id: 'b1',
    url: 'https://acme.example/menu',
    source_platform: 'gemini',
    country: 'US',
    created_at: '2026-10-15T09:01:00Z',
    visit_of: 'v1',
  },
  {
    id: 'r2',
    brand_id: 'b1',
    url: 'https://acme.example/menu',
    source_platform: 'gemini',
    country: 'US',
    created_at: '2026-10-15T09:02:00Z',
    visit_of: 'v1',
  },
  {
    id: 'v2',
    brand_id: 'b1',
    url: 'https://acme.example/pricing',
    source_platform: 'chatgpt',
    country: 'DE',
    created_at: '2026-10-16T09:00:00Z',
    visit_of: null,
  },
];

const visitsOnly = (calls: Call[]) =>
  calls.some(([m, col, val]) => m === 'is' && col === 'visit_of' && val === null);

function answer(table: string, calls: Call[]): Answer {
  if (table === 'ai_traffic_logs') {
    // The rows a query gets back depend on whether it asked for visits.
    const rows = visitsOnly(calls) ? PAGEVIEWS.filter((r) => r.visit_of === null) : PAGEVIEWS;
    return { data: rows, count: rows.length, error: null };
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
    'ilike',
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
  builder.then = (resolve: (a: Answer) => unknown) => resolve(answer(table, calls));
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
const { getBrandsCardSummary } = await import('./brand');
const { getCitationUrlDetail } = await import('./citations');
const { getAiTrafficFor } = await import('@/lib/mcp/data');

const trafficQueries = () => queries.filter((q) => q.table === 'ai_traffic_logs');

beforeEach(() => {
  queries.length = 0;
  inserted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ summary: '' }), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readers of the snippet count visits, not pageviews', () => {
  it("the report's AI traffic section", async () => {
    await createReport('b1', {
      dateFrom: '2026-10-11T00:00:00.000Z',
      dateTo: '2026-10-17T23:59:59.999Z',
      sections: ['aiTraffic'],
    });

    const payload = inserted[0].payload as { aiTraffic: Record<string, unknown> };
    expect(payload.aiTraffic.totalVisits).toBe(2);
    expect(payload.aiTraffic.platformBreakdown).toEqual([
      { platform: 'gemini', visits: 1 },
      { platform: 'chatgpt', visits: 1 },
    ]);
    // A count for this window and the one before it, and the breakdowns' scan.
    expect(trafficQueries()).toHaveLength(3);
    for (const q of trafficQueries()) expect(visitsOnly(q.calls)).toBe(true);
  });

  it("the brand cards' last 7 days", async () => {
    const summary = await getBrandsCardSummary(['b1']);
    expect(summary.b1.trafficVisits7d).toBe(2);
    expect(visitsOnly(trafficQueries()[0].calls)).toBe(true);
  });

  it("a brand page's visits on its citation detail", async () => {
    const detail = await getCitationUrlDetail('b1', 'https://acme.example/menu', {
      datePreset: 'all',
    });
    expect(detail.owned?.traffic).toEqual({
      totalVisits: 1,
      byPlatform: [{ platform: 'gemini', visits: 1 }],
    });
    expect(visitsOnly(trafficQueries()[0].calls)).toBe(true);
  });

  it('the MCP and API traffic tool', async () => {
    // A key's owner with All brands, as every key carries its owner's access (BRAND-ACCESS).
    const auth = { organizationId: 'org-1', brandAccess: 'all' } as McpAuthContext;
    const result = await getAiTrafficFor(auth, { brandId: 'b1' });
    expect(result?.total_visits).toBe(2);
    expect(result?.top_pages).toEqual([
      { url: '/menu', visits: 1 },
      { url: '/pricing', visits: 1 },
    ]);
    expect(visitsOnly(trafficQueries()[0].calls)).toBe(true);
  });
});
