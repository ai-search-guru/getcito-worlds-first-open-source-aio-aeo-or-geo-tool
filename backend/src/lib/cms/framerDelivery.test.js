import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS to Framer (#1331, phase 2; 00295): a page goes to the brand's
 * collection as a draft item, or updates the item its last send made there.
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
const framer = { writeItem: vi.fn() };
vi.mock('./framer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  writeItem: (...args) => framer.writeItem(...args),
}));

const { sendToFramer } = await import('./framerDelivery.js');
const actual = await vi.importActual('./framer.js');
const { FramerError } = actual;

const PROJECT = 'AbCdEfGhIj0123456789';
const KEY = 'fr_key_0123456789abcdefSECRET';
const connection = {
  id: 'cn1',
  brand_id: 'b1',
  site_id: PROJECT,
  collection_id: 'cBlog',
  field_map: { title: 'fTitle', body: 'fBody', metaDescription: 'fDesc' },
  updated_at: '2026-10-27T09:00:00Z',
};
const DELIVERY = 'd2345678-0000-0000-0000-000000000000';
const send = (over = {}, extra = {}) =>
  sendToFramer({
    delivery: { id: DELIVERY },
    page: {
      draftId: 'dr1',
      title: 'Cold brew at home',
      slug: 'cold-brew-at-home',
      metaTitle: '',
      metaDescription: 'How to make it.',
      ...over,
    },
    html: '<h2>Why</h2><p>Smooth.</p><table><tr><td>a</td></tr></table><img src="https://x.example/a.png"><script type="application/ld+json">{"@type":"Article"}</script>',
    jsonLd: [{ '@type': 'Article' }],
    connection,
    ...extra,
  });
const FIELD_DATA = {
  fTitle: { type: 'string', value: 'Cold brew at home' },
  fBody: {
    type: 'formattedText',
    value: '<h2>Why</h2><p>Smooth.</p><table><tbody><tr><td>a</td></tr></tbody></table>',
    contentType: 'html',
  },
  fDesc: { type: 'string', value: 'How to make it.' },
};
const refusal = {
  table: 'brand_cms_connections',
  row: { status: 'auth_failed', updated_at: expect.any(String) },
  filters: [
    ['eq', 'id', 'cn1'],
    ['eq', 'provider', 'framer'],
    ['eq', 'updated_at', '2026-10-27T09:00:00Z'],
  ],
};

beforeEach(() => {
  previous = null;
  credentials = { apiKey: KEY };
  queries.length = 0;
  updates.length = 0;
  logged.length = 0;
  framer.writeItem.mockReset().mockResolvedValue({ id: 'item-new', updated: false, live: false });
});

describe('sendToFramer', () => {
  it('makes a draft item of a page sent for the first time', async () => {
    expect(await send()).toEqual({
      taken: true,
      externalId: 'item-new',
      collectionId: 'cBlog',
      updated: false,
      live: false,
      changed: { images: 1 },
    });
    expect(framer.writeItem).toHaveBeenCalledWith(
      PROJECT,
      KEY,
      'cBlog',
      { before: null, slug: 'cold-brew-at-home', fieldData: FIELD_DATA, titleField: 'fTitle' },
      { connect: undefined },
    );
    // The page's last item is looked for in this collection, from any send that made one.
    expect(queries[0].filters).toEqual([
      ['eq', 'draft_id', 'dr1'],
      ['eq', 'target', 'framer'],
      ['eq', 'target_collection', 'cBlog'],
      ['not', 'external_id', 'is', null],
      ['neq', 'id', DELIVERY],
    ]);
    expect(updates).toEqual([]);
  });

  it('updates the item the page’s last send made, and says whether it is live', async () => {
    previous = 'item-old';
    framer.writeItem.mockResolvedValueOnce({ id: 'item-old', updated: true, live: true });
    expect(await send()).toMatchObject({
      taken: true,
      externalId: 'item-old',
      updated: true,
      live: true,
    });
    expect(framer.writeItem.mock.calls[0][3].before).toBe('item-old');
  });

  it('asks to connect again when the key can’t be read, sending nothing', async () => {
    credentials = null;
    expect(await send()).toEqual({
      taken: false,
      failure: 'The Framer API key can’t be read. Connect Framer again.',
      refused: true,
    });
    expect(framer.writeItem).not.toHaveBeenCalled();
    expect(updates).toEqual([refusal]);
  });

  it('marks the key refused when Framer refuses it, and says what went wrong in its own words', async () => {
    framer.writeItem.mockRejectedValueOnce(
      new FramerError('auth_failed', 'Framer refused the API key.'),
    );
    expect(await send()).toEqual({
      taken: false,
      failure: 'Framer refused the API key.',
      refused: true,
    });
    expect(updates).toEqual([refusal]);

    framer.writeItem.mockRejectedValueOnce(
      new FramerError('slug_taken', 'Another item in Blog has the slug "cold-brew-at-home".'),
    );
    expect(await send()).toEqual({
      taken: false,
      failure: 'Another item in Blog has the slug "cold-brew-at-home".',
    });
    expect(updates).toHaveLength(1);
  });

  it('says Framer couldn’t be reached on anything else, logging its name only', async () => {
    framer.writeItem.mockRejectedValueOnce(new Error(`socket hang up with ${KEY}`));
    expect(await send()).toEqual({ taken: false, failure: 'Framer could not be reached' });
    expect(logged.join('')).not.toContain(KEY);
    expect(updates).toEqual([]);
  });

  it('writes the item through one connection to the project', async () => {
    framer.writeItem.mockImplementationOnce(actual.writeItem);
    const addItems = vi.fn(async () => {});
    const getItems = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'item-9', slug: 'cold-brew-at-home', draft: true }]);
    const project = {
      disconnect: vi.fn(async () => {}),
      getCollections: vi.fn(async () => [
        { id: 'cBlog', name: 'Blog', managedBy: 'user', getItems, addItems },
      ]),
    };
    const connect = vi.fn(async () => project);
    expect(await send({}, { connect })).toMatchObject({ taken: true, externalId: 'item-9' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith(PROJECT, KEY);
    expect(addItems).toHaveBeenCalledWith([
      { slug: 'cold-brew-at-home', draft: true, fieldData: FIELD_DATA },
    ]);
    expect(project.disconnect).toHaveBeenCalledTimes(1);
  });
});
