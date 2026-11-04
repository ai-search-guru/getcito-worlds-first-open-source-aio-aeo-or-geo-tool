import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pages sent to Framer, published there since (Send to CMS #1331, phase 2;
 * 00295): read from the items the sends made, in one connection, and marked
 * published at the item's page once the site was published after the send.
 */

const db = { connection: null, sends: [], brands: [], queries: [], updates: [] };
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, filters: [] };
      const result = () => {
        if (q.update) {
          db.updates.push({ table, update: q.update, filters: q.filters });
          return { data: null, error: null };
        }
        db.queries.push(q);
        if (table === 'brand_cms_connections') {
          return { data: q.single ? db.connection : db.brands, error: null };
        }
        return { data: db.sends, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        not: (col, op, value) => (q.filters.push(['not', col, op, value]), chain),
        gte: (col, value) => (q.filters.push(['gte', col, value]), chain),
        order: () => chain,
        limit: (n) => ((q.limit = n), chain),
        update: (row) => ((q.update = row), chain),
        maybeSingle: async () => ((q.single = true), result()),
        then: (resolve) => resolve(result()),
      };
      return chain;
    },
  },
}));
const configured = vi.hoisted(() => ({ on: true }));
vi.mock('../catalog/credentials.js', () => ({ credentialsConfigured: () => configured.on }));
let credentials;
vi.mock('./credentials.js', () => ({ readCmsCredentials: async () => credentials }));
const markDeliveryPublished = vi.fn();
vi.mock('../contentPublished.js', async (importOriginal) => ({
  ...(await importOriginal()),
  markDeliveryPublished: (...args) => markDeliveryPublished(...args),
}));
const readPublished = vi.fn();
vi.mock('./framer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPublished: (...args) => readPublished(...args),
}));
const logged = { warn: [], error: [] };
vi.mock('../logger.js', () => ({
  logger: {
    warn: (...args) => logged.warn.push(JSON.stringify(args)),
    error: (...args) => logged.error.push(JSON.stringify(args)),
  },
}));

const { checkFramerPublished, sweepFramerPublished } = await import('./framerStatus.js');
const { FramerError } = await import('./framer.js');

const PROJECT = 'AbCdEfGhIj0123456789';
const KEY = 'fr_key_0123456789abcdefSECRET';
const SITE = 'https://www.acme.example';
const SENT_AT = '2026-10-24T10:00:00Z';
const AFTER = Date.parse('2026-10-24T12:00:00Z');
const BEFORE = Date.parse('2026-10-24T09:00:00Z');

const send = (id, draftId, over = {}) => ({
  id,
  draft_id: draftId,
  status: 'sent',
  published_url: null,
  external_id: `item-${id}`,
  target_collection: 'cBlog',
  sent_at: SENT_AT,
  ...over,
});
/** The project as readPublished reads it: the items by id, as framer.js maps them. */
const project = (items, over = {}) => ({
  siteUrl: SITE,
  deployedAt: AFTER,
  detailPath: '/blog/:slug',
  items: new Map(Object.entries(items)),
  ...over,
});

beforeEach(() => {
  configured.on = true;
  credentials = { apiKey: KEY };
  db.connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_id: PROJECT,
    collection_id: 'cBlog',
    updated_at: '2026-10-27T09:00:00Z',
  };
  db.sends = [];
  db.brands = [];
  db.queries = [];
  db.updates = [];
  logged.warn.length = 0;
  logged.error.length = 0;
  markDeliveryPublished.mockReset().mockResolvedValue(undefined);
  readPublished.mockReset();
});

const deliveryQuery = () => db.queries.find((q) => q.table === 'content_draft_deliveries');

