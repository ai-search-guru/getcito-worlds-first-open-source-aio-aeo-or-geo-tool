import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsPage } from './cmsSend';

/**
 * Send to CMS from the browser (#1331): through the API's proxy with the
 * session's token, its errors as the server names them, and the draft's kept
 * fields and last send read when the dialog opens.
 */

let session: { access_token: string } | null;
let reads: Record<string, { data: unknown; error: unknown }>;
const filters: [string, string, unknown][] = [];
/** Reads by ids (each draft's last send, kept fields, sends): each read's answer, in turn. */
let statusReads: { data: unknown; error: unknown }[];
const statusIds: string[][] = [];
const rpcs: string[] = [];

vi.mock('@/config/api', () => ({ BROWSER_API_BASE_URL: '/api/aeo' }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session } }) },
    rpc: async (fn: string, args: { p_draft_ids: string[] }) => {
      rpcs.push(fn);
      statusIds.push(args.p_draft_ids);
      return statusReads.shift();
    },
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: unknown) => (filters.push([table, col, v]), chain),
        in: (_col: string, ids: string[]) => (statusIds.push(ids), chain),
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => reads[table],
        then: (resolve: (r: unknown) => void) => resolve(statusReads.shift()),
      };
      return chain;
    },
  }),
}));

const {
  readCmsStatuses,
  readDeliveries,
  readDraftCms,
  readKeptFields,
  refreshFramerPublished,
  refreshWebflowPublished,
  refreshWordPressPublished,
  sendPagesToCms,
} = await import('./cmsSendClient');

