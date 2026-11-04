import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftPage } from '@/lib/actions/contentDrafts';
import type { AuthorsRead, ContentAuthor } from './authors';
import {
  cmsFields,
  cmsFieldsProblem,
  cmsPage,
  cmsPageProblem,
  bulkCmsItems,
  cmsSendGroups,
  cmsSource,
  metaTitleOf,
  type CmsFields,
  type CmsPage,
  type CmsSource,
} from './cmsSend';
import type { PageFields } from './readyToPublish';

/**
 * Send to CMS (#1331): the fields a send starts with, when they can't go,
 * and the page as the server takes it.
 */

const page: PageFields = {
  metaTitle: 'Pour-over coffee',
  metaDescription: 'Brew it slowly.',
  slug: 'pour-over-coffee',
  author: 'Ada Lovelace',
  reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
  featuredImage: null,
};
const fields: CmsFields = {
  slug: 'pour-over-coffee',
  metaTitle: 'Pour-over coffee',
  metaDescription: 'Brew it slowly.',
};

describe('metaTitleOf', () => {
  it('keeps a title that fits, takes a long one’s first part when it says enough, else cuts it', () => {
    expect(metaTitleOf('AEO: Answer Engine Optimization for AI Search Visibility')).toBe(
      'AEO: Answer Engine Optimization for AI Search Visibility',
    );
    expect(
      metaTitleOf('AEO tools compared side by side for marketing teams: a 2026 guide to the best'),
    ).toBe('AEO tools compared side by side for marketing teams');
    // The page that went to Webflow as "…Unified Tracking Across".
    expect(
      metaTitleOf(
        'The Ultimate Technical Guide to Unified Tracking Across ChatGPT, Gemini, and Google AIO',
      ),
    ).toBe('The Ultimate Technical Guide to Unified Tracking');
  });

  it('never ends a Turkish title cut short on "için", in lower case or capitalized', () => {
    expect(
      metaTitleOf('Yapay zekâ aramasında görünürlük isteyen yerel markalar için en iyi rehber'),
    ).toBe('Yapay zekâ aramasında görünürlük isteyen yerel markalar');
    // "İçin".toLowerCase() is "i\u0307çin", with a combining dot: read as "için".
    expect(
      metaTitleOf('Yapay Zekâ Aramasında Görünürlük İsteyen Yerel Markalar İçin En İyi Rehber'),
    ).toBe('Yapay Zekâ Aramasında Görünürlük İsteyen Yerel Markalar');
  });

  it('gives the guide’s example as the guide says', () => {
    expect(
      metaTitleOf('AEO tools compared side by side for marketing teams: a 2026 guide to the best'),
    ).toBe('AEO tools compared side by side for marketing teams');
    // A title that fits stays whole, parts and all.
    expect(metaTitleOf('AEO tools compared: a 2026 guide')).toBe(
      'AEO tools compared: a 2026 guide',
    );
  });
});

describe('cmsFields', () => {
  it('cuts the page’s meta title at a word near 60 characters, not a kept one', () => {
    const cut = (metaTitle: string) => cmsFields({ ...page, metaTitle }, null).metaTitle;
    const long = `${'Pour-over coffee at home: '.repeat(4)}a guide`;
    // At the last space that fits, without the colon the cut leaves.
    expect(cut(long)).toBe('Pour-over coffee at home: Pour-over coffee at home');
    expect(cmsFields({ ...page, metaTitle: long }, { metaTitle: long }).metaTitle).toBe(long);
    // Exactly 60 stays whole.
    expect(cut('a'.repeat(60))).toBe('a'.repeat(60));
    // A no-break space is a space too.
    expect(cut(`${'b'.repeat(40)}\u00a0${'c'.repeat(30)}`)).toBe('b'.repeat(40));
    // No space past half: cut at 60 characters, never inside an emoji.
    const emoji = `${'d'.repeat(59)}☕️☕️`;
    expect(Array.from(cut(emoji))).toHaveLength(60);
    expect(cut(`${'e'.repeat(59)}😀x`)).toBe(`${'e'.repeat(59)}😀`);
  });

  it('starts from what the draft kept, else from the page', () => {
    expect(cmsFields(page, null)).toEqual(fields);
    expect(cmsFields(page, { slug: 'coffee', metaDescription: '' })).toEqual({
      ...fields,
      slug: 'coffee',
    });
  });
});

