import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS to Webflow (#1331, phase 2): a page goes to the brand's
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
        in: (col, value) => (q.filters.push(['in', col, value]), chain),
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
const webflow = { createItem: vi.fn(), updateItem: vi.fn(), getItem: vi.fn() };
vi.mock('./webflow.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createItem: (...args) => webflow.createItem(...args),
  updateItem: (...args) => webflow.updateItem(...args),
  getItem: (...args) => webflow.getItem(...args),
}));

const { sendToWebflow } = await import('./webflowDelivery.js');
const { WebflowError } = await import('./webflow.js');

const connection = {
  brand_id: 'b1',
  composio_entity_id: 'brand_b1',
  composio_account_id: 'ca_1',
  collection_id: 'c1',
  field_map: { body: 'post-body', metaDescription: 'post-summary' },
};
const account = { entityId: 'brand_b1', accountId: 'ca_1' };
const send = (over = {}) =>
  sendToWebflow({
    delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
    page: {
      draftId: 'dr1',
      title: 'Cold brew at home',
      slug: 'cold-brew-at-home',
      metaTitle: '',
      metaDescription: 'How to make it.',
      ...over,
    },
    html: '<h2>Why</h2><p>Smooth.</p><table><tr><td>a</td></tr></table><img src="https://x.example/a.png">',
    jsonLd: [],
    connection,
  });

beforeEach(() => {
  previous = null;
  queries.length = 0;
  updates.length = 0;
  logged.length = 0;
  webflow.createItem.mockReset().mockResolvedValue('item-new');
  webflow.updateItem.mockReset().mockResolvedValue('item-old');
  // The item as sent before: dated.
  webflow.getItem.mockReset().mockResolvedValue({
    id: 'item-old',
    slug: 'cold-brew-at-home',
    live: false,
    lastPublished: null,
    filledFields: ['name', 'slug', 'date'],
  });
});

