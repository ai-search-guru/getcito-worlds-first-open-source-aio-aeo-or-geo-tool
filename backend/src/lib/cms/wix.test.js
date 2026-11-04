import { afterEach, describe, expect, it, vi } from 'vitest';

// The harness reaches the Supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { startFakeApi } = await import('../../connectors/testing.js');
const {
  RICOS_CHUNK,
  WixError,
  checkSite,
  createDraftPost,
  readDraftPost,
  ricosChunks,
  siteIdOf,
  toRicos,
  updateDraftPost,
  webAddress,
  publishDraftPost,
  revertToDraft,
} = await import('./wix.js');

/**
 * Wix's REST API for Send to CMS (#1331, phase 2; 00372): a site checked
 * before its key is kept, a page's HTML turned into Wix's rich content, and
 * draft posts written, against a fake of the API (its answers as Wix's
 * reference shows them). Real keys are tried by the maintainer.
 */

const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const KEY = 'IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.fake-key';
const MEMBER = 'c00e8a5c-322b-4e77-8813-002e3ea7e811';
const POST = '9124f6ef-a537-4bdd-bca3-e7306947deeb';

let api;
afterEach(() => api?.close());

const start = async (routes) => {
  api = await startFakeApi(routes);
  return { base: api.origin, request: api.request };
};

const CONVERT = 'POST /ricos/v1/ricos-document/convert/to-ricos';
const converts = () => ({ json: { document: { nodes: [{ type: 'PARAGRAPH' }] } } });

describe('siteIdOf', () => {
  it("reads the site's id, or the dashboard address it is in", () => {
    expect(siteIdOf(SITE.toUpperCase())).toBe(SITE);
    expect(siteIdOf(`https://manage.wix.com/dashboard/${SITE}/home`)).toBe(SITE);
  });

  it('refuses what has no id', () => {
    expect(() => siteIdOf('my-site.wixsite.com')).toThrow(WixError);
  });
});

describe('checkSite', () => {
  it("checks the Blog and the converter with the key, and takes its newest post's owner and the site's name", async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [{ id: POST, memberId: MEMBER }] } }),
      [CONVERT]: converts,
      'GET /site-properties/v4/properties': () => ({
        json: { properties: { siteDisplayName: ' Acme Coffee ' } },
      }),
    });

    expect(await checkSite(SITE, KEY, opts)).toEqual({ siteName: 'Acme Coffee', memberId: MEMBER });
    const [first] = api.calls;
    // The key goes as Wix takes it, beside the site's id; never anywhere else.
    expect(first.headers.authorization).toBe(KEY);
    expect(first.headers['wix-site-id']).toBe(SITE);
    expect(first.query).toEqual({ 'paging.limit': '1' });
    // The converter is tried on a line of text: nothing is written to the site.
    expect(api.calls[1]).toMatchObject({
      method: 'POST',
      path: '/ricos/v1/ricos-document/convert/to-ricos',
      body: { html: '<p>x</p>' },
    });
  });

  it('takes a member when the Blog has no post yet, and goes without a name it may not read', async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [] } }),
      [CONVERT]: converts,
      'POST /members/v1/members/query': () => ({ json: { members: [{ id: MEMBER }] } }),
      'GET /site-properties/v4/properties': () => ({ status: 403, json: {} }),
    });
    expect(await checkSite(SITE, KEY, opts)).toEqual({ siteName: null, memberId: MEMBER });
  });

  it('says what stops it: a refused key, a site with no Blog, no member to own the posts', async () => {
    let opts = await start({ 'GET /blog/v3/posts': () => ({ status: 401, json: {} }) });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'auth_failed' });
    api.close();

    opts = await start({ 'GET /blog/v3/posts': () => ({ status: 404, json: {} }) });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'no_blog' });
    api.close();

    opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [] } }),
      [CONVERT]: converts,
      'POST /members/v1/members/query': () => ({ json: { members: [] } }),
    });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({ code: 'no_member' });
  });

  it('says the key needs the Ricos permission when the converter refuses it', async () => {
    const opts = await start({
      'GET /blog/v3/posts': () => ({ json: { posts: [{ id: POST, memberId: MEMBER }] } }),
      [CONVERT]: () => ({ status: 403, json: { message: 'PERMISSION_DENIED' } }),
    });
    await expect(checkSite(SITE, KEY, opts)).rejects.toMatchObject({
      code: 'no_ricos_permission',
      message: expect.stringContaining('Manage Ricos Document'),
    });
    // Refused there, nothing else is asked.
    expect(api.calls.map((call) => call.path)).toEqual([
      '/blog/v3/posts',
      '/ricos/v1/ricos-document/convert/to-ricos',
    ]);
  });
});

