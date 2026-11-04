// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The demo brand (00380) on the MCP's REST mirrors: a route that writes,
 * runs or spends refuses it with 402 demo_brand, as its tool does, before
 * the data function writes anything with the service role.
 */

const ORG = 'org-1';
const AUTH = {
  userId: 'user-1',
  email: null,
  organizationId: ORG,
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin' as const,
};

/** The rows the fake database holds, by table and id. */
let rows: Record<string, Record<string, Record<string, unknown>>>;

function from(table: string) {
  const filters: [string, unknown][] = [];
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    maybeSingle: async () => {
      const found = Object.entries(rows[table] ?? {})
        .map(([id, row]) => ({ id, ...row }) as Record<string, unknown>)
        .filter((row) => filters.every(([key, value]) => row[key] === value));
      return { data: found[0] ?? null, error: null };
    },
  };
  return query;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: { from } }));
vi.mock('@/lib/mcpAuth', () => ({ authenticateMcpRequest: async () => AUTH }));

const data = vi.hoisted(() => ({
  updateOpportunityStatusFor: vi.fn(async () => ({ id: 'opportunity-1', status: 'done' })),
}));
vi.mock('@/lib/mcp/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/data')>()),
  ...data,
}));

const { PATCH } = await import('@/app/api/mcp/content-opportunities/[id]/status/route');

const patchStatus = (id: string) =>
  PATCH(
    new Request(`http://localhost/api/mcp/content-opportunities/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  rows = {
    brands: {
      'demo-brand': { organization_id: ORG, is_demo: true },
      'own-brand': { organization_id: ORG, is_demo: false },
    },
    content_opportunities: {
      'opportunity-1': { brand_id: 'demo-brand' },
      'opportunity-2': { brand_id: 'own-brand' },
    },
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the REST mirrors on the demo brand', () => {
  it('refuse a write on it with 402 demo_brand, before the data function runs', async () => {
    const res = await patchStatus('opportunity-1');
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'demo_brand' });
    expect(data.updateOpportunityStatusFor).not.toHaveBeenCalled();
  });

  it("run it on the organization's own brand", async () => {
    const res = await patchStatus('opportunity-2');
    expect(res.status).toBe(200);
    expect(data.updateOpportunityStatusFor).toHaveBeenCalledWith(AUTH, 'opportunity-2', 'done');
  });

  it('check every route that writes, runs or spends', () => {
    const root = join(process.cwd(), 'src/app/api/mcp');
    const routes = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('route.ts'))
      .map((file) => join(root, file));
    // Through the data function, which refuses the demo brand itself.
    const SELF_CHECKED = /\b(runSiteAuditFor|generateBriefFor|createImproveActionFor)\(/;
    const unchecked = routes
      .filter((file) => relative(root, file) !== 'route.ts') // the MCP endpoint: its tools are gated
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        if (!/export (async function|const) (POST|PUT|PATCH|DELETE)\b/.test(source)) return false;
        return !source.includes('demoBrandRefusal(') && !SELF_CHECKED.test(source);
      })
      .map((file) => relative(root, file));
    // A route here writes on whatever brand it's given: call demoBrandRefusal
    // with its tool's name and arguments before the data function.
    expect(unchecked).toEqual([]);
    expect(routes.length).toBeGreaterThan(10);
  });
});