describe('cmsFieldsProblem', () => {
  it('takes letters of any script, digits, dots, - and _ in a slug', () => {
    expect(cmsFieldsProblem(fields)).toBeNull();
    expect(cmsFieldsProblem({ ...fields, slug: 'çay-demleme_2.0' })).toBeNull();
    expect(cmsFieldsProblem({ ...fields, slug: ' coffee ' })).toBeNull();
  });

  it('names the field that cannot go', () => {
    expect(cmsFieldsProblem({ ...fields, slug: '' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'pour over' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'blog/coffee' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: '..' })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, slug: 'a'.repeat(201) })).toBe('slug');
    expect(cmsFieldsProblem({ ...fields, metaTitle: 'a'.repeat(301) })).toBe('metaTitle');
    expect(cmsFieldsProblem({ ...fields, metaDescription: 'a'.repeat(501) })).toBe(
      'metaDescription',
    );
  });
});

describe('cmsPageProblem', () => {
  it('needs a title the CMS takes, and something under the H1', () => {
    expect(cmsPageProblem('Pour-over', '<h1>Pour-over</h1><p>Brew it.</p>')).toBeNull();
    expect(
      cmsPageProblem('Pour-over', '<h1>Pour-over</h1><img src="https://cdn.example/a.jpg">'),
    ).toBeNull();
    expect(cmsPageProblem('  ', '<p>Brew it.</p>')).toBe('noTitle');
    expect(cmsPageProblem('a'.repeat(301), '<p>Brew it.</p>')).toBe('longTitle');
    // A new page: its H1 and an empty paragraph.
    expect(cmsPageProblem('Pour-over', '<h1>Pour-over</h1><p></p>')).toBe('empty');
    expect(cmsPageProblem('Pour-over', '')).toBe('empty');
    expect(cmsPageProblem('Pour-over', `<p>${'a'.repeat(1_000_000)}</p>`)).toBe('tooLong');
  });
});

describe('cmsPage', () => {
  const html =
    '<h1>Pour-over</h1>\n<p>Brew it slowly.</p>\n<img src="https://cdn.example/cup.jpg" alt="A cup">';

  it('sends the page without its H1, its fields trimmed', () => {
    expect(
      cmsPage({
        draftId: 'd1',
        title: ' Pour-over ',
        html,
        fields: { slug: ' coffee ', metaTitle: ' Coffee ', metaDescription: ' Slowly. ' },
        page: { ...page, featuredImage: 'https://cdn.example/cup.jpg' },
        byline: null,
      }),
    ).toEqual({
      draftId: 'd1',
      title: 'Pour-over',
      slug: 'coffee',
      metaTitle: 'Coffee',
      metaDescription: 'Slowly.',
      html: '<p>Brew it slowly.</p>\n<img src="https://cdn.example/cup.jpg" alt="A cup">',
      author: 'Ada Lovelace',
      reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
      featuredImage: { src: 'https://cdn.example/cup.jpg', alt: 'A cup' },
    });
  });

  it('keeps the brand’s byline line, which went under the H1', () => {
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html,
      fields,
      page,
      byline: 'By Ada',
    });
    expect(sent.html.startsWith('<p>By Ada</p>\n<p>Brew it slowly.</p>')).toBe(true);
  });

  it('sends no author while none is known, and only an https featured image', () => {
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html: '<p>Brew it.</p><img src="http://cdn.example/cup.jpg">',
      fields,
      page: { ...page, author: '', featuredImage: 'http://cdn.example/cup.jpg' },
      byline: null,
    });
    expect(sent.author).toBeNull();
    expect(sent.featuredImage).toBeNull();
  });

  it('keeps the author, alt text and image within what the server takes', () => {
    const src = 'https://cdn.example/cup.jpg';
    const sent = cmsPage({
      draftId: 'd1',
      title: 'Pour-over',
      html: `<p>Brew it.</p><img src="${src}" alt="${'a'.repeat(600)}">`,
      fields,
      page: { ...page, author: 'b'.repeat(250), featuredImage: src },
      byline: null,
    });
    expect(sent.author).toBe('b'.repeat(200));
    expect(sent.featuredImage).toEqual({ src, alt: 'a'.repeat(500) });
    const long = `https://cdn.example/${'c'.repeat(2048)}.jpg`;
    expect(
      cmsPage({
        draftId: 'd1',
        title: 'Pour-over',
        html: `<p>Brew it.</p><img src="${long}">`,
        fields,
        page: { ...page, featuredImage: long },
        byline: null,
      }).featuredImage,
    ).toBeNull();
  });
});

