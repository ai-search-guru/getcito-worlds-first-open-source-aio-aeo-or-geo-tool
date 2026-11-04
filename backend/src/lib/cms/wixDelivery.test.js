import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Send to CMS to Wix (#1331, phase 2; 00372): a page goes to the brand's
 * site's Blog as a draft post, updates the post its last send made there,
 * and writes a live post's draft version, never the post people read.
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
          return { data: previous ? { id: 'd0', external_id: previous } : null, error: null };
        },
        then: (resolve) => resolve({ data: null, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { warn: vi.fn() } }));
let credentials;
vi.mock('./credentials.js', () => ({ readCmsCredentials: async () => credentials }));
const wix = {
  createDraftPost: vi.fn(),
  readDraftPost: vi.fn(),
  updateDraftPost: vi.fn(),
  toRicos: vi.fn(),
};
vi.mock('./wix.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createDraftPost: (...args) => wix.createDraftPost(...args),
  readDraftPost: (...args) => wix.readDraftPost(...args),
  updateDraftPost: (...args) => wix.updateDraftPost(...args),
  toRicos: (...args) => wix.toRicos(...args),
}));

const { seoTags, sendToWix, toWixHtml } = await import('./wixDelivery.js');
const { WixError } = await import('./wix.js');

const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const MEMBER = 'c00e8a5c-322b-4e77-8813-002e3ea7e811';
const POST = '9124f6ef-a537-4bdd-bca3-e7306947deeb';
const connection = {
  id: 'cn1',
  site_id: SITE,
  account: MEMBER,
  updated_at: '2026-10-28T09:00:00Z',
};
const HTML =
  '<h2>Why</h2><p>Smooth.</p><figure><img src="https://acme.example/a.png" alt="A"></figure><script type="application/ld+json">{"@type":"Article"}</script>';
const send = () =>
  sendToWix({
    delivery: { id: 'd2345678-0000-0000-0000-000000000000' },
    page: {
      draftId: 'dr1',
      title: 'Cold brew at home',
      slug: 'cold-brew-at-home',
      metaTitle: '',
      metaDescription: 'How to make it.',
    },
    html: HTML,
    jsonLd: [{ '@type': 'Article' }],
    connection,
  });

beforeEach(() => {
  previous = null;
  queries.length = 0;
  updates.length = 0;
  credentials = { apiKey: 'IST.fake-key' };
  for (const fn of Object.values(wix)) fn.mockReset();
  wix.toRicos.mockResolvedValue({ nodes: [{ type: 'PARAGRAPH' }] });
  wix.createDraftPost.mockResolvedValue({ id: POST, status: 'UNPUBLISHED', url: null });
  wix.updateDraftPost.mockResolvedValue({ id: POST, status: 'UNPUBLISHED', url: null });
});

describe('toWixHtml', () => {
  it('leaves its JSON-LD and images out, and counts the images', () => {
    expect(toWixHtml(HTML)).toEqual({ html: '<h2>Why</h2><p>Smooth.</p>', images: 1 });
  });
});

describe('seoTags', () => {
  it("gives the post its title, meta description and JSON-LD as Wix's SEO tags", () => {
    expect(
      seoTags({ title: 'T', metaTitle: 'Meta T', metaDescription: 'D' }, [{ '@type': 'Article' }]),
    ).toEqual([
      { type: 'title', children: 'Meta T', custom: false, disabled: false },
      {
        type: 'meta',
        props: { name: 'description', content: 'D' },
        custom: false,
        disabled: false,
      },
      {
        type: 'script',
        props: { type: 'application/ld+json' },
        children: '{"@type":"Article"}',
        custom: false,
        disabled: false,
      },
    ]);
  });

  it('includes the qualified reviewer in a custom SEO metadata tag', () => {
    expect(seoTags({ title: 'T', reviewer: 'Dr. Grace Hopper, Clinical Reviewer' })).toEqual([
      { type: 'title', children: 'T', custom: false, disabled: false },
      {
        type: 'meta',
        props: { name: 'reviewed-by', content: 'Dr. Grace Hopper, Clinical Reviewer' },
        custom: true,
        disabled: false,
      },
    ]);
  });

  it('escapes every "<" in the JSON-LD, so it can’t end the script it goes in', () => {
    const [tag] = seoTags({}, [{ '@type': 'Article', headline: 'Cold brew </script><b>x' }]);
    expect(tag.children).not.toContain('<');
    expect(tag.children).toContain('\\u003c/script>\\u003cb>x');
    expect(JSON.parse(tag.children).headline).toBe('Cold brew </script><b>x');
  });
});

