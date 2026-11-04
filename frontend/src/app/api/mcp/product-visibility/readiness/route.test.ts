// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/product-visibility/readiness: the REST mirror of get_shopping_readiness. */

const { getShoppingReadinessFor } = vi.hoisted(() => ({ getShoppingReadinessFor: vi.fn() }));
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
  getShoppingReadinessFor,
  PV_PERIODS: ['7d', '30d', '90d', 'all'],
}));

const { GET } = await import('./route');
const { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN } = await import('@/lib/mcp/data');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/product-visibility/readiness${query}`));

beforeEach(() => {
  getShoppingReadinessFor.mockReset();
});

describe('GET /api/mcp/product-visibility/readiness', () => {
  it("gives the brand's readiness", async () => {
    getShoppingReadinessFor.mockResolvedValue({ market: 'us', score: 70, checks: [] });
    const res = await get('?brand_id=brand-1&period=90d&market=us');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ market: 'us', score: 70, checks: [] });
    expect(getShoppingReadinessFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      period: '90d',
      market: 'us',
    });
  });

  it('asks for a brand, answers 404, 403 without Product Visibility, and 500 on a failed read', async () => {
    expect((await get('')).status).toBe(400);
    getShoppingReadinessFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    getShoppingReadinessFor.mockResolvedValue(NOT_IN_PLAN);
    const locked = await get('?brand_id=brand-1');
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual(SHOPPING_NOT_IN_PLAN);
    getShoppingReadinessFor.mockRejectedValue(new Error('timeout'));
    expect((await get('?brand_id=brand-1')).status).toBe(500);
  });
});