describe('sendToWebflow', () => {
  it('makes a draft item of a page sent for the first time', async () => {
    expect(await send()).toEqual({
      taken: true,
      externalId: 'item-new',
      collectionId: 'c1',
      updated: false,
      changed: { tables: 1, images: 1 },
    });
    expect(webflow.createItem).toHaveBeenCalledWith(account, 'c1', {
      name: 'Cold brew at home',
      slug: 'cold-brew-at-home',
      'post-body': '<h2>Why</h2><p>Smooth.</p><ul><li>a</li></ul>',
      'post-summary': 'How to make it.',
    });
    expect(webflow.updateItem).not.toHaveBeenCalled();
    // The page's last item is looked for in this collection, from any send that made one:
    // one closed as removed in Webflow too, in case it wasn't.
    expect(queries[0].filters).toEqual([
      ['eq', 'draft_id', 'dr1'],
      ['eq', 'target', 'webflow'],
      ['eq', 'target_collection', 'c1'],
      ['not', 'external_id', 'is', null],
      ['neq', 'id', 'd2345678-0000-0000-0000-000000000000'],
    ]);
  });

  it('updates the item the page’s last send made, or makes a new one when it was deleted in Webflow', async () => {
    previous = 'item-old';
    expect(await send()).toMatchObject({ taken: true, externalId: 'item-old', updated: true });
    expect(webflow.updateItem).toHaveBeenCalledWith(account, 'c1', 'item-old', expect.any(Object));
    expect(webflow.createItem).not.toHaveBeenCalled();

    webflow.updateItem.mockRejectedValueOnce(new WebflowError('not_found', 'gone'));
    expect(await send()).toMatchObject({ taken: true, externalId: 'item-new', updated: false });

    // Any other refusal of the update is the send's: no second item.
    webflow.createItem.mockClear();
    webflow.updateItem.mockRejectedValueOnce(
      new WebflowError('invalid', 'Webflow refused the item'),
    );
    expect(await send()).toMatchObject({ taken: false, failure: 'Webflow refused the item' });
    expect(webflow.createItem).not.toHaveBeenCalled();
  });

  it('dates a new item the day it’s sent, and leaves an item sent again its own date', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-27T09:30:00Z') });
    try {
      const dated = { ...connection, field_map: { ...connection.field_map, date: 'date' } };
      const sendDated = () =>
        sendToWebflow({
          delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
          page: { draftId: 'dr1', title: 'Cold brew at home', slug: 'cold-brew-at-home' },
          html: '<p>Smooth.</p>',
          jsonLd: [],
          connection: dated,
        });
      await sendDated();
      expect(webflow.createItem.mock.calls[0][2]).toMatchObject({
        date: '2026-10-27T09:30:00.000Z',
      });

      previous = 'item-old';
      await sendDated();
      expect(webflow.updateItem.mock.calls[0][3]).not.toHaveProperty('date');
      // Deleted in Webflow: the new item is dated again.
      webflow.updateItem.mockRejectedValueOnce(new WebflowError('not_found', 'gone'));
      await sendDated();
      expect(webflow.createItem.mock.calls[1][2]).toHaveProperty(
        'date',
        '2026-10-27T09:30:00.000Z',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('dates an item sent again that has no date, as one sent before the date was mapped (#1600)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-28T08:00:00Z') });
    try {
      const dated = { ...connection, field_map: { ...connection.field_map, date: 'date' } };
      const sendDated = () =>
        sendToWebflow({
          delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
          page: { draftId: 'dr1', title: 'Cold brew at home', slug: 'cold-brew-at-home' },
          html: '<p>Smooth.</p>',
          jsonLd: [],
          connection: dated,
        });
      previous = 'item-old';
      webflow.getItem.mockResolvedValueOnce({
        id: 'item-old',
        slug: 'cold-brew-at-home',
        live: true,
        lastPublished: '2026-10-01T00:00:00Z',
        filledFields: ['name', 'slug', 'post-body'],
      });
      expect(await sendDated()).toMatchObject({ taken: true, updated: true });
      expect(webflow.getItem).toHaveBeenCalledWith(account, 'c1', 'item-old');
      expect(webflow.updateItem.mock.calls[0][3]).toHaveProperty(
        'date',
        '2026-10-28T08:00:00.000Z',
      );

      // An item that can't be read is updated without a date, not refused.
      webflow.getItem.mockRejectedValueOnce(new WebflowError('failed', 'busy'));
      expect(await sendDated()).toMatchObject({ taken: true, updated: true });
      expect(webflow.updateItem.mock.calls[1][3]).not.toHaveProperty('date');

      // A read that didn't see the item's fields keeps its date.
      webflow.getItem.mockResolvedValueOnce({
        id: 'item-old',
        slug: null,
        live: true,
        lastPublished: null,
        filledFields: [],
      });
      expect(await sendDated()).toMatchObject({ taken: true, updated: true });
      expect(webflow.updateItem.mock.calls[2][3]).not.toHaveProperty('date');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the item only when the map gives a date', async () => {
    previous = 'item-old';
    await send();
    expect(webflow.getItem).not.toHaveBeenCalled();
  });

  it('gives Webflow a slug it takes, from the title when the page’s has nothing left', async () => {
    await send({ slug: 'soğuk.demleme' });
    expect(webflow.createItem.mock.calls[0][2].slug).toBe('soguk-demleme');
    await send({ slug: '…', title: 'Café crème' });
    expect(webflow.createItem.mock.calls[1][2].slug).toBe('cafe-creme');
    // Another script: the draft's own, the same on every send.
    await send({ slug: 'привет-мир', title: '日本語' });
    await send({ slug: 'привет-мир', title: '日本語' });
    expect(webflow.createItem.mock.calls[2][2].slug).toBe('page-dr1');
    expect(webflow.createItem.mock.calls[3][2].slug).toBe('page-dr1');
  });

  it('marks the token refused when Webflow refuses it, and says what went wrong in its own words', async () => {
    webflow.createItem.mockRejectedValueOnce(
      new WebflowError('auth_failed', 'Webflow refused the site token'),
    );
    expect(await send()).toEqual({
      taken: false,
      failure: 'Webflow refused the site token',
      refused: true,
    });
    expect(updates).toEqual([
      {
        table: 'brand_cms_connections',
        row: { status: 'auth_failed', updated_at: expect.any(String) },
        filters: [
          ['eq', 'brand_id', 'b1'],
          ['eq', 'provider', 'webflow'],
          ['eq', 'composio_account_id', 'ca_1'],
        ],
      },
    ]);

    webflow.createItem.mockRejectedValueOnce(
      new WebflowError('slug_taken', 'Another item in the collection has this slug'),
    );
    expect(await send()).toMatchObject({ failure: 'Another item in the collection has this slug' });
    expect(updates).toHaveLength(1);

    webflow.createItem.mockRejectedValueOnce(new Error('socket hang up at token wf_secret'));
    expect(await send()).toEqual({ taken: false, failure: 'Webflow could not be reached' });
    expect(logged.join('')).not.toContain('wf_secret');
  });
});