describe('sendToWix', () => {
  it('writes a new draft post, owned by the member the connection keeps', async () => {
    expect(await send()).toEqual({
      taken: true,
      externalId: POST,
      collectionId: SITE,
      updated: false,
      live: false,
      changed: { images: 1 },
    });
    const [, , post] = wix.createDraftPost.mock.calls[0];
    expect(post).toMatchObject({
      title: 'Cold brew at home',
      memberId: MEMBER,
      excerpt: 'How to make it.',
      seoSlug: 'cold-brew-at-home',
      richContent: { nodes: [{ type: 'PARAGRAPH' }] },
    });
    // The page's last send on this site is looked for.
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        ['eq', 'target', 'wix'],
        ['eq', 'target_collection', SITE],
      ]),
    );
  });

  it('updates the draft its last send made, and a live post as its draft version', async () => {
    previous = POST;
    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'UNPUBLISHED', url: null });
    expect(await send()).toMatchObject({ taken: true, updated: true });
    expect(wix.updateDraftPost.mock.calls[0][4]).toMatchObject({ live: false });

    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'PUBLISHED', url: null });
    expect(await send()).toMatchObject({ taken: true, updated: true, live: false });
    expect(wix.updateDraftPost.mock.calls[1][4]).toMatchObject({ live: true });
    expect(wix.createDraftPost).not.toHaveBeenCalled();
  });

  it('keeps the post’s id when Wix’s answer to the update leaves it out', async () => {
    previous = POST;
    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'UNPUBLISHED', url: null });
    wix.updateDraftPost.mockResolvedValue({ id: null, status: null, url: null });
    // Kept on the delivery, the page's next send updates this post rather than making a second.
    expect(await send()).toMatchObject({ taken: true, updated: true, externalId: POST });
    expect(wix.createDraftPost).not.toHaveBeenCalled();
  });

  it('writes a scheduled post as a draft, not as a live post’s draft version', async () => {
    previous = POST;
    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'SCHEDULED', url: null });
    expect(await send()).toMatchObject({ taken: true, updated: true });
    expect(wix.updateDraftPost.mock.calls[0][4]).toMatchObject({ live: false });
  });

  it('writes a new post when the last one was deleted or is gone', async () => {
    previous = POST;
    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'DELETED', url: null });
    expect(await send()).toMatchObject({ taken: true, updated: false });
    wix.readDraftPost.mockResolvedValue({ id: POST, status: 'UNPUBLISHED', url: null });
    wix.updateDraftPost.mockRejectedValue(new WixError('not_found', 'gone', 404));
    expect(await send()).toMatchObject({ taken: true, updated: false });
    expect(wix.createDraftPost).toHaveBeenCalledTimes(2);
  });

  it('marks the connection refused when Wix refuses the key, or it can’t be read', async () => {
    wix.createDraftPost.mockRejectedValue(new WixError('auth_failed', 'Wix refused the API key.'));
    expect(await send()).toEqual({
      taken: false,
      failure: 'Wix refused the API key.',
      refused: true,
    });
    credentials = null;
    expect(await send()).toMatchObject({ taken: false, refused: true });
    expect(updates.map((u) => u.row.status)).toEqual(['auth_failed', 'auth_failed']);
  });

  it('says Wix couldn’t be reached for anything else', async () => {
    wix.toRicos.mockRejectedValue(new Error('socket hang up'));
    expect(await send()).toEqual({ taken: false, failure: 'Wix could not be reached' });
  });
});
