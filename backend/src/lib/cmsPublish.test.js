import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Publishing a new page live (AUTONOMOUS-GO-LIVE PR 9): Framer and a page
 * live already are refused before anything goes; the page is written into
 * its CMS draft first, then published on its own there and marked
 * published at its address (the ship event); a CMS that refuses the
 * publish leaves the draft sent, and says so.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  connection: vi.fn(),
  marked: vi.fn(async () => {}),
  publishItem: vi.fn(async () => 'wf-1'),
  getItem: vi.fn(async () => ({ id: 'wf-1', slug: 'pour-over', live: true })),
  listSites: vi.fn(async () => [{ id: 'site-1', host: 'acme.example' }]),
  listCollections: vi.fn(async () => [{ id: 'col-1', slug: 'blog' }]),
  publishPost: vi.fn(async () => ({
    id: 7,
    status: 'publish',
    link: 'https://acme.example/pour-over/',
  })),
  publishDraftPost: vi.fn(async () => ({
    id: 'wix-1',
    url: 'https://acme.example/post/pour-over',
  })),
}));

function query(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    limit: () => chain,
    maybeSingle: async () => ({
      data: (db.tables[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null,
      error: null,
    }),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./contentPublished.js', () => ({ markDeliveryPublished: mocks.marked }));
vi.mock('./cms/credentials.js', () => ({
  readCmsCredentials: async (id) =>
    id === 'wp-conn'
      ? { username: 'u', password: 'p' }
      : id === 'wix-conn'
        ? { apiKey: 'k' }
        : null,
}));
vi.mock('./contentDelivery.js', async () => {
  class DeliveryError extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    DeliveryError,
    sendContentPages: mocks.send,
    cmsConnectionFor: mocks.connection,
  };
});
vi.mock('./cms/webflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  publishItem: mocks.publishItem,
  getItem: mocks.getItem,
  listSites: mocks.listSites,
  listCollections: mocks.listCollections,
}));
vi.mock('./cms/wordpress.js', async (importOriginal) => ({
  ...(await importOriginal()),
  publishPost: mocks.publishPost,
}));
vi.mock('./cms/wix.js', async (importOriginal) => ({
  ...(await importOriginal()),
  publishDraftPost: mocks.publishDraftPost,
}));

const { publishContentPage } = await import('./cmsPublish.js');
const { WordPressError } = await import('./cms/wordpress.js');

const PAGE = { draftId: 'draft-1', title: 'Pour-over', slug: 'pour-over', html: '<p>x</p>' };
const step = (target) => ({
  orgId: 'org-1',
  brandId: 'brand-1',
  userId: 'user-1',
  page: PAGE,
  target,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.tables = {
    content_drafts: [{ id: 'draft-1', published_url: null }],
    content_draft_deliveries: [
      {
        id: 'd1',
        draft_id: 'draft-1',
        status: 'sent',
        external_id: 'wf-1',
        target_collection: 'col-1',
      },
    ],
    brand_cms_connections: [{ brand_id: 'brand-1', provider: 'webflow', site_id: 'site-1' }],
  };
  mocks.send.mockResolvedValue({ deliveries: [{ id: 'd1', status: 'sent', external_id: 'wf-1' }] });
  mocks.connection.mockImplementation(
    async (_brand, target) =>
      ({
        webflow: {
          brand_id: 'brand-1',
          composio_entity_id: 'e',
          composio_account_id: 'a',
          collection_id: 'col-1',
        },
        wordpress: { id: 'wp-conn', site_url: 'https://acme.example' },
        wix: { id: 'wix-conn', site_id: 'wix-site' },
      })[target],
  );
});

