// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/mentions (MS-13): the page's filters and the table's, from the query string. */

const { listMentionsFor } = vi.hoisted(() => ({ listMentionsFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
// The real filters and checks; only the database read is replaced.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/mentions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/mcp/mentions')>()),
  listMentionsFor,
}));

const { GET } = await import('./route');

const get = (query: string) => GET(new Request(`http://localhost/api/mcp/mentions${query}`));

beforeEach(() => listMentionsFor.mockReset());

describe('GET /api/mcp/mentions', () => {
  it('reads the filters, and leaves out a sentiment or sort it does not know', async () => {
    listMentionsFor.mockResolvedValue({
      total: 0,
      prompts: 0,
      page: 2,
      pageSize: 100,
      mentions: [],
    });
    const res = await get(
      '?brand_id=b1&date_from=2026-10-01&region=DE&topic_id=t1&search=beans' +
        '&sentiment=negative&competitor_id=none&sort=oldest&page=2',
    );
    expect(res.status).toBe(200);
    expect(listMentionsFor.mock.calls[0][1]).toEqual({
      brandId: 'b1',
      dateFrom: '2026-10-01',
      dateTo: undefined,
      platform: undefined,
      region: 'DE',
      topicId: 't1',
      search: 'beans',
      sentiment: 'negative',
      competitorId: 'none',
      sort: 'oldest',
      page: 2,
    });

    await get('?brand_id=b1&sentiment=great&sort=best&page=x');
    expect(listMentionsFor.mock.calls[1][1]).toMatchObject({
      sentiment: undefined,
      sort: undefined,
      page: undefined,
    });
  });

  it("needs a brand, and says when the brand is not the key's", async () => {
    expect((await get('')).status).toBe(400);
    listMentionsFor.mockResolvedValue(null);
    expect((await get('?brand_id=b9')).status).toBe(404);
  });
});