describe('ricosChunks', () => {
  it('keeps the blocks in order, in pieces within Wix’s 30,000 characters', () => {
    expect(RICOS_CHUNK).toBeLessThan(30_000);
    const block = `<p>${'a'.repeat(12_000)}</p>`;
    const chunks = ricosChunks(`${block}${block}${block}<h2>End</h2>`);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= RICOS_CHUNK)).toBe(true);
    expect(chunks[1].endsWith('<h2>End</h2>')).toBe(true);
  });

  it('splits a block longer than that among its children, in copies of its tag', () => {
    const items = Array.from({ length: 40 }, (_, i) => `<li>Item ${i}: smooth and sweet</li>`);
    const chunks = ricosChunks(`<ul class="steps">${items.join('')}</ul>`, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
      expect(chunk).toMatch(/^<ul class="steps">(<li>Item \d+: smooth and sweet<\/li>)+<\/ul>$/);
    }
    // Every item, once, in order.
    expect(chunks.join('').match(/Item \d+/g)).toEqual(items.map((_, i) => `Item ${i}`));

    const rows = `<tr><td>${'x < y & '.repeat(300)}</td></tr>`;
    const tables = ricosChunks(`<table><tbody>${rows}</tbody></table>`, 1000);
    expect(tables.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(tables.every((chunk) => chunk.startsWith('<table><tbody><tr><td>'))).toBe(true);
    expect(tables.join('')).toContain('x &lt; y &amp;');
  });

  it('cuts a long paragraph between words, keeping its links', () => {
    const text = 'Cold brew steeps slowly overnight. '.repeat(60);
    const chunks = ricosChunks(
      `<p>See <a href="https://acme.example">the guide</a>. ${text}</p>`,
      600,
    );
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
    expect(chunks.every((chunk) => chunk.startsWith('<p>') && chunk.endsWith('</p>'))).toBe(true);
    expect(chunks.join('')).toContain('<a href="https://acme.example">the guide</a>');
    // The words of the paragraph's text after the link, each whole.
    const words = new Set(`. ${text}`.trim().split(/\s+/));
    for (const chunk of chunks.slice(1)) {
      for (const word of chunk
        .replace(/<[^>]+>/g, '')
        .trim()
        .split(/\s+/)) {
        expect(words.has(word)).toBe(true);
      }
    }
  });

  it('sends a block with nothing to split it by as its text, escaped, between words', () => {
    const chunks = ricosChunks(
      `<p title="${'t'.repeat(600)}">${'fish & chips '.repeat(200)}</p>`,
      1000,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    expect(chunks.join('')).not.toContain('title=');
    for (const chunk of chunks) {
      expect(chunk).toMatch(/^<p>((fish|&amp;|chips) ?)+<\/p>$/);
    }
  });
});

describe('toRicos', () => {
  it("joins each piece's nodes, as Wix's converter gives them", async () => {
    let n = 0;
    const opts = await start({
      'POST /ricos/v1/ricos-document/convert/to-ricos': (req) => ({
        json: {
          document: {
            nodes: [{ type: 'PARAGRAPH', id: `n${(n += 1)}`, html: req.body.html.length }],
          },
        },
      }),
    });
    const block = `<p>${'a'.repeat(15_000)}</p>`;
    const doc = await toRicos(SITE, KEY, `${block}${block}`, opts);
    expect(doc.nodes.map((node) => node.id)).toEqual(['n1', 'n2']);
    expect(api.calls[0].body.options.plugins).toContain('HEADING');
  });
});

describe('webAddress', () => {
  it('keeps a web address, adds https:// to one without its scheme, and drops the rest', () => {
    expect(webAddress('https://acme.example/post/x')).toBe('https://acme.example/post/x');
    expect(webAddress(' acme.example/post/x ')).toBe('https://acme.example/post/x');
    expect(webAddress('//acme.example/post/x')).toBe('https://acme.example/post/x');
    expect(webAddress('/post/x')).toBeNull();
    expect(webAddress('javascript:alert(1)')).toBeNull();
    expect(webAddress(null)).toBeNull();
  });
});