describe('cmsSource', () => {
  const stored: DraftPage = {
    id: 'd1',
    title: 'Pour-over',
    bodyHtml: '<h1>Pour-over</h1><p>Brew it slowly.</p>',
    sourceUrl: 'https://acme.example/pour-over',
    authorId: 'a1',
    reviewerId: 'r1',
    authorConfirmed: false,
    language: null,
    pageType: 'guide',
    isNew: true,
    schemaLeftOut: false,
  };
  const ada = { id: 'a1', name: 'Ada Lovelace', sameAs: [] } as unknown as ContentAuthor;
  const reviewer = {
    id: 'r1',
    name: 'Dr. Grace Hopper',
    title: 'Clinical Reviewer',
  } as ContentAuthor;
  // The authors are read once Quality is live (its phase 1), as readCmsSources reads them.
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1'));
  afterEach(() => vi.unstubAllEnvs());
  const authors = (bylineInContent: boolean): AuthorsRead => ({
    authors: [ada, reviewer],
    brands: [{ id: 'b1', name: 'Acme', bylineInContent }],
    me: { id: 'u1', role: 'admin' },
  });
  const source = (over: Partial<Parameters<typeof cmsSource>[0]> = {}) =>
    cmsSource({
      page: stored,
      authors: authors(false),
      brandId: 'b1',
      brandName: 'Acme',
      brandLanguage: 'en',
      ...over,
    });

  it('gives the stored page as the editor would: publishable, with its author', () => {
    expect(source()).toEqual({
      draftId: 'd1',
      title: 'Pour-over',
      html: expect.stringContaining('<p>Brew it slowly.</p>'),
      sourceUrl: 'https://acme.example/pour-over',
      author: ada,
      reviewer,
      teamByline: 'Acme Team',
      byline: null,
      schema: {
        input: {
          title: 'Pour-over',
          author: ada,
          authorUrl: null,
          brandName: 'Acme',
          brandUrl: null,
          isNew: true,
        },
        pageType: 'guide',
        leftOut: false,
      },
    });
  });

  it("gives the Article schema's author as Before you publish does (00448)", () => {
    const by = (over: Partial<Parameters<typeof cmsSource>[0]>) => source(over).schema.input.author;
    // No author picked: the brand.
    expect(by({ page: { ...stored, authorId: null } })).toBeNull();
    // The author the site names (00271): left out.
    expect(by({ page: { ...stored, authorId: null, authorConfirmed: true } })).toBeUndefined();
    // Quality on, its authors not read: not known, left out.
    expect(by({ authors: null })).toBeUndefined();
    // Quality off: none are read, the page goes out under the brand.
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    expect(by({ authors: null })).toBeNull();
    expect(source({ page: { ...stored, schemaLeftOut: true, isNew: false } }).schema).toMatchObject(
      {
        leftOut: true,
        input: { isNew: false },
      },
    );
  });

  it('adds the byline line in the page’s language, else the brand’s', () => {
    expect(source({ authors: authors(true) }).byline).toBe('By Ada Lovelace');
    expect(source({ authors: authors(true), brandLanguage: 'tr' }).byline).toBe(
      'Yazar: Ada Lovelace',
    );
    expect(
      source({ authors: authors(true), page: { ...stored, language: 'German', authorId: null } })
        .byline,
    ).toBe('Vom Acme-Team');
  });

  it('names the team in the page’s language, for the CMS’s author field, as Export does', () => {
    expect(source({ brandLanguage: 'tr' }).teamByline).toBe('Acme Ekibi');
    expect(source({ page: { ...stored, language: 'German' } }).teamByline).toBe('Acme-Team');
    // The page's own language over a brand's that isn't English.
    expect(
      source({ brandLanguage: 'tr', page: { ...stored, language: 'German' } }).teamByline,
    ).toBe('Acme-Team');
    // No brand name read: no team to name.
    expect(source({ brandName: '' }).teamByline).toBe('');
  });

  it('names no team, nor its byline line, for an author the site names (00271)', () => {
    const confirmed = { ...stored, authorId: null, authorConfirmed: true };
    expect(source({ authors: authors(true), page: confirmed })).toMatchObject({
      author: null,
      teamByline: '',
      byline: null,
    });
    // A picked author is the page's either way.
    expect(
      source({ authors: authors(true), page: { ...stored, authorConfirmed: true } }),
    ).toMatchObject({ author: ada, teamByline: 'Acme Team', byline: 'By Ada Lovelace' });
  });

  it('gives no author or team byline while Quality is off', () => {
    expect(source({ authors: null })).toMatchObject({ author: null, teamByline: '', byline: null });
  });
});

