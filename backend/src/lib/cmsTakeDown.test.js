import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Taking a published page down (AUTONOMOUS-GO-LIVE PR 10): its latest
 * published send says where; Webflow unpublishes the item, WordPress sets
 * the post back to a draft, Wix reverts it; then the send is marked taken
 * down. Framer and a webhook are refused with words, a page not live
 * through GetCito too, and a CMS that refuses marks nothing.
 */

const db = vi.hoisted(() => ({ tables: {} }));
const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  marked: vi.fn(async () => true),
  unpublishItem: vi.fn(async () => 'wf-1'),
  unpublishPost: vi.fn(async () => ({ id: 7, status: 'draft' })),
  revertToDraft: vi.fn(async () => ({ id: 'wix-1' })),
}));

function query(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, val) => (filters.push((r) => r[col] === val), chain),
    order: () => chain,
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
vi.mock('./contentPublished.js', () => ({ markDeliveryTakenDown: mocks.marked }));
vi.mock('./cmsPublish.js', () => ({ PUBLISH_TARGETS: ['webflow', 'wordpress', 'wix'] }));
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
  return { DeliveryError, cmsConnectionFor: mocks.connection };
});
vi.mock('./cms/webflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  unpublishItem: mocks.unpublishItem,
}));
vi.mock('./cms/wordpress.js', async (importOriginal) => ({
  ...(await importOriginal()),
  unpublishPost: mocks.unpublishPost,
}));
vi.mock('./cms/wix.js', async (importOriginal) => ({
  ...(await importOriginal()),
  revertToDraft: mocks.revertToDraft,
}));

const { takeDownContentPage } = await import('./cmsTakeDown.js');
const { WordPressError } = await import('./cms/wordpress.js');

const LIVE = 'https://acme.example/blog/pour-over';
const input = { orgId: 'org-1', brandId: 'brand-1', userId: 'user-1', draftId: 'draft-1' };
const send = (over = {}) => ({
  id: 'd1',
  organization_id: 'org-1',
  brand_id: 'brand-1',
  draft_id: 'draft-1',
  target: 'webflow',
  status: 'published',
  published_url: LIVE,
  external_id: 'wf-1',
  target_collection: 'col-1',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.tables = {
    content_drafts: [{ id: 'draft-1', brand_id: 'brand-1' }],
    content_draft_deliveries: [send()],
  };
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

describe('takeDownContentPage', () => {
  it('unpublishes the Webflow item of the page’s published send, then marks it taken down', async () => {
    const out = await takeDownContentPage(input);
    expect(mocks.unpublishItem).toHaveBeenCalledWith(
      { entityId: 'e', accountId: 'a' },
      'col-1',
      'wf-1',
    );
    expect(mocks.marked).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }), {
      userId: 'user-1',
      at: expect.any(String),
    });
    expect(out).toMatchObject({
      target: 'webflow',
      delivery: { id: 'd1', status: 'taken_down' },
    });
  });

  it('sets a WordPress post and a Wix post back to drafts', async () => {
    db.tables.content_draft_deliveries = [send({ target: 'wordpress', external_id: '7' })];
    await takeDownContentPage(input);
    expect(mocks.unpublishPost).toHaveBeenCalledWith(
      'https://acme.example',
      { username: 'u', password: 'p' },
      '7',
    );
    db.tables.content_draft_deliveries = [send({ target: 'wix', external_id: 'wix-1' })];
    await takeDownContentPage(input);
    expect(mocks.revertToDraft).toHaveBeenCalledWith('wix-site', 'k', 'wix-1');
    expect(mocks.marked).toHaveBeenCalledTimes(2);
  });

  it('refuses a page not live through GetCito, another brand’s, Framer and a webhook, before any CMS call', async () => {
    db.tables.content_draft_deliveries = [send({ status: 'sent' })];
    await expect(takeDownContentPage(input)).rejects.toMatchObject({
      code: 'not_live',
      status: 409,
    });
    await expect(takeDownContentPage({ ...input, brandId: 'brand-2' })).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
    db.tables.content_draft_deliveries = [send({ target: 'framer' })];
    await expect(takeDownContentPage(input)).rejects.toMatchObject({
      code: 'take_down_unavailable',
      message: 'Framer publishes the whole site at once: take it down in Framer.',
    });
    db.tables.content_draft_deliveries = [send({ target: 'webhook' })];
    await expect(takeDownContentPage(input)).rejects.toMatchObject({
      code: 'take_down_unavailable',
    });
    db.tables.content_draft_deliveries = [send({ organization_id: 'org-2' })];
    await expect(takeDownContentPage(input)).rejects.toMatchObject({ code: 'not_live' });
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.marked).not.toHaveBeenCalled();
  });

  it('says the CMS refused, in its words, and marks nothing', async () => {
    db.tables.content_draft_deliveries = [send({ target: 'wordpress', external_id: '7' })];
    mocks.unpublishPost.mockRejectedValueOnce(
      new WordPressError('no_access', 'This user can’t edit posts.'),
    );
    await expect(takeDownContentPage(input)).rejects.toMatchObject({
      code: 'take_down_refused',
      status: 502,
      message: 'WordPress didn’t take it down: This user can’t edit posts.',
    });
    db.tables.content_draft_deliveries = [send()];
    mocks.unpublishItem.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(takeDownContentPage(input)).rejects.toMatchObject({
      message: 'Webflow could not be reached.',
    });
    db.tables.content_draft_deliveries = [send({ target: 'wix', external_id: 'wix-1' })];
    mocks.connection.mockResolvedValueOnce({ id: 'no-key', site_id: 'wix-site' });
    await expect(takeDownContentPage(input)).rejects.toMatchObject({ code: 'wix_refused' });
    expect(mocks.marked).not.toHaveBeenCalled();
  });
});
