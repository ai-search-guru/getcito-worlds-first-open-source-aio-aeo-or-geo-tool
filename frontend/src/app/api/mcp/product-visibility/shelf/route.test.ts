// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/product-visibility/shelf: the REST mirror of get_shopping_shelf. */

const { getShoppingShelfFor } = vi.hoisted(() => ({ getShoppingShelfFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
    role: 'admin',
  })),
}));
// The read and the periods are the test's; the plan answer is lib/mcp/data's own (no
// database is read).
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/productVisibility', () => ({
  getShoppingShelfFor,
  PV_PERIODS: ['7d', '30d', '90d', 'all'],
}));

const { GET } = await import('./route');
const { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN } = await import('@/lib/mcp/data');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/product-visibility/shelf${query}`));

beforeEach(() => {
  getShoppingShelfFor.mockReset();
});

describe('GET /api/mcp/product-visibility/shelf', () => {
  it('gives a page of the shelves, with what was asked', async () => {
    getShoppingShelfFor.mockResolvedValue({ total: 1, shelves: [{ prompt_id: 'q1' }] });
    const res = await get(
      '?brand_id=brand-1&period=7d&platform=chatgpt-shopping&market=europe&absent_only=true&limit=10&offset=20',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 1, shelves: [{ prompt_id: 'q1' }] });
    expect(getShoppingShelfFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      period: '7d',
      platform: 'chatgpt-shopping',
      market: 'europe',
      absentOnly: true,
      limit: 10,
      offset: 20,
    });
  });

  it('leaves an unknown period or market to the defaults', async () => {
    getShoppingShelfFor.mockResolvedValue({ total: 0, shelves: [] });
    await get('?brand_id=brand-1&period=1y&market=asia&limit=x');
    expect(getShoppingShelfFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      period: undefined,
      platform: undefined,
      market: undefined,
      absentOnly: false,
      limit: undefined,
      offset: undefined,
    });
  });

  it('asks for a brand, answers 404, 403 without Product Visibility, and 500 on a failed read', async () => {
    expect((await get('')).status).toBe(400);
    expect(getShoppingShelfFor).not.toHaveBeenCalled();
    getShoppingShelfFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    getShoppingShelfFor.mockResolvedValue(NOT_IN_PLAN);
    const locked = await get('?brand_id=brand-1');
    expect(locked.status).toBe(403);
    // The other shopping reads' answer, as the API's requireFeature gives it.
    expect(await locked.json()).toEqual(SHOPPING_NOT_IN_PLAN);
    expect(SHOPPING_NOT_IN_PLAN.error).toBe('plan_limit');
    getShoppingShelfFor.mockRejectedValue(new Error('timeout'));
    expect((await get('?brand_id=brand-1')).status).toBe(500);
  });
});
