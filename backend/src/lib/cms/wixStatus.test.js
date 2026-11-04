import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pages sent to Wix, published there since (Send to CMS #1331, phase 2;
 * 00372): read from the posts the sends made, marked published at the
 * post's address once its changes are live too.
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
vi.mock('../catalog/credentials.js', () => ({ credentialsConfigured: () => configured.on }));
let credentials;
vi.mock('./credentials.js', () => ({ readCmsCredentials: async () => credentials }));
const markDeliveryPublished = vi.fn();
vi.mock('../contentPublished.js', () => ({
  markDeliveryPublished: (...args) => markDeliveryPublished(...args),
}));
const readPost = vi.fn();
vi.mock('./wix.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readDraftPost: (...args) => readPost(...args),
}));
const logged = [];
vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, error: (...args) => logged.push(JSON.stringify(args)) },
}));

const { checkWixPublished, sweepWixPublished } = await import('./wixStatus.js');
const { WixError } = await import('./wix.js');

const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const send = (id, draftId, over = {}) => ({
  id,
  draft_id: draftId,
  status: 'sent',
  published_url: null,
  external_id: `post-${id}`,
  target_collection: SITE,
  sent_at: '2026-10-28T10:00:00Z',
  ...over,
});
const post = (status, pending = false) => ({
  id: 'p',
  status,
  url: 'https://acme.example/post/cold-brew',
  pending,
});

beforeEach(() => {
  db.connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_id: SITE,
    updated_at: 'u1',
  };
  db.sends = [];
  db.brands = [];
  db.queries.length = 0;
  db.updates.length = 0;
  configured.on = true;
  credentials = { apiKey: 'IST.fake-key' };
  readPost.mockReset();
  markDeliveryPublished.mockReset();
  logged.length = 0;
});

describe('checkWixPublished', () => {
  it("marks a page published once its post is live with no changes left, at the post's address", async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2'), send('d0', 'dr1')];
    readPost.mockResolvedValueOnce(post('PUBLISHED')).mockResolvedValueOnce(post('UNPUBLISHED'));

    expect(await checkWixPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: 'https://acme.example/post/cold-brew' }],
    });
    // A page's latest send only; the connected site's, read with its key.
    expect(readPost.mock.calls.map((call) => call.slice(0, 3))).toEqual([
      [SITE, 'IST.fake-key', 'post-d1'],
      [SITE, 'IST.fake-key', 'post-d2'],
    ]);
    expect(db.queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'target', 'wix'],
        ['eq', 'target_collection', SITE],
      ]),
    );
    expect(markDeliveryPublished).toHaveBeenCalledWith(
      db.sends[0],
      'https://acme.example/post/cold-brew',
    );
  });

  it("waits while a live post's changes aren't published, and closes a send whose post is gone", async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2'), send('d3', 'dr3')];
    readPost
      .mockResolvedValueOnce(post('PUBLISHED', true))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(post('DELETED'));

    expect(await checkWixPublished('b1')).toEqual({ checked: 3, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
    expect(db.updates.map((u) => u.update)).toEqual([
      { status: 'failed', error: 'Removed in Wix' },
      { status: 'failed', error: 'Removed in Wix' },
    ]);
  });

  it('marks a page published at https:// when Wix gives the post’s address without its scheme', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    readPost
      .mockResolvedValueOnce({
        ...post('PUBLISHED'),
        url: 'mysite.wixsite.com/mysite/post/cold-brew',
      })
      .mockResolvedValueOnce({ ...post('PUBLISHED'), url: '/post/no-host' });
    expect(await checkWixPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: 'https://mysite.wixsite.com/mysite/post/cold-brew' }],
    });
    // An address with no host isn't one: that page waits.
    expect(markDeliveryPublished).toHaveBeenCalledTimes(1);
  });

  it('stops at a refused key and marks the connection, and reads nothing without one', async () => {
    db.sends = [send('d1', 'dr1'), send('d2', 'dr2')];
    readPost.mockRejectedValue(new WixError('auth_failed', 'Wix refused the API key.'));
    expect(await checkWixPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).toHaveBeenCalledTimes(1);
    expect(db.updates[0].update).toMatchObject({ status: 'auth_failed' });

    db.connection = null;
    readPost.mockReset();
    expect(await checkWixPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).not.toHaveBeenCalled();
  });
});

describe('sweepWixPublished', () => {
  it('reads the brands with Wix connected on an active plan', async () => {
    db.brands = [
      { brand_id: 'b1', brands: { organizations: { subscription_status: 'active' } } },
      { brand_id: 'b2', brands: { organizations: { subscription_status: 'canceled' } } },
    ];
    db.sends = [];
    // On the cloud, where subscriptions count.
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await sweepWixPublished()).toEqual({ brands: 1, published: 0 });
    vi.unstubAllEnvs();
    // Never a demo brand's connection (00380).
    expect(db.connectionReads.at(-1)).toContainEqual(['eq', 'brands.is_demo', false]);
  });

  it('does nothing on a server that can’t keep an API key', async () => {
    configured.on = false;
    expect(await sweepWixPublished()).toEqual({ brands: 0, published: 0 });
  });
});
