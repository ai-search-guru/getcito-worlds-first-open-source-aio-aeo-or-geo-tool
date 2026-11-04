import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Webflow for Send to CMS (#1331, phase 2): reading a site through Composio, and the field map. */

const executeWebflowTool = vi.fn();
vi.mock('../composio.js', () => ({
  executeWebflowTool: (...args) => executeWebflowTool(...args),
}));

const {
  WebflowError,
  checkFieldMap,
  createItem,
  getCollection,
  getItem,
  listCollections,
  listSites,
  publishItem,
  unpublishItem,
  suggestFieldMap,
  updateItem,
} = await import('./webflow.js');

const account = { entityId: 'brand_b1', accountId: 'ca_1' };

// A Webflow blog collection's fields, as its template makes them.
const blog = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'slug', name: 'Slug', type: 'PlainText', required: true },
  { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
  { slug: 'post-summary', name: 'Post Summary', type: 'PlainText', required: false },
  { slug: 'main-image', name: 'Main Image', type: 'Image', required: false },
  { slug: 'featured', name: 'Featured?', type: 'Switch', required: false },
];

beforeEach(() => executeWebflowTool.mockReset());

describe('reading the site', () => {
  it('lists the token’s sites, however Composio wraps them', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      sites: [{ id: 's1', displayName: 'GetCito', shortName: 'getcito' }, { displayName: 'no id' }],
    });
    expect(await listSites(account)).toEqual([
      { id: 's1', name: 'GetCito', host: 'getcito.webflow.io' },
    ]);
    expect(executeWebflowTool).toHaveBeenCalledWith('WEBFLOW_LIST_WEBFLOW_SITES', account, {});

    executeWebflowTool.mockResolvedValueOnce({
      response_data: { sites: [{ id: 's2', shortName: 'acme' }] },
    });
    expect(await listSites(account)).toEqual([{ id: 's2', name: 'acme', host: 'acme.webflow.io' }]);
  });

  it('lists a site’s collections, and a collection’s fields a person can fill', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      collections: [{ id: 'c1', displayName: 'Blog Posts', slug: 'post' }],
    });
    expect(await listCollections(account, 's1')).toEqual([
      { id: 'c1', name: 'Blog Posts', slug: 'post' },
    ]);
    expect(executeWebflowTool).toHaveBeenLastCalledWith('WEBFLOW_LIST_COLLECTIONS', account, {
      site_id: 's1',
    });

    executeWebflowTool.mockResolvedValueOnce({
      id: 'c1',
      displayName: 'Blog Posts',
      fields: [
        {
          slug: 'name',
          displayName: 'Name',
          type: 'PlainText',
          isRequired: true,
          isEditable: true,
        },
        { slug: 'post-body', displayName: 'Post Body', type: 'RichText', isEditable: true },
        { slug: 'created-on', displayName: 'Created On', type: 'DateTime', isEditable: false },
      ],
    });
    expect(await getCollection(account, 'c1')).toEqual({
      id: 'c1',
      name: 'Blog Posts',
      fields: [
        { slug: 'name', name: 'Name', type: 'PlainText', required: true },
        { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
      ],
    });
  });

  it('tells what went wrong in its own words, never Webflow’s', async () => {
    const said = async (message) => {
      executeWebflowTool.mockRejectedValueOnce(new Error(message));
      return listSites(account).catch((err) => err);
    };
    const refused = await said('Request failed with status 401: token wf_secret_123 is not valid');
    expect(refused).toBeInstanceOf(WebflowError);
    expect(refused).toMatchObject({ code: 'auth_failed' });
    expect(refused.message).not.toMatch(/wf_secret/);
    expect(await said('{"code":"missing_scopes","message":"cms:write"}')).toMatchObject({
      code: 'missing_scopes',
    });
    expect(await said('404 resource_not_found')).toMatchObject({ code: 'not_found' });
    expect(await said('socket hang up')).toMatchObject({ code: 'failed' });
    // A 403 is a site or collection the token doesn't reach, not a refused token.
    expect(await said('Request failed with status 403: forbidden')).toMatchObject({
      code: 'no_access',
    });
    // The brand's account gone at Composio: connecting again mends it.
    executeWebflowTool.mockRejectedValueOnce(
      Object.assign(new Error('No connected account ca_1'), {
        name: 'ComposioConnectedAccountNotFoundError',
      }),
    );
    expect(await listSites(account).catch((err) => err)).toMatchObject({ code: 'auth_failed' });
  });
});

