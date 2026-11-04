// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/chat/connections (W4-24): a brand's connections for the chat
 * menu and the Connections page, with whether the person may connect
 * (Admins only); a brand they don't reach, or an id that isn't one, gets
 * nothing.
 */

const state = vi.hoisted(() => ({
  on: true,
  brand: true as boolean,
  role: 'admin' as string,
  offered: false,
}));
const readConnections = vi.hoisted(() =>
  vi.fn(async (params: unknown) => (params ? [{ key: 'webflow', status: 'connected' }] : [])),
);

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: state.brand ? { id: 'b' } : null, error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/chat/connections', () => ({ readConnections }));
vi.mock('@/lib/mcp/productVisibility', () => ({
  merchantCenterOffered: async () => state.offered,
}));
vi.mock('@/lib/chat/agents', () => ({
  readAgentContext: async () => ({
    viewer: { userId: 'u1', role: state.role, brandAccess: 'all' },
  }),
}));
vi.mock('@/lib/chat/runApi', async (original) => {
  const actual = await original<typeof import('@/lib/chat/runApi')>();
  return {
    ...actual,
    chatActor: async () =>
      state.on
        ? { userId: 'u1', email: null, organizationId: 'org-1' }
        : actual.runFailure(404, 'not_found', 'not_found', 'Not found'),
  };
});

const { GET } = await import('./route');
const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
const get = (brand: string | null) =>
  GET(
    new Request(
      `https://app.example.com/api/chat/connections${brand === null ? '' : `?brand=${brand}`}`,
    ),
  );

beforeEach(() => {
  state.on = true;
  state.brand = true;
  state.role = 'admin';
  state.offered = false;
  readConnections.mockClear();
});

describe('GET /api/chat/connections', () => {
  it('answers the brand’s connections, read for the person, and whether they may connect', async () => {
    state.offered = true;
    const res = await get(BRAND);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      connections: [{ key: 'webflow', status: 'connected' }],
      canConnect: true,
    });
    expect(readConnections).toHaveBeenCalledWith({
      organizationId: 'org-1',
      brandId: BRAND,
      viewer: { userId: 'u1', role: 'admin', brandAccess: 'all' },
      merchantCenterOffered: true,
    });
    state.role = 'manager';
    expect(await (await get(BRAND)).json()).toMatchObject({ canConnect: false });
  });

  it('reads nothing for a brand the person doesn’t reach, an id that isn’t one, or Chat off', async () => {
    state.brand = false;
    expect((await get(BRAND)).status).toBe(404);
    expect((await get('not-a-brand')).status).toBe(400);
    expect((await get(null)).status).toBe(400);
    state.on = false;
    expect((await get(BRAND)).status).toBe(404);
    expect(readConnections).not.toHaveBeenCalled();
  });

  it('answers a failed read as a value, never a thrown error', async () => {
    readConnections.mockRejectedValueOnce(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await get(BRAND);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, failure: 'failed' });
  });
});
