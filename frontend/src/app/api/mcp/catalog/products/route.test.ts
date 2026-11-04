// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/catalog/products: the REST mirror of list_catalog_products. */

const { listCatalogProductsFor } = vi.hoisted(() => ({ listCatalogProductsFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/catalog', () => ({ listCatalogProductsFor }));

const { GET } = await import('./route');

const get = (query: string) =>
  GET(new Request(`http://localhost/api/mcp/catalog/products${query}`));

beforeEach(() => {
  listCatalogProductsFor.mockReset();
});

describe('GET /api/mcp/catalog/products', () => {
  it('reads the page and search asked', async () => {
    listCatalogProductsFor.mockResolvedValue({ total: 0, products: [], next_offset: null });
    const res = await get('?brand_id=brand-1&search=trail%20boots&limit=20&offset=40');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 0, products: [], next_offset: null });
    expect(listCatalogProductsFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      search: 'trail boots',
      limit: 20,
      offset: 40,
    });
  });

  it('leaves out a limit or offset that is not a number, and cuts a long search', async () => {
    listCatalogProductsFor.mockResolvedValue({ total: 0, products: [], next_offset: null });
    await get(`?brand_id=brand-1&limit=many&search=${'a'.repeat(300)}`);
    expect(listCatalogProductsFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: 'brand-1',
      search: 'a'.repeat(200),
      limit: undefined,
      offset: undefined,
    });
  });

  it('asks for a brand, answers 404 for another organization’s and 500 on a failed read', async () => {
    expect((await get('')).status).toBe(400);
    expect(listCatalogProductsFor).not.toHaveBeenCalled();
    listCatalogProductsFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    listCatalogProductsFor.mockRejectedValue(new Error('timeout'));
    const res = await get('?brand_id=brand-1');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'timeout' });
  });
});
