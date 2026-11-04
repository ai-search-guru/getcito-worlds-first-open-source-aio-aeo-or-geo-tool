import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FramerCollection } from './framerClient';

/** Send to CMS › Framer (#1331, phase 2): a brand's connection from the browser, through the API's proxy. */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}));

const {
  connectFramer,
  disconnectFramer,
  fittingFramerMap,
  missingFramerParts,
  readFramer,
  readFramerCollections,
  saveFramerTarget,
  suggestFramerMap,
  unfillableFramerFields,
  unmappedFramerFields,
} = await import('./framerClient');

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const BASE = '/api/aeo/api/cms/brands/b1/framer';
const input = {
  project: 'https://framer.com/projects/Acme--abcdefghij0123456789',
  apiKey: 'fr_key',
};

const BLOG: FramerCollection = {
  id: 'c1',
  name: 'Blog',
  titleField: 'f-title',
  fields: [
    { id: 'f-seo', name: 'SEO Title', type: 'string', required: false },
    { id: 'f-title', name: 'Title', type: 'string', required: true },
    { id: 'f-cover', name: 'Cover', type: 'image', required: false },
    { id: 'f-intro', name: 'Intro', type: 'formattedText', required: false },
    { id: 'f-content', name: 'Content', type: 'formattedText', required: false },
    { id: 'f-summary', name: 'Summary', type: 'string', required: false },
    { id: 'f-schema', name: 'Schema markup', type: 'string', required: false },
    { id: 'f-reviewer', name: 'Reviewed by', type: 'string', required: false },
  ],
};

