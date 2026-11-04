import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS to WordPress (#1331, phase 2; 00294): a page goes to the
 * brand's site as a draft post, updates the post its last send made there
 * while it's still a draft, and never writes over a live post.
 */

let previous;
const queries = [];
const updates = [];
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (col, value) => (q.filters.push(['eq', col, value]), chain),
        neq: (col, value) => (q.filters.push(['neq', col, value]), chain),
        not: (col, op, value) => (q.filters.push(['not', col, op, value]), chain),
        order: () => chain,
        limit: () => chain,
        update: (row) => (updates.push({ table, row, filters: q.filters }), chain),
        maybeSingle: async () => {
          queries.push(q);
          return { data: previous ? { external_id: previous } : null, error: null };
        },
        then: (resolve) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  },
}));
const logged = [];
vi.mock('../logger.js', () => ({
  logger: { warn: (...args) => logged.push(JSON.stringify(args)) },
}));
let credentials;
vi.mock('./credentials.js', () => ({ readCmsCredentials: async () => credentials }));
const markDeliveryPublished = vi.fn();
vi.mock('../contentPublished.js', () => ({
  markDeliveryPublished: (...args) => markDeliveryPublished(...args),
}));
const wordpress = { createPost: vi.fn(), readPost: vi.fn(), updatePost: vi.fn() };
vi.mock('./wordpress.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createPost: (...args) => wordpress.createPost(...args),
  readPost: (...args) => wordpress.readPost(...args),
  updatePost: (...args) => wordpress.updatePost(...args),
}));

const { sendToWordPress } = await import('./wordpressDelivery.js');
const { WordPressError } = await import('./wordpress.js');