const page: CmsPage = {
  draftId: 'd1',
  title: 'Pour-over',
  slug: 'pour-over',
  metaTitle: 'Pour-over',
  metaDescription: 'Brew it slowly.',
  html: '<p>Brew it slowly.</p>',
  author: null,
  reviewer: null,
  featuredImage: null,
};
const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  session = { access_token: 'token-1' };
  filters.length = 0;
  statusIds.length = 0;
  rpcs.length = 0;
  statusReads = [];
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendPagesToCms', () => {
  it('posts the pages with the session’s token and gives what was sent', async () => {
    answer(200, { batchId: 'b1', deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }] });
    const result = await sendPagesToCms('brand-1', [page]);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ brandId: 'brand-1', pages: [page], target: 'webhook' }),
    });
    expect(result).toEqual({
      ok: true,
      deliveries: [{ id: 'x1', draftId: 'd1', status: 'sent' }],
      skipped: 0,
    });
    // Past the workspace's sends for the day: the pages left over.
    answer(200, { deliveries: [{ id: 'x2', draftId: 'd1', status: 'queued' }], skipped: 3 });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: true, skipped: 3 });
    // To the brand's Webflow collection (#1331, phase 2).
    answer(200, { deliveries: [{ id: 'x3', draftId: 'd1', status: 'sent', updated: true }] });
    expect(await sendPagesToCms('brand-1', [page], 'webflow')).toMatchObject({
      ok: true,
      deliveries: [{ updated: true }],
    });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ target: 'webflow' });
    // To the brand's WordPress site (00294): its post live, its JSON-LD left out.
    answer(200, {
      deliveries: [
        {
          id: 'x4',
          draftId: 'd1',
          status: 'sent',
          updated: false,
          live: true,
          changed: { jsonLd: 2 },
        },
      ],
    });
    expect(await sendPagesToCms('brand-1', [page], 'wordpress')).toMatchObject({
      ok: true,
      deliveries: [{ updated: false, live: true, changed: { jsonLd: 2 } }],
    });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({
      target: 'wordpress',
    });
    // To the brand's Framer collection (00295): its item live, its images left out.
    answer(200, {
      deliveries: [
        {
          id: 'x5',
          draftId: 'd1',
          status: 'sent',
          updated: true,
          live: true,
          changed: { images: 2 },
        },
      ],
    });
    expect(await sendPagesToCms('brand-1', [page], 'framer')).toMatchObject({
      ok: true,
      deliveries: [{ updated: true, live: true, changed: { images: 2 } }],
    });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ target: 'framer' });
  });

  it('gives the server’s reason, and the field a 400 names', async () => {
    answer(409, { code: 'webhook_not_subscribed' });
    expect(await sendPagesToCms('brand-1', [page])).toEqual({
      ok: false,
      code: 'webhook_not_subscribed',
      field: null,
    });
    answer(400, { code: 'invalid', field: 'pages.0.slug' });
    expect(await sendPagesToCms('brand-1', [page])).toEqual({
      ok: false,
      code: 'invalid',
      field: 'pages.0.slug',
    });
    for (const code of [
      'webflow_not_configured',
      'no_webflow',
      'webflow_refused',
      'webflow_not_ready',
      'in_progress',
    ]) {
      answer(409, { code });
      expect(await sendPagesToCms('brand-1', [page], 'webflow')).toMatchObject({ ok: false, code });
    }
    for (const code of [
      'wordpress_not_configured',
      'no_wordpress',
      'wordpress_refused',
      'in_progress',
    ]) {
      answer(409, { code });
      expect(await sendPagesToCms('brand-1', [page], 'wordpress')).toMatchObject({
        ok: false,
        code,
      });
    }
    for (const [status, code] of [
      [503, 'framer_not_configured'],
      [409, 'no_framer'],
      [409, 'framer_refused'],
      [409, 'framer_not_ready'],
      [409, 'in_progress'],
    ] as const) {
      answer(status, { code });
      expect(await sendPagesToCms('brand-1', [page], 'framer')).toMatchObject({ ok: false, code });
    }
  });

  it('says when a request was more than the API’s proxy takes', async () => {
    answer(413, {});
    expect(await sendPagesToCms('brand-1', [page])).toEqual({
      ok: false,
      code: 'too_large',
      field: null,
    });
  });

  it('reads the session, another workspace and the rate limiter as other calls do', async () => {
    answer(401, { error: 'Unauthorized' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'session' });
    answer(403, { error: 'Not in your workspace', code: 'not_in_workspace' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'workspace' });
    answer(429, { message: 'Too many requests' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'busy' });
    // A send's own reason first: the day's limit is a 429 too.
    answer(429, { code: 'daily_limit' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'daily_limit' });
    session = null;
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'session' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // A read-only workspace (plan not active): the upgrade dialog's.
    session = { access_token: 'tok' };
    answer(402, { error: 'plan_limit', code: 'subscription_inactive' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ code: 'subscription' });
  });

  it('reads an unknown code, a body that isn’t JSON or no answer as failed', async () => {
    answer(409, { code: 'conflict' });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => Promise.reject(new Error('not JSON')),
    });
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
    // No route yet (the API before the send was deployed).
    answer(404, {});
    expect(await sendPagesToCms('brand-1', [page])).toMatchObject({ ok: false, code: 'failed' });
  });
});

describe('refreshWebflowPublished', () => {
  it('asks the API to read the brand’s Webflow pages, and gives the drafts it marked published', async () => {
    answer(200, { checked: 2, published: [{ draftId: 'd1', url: 'https://a.example/b/c' }] });
    expect(await refreshWebflowPublished('brand-1')).toEqual(['d1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/webflow-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ brandId: 'brand-1' }),
    });
    answer(502, { code: 'failed' });
    expect(await refreshWebflowPublished('brand-1')).toEqual([]);
  });
});