describe('framer-client', () => {
  it('reads the connection, and whether the server can keep a key', async () => {
    answer(200, { configured: true, connection: null });
    expect(await readFramer('b1')).toEqual({ ok: true, configured: true, connection: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('sends the project and the key once, in the body, with the session', async () => {
    answer(200, { connection: { status: 'connected' } });
    expect(await connectFramer('b1', input)).toEqual({
      ok: true,
      connection: { status: 'connected' },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init).toMatchObject({
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    });
  });

  it('reads the collections, saves where pages go, and disconnects', async () => {
    answer(200, { collections: [BLOG] });
    expect(await readFramerCollections('b1')).toEqual({ ok: true, collections: [BLOG] });
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/collections`);

    answer(200, { connection: { collectionId: 'c1' } });
    const target = { collectionId: 'c1', fieldMap: { title: 'f-title', body: 'f-content' } };
    await saveFramerTarget('b1', target);
    expect(fetchMock.mock.calls[1][0]).toBe(BASE);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify(target),
    });

    answer(200, { success: true, revoked: false });
    expect(await disconnectFramer('b1')).toEqual({ ok: true, success: true, revoked: false });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' });
  });

  it("names the API's reasons with the problems, and the general ones", async () => {
    answer(400, { code: 'invalid_map', problems: ['title: pick the text field', 3] });
    expect(await saveFramerTarget('b1', { collectionId: 'c1', fieldMap: {} })).toEqual({
      ok: false,
      code: 'invalid_map',
      problems: ['title: pick the text field'],
    });
    for (const [status, code] of [
      [400, 'invalid'],
      [409, 'auth_failed'],
      [403, 'no_access'],
      [404, 'not_found'],
      [429, 'busy'],
      [502, 'unreachable'],
      [503, 'not_configured'],
      [409, 'not_connected'],
      [409, 'changed'],
      [403, 'forbidden'],
    ] as const) {
      answer(status, { code, error: 'x' });
      expect(await connectFramer('b1', input)).toEqual({ ok: false, code });
    }
    answer(401, { error: 'Unauthorized' });
    expect(await readFramer('b1')).toEqual({ ok: false, code: 'session' });
    answer(403, { code: 'not_in_workspace' });
    expect(await readFramer('b1')).toEqual({ ok: false, code: 'workspace' });
    answer(429, { message: 'Too many requests' });
    expect(await readFramer('b1')).toEqual({ ok: false, code: 'busy' });
    // A read-only workspace: the upgrade dialog's, not a message.
    answer(402, { code: 'subscription_inactive', error: 'x' });
    expect(await connectFramer('b1', input)).toEqual({ ok: false, code: 'subscription' });
    answer(502, { code: 'failed', error: 'Something went wrong with Framer' });
    expect(await readFramer('b1')).toEqual({ ok: false, code: 'failed' });
    fetchMock.mockRejectedValue(new TypeError('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readFramer('b1')).toEqual({ ok: false, code: 'failed' });
  });
});

describe('suggestFramerMap', () => {
  it('suggests the slug’s field for the title, and the rest by their names, one field a part', () => {
    expect(suggestFramerMap(BLOG)).toEqual({
      title: 'f-title',
      body: 'f-content',
      metaTitle: 'f-seo',
      metaDescription: 'f-summary',
      jsonLd: 'f-schema',
      reviewer: 'f-reviewer',
    });
  });

  it('falls back to a field named as a title, and to the first formatted text for the body', () => {
    expect(
      suggestFramerMap({
        id: 'c2',
        name: 'Guides',
        titleField: 'f-date',
        fields: [
          { id: 'f-date', name: 'Date', type: 'date', required: false },
          { id: 'f-seo', name: 'SEO Title', type: 'string', required: false },
          { id: 'f-name', name: 'Name', type: 'string', required: false },
          { id: 'f-intro', name: 'Intro', type: 'formattedText', required: false },
        ],
      }),
    ).toEqual({ title: 'f-name', body: 'f-intro', metaTitle: 'f-seo' });
    expect(suggestFramerMap({ id: 'c3', name: 'Empty', titleField: null, fields: [] })).toEqual({});
  });
});

describe('fittingFramerMap', () => {
  it('keeps only fields that are still there, of the part’s type, each once', () => {
    expect(
      fittingFramerMap(
        {
          title: 'f-title',
          body: 'f-cover',
          metaTitle: 'f-gone',
          metaDescription: 'f-title',
          jsonLd: 'f-schema',
        },
        BLOG.fields,
      ),
    ).toEqual({ title: 'f-title', jsonLd: 'f-schema' });
  });
});

describe('missingFramerParts', () => {
  it('names the parts every page has that the collection has no field for', () => {
    expect(missingFramerParts(BLOG)).toEqual([]);
    expect(
      missingFramerParts({
        ...BLOG,
        fields: BLOG.fields.filter((f) => f.type !== 'formattedText'),
      }),
    ).toEqual(['body']);
    expect(missingFramerParts({ ...BLOG, fields: [] })).toEqual(['title', 'body']);
  });
});

describe('required fields', () => {
  const strict: FramerCollection = {
    ...BLOG,
    fields: BLOG.fields.map((f) =>
      f.id === 'f-cover' || f.id === 'f-schema' ? { ...f, required: true } : f,
    ),
  };

  it('names the ones no map fills', () => {
    expect(unfillableFramerFields(strict).map((f) => f.name)).toEqual(['Cover']);
    expect(unfillableFramerFields(BLOG)).toEqual([]);
  });

  it('names the ones the map leaves to no part a page always has, JSON-LD aside', () => {
    expect(
      unmappedFramerFields(
        { title: 'f-title', body: 'f-content', jsonLd: 'f-schema' },
        strict.fields,
      ).map((f) => f.name),
    ).toEqual(['Schema markup']);
    expect(
      unmappedFramerFields(
        { title: 'f-title', body: 'f-content', metaDescription: 'f-schema' },
        strict.fields,
      ),
    ).toEqual([]);
    expect(unmappedFramerFields({ body: 'f-content' }, BLOG.fields).map((f) => f.name)).toEqual([
      'Title',
    ]);
  });
});
