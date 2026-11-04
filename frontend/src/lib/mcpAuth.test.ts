// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * authenticateMcpRequest on a read-only workspace (GetCito Cloud, plan not
 * active): the REST routes' reads go through, their writes answer 402
 * subscription_inactive; the MCP endpoint gates its tools instead.
 */

let status: string | null;
let plan: string;
/** The key owner's profile, and the brands shared with them (member_brands) and the demo brand. */
let profile: Record<string, unknown> | null;
let profileError: { code: string; message: string } | null;
let lists: Record<string, Record<string, unknown>[]>;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const row =
        table === 'api_keys'
          ? { id: 'key-1', user_id: 'user-1', revoked_at: null }
          : table === 'profiles'
            ? profile
            : { plan, subscription_status: status };
      const query = {
        select: () => query,
        eq: () => query,
        update: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: lists[table] ?? null, error: null }),
        maybeSingle: async () =>
          table === 'profiles' && profileError
            ? { data: null, error: profileError }
            : { data: row, error: null },
      };
      return query;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'a@example.com' } } }) } },
  },
}));

const { authenticateMcpRequest } = await import('./mcpAuth');

const request = (method: string) =>
  new Request('http://localhost/api/mcp/content-drafts', {
    method,
    headers: { authorization: 'Bearer getcito_test' },
  });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  status = 'canceled';
  plan = 'growth';
  profile = { organization_id: 'org-1', role: 'analyst', brand_scope: 'all' };
  profileError = null;
  lists = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authenticateMcpRequest on a read-only workspace', () => {
  it('lets a read through', async () => {
    const auth = await authenticateMcpRequest(request('GET'));
    expect(auth).toMatchObject({ userId: 'user-1', organizationId: 'org-1' });
  });

  it("carries the user's role, for the tools that check it", async () => {
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({ role: 'analyst' });
  });

  it('answers a write with 402 subscription_inactive', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = (await authenticateMcpRequest(request(method))) as Response;
      expect(res.status).toBe(402);
      expect(await res.json()).toMatchObject({
        error: 'plan_limit',
        code: 'subscription_inactive',
      });
    }
  });

  it('leaves the MCP endpoint to gate its tools', async () => {
    const auth = await authenticateMcpRequest(request('POST'), { gateWrites: false });
    expect(auth).toMatchObject({ organizationId: 'org-1' });
  });

  it('lets a write through once the plan is active', async () => {
    status = 'active';
    expect(await authenticateMcpRequest(request('POST'))).toMatchObject({ apiKeyId: 'key-1' });
  });

  it('never gates self-hosted', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    expect(await authenticateMcpRequest(request('POST'))).toMatchObject({ apiKeyId: 'key-1' });
  });
});

describe('authenticateMcpRequest per plan (DECISIONS S, 2026-10-30)', () => {
  it.each([
    ['starter', 'active'],
    ['growth', 'trialing'],
  ])('answers a write on %s (%s) with 402 plan_required, and lets reads through', async (p, s) => {
    plan = p;
    status = s;
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({ apiKeyId: 'key-1' });
    const res = (await authenticateMcpRequest(request('PATCH'))) as Response;
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'plan_required', required_plan: 'growth' });
  });

  it.each([
    ['growth', 'active'],
    ['enterprise', 'trialing'],
  ])('lets a write through on %s (%s)', async (p, s) => {
    plan = p;
    status = s;
    expect(await authenticateMcpRequest(request('POST'))).toMatchObject({ apiKeyId: 'key-1' });
  });

  it('answers a plan that ended with subscription_inactive first', async () => {
    plan = 'starter';
    const res = (await authenticateMcpRequest(request('POST'))) as Response;
    expect(await res.json()).toMatchObject({ code: 'subscription_inactive' });
  });
});

describe("authenticateMcpRequest carries the key owner's brand access (BRAND-ACCESS)", () => {
  it('gives All brands to everyone who has them, as everyone starts', async () => {
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({ brandAccess: 'all' });
    // An Admin always has All brands, whatever the scope says.
    profile = { organization_id: 'org-1', role: 'admin', brand_scope: 'selected' };
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({ brandAccess: 'all' });
  });

  it('gives a Selected-brands person the brands shared with them, and the demo brand', async () => {
    profile = { organization_id: 'org-1', role: 'manager', brand_scope: 'selected' };
    lists = { member_brands: [{ brand_id: 'b2' }], brands: [{ id: 'demo' }] };
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({
      brandAccess: ['b2', 'demo'],
    });
  });

  it('reaches no brand without a workspace', async () => {
    profile = { organization_id: null, role: null, brand_scope: 'all' };
    expect(await authenticateMcpRequest(request('GET'))).toMatchObject({
      organizationId: null,
      brandAccess: null,
    });
  });

  it('answers 503 when the access can’t be read, so no tool runs on a guess', async () => {
    profileError = { code: '57014', message: 'timeout' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = (await authenticateMcpRequest(request('GET'))) as Response;
    expect(res.status).toBe(503);
  });
});