describe('refreshWordPressPublished', () => {
  it('asks the API to read the brand’s WordPress posts, and gives the drafts it marked published', async () => {
    answer(200, {
      checked: 2,
      published: [
        { draftId: 'd1', url: 'https://a.example/cold-brew/' },
        // A page deleted since: no draft to mark.
        { draftId: null, url: 'https://a.example/espresso/' },
      ],
    });
    expect(await refreshWordPressPublished('brand-1')).toEqual(['d1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/wordpress-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ brandId: 'brand-1' }),
    });
    // Read a moment ago, or not there (an API before 00294): none.
    answer(200, { checked: 0, published: [], recent: true });
    expect(await refreshWordPressPublished('brand-1')).toEqual([]);
    answer(404, {});
    expect(await refreshWordPressPublished('brand-1')).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await refreshWordPressPublished('brand-1')).toEqual([]);
    session = null;
    expect(await refreshWordPressPublished('brand-1')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('refreshFramerPublished', () => {
  it('asks the API to read the brand’s Framer items, and gives the drafts it marked published', async () => {
    answer(200, {
      checked: 2,
      published: [
        { draftId: 'd1', url: 'https://acme.framer.website/blog/cold-brew' },
        // A page deleted since: no draft to mark.
        { draftId: null, url: 'https://acme.framer.website/blog/espresso' },
      ],
    });
    expect(await refreshFramerPublished('brand-1')).toEqual(['d1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/aeo/api/content-drafts/framer-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-1' },
      body: JSON.stringify({ brandId: 'brand-1' }),
    });
    // Read a moment ago, or not there (an API before 00295): none.
    answer(200, { checked: 0, published: [], recent: true });
    expect(await refreshFramerPublished('brand-1')).toEqual([]);
    answer(404, {});
    expect(await refreshFramerPublished('brand-1')).toEqual([]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await refreshFramerPublished('brand-1')).toEqual([]);
    session = null;
    expect(await refreshFramerPublished('brand-1')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('readDraftCms', () => {
  it('gives the kept fields, where the page went live and its last send', async () => {
    reads = {
      content_drafts: {
        data: {
          slug: 'coffee',
          meta_title: null,
          meta_description: 'Slowly.',
          published_url: 'https://example.com/coffee',
        },
        error: null,
      },
      content_draft_deliveries: {
        data: {
          status: 'sent',
          created_at: '2026-10-24T10:00:00Z',
          sent_at: '2026-10-24T10:00:02Z',
          error: null,
        },
        error: null,
      },
    };
    expect(await readDraftCms('d1')).toEqual({
      fields: { slug: 'coffee', metaTitle: undefined, metaDescription: 'Slowly.' },
      publishedUrl: 'https://example.com/coffee',
      last: { status: 'sent', target: 'webhook', at: '2026-10-24T10:00:02Z', error: null },
    });
    expect(filters).toEqual([
      ['content_drafts', 'id', 'd1'],
      ['content_draft_deliveries', 'draft_id', 'd1'],
    ]);
  });

  it('reads a send left queued for over 30 minutes as interrupted, as the Library does', async () => {
    reads = {
      content_drafts: {
        data: { slug: null, meta_title: null, meta_description: null, published_url: null },
        error: null,
      },
      content_draft_deliveries: {
        data: {
          status: 'queued',
          created_at: new Date(Date.now() - 31 * 60_000).toISOString(),
          sent_at: null,
          published_at: null,
          error: null,
        },
        error: null,
      },
    };
    expect((await readDraftCms('d1'))?.last).toMatchObject({
      status: 'failed',
      error: 'Not sent: interrupted',
    });
  });

  it('says the last send went to Framer', async () => {
    reads = {
      content_drafts: {
        data: { slug: null, meta_title: null, meta_description: null, published_url: null },
        error: null,
      },
      content_draft_deliveries: {
        data: {
          status: 'sent',
          target: 'framer',
          created_at: '2026-10-24T10:00:00Z',
          sent_at: '2026-10-24T10:00:02Z',
          published_at: null,
          error: null,
        },
        error: null,
      },
    };
    expect((await readDraftCms('d1'))?.last).toEqual({
      status: 'sent',
      target: 'framer',
      at: '2026-10-24T10:00:02Z',
      error: null,
    });
  });

  it('gives no last send when its read fails, and null when the draft’s does', async () => {
    reads = {
      content_drafts: {
        data: { slug: null, meta_title: null, meta_description: null, published_url: null },
        error: null,
      },
      content_draft_deliveries: { data: null, error: { message: 'no such table' } },
    };
    expect((await readDraftCms('d1'))?.last).toBeNull();
    // Before its columns are there (00262): null, and the dialog holds Send.
    reads.content_drafts = { data: null, error: { message: 'column "slug" does not exist' } };
    expect(await readDraftCms('d1')).toBeNull();
  });
});

describe('readCmsStatuses', () => {
  const delivery = (draft: string, status: string, at: string, over = {}) => ({
    draft_id: draft,
    status,
    created_at: at,
    sent_at: null,
    published_at: null,
    http_status: null,
    error: null,
    published_url: null,
    ...over,
  });

  it('gives each draft its last send, one row a draft, five hundred drafts a read', async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `d${i}`);
    statusReads = [
      {
        data: [
          delivery('d1', 'published', '2026-10-24T10:00:00Z', {
            sent_at: '2026-10-24T10:00:02Z',
            published_at: '2026-10-24T12:00:00Z',
            http_status: 200,
            published_url: 'https://example.com/coffee',
          }),
          delivery(null as unknown as string, 'sent', '2026-10-22T10:00:00Z'),
        ],
        error: null,
      },
      {
        data: [delivery('d520', 'failed', '2026-10-24T09:00:00Z', { error: 'Not reached' })],
        error: null,
      },
    ];
    const statuses = await readCmsStatuses(ids);
    expect(rpcs).toEqual(['content_draft_last_deliveries', 'content_draft_last_deliveries']);
    expect(statusIds.map((chunk) => chunk.length)).toEqual([500, 100]);
    expect([...statuses.entries()]).toEqual([
      [
        'd1',
        {
          status: 'published',
          target: 'webhook',
          at: '2026-10-24T12:00:00Z',
          httpStatus: 200,
          error: null,
          publishedUrl: 'https://example.com/coffee',
        },
      ],
      [
        'd520',
        {
          status: 'failed',
          target: 'webhook',
          at: '2026-10-24T09:00:00Z',
          httpStatus: null,
          error: 'Not reached',
          publishedUrl: null,
        },
      ],
    ]);
  });

  it('names the agent that sent a page on its own, or "an agent" where it can’t be read (AUTONOMOUS-GO-LIVE §6.4)', async () => {
    statusReads = [
      {
        data: [
          delivery('d1', 'sent', '2026-11-02T10:00:00Z', {
            target: 'webflow',
            agent_run_id: 'run-1',
          }),
          delivery('d2', 'sent', '2026-11-02T10:00:00Z', {
            target: 'webflow',
            agent_run_id: 'run-2',
          }),
          delivery('d3', 'sent', '2026-11-02T10:00:00Z', { target: 'webflow' }),
        ],
        error: null,
      },
      // The runs the person may read, then their agents.
      { data: [{ id: 'run-1', agent_id: 'agent-1' }], error: null },
      { data: [{ id: 'agent-1', name: 'Publisher' }], error: null },
    ];
    const statuses = await readCmsStatuses(['d1', 'd2', 'd3']);
    expect(statuses.get('d1')).toMatchObject({ agent: { name: 'Publisher' } });
    expect(statuses.get('d2')).toMatchObject({ agent: { name: null } });
    expect(statuses.get('d3')).not.toHaveProperty('agent');
    expect(statusIds.slice(1)).toEqual([['run-1', 'run-2'], ['agent-1']]);
  });

  it('reads a send queued for over 30 minutes as interrupted, a newer one as going', async () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    statusReads = [
      {
        data: [delivery('d1', 'queued', ago(31)), delivery('d2', 'queued', ago(2))],
        error: null,
      },
    ];
    const statuses = await readCmsStatuses(['d1', 'd2']);
    expect(statuses.get('d1')).toMatchObject({ status: 'failed', error: 'Not sent: interrupted' });
    expect(statuses.get('d2')).toMatchObject({ status: 'queued', error: null });
  });

  it('says which sends went to Webflow', async () => {
    statusReads = [
      {
        data: [delivery('d1', 'sent', '2026-10-24T10:00:00Z', { target: 'webflow' })],
        error: null,
      },
    ];
    expect((await readCmsStatuses(['d1'])).get('d1')).toMatchObject({
      status: 'sent',
      target: 'webflow',
    });
  });

  it('says which sends went to WordPress, and reads an unknown target as the webhook', async () => {
    statusReads = [
      {
        data: [
          delivery('d1', 'sent', '2026-10-24T10:00:00Z', { target: 'wordpress' }),
          delivery('d2', 'sent', '2026-10-24T10:00:00Z', { target: 'shopify' }),
        ],
        error: null,
      },
    ];
    const statuses = await readCmsStatuses(['d1', 'd2']);
    expect(statuses.get('d1')).toMatchObject({ status: 'sent', target: 'wordpress' });
    expect(statuses.get('d2')).toMatchObject({ target: 'webhook' });
  });

  it('says which sends went to Framer, and one removed there since as failed', async () => {
    statusReads = [
      {
        data: [
          delivery('d1', 'sent', '2026-10-24T10:00:00Z', { target: 'framer' }),
          delivery('d2', 'failed', '2026-10-24T10:00:00Z', {
            target: 'framer',
            error: 'Removed in Framer',
          }),
        ],
        error: null,
      },
    ];
    const statuses = await readCmsStatuses(['d1', 'd2']);
    expect(statuses.get('d1')).toMatchObject({ status: 'sent', target: 'framer' });
    expect(statuses.get('d2')).toMatchObject({
      status: 'failed',
      target: 'framer',
      error: 'Removed in Framer',
    });
  });

  it('says which sends went to Wix, and one removed there since as failed', async () => {
    statusReads = [
      {
        data: [
          delivery('d1', 'sent', '2026-10-24T10:00:00Z', { target: 'wix' }),
          delivery('d2', 'failed', '2026-10-24T10:00:00Z', {
            target: 'wix',
            error: 'Removed in Wix',
          }),
        ],
        error: null,
      },
    ];
    const statuses = await readCmsStatuses(['d1', 'd2']);
    expect(statuses.get('d1')).toMatchObject({ status: 'sent', target: 'wix' });
    expect(statuses.get('d2')).toMatchObject({
      status: 'failed',
      target: 'wix',
      error: 'Removed in Wix',
    });
  });

  it('leaves a read that fails with no sends, as before its table is there', async () => {
    statusReads = [{ data: null, error: { message: 'relation does not exist' } }];
    expect((await readCmsStatuses(['d1'])).size).toBe(0);
    expect((await readCmsStatuses([])).size).toBe(0);
    expect(statusIds).toHaveLength(1);
  });
});

describe('readKeptFields and readDeliveries', () => {
  it('reads the slug and meta each draft kept, none when they can’t be read', async () => {
    statusReads = [
      {
        data: [
          { id: 'd1', slug: 'coffee', meta_title: null, meta_description: 'Slowly.' },
          { id: 'd2', slug: null, meta_title: null, meta_description: null },
        ],
        error: null,
      },
    ];
    expect([...(await readKeptFields(['d1', 'd2'])).entries()]).toEqual([
      ['d1', { slug: 'coffee', metaTitle: undefined, metaDescription: 'Slowly.' }],
      ['d2', { slug: undefined, metaTitle: undefined, metaDescription: undefined }],
    ]);
    expect(statusIds).toEqual([['d1', 'd2']]);
    // Unread, a page sent before would go with another slug: the send waits.
    statusReads = [{ data: null, error: { message: 'column "slug" does not exist' } }];
    await expect(readKeptFields(['d1'])).rejects.toThrow('column "slug" does not exist');
    expect((await readKeptFields([])).size).toBe(0);
  });

  it('reads the sends as they are now, null when they can’t be read', async () => {
    statusReads = [
      {
        data: [{ id: 'x1', draft_id: 'd1', status: 'failed', http_status: 500, error: 'No' }],
        error: null,
      },
    ];
    expect(await readDeliveries(['x1'])).toEqual([
      { id: 'x1', draftId: 'd1', status: 'failed', http_status: 500, error: 'No' },
    ]);
    statusReads = [{ data: null, error: { message: 'offline' } }];
    expect(await readDeliveries(['x1'])).toBeNull();
    expect(await readDeliveries([])).toEqual([]);
  });
});
