// @vitest-environment node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcpAuth';

/**
 * mark_content_draft_published (B5): a page the user's own AI tool put on a
 * CMS, marked live as the editor's Mark published does, through the API's
 * publishDraft for the key's user and organization.
 */

let subscriptionStatus: string;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: { subscription_status: subscriptionStatus },
          error: null,
        }),
      };
      return chain;
    },
  },
}));

const { markContentDraftPublishedFor } = await import('./contentDelivery');
const { createMcpServer } = await import('./server');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};
const LIVE = 'https://acme.example/blog/cold-brew';
const fetchMock = vi.fn();

beforeEach(() => {
  subscriptionStatus = 'active';
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CRON_SECRET', 'secret');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('markContentDraftPublishedFor', () => {
  it("marks the page live through the API, as the key's user of the key's organization", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        success: true,
        publishedUrl: LIVE,
        publishedAt: '2026-10-28T18:00:00Z',
        taskCompleted: true,
        onBrandDomain: true,
      }),
    );
    expect(await markContentDraftPublishedFor(auth, 'draft-1', LIVE)).toEqual({
      published_url: LIVE,
      published_at: '2026-10-28T18:00:00Z',
      task_completed: true,
      on_brand_domain: true,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/internal\/content-drafts\/draft-1\/publish$/);
    expect(init).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer secret' } });
    expect(JSON.parse(init.body)).toEqual({ url: LIVE, userId: 'user-1', orgId: 'org-1' });
  });

  it('says what is wrong with an address, and that a draft is not there', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'invalid_url' }, { status: 400 }));
    expect(await markContentDraftPublishedFor(auth, 'draft-1', 'ftp://x')).toMatchObject({
      error: 'invalid_url',
    });
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'not_found' }, { status: 404 }));
    expect(await markContentDraftPublishedFor(auth, 'draft-2', LIVE)).toMatchObject({
      error: 'not_found',
    });
    // A request the API can't read isn't the address's fault.
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 'invalid', message: 'Invalid request' }, { status: 400 }),
    );
    await expect(markContentDraftPublishedFor(auth, 'draft-3', LIVE)).rejects.toThrow(
      'Invalid request',
    );
  });

  it('refuses a read-only workspace before asking the API', async () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
    subscriptionStatus = 'canceled';
    await expect(markContentDraftPublishedFor(auth, 'draft-1', LIVE)).rejects.toMatchObject({
      code: 'subscription_inactive',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on the API's failure, and asks nothing without an organization", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'boom' }, { status: 500 }));
    await expect(markContentDraftPublishedFor(auth, 'draft-1', LIVE)).rejects.toThrow('boom');
    fetchMock.mockReset();
    expect(
      await markContentDraftPublishedFor({ ...auth, organizationId: null }, 'draft-1', LIVE),
    ).toMatchObject({ error: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the B5 tools', () => {
  it('list with a title, the plan as a read and the mark as a write', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const tool = (name: string) => tools.find((t) => t.name === name);
    expect(tool('get_content_plan')).toMatchObject({
      title: 'Content plan',
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    expect(tool('mark_content_draft_published')).toMatchObject({
      title: 'Mark a draft published',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    });
  });
});

describe('last_send in the drafts tools', () => {
  it('names every CMS a page can be sent to, Wix included', async () => {
    const server = createMcpServer(auth);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === 'list_content_drafts')?.description ?? '';
    expect(description).toContain('target webhook, webflow, wordpress, framer or wix');
  });
});
