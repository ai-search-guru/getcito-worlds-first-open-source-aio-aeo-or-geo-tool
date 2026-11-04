// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/catalog/sources: the REST mirror of get_catalog_sources. */

const { getCatalogSourcesFor } = vi.hoisted(() => ({ getCatalogSourcesFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/catalog', () => ({ getCatalogSourcesFor }));

const { GET } = await import('./route');

const get = (query: string) => GET(new Request(`http://localhost/api/mcp/catalog/sources${query}`));

beforeEach(() => {
  getCatalogSourcesFor.mockReset();
});

describe('GET /api/mcp/catalog/sources', () => {
  it("gives the brand's sources", async () => {
    getCatalogSourcesFor.mockResolvedValue([{ id: 's1', kind: 'feed_url', products: 12 }]);
    const res = await get('?brand_id=brand-1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sources: [{ id: 's1', kind: 'feed_url', products: 12 }] });
    expect(getCatalogSourcesFor).toHaveBeenCalledWith(expect.anything(), 'brand-1');
  });

  it('asks for a brand, answers 404 for another organization’s and 500 on a failed read', async () => {
    expect((await get('')).status).toBe(400);
    expect(getCatalogSourcesFor).not.toHaveBeenCalled();
    getCatalogSourcesFor.mockResolvedValue(null);
    expect((await get('?brand_id=brand-2')).status).toBe(404);
    getCatalogSourcesFor.mockRejectedValue(new Error('timeout'));
    expect((await get('?brand_id=brand-1')).status).toBe(500);
  });
});
