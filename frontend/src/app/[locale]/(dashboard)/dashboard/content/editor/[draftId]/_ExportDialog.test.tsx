import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import type { PasteChecks } from '@/lib/content/readyToPublish';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
// No white label kit: downloads keep GetCito's names (exportName.test.ts has a kit's).
vi.mock('@/lib/actions/whiteLabel', () => ({
  getExportBranding: async () => ({ ok: true, branding: null }),
}));
vi.mock('sonner', () => ({ toast }));
const saveBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ saveBlob }));
const draftExportBlob = vi.hoisted(() => vi.fn());
vi.mock('@/lib/content/draftExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/content/draftExport')>()),
  draftExportBlob,
}));

const { ExportDialog } = await import('./_ExportDialog');

/**
 * Export (Quality spec §7b, CE-057): the page ready to paste or save for the
 * destination picked, its placeholders first, its checks, its page fields.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HTML =
  '<h1>Pour-over</h1><p>Use [figure, source] g of coffee. Brew it slowly.</p><p>See <a href="https://ok.example/">the guide</a>.</p>';
const ada = { id: 'a1', name: 'Ada Lovelace' } as ContentAuthor;
const checks: PasteChecks = {
  links: { count: 1, read: 1, broken: 0 },
  images: { count: 1, withoutAlt: 1 },
  ownCode: 0,
};

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

let container: HTMLDivElement;
let root: Root;
const onFillNow = vi.fn();
const writeText = vi.fn();
const write = vi.fn();

async function render(over: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ExportDialog
          onClose={() => {}}
          title="Pour-over"
          html={HTML}
          isNew
          sourceUrl={null}
          author={ada}
          reviewer={null}
          teamByline="Acme Team"
          byline={null}
          checks={checks}
          linksPending={0}
          onFillNow={onFillNow}
          {...over}
        />
      </NextIntlClientProvider>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const button = (name: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label') === name,
  );
const destination = (name: string) =>
  [...dialog().querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (b) => b.textContent === name,
  )!;

/** A Blob's text (jsdom's has no text()). */
const textOf = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