describe('checkFramerPublished', () => {
  it('marks an item live since the site’s publish published at its page, and leaves a draft', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    readPublished.mockResolvedValue(
      project({
        'item-d1': { slug: 'cold-brew', draft: false },
        'item-d2': { slug: 'espresso', draft: true },
      }),
    );
    const connect = vi.fn();
    expect(await checkFramerPublished('b1', { connect })).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: `${SITE}/blog/cold-brew` }],
    });
    expect(markDeliveryPublished).toHaveBeenCalledTimes(1);
    expect(markDeliveryPublished).toHaveBeenCalledWith(db.sends[0], `${SITE}/blog/cold-brew`);
    // One read for every send, with the connection's project, key and collection.
    expect(readPublished).toHaveBeenCalledTimes(1);
    expect(readPublished).toHaveBeenCalledWith(PROJECT, KEY, 'cBlog', ['item-d1', 'item-d2'], {
      connect,
    });
    // The connected collection's sends only, sent and not seen live, with their item.
    expect(deliveryQuery().filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'target', 'framer'],
      ['eq', 'target_collection', 'cBlog'],
      ['eq', 'status', 'sent'],
      ['not', 'external_id', 'is', null],
      ['gte', 'sent_at', expect.any(String)],
    ]);
    expect(db.updates).toEqual([]);
  });

  it('puts the slug in the page’s address as a path segment', async () => {
    db.sends = [send('d1', 'dr1')];
    readPublished.mockResolvedValue(
      project({ 'item-d1': { slug: 'café au lait', draft: false } }, { detailPath: 'posts/:slug' }),
    );
    expect((await checkFramerPublished('b1')).published).toEqual([
      { draftId: 'dr1', url: `${SITE}/posts/caf%C3%A9%20au%20lait` },
    ]);
  });

  it('closes a send whose item was deleted in Framer', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    readPublished.mockResolvedValue(project({ 'item-d2': { slug: 'espresso', draft: true } }));
    expect(await checkFramerPublished('b1')).toEqual({ checked: 2, published: [] });
    expect(db.updates).toEqual([
      {
        table: 'content_draft_deliveries',
        update: { status: 'failed', error: 'Removed in Framer' },
        filters: [
          ['eq', 'id', 'd1'],
          ['eq', 'status', 'sent'],
        ],
      },
    ]);
  });

  it('waits for the site’s next publish when it was last published before the send', async () => {
    db.sends = [send('d1', 'dr1')];
    readPublished.mockResolvedValue(
      project({ 'item-d1': { slug: 'cold-brew', draft: false } }, { deployedAt: BEFORE }),
    );
    expect(await checkFramerPublished('b1')).toEqual({ checked: 1, published: [] });
    // Published the very moment of the send: still not after it.
    readPublished.mockResolvedValue(
      project(
        { 'item-d1': { slug: 'cold-brew', draft: false } },
        { deployedAt: Date.parse(SENT_AT) },
      ),
    );
    expect(await checkFramerPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('waits for the site’s next publish when the item was taken out of draft after the last one', async () => {
    db.sends = [send('d1', 'dr1')];
    const live = (updatedAt) =>
      project({ 'item-d1': { slug: 'cold-brew', draft: false, updatedAt } });
    // Sent at 10:00, the site published at 12:00, the item taken out of draft at 13:00.
    readPublished.mockResolvedValue(live('2026-10-24T13:00:00.000Z'));
    expect(await checkFramerPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
    // Taken out of draft at 11:00, or the very moment of the publish: on the site.
    for (const updatedAt of ['2026-10-24T11:00:00.000Z', new Date(AFTER).toISOString()]) {
      readPublished.mockResolvedValue(live(updatedAt));
      expect((await checkFramerPublished('b1')).published, updatedAt).toEqual([
        { draftId: 'dr1', url: `${SITE}/blog/cold-brew` },
      ]);
    }
    expect(markDeliveryPublished).toHaveBeenCalledTimes(2);
  });

  it('goes by the send’s time alone when Framer gives no time for the item’s last change', async () => {
    db.sends = [send('d1', 'dr1')];
    const items = { 'item-d1': { slug: 'cold-brew', draft: false, updatedAt: null } };
    readPublished.mockResolvedValue(project(items));
    expect((await checkFramerPublished('b1')).published).toEqual([
      { draftId: 'dr1', url: `${SITE}/blog/cold-brew` },
    ]);
    readPublished.mockResolvedValue(project(items, { deployedAt: BEFORE }));
    expect(await checkFramerPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).toHaveBeenCalledTimes(1);
  });

  it('waits while the collection has no detail page, or the site was never published', async () => {
    db.sends = [send('d1', 'dr1')];
    const items = { 'item-d1': { slug: 'cold-brew', draft: false } };
    for (const over of [
      { detailPath: null },
      { siteUrl: null, deployedAt: null },
      { deployedAt: null },
    ]) {
      readPublished.mockResolvedValue(project(items, over));
      expect(await checkFramerPublished('b1'), JSON.stringify(over)).toEqual({
        checked: 1,
        published: [],
      });
    }
    expect(markDeliveryPublished).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it('marks nothing when the detail page’s path has no :slug, or another parameter, and logs it', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    const items = {
      'item-d1': { slug: 'cold-brew', draft: false },
      'item-d2': { slug: 'espresso', draft: false },
    };
    for (const detailPath of ['/blog/:id', '/blog', '/:category/:slug', '/blog/:slugged']) {
      logged.warn.length = 0;
      readPublished.mockResolvedValue(project(items, { detailPath }));
      expect(await checkFramerPublished('b1'), detailPath).toEqual({ checked: 2, published: [] });
      // Once a check, not once a page.
      expect(logged.warn).toHaveLength(1);
      expect(logged.warn[0]).toContain('detail page path has no :slug');
    }
    expect(markDeliveryPublished).not.toHaveBeenCalled();
  });

  it('logs an item with no slug apart from the path, and goes on to the next page', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2'), send('d3', 'dr3')];
    readPublished.mockResolvedValue(
      project({
        'item-d1': { slug: '', draft: false },
        'item-d2': { slug: '   ', draft: false },
        'item-d3': { slug: 'cold-brew', draft: false },
      }),
    );
    expect(await checkFramerPublished('b1')).toEqual({
      checked: 3,
      published: [{ draftId: 'dr3', url: `${SITE}/blog/cold-brew` }],
    });
    // Each by its send, not as the path's.
    expect(logged.warn).toHaveLength(2);
    expect(logged.warn[0]).toContain('item has no slug');
    expect(logged.warn[0]).toContain('"deliveryId":"d1"');
    expect(logged.warn[1]).toContain('"deliveryId":"d2"');
    expect(logged.warn.join('\n')).not.toContain('detail page path');
  });

  it('marks no page whose address is too long to keep, and goes on to the next', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    readPublished.mockResolvedValue(
      project({
        'item-d1': { slug: 'a'.repeat(2100), draft: false },
        'item-d2': { slug: 'cold-brew', draft: false },
      }),
    );
    expect(await checkFramerPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr2', url: `${SITE}/blog/cold-brew` }],
    });
    expect(markDeliveryPublished).toHaveBeenCalledTimes(1);
    expect(logged.warn).toHaveLength(1);
    expect(logged.warn[0]).toContain('page address not https, or too long');
    expect(logged.warn[0]).toContain('"deliveryId":"d1"');
  });

  it('marks no page on a site address that isn’t https', async () => {
    db.sends = [send('d1', 'dr1')];
    readPublished.mockResolvedValue(
      project(
        { 'item-d1': { slug: 'cold-brew', draft: false } },
        { siteUrl: 'http://www.acme.example' },
      ),
    );
    expect(await checkFramerPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
    expect(logged.warn[0]).toContain('page address not https');
  });

  it('stops at a page that can’t be marked, as WordPress’s check does, for the caller to log', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2'), send('d3', 'dr3')];
    readPublished.mockResolvedValue(
      project({
        'item-d1': { slug: 'cold-brew', draft: false },
        'item-d2': { slug: 'espresso', draft: false },
        'item-d3': { slug: 'latte', draft: false },
      }),
    );
    markDeliveryPublished
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db down'));
    await expect(checkFramerPublished('b1')).rejects.toThrow('db down');
    // The first page is marked; the third waits for the next check (its send is still 'sent').
    expect(markDeliveryPublished).toHaveBeenCalledTimes(2);
    expect(markDeliveryPublished.mock.calls.map(([delivery]) => delivery.id)).toEqual(['d1', 'd2']);
  });

  it('reads each page’s latest send only, and only as many pages as asked', async () => {
    db.sends = [
      send('d2', 'dr1'),
      send('d1', 'dr1', { sent_at: '2026-10-20T10:00:00Z' }),
      send('d3', 'dr3'),
      send('d4', null),
    ];
    readPublished.mockResolvedValue(project({}));
    await checkFramerPublished('b1');
    expect(readPublished.mock.calls[0][3]).toEqual(['item-d2', 'item-d3', 'item-d4']);
    expect(deliveryQuery().limit).toBe(40);
    readPublished.mockClear();
    db.queries = [];
    await checkFramerPublished('b1', { limit: 2 });
    expect(readPublished.mock.calls[0][3]).toEqual(['item-d2', 'item-d3']);
    expect(deliveryQuery().limit).toBe(8);
  });

  it('reads the sends of the last 60 days only', async () => {
    db.sends = [send('d1', 'dr1')];
    readPublished.mockResolvedValue(project({}));
    const before = Date.now();
    await checkFramerPublished('b1');
    const after = Date.now();
    const since = Date.parse(deliveryQuery().filters.find((f) => f[0] === 'gte')[2]);
    const sixtyDays = 60 * 24 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - sixtyDays);
    expect(since).toBeLessThanOrEqual(after - sixtyDays);
  });

  it('marks the connection refused, as it was read, when Framer refuses the key', async () => {
    db.sends = [send('d1', 'dr1')];
    readPublished.mockRejectedValue(new FramerError('auth_failed', 'refused'));
    expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(db.updates).toEqual([
      {
        table: 'brand_cms_connections',
        update: { status: 'auth_failed', updated_at: expect.any(String) },
        filters: [
          ['eq', 'id', 'cn1'],
          ['eq', 'provider', 'framer'],
          ['eq', 'updated_at', '2026-10-27T09:00:00Z'],
        ],
      },
    ]);
    expect(markDeliveryPublished).not.toHaveBeenCalled();
  });

  it('leaves the sends for the next check when Framer can’t be read, logging no message', async () => {
    db.sends = [send('d1', 'dr1')];
    for (const err of [
      new FramerError('busy', `Framer is busy for ${KEY}`),
      new FramerError('not_found', 'The collection pages go to is gone'),
      new TypeError(`x of ${KEY}`),
    ]) {
      readPublished.mockRejectedValueOnce(err);
      expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    }
    expect(db.updates).toEqual([]);
    expect(logged.warn).toHaveLength(3);
    expect(logged.warn.join('\n')).not.toContain(KEY);
    expect(logged.warn[0]).toContain('"code":"busy"');
  });

  it('asks to connect again when the kept key can’t be read', async () => {
    db.sends = [send('d1', 'dr1')];
    credentials = null;
    expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    credentials = { username: 'not-a-framer-key' };
    expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPublished).not.toHaveBeenCalled();
    expect(db.updates.map((u) => [u.table, u.update.status])).toEqual([
      ['brand_cms_connections', 'auth_failed'],
      ['brand_cms_connections', 'auth_failed'],
    ]);
  });

  it('reads nothing without the server’s key, a connection, a connected one with a collection, or sends', async () => {
    db.sends = [send('d1', 'dr1')];
    configured.on = false;
    expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    configured.on = true;
    for (const connection of [
      null,
      { ...db.connection, status: 'auth_failed' },
      { ...db.connection, collection_id: null },
    ]) {
      db.connection = connection;
      expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    }
    expect(deliveryQuery()).toBeUndefined();
    db.connection = { ...db.connection, collection_id: 'cBlog' };
    db.sends = [];
    expect(await checkFramerPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPublished).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });
});

