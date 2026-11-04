import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import { bulkCmsItems, cmsSource } from '@/lib/content/cmsSend';
import { setContentDom } from '@/lib/content/dom';
import { AUTHORS, BRAND_ID, DRAFT_ID, DRAFT_ROW, EXPECTED_HTML } from './__fixtures__/packageDraft';

/**
 * get_content_draft_package's page is the editor's own (B5): the Library's
 * Send to CMS, in the browser, makes EXPECTED_HTML of the fixture, and the
 * same helpers given another window (as the server gives jsdom's) make the
 * same page. contentPackage.test.ts runs the MCP's on the server.
 */

/** The fixture's page as the Library's Send to CMS makes it. */
function sendPage() {
  const source = cmsSource({
    page: {
      id: DRAFT_ID,
      title: DRAFT_ROW.title,
      bodyHtml: DRAFT_ROW.body_html,
      sourceUrl: DRAFT_ROW.source_url,
      authorId: DRAFT_ROW.author_id,
      reviewerId: DRAFT_ROW.reviewer_id ?? null,
      authorConfirmed: false,
      language: null,
      pageType: DRAFT_ROW.page_type,
      isNew: DRAFT_ROW.method === 'create',
      schemaLeftOut: DRAFT_ROW.schema_left_out,
    },
    authors: AUTHORS,
    brandId: BRAND_ID,
    brandName: 'Acme Coffee',
    brandLanguage: 'en',
  });
  const [item] = bulkCmsItems([source], new Map([[DRAFT_ID, { slug: DRAFT_ROW.slug }]]));
  return item.page!;
}

afterEach(() => {
  setContentDom(null);
});

describe("the editor's Send to CMS page", () => {
  it('is the page the MCP gives, made with the browser’s window', () => {
    const page = sendPage();
    expect(page.html).toBe(EXPECTED_HTML);
    expect(page).toMatchObject({
      slug: 'cold-brew-at-home',
      author: 'Ada Lovelace',
      featuredImage: { src: 'https://acme.example/cold-brew.jpg', alt: 'A jar of cold brew' },
    });
  });

  it('is the same made with a window of its own, as the server gives jsdom’s', () => {
    const browser = sendPage();
    setContentDom(new JSDOM('<!doctype html><html><head></head><body></body></html>').window);
    expect(sendPage()).toEqual(browser);
  });
});