describe('bulkCmsItems', () => {
  const schema = (over: Partial<CmsSource['schema']> = {}): CmsSource['schema'] => ({
    input: {
      title: 'Pour-over',
      author: null,
      authorUrl: null,
      brandName: 'Acme',
      brandUrl: null,
      isNew: true,
    },
    // A page that isn't an article: no Article schema.
    pageType: 'product_page',
    leftOut: false,
    ...over,
  });
  const source = (over: Partial<CmsSource>): CmsSource => ({
    draftId: 'd1',
    title: 'Pour-over',
    html: '<h1>Pour-over</h1>\n<p>Brew it slowly.</p>',
    sourceUrl: null,
    author: null,
    reviewer: null,
    teamByline: 'Acme Team',
    byline: null,
    schema: schema(),
    ...over,
  });
  afterEach(() => vi.useRealTimers());

  it("sends an article with its Article schema at the end, unless it's left out (00448)", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 1, 12), toFake: ['Date'] });
    const [article, leftOut] = bulkCmsItems(
      [
        source({ schema: schema({ pageType: 'guide' }) }),
        source({ draftId: 'd2', schema: schema({ pageType: 'guide', leftOut: true }) }),
      ],
      new Map(),
    );
    const [body, script] = article.page!.html.split('\n<script type="application/ld+json">');
    expect(body).toBe('<p>Brew it slowly.</p>');
    expect(JSON.parse(script.replace('</script>', ''))).toMatchObject({
      '@type': 'Article',
      headline: 'Pour-over',
      author: { '@type': 'Organization', name: 'Acme' },
      datePublished: '2026-11-01',
    });
    expect(leftOut.page!.html).toBe('<p>Brew it slowly.</p>');
  });

  it('includes the reviewer as a WebPage schema node in bulk sends', () => {
    const reviewer = {
      id: 'r1',
      name: 'Dr. Grace Hopper',
      title: 'Clinical Reviewer',
    } as ContentAuthor;
    const named = '<h1>Pour-over</h1>\n<p>Reviewed by Dr. Grace Hopper.</p>';
    const [item] = bulkCmsItems([source({ reviewer, html: named })], new Map());
    expect(item.page).toMatchObject({
      reviewer: 'Dr. Grace Hopper, Clinical Reviewer',
      html: expect.stringContaining('"reviewedBy"'),
    });
    // A page that doesn't name them goes without the node, as the editor's does.
    const [unnamed] = bulkCmsItems([source({ reviewer })], new Map());
    expect(unnamed.page?.html).not.toContain('reviewedBy');
  });

  it('sends an article with both its Article schema and its reviewer’s WebPage node', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 1, 12), toFake: ['Date'] });
    const reviewer = {
      id: 'r1',
      name: 'Dr. Grace Hopper',
      title: 'Clinical Reviewer',
    } as ContentAuthor;
    const named = '<h1>Pour-over</h1>\n<p>Reviewed by Dr. Grace Hopper.</p>';
    const [item] = bulkCmsItems(
      [source({ reviewer, html: named, schema: schema({ pageType: 'guide' }) })],
      new Map(),
    );
    const nodes = item
      .page!.html.split('<script type="application/ld+json">')
      .slice(1)
      .map((part) => JSON.parse(part.slice(0, part.indexOf('</script>'))));
    expect(nodes).toEqual([
      expect.objectContaining({ '@type': 'Article', headline: 'Pour-over' }),
      expect.objectContaining({ '@type': 'WebPage', reviewedBy: expect.anything() }),
    ]);
  });

  it('gives each page as the Send dialog would send it, or why it can’t go', () => {
    const items = bulkCmsItems(
      [
        source({}),
        source({ draftId: 'd2', html: '<h1>Pour-over</h1><p>Use [figure] g.</p>' }),
        source({ draftId: 'd3', html: '<h1>Pour-over</h1><p></p>' }),
        source({ draftId: 'd4', title: '東京ガイド', html: '<h1>東京ガイド</h1><p>東京</p>' }),
        source({ draftId: 'd5', title: ' ' }),
      ],
      new Map(),
    );
    expect(items.map((item) => [item.draftId, item.problem])).toEqual([
      ['d1', null],
      ['d2', 'placeholders'],
      ['d3', 'empty'],
      // A title in another script gives no slug: added in the editor.
      ['d4', 'slug'],
      ['d5', 'noTitle'],
    ]);
    expect(items[0].page).toMatchObject({
      draftId: 'd1',
      slug: 'pour-over',
      metaDescription: 'Brew it slowly.',
      html: '<p>Brew it slowly.</p>',
      author: 'Acme Team',
    });
    expect(items.slice(1).every((item) => item.page === null)).toBe(true);
  });

  it('takes the slug and meta the page kept from its last send', () => {
    const [item] = bulkCmsItems(
      [source({ draftId: 'd4', title: '東京ガイド', html: '<h1>東京ガイド</h1><p>東京</p>' })],
      new Map([['d4', { slug: 'tokyo-guide', metaTitle: 'Tokyo' }]]),
    );
    expect(item.problem).toBeNull();
    expect(item.page).toMatchObject({ slug: 'tokyo-guide', metaTitle: 'Tokyo' });
  });
});

