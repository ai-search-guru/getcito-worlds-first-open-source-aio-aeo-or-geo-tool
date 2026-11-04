// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/product-visibility/ai-says: the REST mirror of get_product_ai_says. */

const { getProductAiSaysFor } = vi.hoisted(() => ({ getProductAiSaysFor: vi.fn() }));
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
  getProductAiSaysFor,
  PV_PERIODS: ['7d', '30d', '90d', 'all'],
}));

const { GET } = await import('./route');
const { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN } = await import('@/lib/mcp/data');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/product-visibility/ai-says${query}`));

beforeEach(() => {
  getProductAiSaysFor.mockReset();
});

const PRODUCT = '22222222-2222-2222-2222-222222222222';

describe('GET /api/mcp/product-visibility/ai-says', () => {
  it('gives what AI says about the product', async () => {
    getProductAiSaysFor.mockResolvedValue({ product_id: PRODUCT, answers: 2, quotes: [] });
    const res = await get(`?brand_id=brand-1&product_id=${PRODUCT}&period=all`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ product_id: PRODUCT, answers: 2, quotes: [] });
    expect(getProductAiSaysFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      productId: PRODUCT,
      period: 'all',
    });
  });

  it('asks for a brand and a product UUID, answers 404, 403 and 500', async () => {
    expect((await get('?brand_id=brand-1')).status).toBe(400);
    expect((await get('?brand_id=brand-1&product_id=p1')).status).toBe(400);
    expect(getProductAiSaysFor).not.toHaveBeenCalled();
    getProductAiSaysFor.mockResolvedValue(null);
    const missing = await get(`?brand_id=brand-1&product_id=${PRODUCT}`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Brand or product not found' });
    getProductAiSaysFor.mockResolvedValue(NOT_IN_PLAN);
    const locked = await get(`?brand_id=brand-1&product_id=${PRODUCT}`);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toEqual(SHOPPING_NOT_IN_PLAN);
    getProductAiSaysFor.mockRejectedValue(new Error('timeout'));
    expect((await get(`?brand_id=brand-1&product_id=${PRODUCT}`)).status).toBe(500);
  });
});