describe('publishContentPage', () => {
  it('writes the checked page into its Webflow draft, publishes that item alone, and marks it live', async () => {
    const out = await publishContentPage({ ...step('webflow'), agentRunId: 'run-1' });
    expect(mocks.send).toHaveBeenCalledWith({
      orgId: 'org-1',
      brandId: 'brand-1',
      userId: 'user-1',
      pages: [PAGE],
      target: 'webflow',
      agentRunId: 'run-1',
    });
    expect(mocks.publishItem).toHaveBeenCalledWith(
      { entityId: 'e', accountId: 'a' },
      'col-1',
      'wf-1',
    );
    expect(out).toMatchObject({
      published: true,
      url: 'https://acme.example/blog/pour-over',
      delivery: {
        id: 'd1',
        status: 'published',
        published_url: 'https://acme.example/blog/pour-over',
      },
    });
    expect(mocks.marked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'https://acme.example/blog/pour-over',
      { externalId: 'wf-1' },
    );
  });

  it('publishes a WordPress post and a Wix draft post at their own addresses', async () => {
    db.tables.content_draft_deliveries[0].external_id = '7';
    expect((await publishContentPage(step('wordpress'))).url).toBe(
      'https://acme.example/pour-over/',
    );
    expect(mocks.publishPost).toHaveBeenCalledWith(
      'https://acme.example',
      { username: 'u', password: 'p' },
      '7',
    );
    db.tables.content_draft_deliveries[0].external_id = 'wix-1';
    expect((await publishContentPage(step('wix'))).url).toBe('https://acme.example/post/pour-over');
    expect(mocks.publishDraftPost).toHaveBeenCalledWith('wix-site', 'k', 'wix-1');
  });

  it('refuses Framer and a page live already before anything goes out', async () => {
    await expect(publishContentPage(step('framer'))).rejects.toMatchObject({
      code: 'framer_site_publish',
      status: 409,
    });
    db.tables.content_drafts[0].published_url = 'https://acme.example/live';
    await expect(publishContentPage(step('webflow'))).rejects.toMatchObject({ code: 'live_item' });
    db.tables.content_drafts[0].published_url = null;
    db.tables.content_draft_deliveries.push({ id: 'd0', draft_id: 'draft-1', status: 'published' });
    await expect(publishContentPage(step('wordpress'))).rejects.toMatchObject({
      code: 'live_item',
    });
    await expect(publishContentPage(step('webhook'))).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('answers a send that failed as it is, publishing nothing', async () => {
    mocks.send.mockResolvedValueOnce({ deliveries: [{ id: 'd1', status: 'failed', error: 'no' }] });
    expect(await publishContentPage(step('webflow'))).toEqual({
      delivery: { id: 'd1', status: 'failed', error: 'no' },
    });
    expect(mocks.publishItem).not.toHaveBeenCalled();
    expect(mocks.marked).not.toHaveBeenCalled();
  });

  it('says the CMS refused the publish, the page left a draft there, and marks nothing live', async () => {
    db.tables.content_draft_deliveries[0].external_id = '7';
    mocks.publishPost.mockRejectedValueOnce(
      new WordPressError('no_access', 'This user can’t publish posts.'),
    );
    await expect(publishContentPage(step('wordpress'))).rejects.toMatchObject({
      code: 'publish_refused',
      status: 502,
      message: 'WordPress didn’t publish it: This user can’t publish posts.',
    });
    mocks.publishItem.mockRejectedValueOnce(new Error('socket hang up'));
    db.tables.content_draft_deliveries[0].external_id = 'wf-1';
    await expect(publishContentPage(step('webflow'))).rejects.toMatchObject({
      message: 'Webflow could not be reached.',
    });
    expect(mocks.marked).not.toHaveBeenCalled();
  });

  it('leaves a page whose address can’t be read to the status sweep', async () => {
    mocks.getItem.mockResolvedValueOnce({ id: 'wf-1', slug: null, live: true });
    expect(await publishContentPage(step('webflow'))).toMatchObject({
      published: true,
      url: null,
      delivery: { status: 'sent' },
    });
    expect(mocks.marked).not.toHaveBeenCalled();
  });
});
