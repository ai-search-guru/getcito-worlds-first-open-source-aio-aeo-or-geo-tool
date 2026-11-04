import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pages sent to WordPress, published there since (Send to CMS #1331, phase
 * 2; 00294): read from the posts the sends made, marked published at the
 * post's link.
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
        if (table === 'brand_cms_connections') {
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
const answersAsWordPress = vi.fn();
vi.mock('./wordpress.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPostState: (...args) => readPost(...args),
  answersAsWordPress: (...args) => answersAsWordPress(...args),
}));
const logged = [];
vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, error: (...args) => logged.push(JSON.stringify(args)) },
}));

const { checkWordPressPublished, sweepWordPressPublished } = await import('./wordpressStatus.js');
const { WordPressError } = await import('./wordpress.js');

const SITE = 'https://blog.acme.example';
const signIn = { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' };
const send = (id, draftId, over = {}) => ({
  id,
  draft_id: draftId,
  status: 'sent',
  published_url: null,
  external_id: `${id}`,
  target_collection: SITE,
  sent_at: '2026-10-24T10:00:00Z',
  ...over,
});
const post = (id, status, link = `${SITE}/?p=${id}`) => ({ id, status, link });

beforeEach(() => {
  configured.on = true;
  credentials = signIn;
  db.connection = {
    id: 'cn1',
    brand_id: 'b1',
    status: 'connected',
    site_url: SITE,
    updated_at: '2026-10-27T09:00:00Z',
  };
  db.sends = [];
  db.brands = [];
  db.queries = [];
  db.updates = [];
  logged.length = 0;
  markDeliveryPublished.mockReset().mockResolvedValue(undefined);
  readPost.mockReset();
  answersAsWordPress.mockReset().mockResolvedValue(true);
});

describe('checkWordPressPublished', () => {
  it('marks a post put live published at its own link, and leaves a draft as it is', async () => {
    db.sends = [send('41', 'dr1'), send('42', 'dr2')];
    readPost
      .mockResolvedValueOnce(post(41, 'publish', `${SITE}/cold-brew/`))
      .mockResolvedValueOnce(post(42, 'draft'));
    expect(await checkWordPressPublished('b1')).toEqual({
      checked: 2,
      published: [{ draftId: 'dr1', url: `${SITE}/cold-brew/` }],
    });
    expect(markDeliveryPublished).toHaveBeenCalledWith(db.sends[0], `${SITE}/cold-brew/`);
    expect(readPost).toHaveBeenCalledWith(SITE, signIn, '41', { request: undefined });
    // The connected site's sends only.
    expect(db.queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'target', 'wordpress'],
        ['eq', 'target_collection', SITE],
        ['eq', 'status', 'sent'],
      ]),
    );
  });

  it('waits on a post scheduled or pending, and closes one gone or in the trash', async () => {
    db.sends = [send('41', 'dr1'), send('42', 'dr2'), send('43', 'dr3'), send('44', 'dr4')];
    readPost
      .mockResolvedValueOnce(post(41, 'future'))
      .mockResolvedValueOnce(post(42, 'pending'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(post(44, 'trash'));
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 4, published: [] });
    expect(db.updates.map((u) => [u.update.error, u.filters[0][2]])).toEqual([
      ['Removed in WordPress', '43'],
      ['Removed in WordPress', '44'],
    ]);
  });

  it('closes a post gone only once the site answers as WordPress', async () => {
    db.sends = [send('41', 'dr1'), send('42', 'dr2')];
    readPost.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    await checkWordPressPublished('b1');
    expect(answersAsWordPress).toHaveBeenCalledTimes(1);
    expect(db.updates.map((u) => u.filters[0][2])).toEqual(['41', '42']);
  });

  it('closes nothing while the site answers 404 for every post (moved, its permalinks changed)', async () => {
    db.sends = ['1', '2', '3', '4'].map((id) => send(id, `dr${id}`));
    readPost.mockResolvedValue(null);
    answersAsWordPress.mockResolvedValue(false);
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(db.updates).toEqual([]);
    // Three in a row stop it, as failed reads do.
    expect(readPost).toHaveBeenCalledTimes(3);
  });

  it('marks no published post whose link isn’t a web address', async () => {
    db.sends = [send('41', 'dr1')];
    readPost.mockResolvedValueOnce(post(41, 'publish', '/?p=41'));
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 1, published: [] });
    expect(markDeliveryPublished).not.toHaveBeenCalled();
  });

  it('reads each page’s latest send only', async () => {
    db.sends = [send('42', 'dr1'), send('41', 'dr1', { sent_at: '2026-10-20T10:00:00Z' })];
    readPost.mockResolvedValue(post(42, 'draft'));
    await checkWordPressPublished('b1');
    expect(readPost).toHaveBeenCalledTimes(1);
    expect(readPost.mock.calls[0][2]).toBe('42');
  });

  it('marks the connection refused, as it was read, and stops', async () => {
    db.sends = [send('41', 'dr1'), send('42', 'dr2')];
    readPost.mockRejectedValueOnce(new WordPressError('auth_failed', 'refused'));
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).toHaveBeenCalledTimes(1);
    expect(db.updates).toEqual([
      {
        table: 'brand_cms_connections',
        update: expect.objectContaining({ status: 'auth_failed' }),
        filters: [
          ['eq', 'id', 'cn1'],
          ['eq', 'provider', 'wordpress'],
          ['eq', 'updated_at', '2026-10-27T09:00:00Z'],
        ],
      },
    ]);
  });

  it('stops after three failed reads in a row, the site down', async () => {
    db.sends = ['1', '2', '3', '4'].map((id) => send(id, `dr${id}`));
    readPost.mockRejectedValue(new WordPressError('unreachable', 'down'));
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).toHaveBeenCalledTimes(3);
  });

  it('reads nothing without a connection, a connected one, sends or the server’s key', async () => {
    configured.on = false;
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    configured.on = true;
    db.connection = { ...db.connection, status: 'auth_failed' };
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    db.connection = null;
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).not.toHaveBeenCalled();
  });

  it('asks to connect again when the kept sign-in can’t be read', async () => {
    db.sends = [send('41', 'dr1')];
    credentials = null;
    expect(await checkWordPressPublished('b1')).toEqual({ checked: 0, published: [] });
    expect(readPost).not.toHaveBeenCalled();
    expect(db.updates[0].update.status).toBe('auth_failed');
  });
});

describe('sweepWordPressPublished', () => {
  it('reads the brands of active subscriptions, going on past one that fails', async () => {
    db.brands = [
      { brand_id: 'b1', brands: { organizations: { subscription_status: 'active' } } },
      { brand_id: 'b2', brands: { organizations: { subscription_status: 'canceled' } } },
      { brand_id: 'b3', brands: { organizations: { subscription_status: 'trialing' } } },
    ];
    db.sends = [send('41', 'dr1')];
    readPost.mockResolvedValue(post(41, 'publish'));
    markDeliveryPublished.mockRejectedValueOnce(new Error('down'));
    // On the cloud, where subscriptions count.
    vi.stubEnv('IS_CLOUD', 'true');
    expect(await sweepWordPressPublished()).toEqual({ brands: 1, published: 1 });
    vi.unstubAllEnvs();
    // The brand that failed (the order is shuffled daily) is logged; the other went on.
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/"brandId":"b[13]"/);
    expect(readPost).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a server that can’t keep a sign-in', async () => {
    configured.on = false;
    expect(await sweepWordPressPublished()).toEqual({ brands: 0, published: 0 });
  });
});
