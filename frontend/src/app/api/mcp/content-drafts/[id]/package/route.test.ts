// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** GET /api/mcp/content-drafts/[id]/package: the REST mirror of get_content_draft_package. */

const { getContentDraftPackageFor } = vi.hoisted(() => ({ getContentDraftPackageFor: vi.fn() }));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/mcp/contentPackage', () => ({ getContentDraftPackageFor }));

const { GET, runtime } = await import('./route');

const DRAFT = '11111111-2222-3333-4444-555555555555';
const get = (id = DRAFT) =>
  GET(new Request(`http://localhost/api/mcp/content-drafts/${id}/package`), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  getContentDraftPackageFor.mockReset();
});

describe('GET /api/mcp/content-drafts/[id]/package', () => {
  it('runs on Node, where jsdom reads the page, and answers the package', async () => {
    expect(runtime).toBe('nodejs');
    getContentDraftPackageFor.mockResolvedValue({ draft_id: DRAFT, html: '<p>x</p>' });
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft_id: DRAFT, html: '<p>x</p>' });
  });

  it('says why a page can’t go yet (409), or that it isn’t there (404)', async () => {
    getContentDraftPackageFor.mockResolvedValueOnce({
      error: 'not_ready',
      problem: 'placeholders',
      message: 'Fill them',
    });
    const notReady = await get();
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toEqual({
      error: 'Fill them',
      code: 'not_ready',
      problem: 'placeholders',
    });
    getContentDraftPackageFor.mockResolvedValueOnce({ error: 'not_found', message: 'No' });
    expect((await get()).status).toBe(404);
    expect((await get('not-a-draft')).status).toBe(400);
  });
});