describe('sweepFramerPublished', () => {
  it('reads the brands of active subscriptions, going on past one that fails', async () => {
    db.brands = [
      { brand_id: 'b1', brands: { organizations: { subscription_status: 'active' } } },
      { brand_id: 'b2', brands: { organizations: { subscription_status: 'canceled' } } },
      { brand_id: 'b3', brands: { organizations: { subscription_status: 'trialing' } } },
    ];
    db.sends = [send('d1', 'dr1')];
    readPublished.mockResolvedValue(project({ 'item-d1': { slug: 'cold-brew', draft: false } }));
    markDeliveryPublished.mockRejectedValueOnce(new Error('down'));
    // On the cloud, where subscriptions count.
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await sweepFramerPublished()).toEqual({ brands: 1, published: 1 });
    vi.unstubAllEnvs();
    // The brand that failed (the order is shuffled daily) is logged; the other went on.
    expect(logged.error).toHaveLength(1);
    expect(logged.error[0]).toMatch(/"brandId":"b[13]"/);
    expect(readPublished).toHaveBeenCalledTimes(2);
    // The connections read: Framer's, connected, with a collection pages go to.
    expect(db.queries[0]).toMatchObject({
      table: 'brand_cms_connections',
      filters: [
        ['eq', 'provider', 'framer'],
        ['eq', 'status', 'connected'],
        ['not', 'collection_id', 'is', null],
      ],
    });
    // The daily sweep reads more of a brand's pages than the Library does.
    expect(db.queries.find((q) => q.table === 'content_draft_deliveries').limit).toBe(400);
  });

  it('does nothing on a server that can’t keep a key', async () => {
    configured.on = false;
    expect(await sweepFramerPublished()).toEqual({ brands: 0, published: 0 });
    expect(db.queries).toEqual([]);
  });
});
