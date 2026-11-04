// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GET /api/chat/skills/connections (W3-07): the kinds a brand the person
 * reaches has connected, for the Skills page's chips; a brand they don't
 * reach, or an id that isn't one, gets nothing.
 */

const state = vi.hoisted(() => ({ on: true, brand: true as boolean }));
const readBrandConnections = vi.hoisted(() =>
  vi.fn(async () => new Set(['google_search_console', 'cms'])),
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
vi.mock('@/lib/chat/agentConnections', () => ({ readBrandConnections }));
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
      `https://app.example.com/api/chat/skills/connections${brand === null ? '' : `?brand=${brand}`}`,
    ),
  );

beforeEach(() => {
  state.on = true;
  state.brand = true;
  readBrandConnections.mockClear();
});

describe('GET /api/chat/skills/connections', () => {
  it('answers the kinds the brand has connected, sorted', async () => {
    const res = await get(BRAND);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, connected: ['cms', 'google_search_console'] });
    expect(readBrandConnections).toHaveBeenCalledWith(BRAND);
  });

  it('reads nothing for a brand the person doesn’t reach, an id that isn’t one, or Chat off', async () => {
    state.brand = false;
    expect((await get(BRAND)).status).toBe(404);
    expect((await get('not-a-brand')).status).toBe(400);
    expect((await get(null)).status).toBe(400);
    state.on = false;
    expect((await get(BRAND)).status).toBe(404);
    expect(readBrandConnections).not.toHaveBeenCalled();
  });
});