describe('suggestFieldMap', () => {
  it('suggests the template’s fields by their names, one field a part', () => {
    expect(suggestFieldMap(blog)).toEqual({ body: 'post-body', metaDescription: 'post-summary' });
    expect(
      suggestFieldMap([
        ...blog,
        { slug: 'seo-title', name: 'SEO Title', type: 'PlainText' },
        { slug: 'meta-description', name: 'Meta Description', type: 'PlainText' },
        { slug: 'schema-markup', name: 'Schema markup', type: 'PlainText' },
      ]),
    ).toEqual({
      body: 'post-body',
      metaTitle: 'seo-title',
      metaDescription: 'meta-description',
      jsonLd: 'schema-markup',
    });
  });

  it('falls back to the first rich text for the body, and never suggests a field of another type', () => {
    expect(
      suggestFieldMap([
        { slug: 'intro', name: 'Intro', type: 'RichText' },
        { slug: 'summary-image', name: 'Summary image', type: 'Image' },
      ]),
    ).toEqual({ body: 'intro' });
    expect(suggestFieldMap([{ slug: 'name', name: 'Name', type: 'PlainText' }])).toEqual({});
  });

  it('suggests a date the collection requires: the one named as a date, else its only one', () => {
    const date = (slug, name, required = true) => ({ slug, name, type: 'DateTime', required });
    expect(suggestFieldMap([...blog, date('date', 'Date')])).toEqual({
      body: 'post-body',
      metaDescription: 'post-summary',
      date: 'date',
    });
    expect(
      suggestFieldMap([
        ...blog,
        date('event-day', 'Event day'),
        date('publish-date', 'Publish Date'),
      ]).date,
    ).toBe('publish-date');
    expect(suggestFieldMap([...blog, date('event-day', 'Event day')]).date).toBe('event-day');
    // Two it requires, neither named as a date: the person picks.
    expect(
      suggestFieldMap([...blog, date('event-day', 'Event day'), date('ends', 'Ends')]).date,
    ).toBeUndefined();
    // A date it doesn't require isn't filled unasked, nor Webflow's own.
    expect(suggestFieldMap([...blog, date('post-date', 'Post Date', false)]).date).toBeUndefined();
    expect(suggestFieldMap([...blog, date('published-on', 'Published On')]).date).toBeUndefined();
  });
});