describe('cmsSendGroups', () => {
  const sized = (id: string, chars: number): CmsPage => ({
    draftId: id,
    title: 'T',
    slug: 't',
    metaTitle: '',
    metaDescription: '',
    html: 'x'.repeat(chars),
    author: null,
    reviewer: null,
    featuredImage: null,
  });

  it('puts the pages in as few requests as their size allows, in order', () => {
    const groups = cmsSendGroups(
      // A page's JSON is about 120 characters past its HTML.
      [sized('a', 300), sized('b', 300), sized('c', 900), sized('d', 100)],
      1000,
    );
    expect(groups.map((group) => group.map((page) => page.draftId))).toEqual([
      ['a', 'b'],
      // A page past the budget goes alone, never split.
      ['c'],
      ['d'],
    ]);
    expect(cmsSendGroups([])).toEqual([]);
    // By the bytes sent: a letter outside ASCII takes two or three.
    expect(cmsSendGroups([sized('a', 200), sized('b', 0)], 500)).toHaveLength(1);
    expect(
      cmsSendGroups([{ ...sized('a', 0), html: 'ç'.repeat(200) }, sized('b', 0)], 500),
    ).toHaveLength(2);
    expect(cmsSendGroups([sized('a', 10), sized('b', 10)])).toHaveLength(1);
  });
});
