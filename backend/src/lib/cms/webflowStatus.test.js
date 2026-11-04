import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pages sent to Webflow, published there since (Send to CMS #1331, phase 2):
 * read from the items the sends made, marked published at their address.
 */

const db = {
  connection: null,
  sends: [],
  brands: [],
  queries: [],
  updates: [],
  connectionReads: [],
};
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, filters: [] };
      const result = () => {
        if (q.update) {
          db.updates.push({ table, update: q.update, filters: q.filters });
          return { data: null, error: null };
        }
        if (table === 'brand_cms_connections') {
          if (!q.single) db.connectionReads.push(q.filters);
          return { data: q.single ? db.connection : db.brands, error: null };
        }
        db.queries.push(q);
        return { data: db.sends, error: null };
      };
      const chain = {
        select: () => chain,
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        not: (col, op, value) => (q.filters.push(['not', col, op, value]), chain),
        gte: (col, value) => (q.filters.push(['gte', col, value]), chain),
        order: () => chain,
        limit: () => chain,
        update: (row) => ((q.update = row), chain),
        maybeSingle: async () => ((q.single = true), result()),
        then: (resolve) => resolve(result()),
      };
      return chain;
    },
  },
}));
const configured = vi.hoisted(() => ({ on: true }));
vi.mock('../composio.js', () => ({ isWebflowConfigured: () => configured.on }));
const markDeliveryPublished = vi.fn();
vi.mock('../contentPublished.js', () => ({
  markDeliveryPublished: (...args) => markDeliveryPublished(...args),
}));
const webflow = { listSites: vi.fn(), listCollections: vi.fn(), getItem: vi.fn() };
vi.mock('./webflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  listSites: (...args) => webflow.listSites(...args),
  listCollections: (...args) => webflow.listCollections(...args),
  getItem: (...args) => webflow.getItem(...args),
}));
const logged = [];
vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, error: (...args) => logged.push(JSON.stringify(args)) },
}));

const { checkWebflowPublished, sweepWebflowPublished } = await import('./webflowStatus.js');
const { WebflowError } = await import('./webflow.js');

const SENT_AT = '2026-10-24T10:00:00Z';
const send = (id, draftId, over = {}) => ({
  id,
  draft_id: draftId,
  status: 'sent',
  published_url: null,
  external_id: `item-${id}`,
  target_collection: 'c1',
  sent_at: SENT_AT,
  ...over,
});

beforeEach(() => {
  configured.on = true;
  db.connection = {
    brand_id: 'b1',
    composio_account_id: 'ca_1',
    composio_entity_id: 'brand_b1',
    status: 'connected',
    site_id: 's1',
  };
  db.sends = [send('d1', 'dr1'), send('d0', 'dr1'), send('d2', 'dr2')];
  db.brands = [];
  db.queries = [];
  db.updates = [];
  logged.length = 0;
  markDeliveryPublished.mockReset().mockResolvedValue(undefined);
  webflow.listSites
    .mockReset()
    .mockResolvedValue([{ id: 's1', name: 'Acme', host: 'www.acme.example' }]);
  webflow.listCollections
    .mockReset()
    .mockResolvedValue([{ id: 'c1', name: 'Blog Posts', slug: 'blog' }]);
  webflow.getItem.mockReset().mockImplementation(async (_account, _collection, itemId) => ({
    id: itemId,
    slug: itemId === 'item-d1' ? 'cold-brew' : 'espresso',
    live: itemId === 'item-d1',
    lastPublished: itemId === 'item-d1' ? '2026-10-24T12:00:00Z' : null,
  }));
});