describe('checkFieldMap', () => {
  it('maps the reviewer to a plain-text field without making it universally required', () => {
    const reviewer = {
      slug: 'reviewed-by',
      name: 'Reviewed by',
      type: 'PlainText',
      required: false,
    };
    const fields = [...blog, reviewer];
    expect(suggestFieldMap(fields).reviewer).toBe('reviewed-by');
    expect(checkFieldMap({ body: 'post-body', reviewer: 'reviewed-by' }, fields)).toEqual({
      ok: true,
      map: { body: 'post-body', reviewer: 'reviewed-by' },
    });
    const required = fields.map((field) =>
      field.slug === 'reviewed-by' ? { ...field, required: true } : field,
    );
    expect(
      checkFieldMap({ body: 'post-body', reviewer: 'reviewed-by' }, required).problems,
    ).toEqual([
      'The collection requires Reviewed by, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
  });

  it('keeps a map that fits the collection', () => {
    expect(
      checkFieldMap({ body: 'post-body', metaDescription: 'post-summary', jsonLd: '' }, blog),
    ).toEqual({
      ok: true,
      map: { body: 'post-body', metaDescription: 'post-summary' },
    });
  });

  it('names each part that doesn’t fit', () => {
    const problems = (map, fields = blog) => checkFieldMap(map, fields).problems;
    expect(problems({ body: 'post-summary' })).toEqual([
      'body: Post Summary is PlainText, not RichText',
    ]);
    expect(problems({ body: 'post-body', metaTitle: 'nope' })).toEqual([
      'metaTitle: the collection has no field "nope"',
    ]);
    expect(problems({ body: 'post-body', metaTitle: 'name' })).toEqual([
      'metaTitle: the collection has no field "name"',
    ]);
    expect(
      problems({ body: 'post-body', metaTitle: 'post-summary', metaDescription: 'post-summary' }),
    ).toEqual(['metaDescription: Post Summary already takes another part']);
    expect(problems({ metaTitle: 'post-summary' })).toEqual([
      'body: pick the rich text field a page goes to',
    ]);
  });

  it('refuses a collection that requires a field Send to CMS doesn’t fill', () => {
    const fields = [
      ...blog,
      { slug: 'category', name: 'Category', type: 'Reference', required: true },
    ];
    expect(checkFieldMap({ body: 'post-body' }, fields).problems).toEqual([
      'The collection requires Category, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
    // A required field the map fills is fine.
    expect(
      checkFieldMap(
        { body: 'post-body' },
        blog.map((f) => (f.slug === 'post-body' ? { ...f, required: true } : f)),
      ).ok,
    ).toBe(true);
    // A page's meta description always has words (its opening ones at least);
    // its JSON-LD may be none.
    const summaryRequired = blog.map((f) =>
      f.slug === 'post-summary' ? { ...f, required: true } : f,
    );
    expect(
      checkFieldMap({ body: 'post-body', metaDescription: 'post-summary' }, summaryRequired).ok,
    ).toBe(true);
    expect(
      checkFieldMap({ body: 'post-body', jsonLd: 'post-summary' }, summaryRequired).problems,
    ).toEqual([
      'The collection requires Post Summary, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
  });

  it('fills a date the collection requires with the day a page is sent, a DateTime field only', () => {
    const fields = [
      ...blog,
      { slug: 'date', name: 'Date', type: 'DateTime', required: true },
      { slug: 'category', name: 'Category', type: 'Reference', required: false },
    ];
    expect(checkFieldMap({ body: 'post-body', date: 'date' }, fields)).toEqual({
      ok: true,
      map: { body: 'post-body', date: 'date' },
    });
    // Left unmapped, the date is still a field Send to CMS doesn't fill.
    expect(checkFieldMap({ body: 'post-body' }, fields).problems).toEqual([
      'The collection requires Date, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
    expect(checkFieldMap({ body: 'post-body', date: 'post-summary' }, fields).problems).toEqual([
      'date: Post Summary is PlainText, not DateTime',
      'The collection requires Date, which Send to CMS doesn’t fill: make it optional in Webflow, or pick another collection',
    ]);
    expect(checkFieldMap({ body: 'post-body', metaDescription: 'date' }, fields).problems).toEqual(
      expect.arrayContaining(['metaDescription: Date is DateTime, not PlainText']),
    );
    // Webflow keeps its own dates.
    expect(checkFieldMap({ body: 'post-body', date: 'published-on' }, blog).problems).toEqual([
      'date: the collection has no field "published-on"',
    ]);
  });
});

describe('items', () => {
  it('makes a draft item, and writes an item again leaving its state as it is', async () => {
    executeWebflowTool.mockResolvedValueOnce({ id: 'item-1', isDraft: true });
    expect(await createItem(account, 'c1', { name: 'A', slug: 'a' })).toBe('item-1');
    expect(executeWebflowTool).toHaveBeenLastCalledWith('WEBFLOW_CREATE_COLLECTION_ITEM', account, {
      collection_id: 'c1',
      field_data: { name: 'A', slug: 'a' },
      is_draft: true,
    });
    executeWebflowTool.mockResolvedValueOnce({ response_data: { id: 'item-1' } });
    expect(await updateItem(account, 'c1', 'item-1', { name: 'B', slug: 'a' })).toBe('item-1');
    expect(executeWebflowTool).toHaveBeenLastCalledWith(
      'WEBFLOW_UPDATE_COLLECTION_ITEM_V2',
      account,
      { collection_id: 'c1', item_id: 'item-1', fieldData: { name: 'B', slug: 'a' } },
    );
    // An answer with no item: the one written.
    executeWebflowTool.mockResolvedValueOnce({});
    expect(await updateItem(account, 'c1', 'item-1', {})).toBe('item-1');
    executeWebflowTool.mockResolvedValueOnce({});
    await expect(createItem(account, 'c1', {})).rejects.toMatchObject({ code: 'failed' });
  });

  it('names an item Webflow won’t take', async () => {
    const said = async (message) => {
      executeWebflowTool.mockRejectedValueOnce(new Error(message));
      return createItem(account, 'c1', {}).catch((err) => err);
    };
    expect(
      await said("400 validation_error: Unique value is already in database: 'slug'"),
    ).toMatchObject({
      code: 'slug_taken',
    });
    expect(await said('400 Bad Request: validation_error on field post-summary')).toMatchObject({
      code: 'invalid',
    });
  });
});

describe('where pages live', () => {
  it('reads a site’s host: its custom domain published to, else its first, else webflow.io', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      sites: [
        {
          id: 's1',
          shortName: 'acme',
          customDomains: [
            { url: 'staging.acme.example', lastPublished: null },
            { url: 'https://www.acme.example/', lastPublished: '2026-10-20T10:00:00Z' },
          ],
        },
        // Never published to its domain: published on webflow.io only.
        { id: 's2', shortName: 'beta', customDomains: [{ url: 'Beta.Example' }] },
        { id: 's3', customDomains: [{ url: 'not a host' }] },
        { id: 's4', customDomains: [{ url: 'gamma.example' }] },
        // Both published: the one published to last (the canonical one, as Webflow redirects).
        {
          id: 's5',
          shortName: 'delta',
          customDomains: [
            { url: 'delta.example', lastPublished: '2026-10-01T10:00:00Z' },
            { url: 'www.delta.example', lastPublished: '2026-10-21T10:00:00Z' },
          ],
        },
      ],
    });
    expect((await listSites(account)).map((s) => s.host)).toEqual([
      'www.acme.example',
      'beta.webflow.io',
      null,
      'gamma.example',
      'www.delta.example',
    ]);
  });

  it('reads whether an item is live, and its slug; a deleted one is none', async () => {
    executeWebflowTool.mockResolvedValueOnce({
      id: 'i1',
      lastPublished: '2026-10-25T10:00:00Z',
      isDraft: false,
      isArchived: false,
      fieldData: { slug: 'cold-brew', name: 'Cold brew' },
    });
    expect(await getItem(account, 'c1', 'i1')).toEqual({
      id: 'i1',
      slug: 'cold-brew',
      live: true,
      lastPublished: '2026-10-25T10:00:00Z',
      filledFields: ['slug', 'name'],
    });
    expect(executeWebflowTool).toHaveBeenLastCalledWith('WEBFLOW_GET_COLLECTION_ITEM', account, {
      collection_id: 'c1',
      item_id: 'i1',
    });
    executeWebflowTool.mockResolvedValueOnce({
      response_data: { id: 'i1', lastPublished: null, isDraft: true, fieldData: { slug: 'x' } },
    });
    expect(await getItem(account, 'c1', 'i1')).toMatchObject({ live: false });
    executeWebflowTool.mockResolvedValueOnce({
      id: 'i1',
      lastPublished: '2026-10-25T10:00:00Z',
      isDraft: true,
      fieldData: { slug: 'x' },
    });
    expect(await getItem(account, 'c1', 'i1')).toMatchObject({ live: false });
    // Wrapped as { item }.
    executeWebflowTool.mockResolvedValueOnce({
      item: { id: 'i1', lastPublished: '2026-10-25T10:00:00Z', fieldData: { slug: 'y' } },
    });
    expect(await getItem(account, 'c1', 'i1')).toMatchObject({ slug: 'y', live: true });
    executeWebflowTool.mockRejectedValueOnce(new Error('404 resource_not_found'));
    expect(await getItem(account, 'c1', 'i1')).toBeNull();
    executeWebflowTool.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(getItem(account, 'c1', 'i1')).rejects.toMatchObject({ code: 'auth_failed' });
  });
});

describe('publishItem (AUTONOMOUS-GO-LIVE PR 9)', () => {
  it('takes the item out of draft, then publishes it alone', async () => {
    executeWebflowTool.mockResolvedValue({});
    expect(await publishItem(account, 'col_1', 'item_1')).toBe('item_1');
    expect(executeWebflowTool.mock.calls.map(([slug, , args]) => [slug, args])).toEqual([
      [
        'WEBFLOW_UPDATE_COLLECTION_ITEM_V2',
        { collection_id: 'col_1', item_id: 'item_1', isDraft: false },
      ],
      ['WEBFLOW_PUBLISH_COLLECTION_ITEMS', { collection_id: 'col_1', item_ids: ['item_1'] }],
    ]);
  });

  it('says why Webflow refused, and publishes nothing after a refused update', async () => {
    executeWebflowTool.mockRejectedValueOnce(new Error('403 Forbidden'));
    await expect(publishItem(account, 'col_1', 'item_1')).rejects.toBeInstanceOf(WebflowError);
    expect(executeWebflowTool).toHaveBeenCalledTimes(1);
  });
});

describe('unpublishItem (AUTONOMOUS-GO-LIVE PR 10)', () => {
  it('unpublishes the one live item', async () => {
    executeWebflowTool.mockResolvedValue({});
    expect(await unpublishItem(account, 'col_1', 'item_1')).toBe('item_1');
    expect(executeWebflowTool.mock.calls.map(([slug, , args]) => [slug, args])).toEqual([
      ['WEBFLOW_UNPUBLISH_LIVE_COLLECTION_ITEM', { collection_id: 'col_1', item_id: 'item_1' }],
    ]);
    executeWebflowTool.mockRejectedValueOnce(new Error('403 Forbidden'));
    await expect(unpublishItem(account, 'col_1', 'item_1')).rejects.toBeInstanceOf(WebflowError);
  });
});
