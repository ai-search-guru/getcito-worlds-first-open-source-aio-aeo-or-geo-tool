// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/content-plan: the REST mirror of get_content_plan. */

const { getContentPlanFor } = vi.hoisted(() => ({ getContentPlanFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/contentPlan', () => ({ getContentPlanFor }));

const { GET } = await import('./route');

const BRAND = '11111111-2222-3333-4444-555555555555';
const OTHER = '66666666-7777-8888-9999-000000000000';
const get = (query: string) => GET(new Request(`http://localhost/api/mcp/content-plan${query}`));

beforeEach(() => {
  getContentPlanFor.mockReset();
});

describe('GET /api/mcp/content-plan', () => {
  it("answers the brand's plan over the days and card asked", async () => {
    getContentPlanFor.mockResolvedValue({ days: 7, rows: [] });
    const res = await get(`?brand_id=${BRAND}&days=7&card=protect`);
    expect(await res.json()).toEqual({ plan: { days: 7, rows: [] } });
    expect(getContentPlanFor).toHaveBeenCalledWith(expect.anything(), {
      brandId: BRAND,
      days: 7,
      card: 'protect',
    });
  });

  it('reads 30 days without a period, and refuses one it does not offer', async () => {
    getContentPlanFor.mockResolvedValue({ days: 30, rows: [] });
    await get(`?brand_id=${BRAND}`);
    expect(getContentPlanFor.mock.calls[0][1]).toMatchObject({ days: 30 });
    expect((await get(`?brand_id=${BRAND}&days=14`)).status).toBe(400);
    expect((await get(`?brand_id=${BRAND}&card=later`)).status).toBe(400);
    expect((await get('')).status).toBe(400);
  });

  it('refuses a brand_id that is not a UUID, before reading anything', async () => {
    const res = await get('?brand_id=brand-1');
    expect(res.status).toBe(400);
    expect(getContentPlanFor).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's brand", async () => {
    getContentPlanFor.mockResolvedValue(null);
    expect((await get(`?brand_id=${OTHER}`)).status).toBe(404);
  });
});
