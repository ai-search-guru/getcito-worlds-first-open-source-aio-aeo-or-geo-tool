import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/prompts/usage (PROMPT-012): who may read a brand's usage, and the
 * plan the cards are measured against — the organization's own, read with the
 * brand in the same round trip as the counts.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';

let user: { id: string } | null;
let brand: { data: unknown; error: { message: string } | null };
let usage: { data: unknown; error: { message: string } | null };
const rpc = vi.fn(async () => usage);

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => brand }) }),
    }),
    rpc,
  }),
}));

const { GET } = await import('./route');

const get = (query: string) => GET(new Request(`http://localhost/api/prompts/usage${query}`));

const counts = {
  brand_active: 46,
  brand_paused: 2,
  account_active: 46,
  account_brands: 1,
  account_locations: 46,
};

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'u1' };
  brand = {
    data: {
      organization_id: 'org1',
      organizations: { plan: 'starter', subscription_status: 'active', plan_overrides: null },
    },
    error: null,
  };
  usage = { data: [counts], error: null };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/prompts/usage', () => {
  it("returns the brand's counts against its organization's plan", async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');

    const res = await get(`?brandId=${BRAND}`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toMatchObject({
      plan: { key: 'starter', name: 'Starter plan', locationLimit: 50, cta: 'upgrade_growth' },
      brand: { active: 46, paused: 2, total: 48 },
      account: { activePrompts: 46, brands: 1, locationsUsed: 46 },
    });
    expect(rpc).toHaveBeenCalledWith('prompt_usage_summary', { p_brand_id: BRAND });
  });

  it('measures an Enterprise account against the limit set for it', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    brand.data = {
      organization_id: 'org1',
      organizations: {
        plan: 'enterprise',
        subscription_status: 'active',
        plan_overrides: { maxPrompts: 1000 },
      },
    };

    const body = await (await get(`?brandId=${BRAND}`)).json();

    expect(body.plan).toEqual({
      key: 'enterprise',
      name: 'Enterprise plan',
      locationLimit: 1000,
      cta: 'contact',
    });
  });

  it('counts an organization whose plan ended against the plan it was on, not Starter', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    brand.data = {
      organization_id: 'org1',
      organizations: { plan: 'growth', subscription_status: 'canceled', plan_overrides: null },
    };

    const body = await (await get(`?brandId=${BRAND}`)).json();

    expect(body.plan).toEqual({
      key: 'growth',
      name: 'Growth plan',
      locationLimit: 200,
      cta: 'choose_plan',
      ended: true,
    });
  });

  it('is unlimited on a self-hosted install', async () => {
    const body = await (await get(`?brandId=${BRAND}`)).json();
    expect(body.plan).toEqual({
      key: 'self_hosted',
      name: 'Self-Hosted plan',
      locationLimit: null,
      cta: null,
    });
  });

  it('rejects a missing or malformed brand id', async () => {
    expect((await get('')).status).toBe(400);
    expect((await get('?brandId=nope')).status).toBe(400);
  });

  it('needs a signed-in user', async () => {
    user = null;
    expect((await get(`?brandId=${BRAND}`)).status).toBe(401);
  });

  it("is not found for a brand outside the caller's organization", async () => {
    brand = { data: null, error: null };
    usage = { data: [], error: null };
    expect((await get(`?brandId=${BRAND}`)).status).toBe(404);
  });

  it('reports a database failure as an error, not as a missing brand', async () => {
    brand = { data: null, error: { message: 'statement timeout' } };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await get(`?brandId=${BRAND}`)).status).toBe(500);
  });
});