beforeEach(() => {
  localStorage.clear();
  onFillNow.mockReset();
  saveBlob.mockReset();
  toast.success.mockReset();
  draftExportBlob.mockReset().mockResolvedValue(new Blob(['x']));
  writeText.mockReset().mockResolvedValue(undefined);
  write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, write },
    configurable: true,
  });
  vi.stubGlobal('ClipboardItem', FakeClipboardItem);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('ExportDialog', () => {
  it('names what Before you publish warns about over its options, with Review', async () => {
    const onReview = vi.fn();
    await render({ publish: { trustBelow: 45, noAuthor: true, article: true, onReview } });
    expect(dialog().textContent).toContain(
      'Before you publish: Trust 45, below 60 · no author yet.Review',
    );
    // A page that puts the brand forward without saying the brand makes it (CE-050).
    await render({
      publish: { trustBelow: null, noAuthor: false, noDisclosure: true, article: true, onReview },
    });
    expect(dialog().textContent).toContain('Before you publish: no disclosure.Review');
    await render({ publish: { trustBelow: 45, noAuthor: true, article: true, onReview } });
    await act(async () => button('Review')!.click());
    expect(onReview).toHaveBeenCalled();
    // Nothing to warn about: a quiet line where the author, dates and schema are.
    await render({ publish: { trustBelow: null, noAuthor: false, article: true, onReview } });
    expect(dialog().textContent).toContain(
      'Before you publish has the author, dates and schema (JSON-LD) for your CMS.Review',
    );
    expect(button('Review')!.getAttribute('aria-label')).toBe('Review Before you publish');
    // Not an article: no dates or JSON-LD to speak of.
    await render({ publish: { trustBelow: null, noAuthor: false, article: false, onReview } });
    expect(dialog().textContent).toContain(
      'Before you publish has the author and what your CMS adds for this page type.Review',
    );
    // A product page in Phase 3 (CE-053): its Product schema.
    await render({
      publish: { trustBelow: null, noAuthor: false, article: false, product: true, onReview },
    });
    expect(dialog().textContent).toContain(
      "Before you publish has the Product schema (JSON-LD) with the page's price for your CMS.Review",
    );
    // A category page (CE-054): its ItemList.
    await render({
      publish: { trustBelow: null, noAuthor: false, article: false, itemList: true, onReview },
    });
    expect(dialog().textContent).toContain(
      'Before you publish has the ItemList schema (JSON-LD) of the products the page links, for your CMS.Review',
    );
  });

  it('holds the export while a placeholder is open, and fills it or leaves its sentence out', async () => {
    await render({ initialDestination: 'webflow' });
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      '1 placeholder is still open. Exports never contain [ ] text.',
    );
    expect(button('Copy for Webflow')!.disabled).toBe(true);
    await act(async () => button('Fill now')!.click());
    expect(onFillNow).toHaveBeenCalled();

    await act(async () => button('Export without them')!.click());
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      'The sentence with the placeholder is left out of this export.',
    );
    await act(async () => button('Copy for Webflow')!.click());
    // As rich text, for the CMS's editor to paste, without the placeholder's sentence.
    const [[[item]]] = write.mock.calls as [[[FakeClipboardItem]]];
    const html = await textOf(item.items['text/html']);
    // The H1 goes in the CMS's title field, the placeholder's sentence nowhere.
    expect(html).toBe(
      '<p>Brew it slowly.</p><p>See <a href="https://ok.example/">the guide</a>.</p>',
    );
    expect(await textOf(item.items['text/plain'])).toContain('Brew it slowly.');
    expect(toast.success).toHaveBeenCalledWith('Copied for Webflow: paste it in.');
    // The fields are read from what goes out: no placeholder in them either.
    expect(dialog().textContent).toContain('Meta descriptionBrew it slowly.Copy');
  });

  it('holds a placeholder in the title or a heading until it is filled', async () => {
    await render({
      html: '<h2>What [name of a real person] uses</h2><p>Use [figure, source] g.</p>',
      initialDestination: 'webflow',
    });
    await act(async () => button('Export without them')!.click());
    expect(dialog().querySelector('[role="status"]')!.textContent).toContain(
      '1 placeholder is in the title or a heading: fill it first.',
    );
    expect(button('Copy for Webflow')!.disabled).toBe(true);
    // A new dialog: one with the placeholder in its title.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ title: 'Pour-over by [name of a real person]', html: '<p>Done.</p>' });
    expect(dialog().querySelector('[role="alert"]')!.textContent).toContain(
      '1 placeholder is still open',
    );
  });

  it("exports a title's and a heading's own brackets as written", async () => {
    const html = '<h1>Best CRM tools [2026 Update]</h1><h2>The checklist [PDF]</h2><p>Done.</p>';
    await render({ title: 'Best CRM tools [2026 Update]', html, initialDestination: 'html' });
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
    expect(button('Copy HTML')!.disabled).toBe(false);
    await act(async () => button('Copy HTML')!.click());
    expect(writeText).toHaveBeenCalledWith(html);
  });

  it('copies as HTML, and says so, where rich text is refused', async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    document.execCommand = vi.fn(() => false);
    await render({ html: '<h1>Pour-over</h1><p>Done.</p>', initialDestination: 'webflow' });
    await act(async () => button('Copy for Webflow')!.click());
    expect(writeText).toHaveBeenCalledWith('<p>Done.</p>');
    expect(toast.success).toHaveBeenCalledWith(
      "Copied as HTML: paste it into the editor's HTML or code view.",
    );
  });

  it('lists what it checks: clean HTML, the links, the images', async () => {
    await render({ html: '<p>Done.</p>' });
    const rows = [
      ...dialog().querySelectorAll('[aria-label="Content · ready to paste"] li > div'),
    ].map((row) => row.textContent);
    expect(rows).toEqual([
      'Clean HTML · doneHeadings, lists, tables and FAQ. No editor marks, Page info strip or underlines.',
      '1 link answers · doneEach was read in the last day.',
      '1 of 1 images have no alt text · missingAdd it in the HTML view: a few words on what the image shows.',
    ]);
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 3, read: 1, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 2,
      },
      linksPending: 2,
    });
    // Two of the three unread, both of them still coming.
    expect(dialog().textContent).toContain('2 of 3 links still being read');
    expect(dialog().textContent).not.toContain('alt text');
    expect(dialog().textContent).toContain(
      'HTML blocks keep their own code · check it2 elements keep a class, a style or a script',
    );
    // Read for none and nothing coming: no word that they answer.
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 1, read: 0, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 0,
      },
    });
    expect(dialog().textContent).toContain("1 of 1 links couldn't be read");
    expect(dialog().textContent).not.toContain('answers');
    // One read still coming for two unread: the other couldn't be read.
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 3, read: 1, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 0,
      },
      linksPending: 1,
    });
    expect(dialog().textContent).toContain(
      "1 of 3 links still being read, 1 couldn't be read · check itOpen them yourself before you publish.",
    );
    // More reads coming than links unread (another page's): only the unread are.
    await render({
      html: '<p>Done.</p>',
      checks: {
        links: { count: 3, read: 2, broken: 0 },
        images: { count: 0, withoutAlt: 0 },
        ownCode: 0,
      },
      linksPending: 4,
    });
    expect(dialog().textContent).toContain('1 of 3 links still being read · check it');
  });

  it('gives the page fields, each with Copy', async () => {
    await render({ html: '<p>Brew it slowly.</p>' });
    const fieldRows = [...dialog().querySelectorAll('[aria-label="Page fields"] dl > div')].map(
      (row) => row.textContent,
    );
    expect(fieldRows).toEqual([
      'Meta titlePour-overCopy',
      'Meta descriptionBrew it slowly.Copy',
      'Slugpour-overCopy',
      'AuthorAda Lovelace → your CMS author fieldCopy',
      'Reviewed byNo reviewer selected',
      'Featured imageNone in the page',
    ]);
    await act(async () => button('Copy Author')!.click());
    expect(writeText).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('adds WebPage.reviewedBy to HTML and the reviewer to export metadata', async () => {
    const reviewer: ContentAuthor = {
      ...ada,
      id: 'r1',
      name: 'Dr. Grace Hopper',
      title: 'Clinical Reviewer',
    };
    await render({
      html: '<h1>Pour-over</h1><p>Reviewed by Dr. Grace Hopper.</p><p>Done.</p>',
      reviewer,
      initialDestination: 'html',
    });

    expect(dialog().textContent).toContain('Reviewed byDr. Grace Hopper, Clinical ReviewerCopy');
    await act(async () => button('Download HTML')!.click());

    const [format, , html, fields] = draftExportBlob.mock.calls[0] as [
      string,
      string,
      string,
      {
        table: { rows: [string, string][] };
        front: Record<string, string>;
        head: { reviewer?: string };
      },
    ];
    expect(format).toBe('html');
    expect(html).toContain('"reviewedBy"');
    expect(html).toMatch(/"name":\s*"Dr\. Grace Hopper"/);
    expect(fields.table.rows).toContainEqual([
      'Reviewed by',
      'Dr. Grace Hopper, Clinical Reviewer',
    ]);
    expect(fields.front).toMatchObject({
      reviewed_by: 'Dr. Grace Hopper, Clinical Reviewer',
    });
    expect(fields.head.reviewer).toBe('Dr. Grace Hopper, Clinical Reviewer');
  });

  it('keeps the Article schema the page came with beside the reviewer’s node (00448)', async () => {
    const reviewer = { ...ada, id: 'r1', name: 'Dr. Grace Hopper' } as ContentAuthor;
    const article =
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Pour-over"}</script>';
    await render({
      html: `<h1>Pour-over</h1><p>Reviewed by Dr. Grace Hopper.</p>\n${article}`,
      reviewer,
      initialDestination: 'html',
    });
    await act(async () => button('Download HTML')!.click());
    const html = draftExportBlob.mock.calls[0][2] as string;
    expect(html).toContain('"@type":"Article"');
    expect(html.indexOf('"@type":"Article"')).toBeLessThan(html.indexOf('"reviewedBy"'));
  });

  it('leaves WebPage.reviewedBy out while the page doesn’t name the reviewer', async () => {
    const reviewer = { ...ada, id: 'r1', name: 'Dr. Grace Hopper' } as ContentAuthor;
    await render({ html: '<h1>Pour-over</h1><p>Done.</p>', reviewer, initialDestination: 'html' });
    await act(async () => button('Download HTML')!.click());
    const html = draftExportBlob.mock.calls[0][2] as string;
    expect(html).toContain('<p>Done.</p>');
    expect(html).not.toContain('reviewedBy');
  });

  it('downloads Word and Markdown with the page fields, and remembers the destination', async () => {
    await render({ html: '<p>Done.</p>' });
    // The dialog moves focus in after it opens: once it has, it won't take
    // focus back from the arrow keys (it did on a busy machine).
    await vi.waitFor(() => expect(dialog().contains(document.activeElement)).toBe(true));
    // Arrow keys move along the files, from Word back round to Markdown.
    destination('Word').focus();
    await act(async () => {
      destination('Word').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
      );
    });
    expect(destination('Markdown').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(destination('Markdown'));
    await act(async () => destination('Word').click());
    expect(dialog().textContent).toContain(
      'A Word file, with the page fields in a table on page 1',
    );
    await act(async () => button('Download Word')!.click());
    expect(draftExportBlob).toHaveBeenCalledWith(
      'docx',
      'Pour-over',
      '<p>Done.</p>',
      expect.objectContaining({
        table: expect.objectContaining({
          rows: expect.arrayContaining([['Slug', 'pour-over']]),
        }),
        front: expect.objectContaining({ slug: 'pour-over', author: 'Ada Lovelace' }),
      }),
      null,
      undefined,
    );
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'getcito_content_pour-over.docx');
    expect(localStorage.getItem('aeo:content-export-destination')).toBe('docx');
    // A new page's front matter dates it today.
    await act(async () => destination('Markdown').click());
    await act(async () => button('Download Markdown')!.click());
    const [, , , fields] = draftExportBlob.mock.calls.at(-1)!;
    expect(fields.front).toHaveProperty('date', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(fields.front).not.toHaveProperty('lastmod');
  });

  it('lists the files first, each with its icon, and the platforms folded under them', async () => {
    await render({ html: '<p>Done.</p>' });
    const files = dialog().querySelector('[role="radiogroup"][aria-label="Files"]')!;
    expect([...files.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      'Word',
      'Excel',
      'CSV',
      'HTML',
      'Markdown',
    ]);
    expect(files.querySelectorAll('[role="radio"] svg')).toHaveLength(5);
    // Word to start with, the platforms folded away.
    expect(destination('Word').getAttribute('aria-checked')).toBe('true');
    const bar = dialog().querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(bar.textContent).toBe('PlatformsShow');
    expect(bar.getAttribute('aria-expanded')).toBe('false');
    const platforms = dialog().querySelector<HTMLElement>(
      '[role="radiogroup"][aria-label="Platforms"]',
    )!;
    expect(platforms.parentElement!.hidden).toBe(true);

    await act(async () => bar.click());
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    expect(bar.textContent).toBe('PlatformsHide');
    expect(platforms.parentElement!.hidden).toBe(false);
    expect([...platforms.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual([
      'Webflow',
      'WordPress',
      'Shopify',
      'Google Docs',
    ]);
    // Each with its logo.
    expect(platforms.querySelectorAll('img')).toHaveLength(4);
    await act(async () => destination('WordPress').click());
    expect(button('Copy for WordPress')).toBeDefined();
    // Folded again, the platform picked is still named.
    await act(async () => bar.click());
    expect(bar.textContent).toBe('PlatformsWordPressShow');
  });

  it('opens on the platforms when one was picked last, focus on it', async () => {
    localStorage.setItem('aeo:content-export-destination', 'shopify');
    await render({ html: '<p>Done.</p>' });
    const bar = dialog().querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(bar.getAttribute('aria-expanded')).toBe('true');
    expect(destination('Shopify').getAttribute('aria-checked')).toBe('true');
    // Focus starts on it: Enter keeps Shopify, not the first file.
    await vi.waitFor(() => expect(document.activeElement).toBe(destination('Shopify')));
    // Each row is its own group: the files' tab stop is their first.
    expect(destination('Word').tabIndex).toBe(0);
    expect(destination('Excel').tabIndex).toBe(-1);
    // Arrow keys go round the platforms, never into the files.
    await act(async () => {
      destination('Shopify').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(destination('Google Docs').getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      destination('Google Docs').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(destination('Webflow').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(destination('Webflow'));
  });

  it('downloads Excel and CSV with the page fields', async () => {
    await render({ html: '<p>Done.</p>' });
    await act(async () => destination('Excel').click());
    expect(dialog().textContent).toContain('An Excel sheet with the page as one row');
    await act(async () => button('Download Excel')!.click());
    expect(draftExportBlob).toHaveBeenLastCalledWith(
      'xlsx',
      'Pour-over',
      '<p>Done.</p>',
      expect.objectContaining({ front: expect.objectContaining({ slug: 'pour-over' }) }),
      null,
      undefined,
    );
    expect(saveBlob).toHaveBeenLastCalledWith(expect.any(Blob), 'getcito_content_pour-over.xlsx');
    await act(async () => destination('CSV').click());
    await act(async () => button('Download CSV')!.click());
    expect(draftExportBlob).toHaveBeenLastCalledWith(
      'csv',
      'Pour-over',
      '<p>Done.</p>',
      expect.anything(),
      null,
      undefined,
    );
    expect(saveBlob).toHaveBeenLastCalledWith(expect.any(Blob), 'getcito_content_pour-over.csv');
  });

  it("dates a live page's Markdown as updated today, keeping its published date", async () => {
    await render({
      html: '<p>Done.</p>',
      isNew: false,
      sourceUrl: 'https://acme.com/blog/pour-over/',
      initialDestination: 'md',
    });
    await act(async () => button('Download Markdown')!.click());
    const [format, , , fields] = draftExportBlob.mock.calls.at(-1)!;
    expect(format).toBe('md');
    expect(fields.front).not.toHaveProperty('date');
    expect(fields.front).toHaveProperty('lastmod', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("puts the brand's byline line under the H1, not in the page fields", async () => {
    vi.stubGlobal('ClipboardItem', undefined);
    document.execCommand = vi.fn(() => false);
    await render({
      html: '<h1>Pour-over</h1><p>Done.</p>',
      byline: 'By Ada Lovelace',
      initialDestination: 'webflow',
    });
    await act(async () => button('Copy for Webflow')!.click());
    expect(writeText).toHaveBeenCalledWith('<p>By Ada Lovelace</p><p>Done.</p>');
    expect(dialog().textContent).toContain('Meta descriptionDone.');
    expect(dialog().textContent).toContain(
      'AuthorAda Lovelace → in the content, under the H1 (Add byline to content)',
    );
    await act(async () => destination('Word').click());
    await act(async () => button('Download Word')!.click());
    expect(draftExportBlob).toHaveBeenCalledWith(
      'docx',
      'Pour-over',
      '<h1>Pour-over</h1><p>By Ada Lovelace</p><p>Done.</p>',
      expect.anything(),
      null,
      undefined,
    );
    await act(async () => destination('HTML').click());
    await act(async () => button('Copy HTML')!.click());
    expect(writeText).toHaveBeenLastCalledWith(
      '<h1>Pour-over</h1><p>By Ada Lovelace</p><p>Done.</p>',
    );
  });

  it("opens on HTML for Copy HTML, and copies the page's HTML as it is", async () => {
    await render({ html: '<p>Done.</p>', initialDestination: 'html' });
    expect(destination('HTML').getAttribute('aria-checked')).toBe('true');
    await act(async () => button('Copy HTML')!.click());
    expect(writeText).toHaveBeenCalledWith('<p>Done.</p>');
    await act(async () => button('Download HTML')!.click());
    expect(draftExportBlob).toHaveBeenCalledWith(
      'html',
      'Pour-over',
      '<p>Done.</p>',
      expect.anything(),
      null,
      undefined,
    );
  });
});