describe('checkWebflowPublished', () => {
  it('marks a page whose item is live published at its address, and leaves a draft one', async () => {
    expect(await checkWebflowPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: 'https://www.acme.example/blog/cold-brew' }],
    });
    // A page's latest send only: d0 made the same item.
    expect(webflow.getItem.mock.calls.map((call) => call[2])).toEqual(['item-d1', 'item-d2']);
    expect(markDeliveryPublished).toHaveBeenCalledTimes(1);
    expect(markDeliveryPublished).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'https://www.acme.example/blog/cold-brew',
    );
    // The sends read: the brand's, to Webflow, sent and not seen live, with their item.
    expect(db.queries[0].filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'target', 'webflow'],
      ['eq', 'status', 'sent'],
      ['not', 'external_id', 'is', null],
      ['not', 'target_collection', 'is', null],
      ['gte', 'sent_at', expect.any(String)],
    ]);
  });

  it('waits for Webflow’s next publish when a live page is sent again', async () => {
    // Published before this send: the item is live with what was sent before.
    db.sends = [send('d1', 'dr1', { sent_at: '2026-10-25T09:00:00Z' })];
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
  });

  it('closes a send whose item was deleted in Webflow, and goes on past one that can’t be read', async () => {
    db.sends = [send('d3', 'dr3'), send('d4', 'dr4'), send('d1', 'dr1')];
    webflow.getItem
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new WebflowError('failed', 'down'));
    expect(await checkWebflowPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: 'https://www.acme.example/blog/cold-brew' }],
    });
    expect(db.updates).toEqual([
      {
        table: 'content_draft_deliveries',
        update: { status: 'failed', error: 'Removed in Webflow' },
        filters: [
          ['eq', 'id', 'd3'],
          ['eq', 'status', 'sent'],
        ],
      },
    ]);
  });

  it('stops after three items fail in a row, and reads only as many as asked', async () => {
    db.sends = ['a', 'b', 'c', 'd'].map((id) => send(id, `dr-${id}`));
    webflow.getItem.mockRejectedValue(new WebflowError('failed', 'down'));
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(webflow.getItem).toHaveBeenCalledTimes(3);
    webflow.getItem
      .mockReset()
      .mockResolvedValue({ id: 'x', slug: 'x', live: false, lastPublished: null });
    await checkWebflowPublished('b1', { limit: 2 });
    expect(webflow.getItem).toHaveBeenCalledTimes(2);
  });

  it('reads nothing without Webflow set up, connected and on a site', async () => {
    configured.on = false;
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    configured.on = true;
    db.connection = { ...db.connection, status: 'auth_failed' };
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    db.connection = null;
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(webflow.listSites).not.toHaveBeenCalled();
  });

  it('skips a send to a collection no longer on the site, and a site with no host', async () => {
    db.sends = [send('d1', 'dr1', { target_collection: 'c9' })];
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(webflow.getItem).not.toHaveBeenCalled();
    webflow.listSites.mockResolvedValue([{ id: 's1', name: 'Acme', host: null }]);
    db.sends = [send('d1', 'dr1')];
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
  });

  it('stops at a refused token, marking only that connection', async () => {
    webflow.getItem.mockRejectedValueOnce(
      new WebflowError('auth_failed', 'Webflow refused the site token'),
    );
    expect(await checkWebflowPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(db.updates).toEqual([
      {
        table: 'brand_cms_connections',
        update: { status: 'auth_failed', updated_at: expect.any(String) },
        filters: [
          ['eq', 'brand_id', 'b1'],
          ['eq', 'provider', 'webflow'],
          ['eq', 'composio_account_id', 'ca_1'],
        ],
      },
    ]);
    // Webflow or Composio down before the items: the check fails, for the caller to log.
    webflow.listSites.mockRejectedValueOnce(new WebflowError('failed', 'down'));
    await expect(checkWebflowPublished('b1')).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('sweepWebflowPublished', () => {
  it('checks each connected brand on an active subscription, going on past one that fails', async () => {
    db.brands = [
      { brand_id: 'b1', brands: { organizations: { subscription_status: 'active' } } },
      { brand_id: 'b2', brands: { organizations: { subscription_status: 'canceled' } } },
      { brand_id: 'b3', brands: { organizations: { subscription_status: 'active' } } },
    ];
    // On the cloud, where subscriptions count.
    vi.stubEnv('IS_CLOUD', 'true');
    webflow.listSites.mockRejectedValueOnce(new Error('down'));
    expect(await sweepWebflowPublished()).toEqual({ brands: 1, published: 1 });
    vi.unstubAllEnvs();
    // The brand that failed (the order is shuffled daily) is logged; the other went on.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/"brandId":"b[13]"/);
    // Never a demo brand's connection (00380).
    expect(db.connectionReads.at(-1)).toContainEqual(['eq', 'brands.is_demo', false]);
    configured.on = false;
    expect(await sweepWebflowPublished()).toEqual({ brands: 0, published: 0 });
  });
});