const SITE = 'https://blog.acme.example';
const connection = {
  id: 'cn1',
  brand_id: 'b1',
  site_url: SITE,
  updated_at: '2026-10-27T09:00:00Z',
};
const signIn = { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' };
const HTML =
  '<h2>Why</h2><p>Smooth.</p><script type="application/ld+json">{"@type":"Article"}</script>';
const send = (over = {}) =>
  sendToWordPress({
    delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
    page: {
      draftId: 'dr1',
      title: 'Cold brew at home',
      slug: 'cold-brew-at-home',
      metaTitle: '',
      metaDescription: 'How to make it.',
      ...over,
    },
    html: HTML,
    connection,
  });
// The JSON-LD stays out: kses would leave it in the post as text.
const POST = {
  title: 'Cold brew at home',
  slug: 'cold-brew-at-home',
  content: '<h2>Why</h2><p>Smooth.</p>',
  excerpt: 'How to make it.',
};

beforeEach(() => {
  previous = null;
  credentials = signIn;
  queries.length = 0;
  updates.length = 0;
  logged.length = 0;
  markDeliveryPublished.mockReset().mockResolvedValue(undefined);
  wordpress.createPost.mockReset().mockResolvedValue({ id: 41, status: 'draft', link: null });
  wordpress.readPost.mockReset().mockResolvedValue({ id: 7, status: 'draft', link: null });
  wordpress.updatePost.mockReset().mockResolvedValue({ id: 7, status: 'draft', link: null });
});

describe('sendToWordPress', () => {
  it('makes a draft post of a page never sent to the site, its JSON-LD left out', async () => {
    expect(await send()).toEqual({
      taken: true,
      externalId: '41',
      collectionId: SITE,
      updated: false,
      live: false,
      changed: { jsonLd: 1 },
    });
    expect(wordpress.createPost).toHaveBeenCalledWith(SITE, signIn, POST, { request: undefined });
    expect(wordpress.readPost).not.toHaveBeenCalled();
    // The last send looked for: this page's, on this site, not this delivery.
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'draft_id', 'dr1'],
        ['eq', 'target', 'wordpress'],
        ['eq', 'target_collection', SITE],
        ['neq', 'id', 'd2345678-0000-0000-0000-000000000000'],
      ]),
    );
  });

  it('looks for the last post on this site, not another in a folder of its domain', async () => {
    await sendToWordPress({
      delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
      page: { draftId: 'dr1', title: 'Kalter Kaffee', slug: 'kalter-kaffee', metaDescription: '' },
      html: '<p>x</p>',
      connection: { ...connection, site_url: 'https://acme.example/de' },
    });
    expect(queries[0].filters).toContainEqual([
      'eq',
      'target_collection',
      'https://acme.example/de',
    ]);
  });

  it('updates the post its last send made while it is still a draft, or pending review', async () => {
    previous = '7';
    wordpress.readPost.mockResolvedValueOnce({ id: 7, status: 'pending', link: null });
    expect(await send()).toMatchObject({ updated: true });
    previous = '7';
    expect(await send({ title: 'Cold brew, step by step' })).toMatchObject({
      taken: true,
      externalId: '7',
      updated: true,
      live: false,
    });
    expect(wordpress.updatePost).toHaveBeenCalledWith(
      SITE,
      signIn,
      '7',
      { ...POST, title: 'Cold brew, step by step' },
      { request: undefined },
    );
    expect(wordpress.createPost).not.toHaveBeenCalled();
    expect(wordpress.updatePost).toHaveBeenCalledTimes(2);
  });

  it('makes a new draft rather than write over a live post, and says so', async () => {
    for (const status of ['publish', 'future', 'private']) {
      previous = '7';
      wordpress.readPost.mockResolvedValueOnce({ id: 7, status, link: `${SITE}/cold-brew/` });
      expect(await send()).toMatchObject({
        taken: true,
        externalId: '41',
        updated: false,
        live: true,
      });
    }
    expect(wordpress.updatePost).not.toHaveBeenCalled();
    expect(wordpress.createPost).toHaveBeenCalledTimes(3);
  });

  it('keeps the publish its last send’s post had, found live before the check saw it', async () => {
    previous = '7';
    wordpress.readPost.mockResolvedValueOnce({
      id: 7,
      status: 'publish',
      link: `${SITE}/cold-brew/`,
    });
    await send();
    expect(markDeliveryPublished).toHaveBeenCalledWith(
      expect.objectContaining({ external_id: '7' }),
      `${SITE}/cold-brew/`,
    );
    // Scheduled isn't live yet.
    previous = '7';
    markDeliveryPublished.mockClear();
    wordpress.readPost.mockResolvedValueOnce({ id: 7, status: 'future', link: `${SITE}/?p=7` });
    await send();
    expect(markDeliveryPublished).not.toHaveBeenCalled();
  });

  it('makes a new post when the last one is gone or in the trash', async () => {
    previous = '7';
    wordpress.readPost.mockResolvedValueOnce(null);
    expect(await send()).toMatchObject({ externalId: '41', updated: false, live: false });
    wordpress.readPost.mockResolvedValueOnce({ id: 7, status: 'trash', link: null });
    expect(await send()).toMatchObject({ externalId: '41', updated: false, live: false });
    expect(wordpress.updatePost).not.toHaveBeenCalled();
  });

  it('makes a new post when the draft was deleted between the read and the write', async () => {
    previous = '7';
    wordpress.updatePost.mockRejectedValueOnce(new WordPressError('not_found', 'gone'));
    expect(await send()).toMatchObject({ externalId: '41', updated: false });
  });

  it('leaves the slug to WordPress when the page has none', async () => {
    await send({ slug: '' });
    expect(wordpress.createPost.mock.calls[0][2]).not.toHaveProperty('slug');
  });

  it('marks the connection refused when WordPress refuses the sign-in', async () => {
    wordpress.createPost.mockRejectedValueOnce(
      new WordPressError('auth_failed', 'WordPress refused the user or the Application Password.'),
    );
    expect(await send()).toEqual({
      taken: false,
      failure: 'WordPress refused the user or the Application Password.',
      refused: true,
    });
    expect(updates).toEqual([
      {
        table: 'brand_cms_connections',
        row: expect.objectContaining({ status: 'auth_failed' }),
        // The connection as the send read it: one connected again meanwhile keeps its sign-in.
        filters: [
          ['eq', 'id', 'cn1'],
          ['eq', 'provider', 'wordpress'],
          ['eq', 'updated_at', '2026-10-27T09:00:00Z'],
        ],
      },
    ]);
  });

  it('asks to connect again when the kept sign-in can’t be read', async () => {
    credentials = null;
    expect(await send()).toMatchObject({ taken: false, refused: true });
    expect(wordpress.createPost).not.toHaveBeenCalled();
    expect(updates[0].row.status).toBe('auth_failed');
  });

  it('says what WordPress answered, and keeps the connection', async () => {
    wordpress.createPost.mockRejectedValueOnce(
      new WordPressError('failed', 'WordPress answered 500.'),
    );
    expect(await send()).toEqual({ taken: false, failure: 'WordPress answered 500.' });
    expect(updates).toEqual([]);
  });

  it('says WordPress couldn’t be reached on anything else, logging no message', async () => {
    wordpress.createPost.mockRejectedValueOnce(new Error('password=secret'));
    expect(await send()).toEqual({ taken: false, failure: 'WordPress could not be reached' });
    expect(logged.join('')).not.toContain('secret');
  });
});