describe('draft posts', () => {
  it('writes a new draft, never published', async () => {
    const opts = await start({
      'POST /blog/v3/draft-posts': () => ({
        json: {
          draftPost: { id: POST, status: 'UNPUBLISHED', url: 'https://acme.example/post/x' },
        },
      }),
    });
    const post = { title: 'T', richContent: { nodes: [] }, memberId: MEMBER };
    expect(await createDraftPost(SITE, KEY, post, opts)).toEqual({
      id: POST,
      status: 'UNPUBLISHED',
      url: 'https://acme.example/post/x',
      pending: false,
    });
    expect(api.calls[0].body).toEqual({ draftPost: post, publish: false, fieldsets: ['URL'] });
  });

  it("reads a draft, null once it's gone", async () => {
    const opts = await start({
      [`GET /blog/v3/draft-posts/${POST}`]: () => ({
        json: {
          draftPost: {
            id: POST,
            status: 'PUBLISHED',
            url: { base: 'https://acme.example/', path: '/post/x' },
          },
        },
      }),
    });
    expect(await readDraftPost(SITE, KEY, POST, opts)).toEqual({
      id: POST,
      status: 'PUBLISHED',
      url: 'https://acme.example/post/x',
      pending: false,
    });
    expect(await readDraftPost(SITE, KEY, 'f0000000-0000-4000-8000-000000000000', opts)).toBeNull();
    expect(await readDraftPost(SITE, KEY, 'not-an-id', opts)).toBeNull();
  });

  it('gives an address Wix sends without its scheme https://', async () => {
    const OTHER = 'a1111111-2222-4333-8444-955555555555';
    const opts = await start({
      [`GET /blog/v3/draft-posts/${POST}`]: () => ({
        json: {
          draftPost: { id: POST, status: 'PUBLISHED', url: 'mysite.wixsite.com/mysite/post/x' },
        },
      }),
      [`GET /blog/v3/draft-posts/${OTHER}`]: () => ({
        json: {
          draftPost: {
            id: OTHER,
            status: 'PUBLISHED',
            url: { base: 'mysite.wixsite.com/mysite/', path: '/post/y' },
          },
        },
      }),
    });
    expect((await readDraftPost(SITE, KEY, POST, opts)).url).toBe(
      'https://mysite.wixsite.com/mysite/post/x',
    );
    expect((await readDraftPost(SITE, KEY, OTHER, opts)).url).toBe(
      'https://mysite.wixsite.com/mysite/post/y',
    );
  });

  it("writes a live post's draft version, never the post people read", async () => {
    const opts = await start({
      [`PATCH /blog/v3/draft-posts/${POST}`]: () => ({
        json: { draftPost: { id: POST, status: 'PUBLISHED' } },
      }),
    });
    await updateDraftPost(SITE, KEY, POST, { title: 'T' }, opts);
    await updateDraftPost(SITE, KEY, POST, { title: 'T' }, { ...opts, live: true });
    expect(api.calls.map((call) => call.body.action)).toEqual(['UPDATE', 'UPDATE_PUBLICATION']);
    expect(api.calls[0].body.draftPost).toEqual({ title: 'T', id: POST });
  });
});

describe('publishDraftPost (AUTONOMOUS-GO-LIVE PR 9)', () => {
  it('publishes the draft post, then reads it again for its address', async () => {
    const opts = await start({
      [`POST /blog/v3/draft-posts/${POST}/publish`]: () => ({ json: { postId: POST } }),
      [`GET /blog/v3/draft-posts/${POST}`]: () => ({
        json: {
          draftPost: {
            id: POST,
            status: 'PUBLISHED',
            url: { base: 'https://mysite.wixsite.com/mysite', path: '/post/cold-brew' },
          },
        },
      }),
    });
    expect(await publishDraftPost(SITE, KEY, POST, opts)).toMatchObject({
      id: POST,
      status: 'PUBLISHED',
      url: 'https://mysite.wixsite.com/mysite/post/cold-brew',
    });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /blog/v3/draft-posts/${POST}/publish`,
      `GET /blog/v3/draft-posts/${POST}`,
    ]);
    expect(api.calls[0].headers['wix-site-id']).toBe(SITE);
    await expect(publishDraftPost(SITE, KEY, 'not-a-guid', opts)).rejects.toBeInstanceOf(WixError);
  });
});

describe('revertToDraft (AUTONOMOUS-GO-LIVE PR 10)', () => {
  it('reverts the published post to a draft, nothing else', async () => {
    const opts = await start({
      [`PATCH /blog/v3/draft-posts/${POST}`]: () => ({
        json: { draftPost: { id: POST, status: 'UNPUBLISHED' } },
      }),
    });
    expect(await revertToDraft(SITE, KEY, POST, opts)).toMatchObject({ id: POST });
    expect(api.calls[0].body).toEqual({
      draftPost: { id: POST },
      action: 'UPDATE_REVERT_TO_DRAFT',
    });
    await expect(revertToDraft(SITE, KEY, 'not-a-guid', opts)).rejects.toBeInstanceOf(WixError);
  });
});
