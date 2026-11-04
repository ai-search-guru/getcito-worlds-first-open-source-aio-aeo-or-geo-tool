// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** POST /api/mcp/content-drafts/[id]/published: the REST mirror of mark_content_draft_published. */

const { markContentDraftPublishedFor } = vi.hoisted(() => ({
  markContentDraftPublishedFor: vi.fn(),
}));
vi.mock('@/lib/mcpAuth', () => ({
  authenticateMcpRequest: vi.fn(async () => ({
    userId: 'user-1',
    email: null,
    organizationId: 'org-1',
    apiKeyId: 'key-1',
    brandAccess: 'all',
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));
vi.mock('@/lib/mcp/contentDelivery', () => ({ markContentDraftPublishedFor }));

const { POST } = await import('./route');
const { SubscriptionInactiveError } = await import('@/lib/mcp/subscriptionGate');

const DRAFT = '11111111-2222-3333-4444-555555555555';
const post = (body: unknown, id = DRAFT) =>
  POST(
    new Request(`http://localhost/api/mcp/content-drafts/${id}/published`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  markContentDraftPublishedFor.mockReset();
});

describe('POST /api/mcp/content-drafts/[id]/published', () => {
  it('marks the page live at the address given', async () => {
    markContentDraftPublishedFor.mockResolvedValue({ published_url: 'https://acme.example/x' });
    const res = await post({ url: 'https://acme.example/x' });
    expect(res.status).toBe(200);
    expect(markContentDraftPublishedFor).toHaveBeenCalledWith(
      expect.anything(),
      DRAFT,
      'https://acme.example/x',
    );
  });

  it('answers 400 for a request it cannot read, an address it refuses, and 404 for a draft not there', async () => {
    expect((await post({ url: 'https://acme.example/x' }, 'not-a-draft')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    markContentDraftPublishedFor.mockResolvedValueOnce({ error: 'invalid_url', message: 'No' });
    expect((await post({ url: 'ftp://x' })).status).toBe(400);
    markContentDraftPublishedFor.mockResolvedValueOnce({ error: 'not_found', message: 'No' });
    expect((await post({ url: 'https://acme.example/x' })).status).toBe(404);
  });

  it('answers 402 for a read-only workspace', async () => {
    markContentDraftPublishedFor.mockRejectedValueOnce(new SubscriptionInactiveError());
    const res = await post({ url: 'https://acme.example/x' });
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: 'subscription_inactive' });
  });
});
