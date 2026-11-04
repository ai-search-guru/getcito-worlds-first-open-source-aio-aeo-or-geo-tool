import { act, Fragment, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import { articleSchemaInput, schemaAuthor } from '@/lib/content/pageSchema';
import { eeat, trust, trustBlocks, type TrustRead } from '@/lib/content/qualityChecks';
import { qualityTodos } from '@/lib/content/qualityTodos';
import { reviewerJsonLd } from '@/lib/content/readyToPublish';
import type { ShoppingLinks } from '@/lib/content/shoppingCheck';
import type { SiteTrust } from '@/lib/content/siteTrust';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { BeforePublish } = await import('./_BeforePublish');
type QualityRead = import('./_QualityTab').QualityRead;

/**
 * Before you publish (Quality spec §7, CE-041): the Trust < 60 warning, what
 * the CMS does, the JSON-LD to paste, and Mark ready (anyway, logged).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const siteTrust: SiteTrust = {
  checks: {
    about: { ok: true, url: 'https://acme.com/about' },
    contact: { ok: false, url: null },
    editorial: { ok: false, url: null },
    organizationSchema: { ok: true, url: 'https://acme.com/' },
    authorPages: { ok: true, authors: [{ name: 'Ada Lovelace', url: 'https://acme.com/ada' }] },
  },
  score: 3,
  checkedAt: '2026-10-23T12:00:00.000Z',
};
/** Three figures, one with a source: Trust 10 of 30 plus site trust 3 of 5, 37; sourced, 94. */
const lowTrust: TrustRead = trust({
  blocks: trustBlocks(
    '<p>Win rates rose 42% (<a href="https://research.example/r">report</a>).</p>' +
      '<p>Deals close $2.5 million faster.</p><p>Teams book 3x more demos.</p>',
  ),
  links: new Map(),
  brandDomains: ['acme.com'],
  siteTrust,
  now: Date.parse('2026-10-23T12:00:00Z'),
});

function quality(over: Partial<QualityRead> = {}): QualityRead {
  const author = over.author === undefined ? ada : over.author;
  const score = eeat({ author });
  return {
    readability: null,
    eeat: score,
    trust: lowTrust,
    author,
    canEdit: true,
    hasAuthors: true,
    brandName: 'Acme',
    team: 'Acme Team',
    siteTrust,
    todos: qualityTodos({ eeat: score, author, hasAuthors: true, canEdit: true }),
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
const onMarkReady = vi.fn();
const onFixFirst = vi.fn();
const writeText = vi.fn();

const clean = { placeholders: 0, imagesWithoutAlt: 0, linksBroken: 0, linksUnread: 0 };
const onContinue = vi.fn();
const onFillNow = vi.fn();
const onAddDisclosure = vi.fn();
const onSchemaLeftOut = vi.fn();

async function render(
  q: QualityRead,
  {
    isNew = true,
    pageType = 'blog_post' as string | null,
    image = 'https://cdn.acme.com/pour-over.jpg' as string | null,
    linksPending = 0,
    paste = clean,
    mode = 'markReady' as 'markReady' | 'export' | 'send',
    contentByline = null as string | null,
    title = 'How small teams forecast',
    disclosureLine = null as string | null,
    disclosureAdded = false,
    product = null as Parameters<typeof BeforePublish>[0]['product'],
    category = null as Parameters<typeof BeforePublish>[0]['category'],
    strict = false,
    shopping = null as Parameters<typeof BeforePublish>[0]['shopping'],
    schemaLeftOut = false,
    ownArticleSchema = false,
    reviewer = null as ContentAuthor | null,
    reviewerRequired = false,
    reviewerLd = null as string | null,
    openWork = null as { rules: number; todos: number } | null,
  } = {},
) {
  // As the editor makes it (00448): the author it names, the site's pages Site trust found.
  const articleSchema = {
    input: articleSchemaInput({
      title,
      author: schemaAuthor({
        authorsOn: true,
        authorsRead: q.eeat !== null,
        author: q.author,
        confirmedReal: q.authorConfirmed?.real ?? false,
      }),
      siteTrust: q.siteTrust,
      brandName: q.brandName,
      isNew,
    }),
    pageType,
    leftOut: schemaLeftOut,
  };
  const Wrap = strict ? StrictMode : Fragment;
  await act(async () => {
    root.render(
      <Wrap>
        <NextIntlClientProvider locale="en" messages={messages}>
          <BeforePublish
            mode={mode}
            paste={paste}
            onFillNow={onFillNow}
            contentByline={contentByline}
            onContinue={onContinue}
            onClose={() => {}}
            quality={q}
            reviewer={reviewer}
            reviewerRequired={reviewerRequired}
            reviewerLd={reviewerLd}
            title={title}
            pageType={pageType}
            image={image}
            articleSchema={articleSchema}
            ownArticleSchema={ownArticleSchema}
            onSchemaLeftOut={onSchemaLeftOut}
            linksPending={linksPending}
            product={product}
            category={category}
            shopping={shopping}
            onMarkReady={onMarkReady}
            onFixFirst={onFixFirst}
            disclosureLine={disclosureLine}
            disclosureAdded={disclosureAdded}
            onAddDisclosure={onAddDisclosure}
            openWork={openWork}
          />
        </NextIntlClientProvider>
      </Wrap>,
    );
  });
}
const dialog = () => document.querySelector('[role="dialog"]')!;
const alert = () => dialog().querySelector('[role="alert"]');
const button = (name: string) =>
  [...dialog().querySelectorAll('button')].find((b) => b.textContent === name);
const rows = () => [...dialog().querySelectorAll('li > div')].map((row) => row.textContent);
/** The Ready for your CMS row, in whichever group it shows. */
const pasteRow = () =>
  rows().find((row) => /^(Ready for your CMS|Fix before you paste) · /.test(row ?? ''));
const jsonLd = () =>
  JSON.parse(
    dialog()
      .querySelector('pre')!
      .textContent!.replace(/^<script[^>]*>/, '')
      .replace(/<\/script>$/, ''),
  );
/** A Trust read as the checks would give it. */
const trustRead = (over: Partial<TrustRead>): TrustRead => ({
  score: 50,
  checks: [],
  broken: [],
  stale: [],
  dated: 0,
  unsourced: [],
  figures: 0,
  marks: [],
  aiClaims: 0,
  weak: [],
  classified: 0,
  mismatches: [],
  ...over,
});

beforeEach(() => {
  onMarkReady.mockReset();
  onFixFirst.mockReset();
  onContinue.mockReset();
  onFillNow.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('BeforePublish', () => {
  describe('shopping links (shopping path)', () => {
    const product = (title: string, state: 'ok' | 'sold_out' | 'refused' | 'gone') => ({
      key: `shop.example/products/${title}`,
      title,
      state,
      inPath: true,
    });
    const links = (over: Partial<ShoppingLinks> = {}): ShoppingLinks => ({
      categoryLinked: true,
      linked: [],
      bad: [],
      products: 4,
      want: 0,
      categories: 1,
      merchantCenter: true,
      ...over,
    });
    const shoppingRow = () => rows().find((r) => r?.startsWith('Shopping links'));

    it('names the links to remove or replace, the first three and how many more', async () => {
      await render(quality(), {
        shopping: links({ bad: [product('Canyon', 'sold_out'), product('Ridge', 'refused')] }),
      });
      const bad = rows().find((r) => r?.startsWith('2 product links to remove or replace'));
      expect(bad).toContain(
        'Canyon (not in stock), Ridge (Merchant Center refuses it). Remove or replace these links on the page',
      );

      const five = ['A', 'B', 'C', 'D', 'E'].map((t) => product(t, 'gone'));
      await render(quality(), { shopping: links({ bad: five }) });
      expect(rows().find((r) => r?.startsWith('5 product links'))).toContain(
        'A (no longer in the catalog), B (no longer in the catalog), C (no longer in the catalog) +2 more.',
      );
    });

    it('names the cards that show an old price, with the price now, beside the links row (#1610)', async () => {
      await render(quality(), {
        shopping: links({
          linked: [product('Summit', 'ok')],
          want: 1,
          prices: [
            { title: 'Summit', page: '$199.00', now: '$179.00' },
            { title: 'Trail', page: '$50.00', now: null },
          ],
        }),
      });
      expect(rows().find((r) => r?.startsWith('2 product cards show an old price'))).toContain(
        "Summit: $199.00 on the page, $179.00 now; Trail: $50.00 on the page, no price now. A card keeps the price it was put in with. To show today's, replace the card: delete it and add the product again (Add › Products).",
      );
      // The links themselves still work.
      expect(rows().join('|')).toContain('Shopping links work');

      await render(quality(), { shopping: links({ prices: [] }) });
      expect(rows().join('|')).not.toContain('old price');
    });

    it('asks for the category page, then the products the rule wants', async () => {
      await render(quality(), { shopping: links({ categoryLinked: false, want: 3 }) });
      expect(rows().join('|')).toContain('No link to the category page');

      await render(quality(), {
        shopping: links({ linked: [product('Summit', 'ok')], want: 3 }),
      });
      expect(rows().join('|')).toContain('1 of 3 products linked');
      expect(rows().join('|')).not.toContain('Shopping links work');
    });

    it('says they work, with the words for no product linked by whether the category page is', async () => {
      await render(quality(), {
        shopping: links({ linked: [product('Summit', 'ok')], want: 1 }),
      });
      expect(rows().find((r) => r?.startsWith('Shopping links work'))).toContain(
        '1 product linked, in stock and accepted by Merchant Center.',
      );

      await render(quality(), { shopping: links() });
      expect(rows().find((r) => r?.startsWith('Shopping links work'))).toContain(
        'No product linked yet; the category page is.',
      );
      await render(quality(), { shopping: links({ categories: 0, categoryLinked: false }) });
      const none = rows().find((r) => r?.startsWith('Shopping links work'));
      expect(none).toContain('No product linked yet.');
      expect(none).not.toContain('category page');
    });

    it('says the products are accepted by Merchant Center only when the brand has it', async () => {
      const summit = [product('Summit', 'ok')];
      await render(quality(), {
        shopping: links({ linked: summit, want: 1, merchantCenter: false }),
      });
      const one = rows().find((r) => r?.startsWith('Shopping links work'));
      expect(one).toContain('1 product linked, in stock.');
      expect(one).not.toContain('Merchant Center');

      const two = [...summit, product('Ridge', 'ok')];
      await render(quality(), { shopping: links({ linked: two, want: 2, merchantCenter: false }) });
      expect(rows().find((r) => r?.startsWith('Shopping links work'))).toContain(
        '2 products linked, in stock.',
      );
      await render(quality(), { shopping: links({ linked: two, want: 2 }) });
      expect(rows().find((r) => r?.startsWith('Shopping links work'))).toContain(
        '2 products linked, in stock and accepted by Merchant Center.',
      );
    });

    it('says the catalog is being read, or couldn’t be, and shows no row without a path', async () => {
      await render(quality(), { shopping: 'reading' });
      expect(shoppingRow()).toBe(
        "Shopping links · check itReading your catalog for the linked products' stock…",
      );
      await render(quality(), { shopping: 'failed' });
      expect(rows().join('|')).toContain("Couldn't read your catalog");

      await render(quality());
      expect(rows().join('|')).not.toContain('Shopping links');
    });
  });

  it('warns under Trust 60 with the biggest reason, and logs Mark ready anyway', async () => {
    expect(lowTrust.score).toBe(37);
    await render(quality());
    expect(alert()!.textContent).toBe(
      'Trust is 37, under 60: AI answers may lean on this page less. 2 sentences with figures have no source. Fixing them first could raise Trust to about 94 (an estimate). You can still mark it ready.' +
        'If you mark it ready anyway, we note it with this Trust.',
    );
    // The action has the focus, not the code (it moves there after a frame).
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.activeElement).toBe(button('Mark ready anyway'));
    await act(async () => button('Mark ready anyway')!.click());
    expect(onMarkReady).toHaveBeenCalledWith({ trust: 37, reason: 'claimsSourced', count: 2 });
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith('Deals close $2.5 million faster.');
  });

  it('names the check that raises Trust most', async () => {
    await render(
      quality({
        trust: trustRead({
          score: 51,
          checks: [
            { id: 'claimsSourced', points: 25, max: 30 },
            { id: 'freshSources', points: 0, max: 7 },
          ],
          unsourced: ['Teams book 3x more demos.'],
          figures: 6,
          stale: [{ url: 'https://old.example/', text: 'An old study.' }],
          dated: 1,
        }),
      }),
    );
    expect(alert()!.textContent).toContain('1 of 1 dated source is over 24 months old');
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith('An old study.');
  });

  it("says Trust is low with no reason when the page's own checks pass", async () => {
    await render(
      quality({
        trust: trustRead({ score: 40, checks: [{ id: 'siteTrust', points: 2, max: 5 }] }),
      }),
    );
    expect(alert()!.textContent).toContain(
      'Trust is 40, under 60: AI answers may lean on this page less. Quality shows what could raise it. You can still mark it ready.',
    );
    expect(button('Fix first')).toBeDefined();
    await act(async () => button('Mark ready anyway')!.click());
    expect(onMarkReady).toHaveBeenCalledWith({ trust: 40, reason: null, count: null });
  });

  it('marks it ready with no warning at Trust 60, or while Trust is unread', async () => {
    await render(
      quality({
        trust: trustRead({
          score: 60,
          checks: [{ id: 'claimsSourced', points: 18, max: 30 }],
          unsourced: ['A figure.'],
          figures: 2,
        }),
      }),
    );
    expect(alert()).toBeNull();
    await render(quality({ trust: null }));
    expect(alert()).toBeNull();
    expect(button('Fix first')).toBeUndefined();
    await act(async () => button('Mark ready')!.click());
    expect(onMarkReady).toHaveBeenCalledWith(null);
  });

  it('says when links are still being read, as Trust may change', async () => {
    await render(quality({ trust: null }), { linksPending: 2 });
    expect(dialog().querySelector('[role="status"]')!.textContent).toBe(
      "Still reading 2 of the page's links, so Trust may change.",
    );
  });

  it('counts what is still open as it is marked ready, never that all is done (editor UX review 2026-11-03)', async () => {
    const said = () =>
      [...dialog().querySelectorAll('[role="status"]')].map((p) => p.textContent).join(' ');
    await render(quality({ trust: null }), { openWork: { rules: 2, todos: 1 } });
    expect(said()).toContain(
      'Still open: 2 rules and 1 to-do. You can mark it ready: they stay in Rules and Quality.',
    );
    // Mark ready stays open.
    expect(
      [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Mark ready')!
        .disabled,
    ).toBe(false);
    await render(quality({ trust: null }), { openWork: { rules: 1, todos: 0 } });
    expect(said()).toContain('Still open: 1 rule. You can mark it ready');
    await render(quality({ trust: null }), { openWork: { rules: 0, todos: 3 } });
    expect(said()).toContain('Still open: 3 to-dos. You can mark it ready');
    // Nothing open, or on the way to Export: nothing said.
    await render(quality({ trust: null }), { openWork: { rules: 0, todos: 0 } });
    expect(said()).not.toContain('Still open');
    await render(quality({ trust: null }), { mode: 'export', openWork: { rules: 2, todos: 1 } });
    expect(said()).not.toContain('Still open');
  });

  it('says what the CMS does: the author, the dates and the Article schema', async () => {
    await render(quality());
    // To fix first, then to check, then what is in place (editor UX review 2026-11-03).
    expect(rows()).toEqual([
      'Visible published and updated dates · check itMost CMSs (WordPress, Webflow, Shopify) add these for you. Check your page.',
      "Author: Ada Lovelace · doneAda Lovelace is named in the page's Article schema. Set them as the author in your CMS too, so its template shows the byline.",
      "Search engine details (Article schema), with the authorAdded · doneGetCito adds it to the page it sends to your CMS and to exports, with Ada Lovelace as the author. The page's text doesn't change. WordPress leaves it out: add it with your SEO plugin.",
      'Ready for your CMS · doneNo placeholders, all images have alt text, all links work.',
    ]);
    const groups = [...dialog().querySelectorAll('section h3')].map((h) => h.textContent);
    expect(groups).toEqual(['Check yourself', 'In place']);
    expect(dialog().textContent).toContain(
      'Nothing to fix and 1 to check yourself before you publish.',
    );
  });

  it('sums up what to fix and what to check, the things to fix first', async () => {
    await render(quality({ author: null, trust: null }), {
      paste: { placeholders: 1, imagesWithoutAlt: 0, linksBroken: 0, linksUnread: 0 },
    });
    expect(dialog().textContent).toContain(
      '2 things to fix and 1 to check yourself before you publish.',
    );
    const groups = [...dialog().querySelectorAll('section h3')].map((h) => h.textContent);
    expect(groups).toEqual(['Fix before you publish', 'Check yourself', 'In place']);
    expect(rows()[0]).toMatch(/^No author yet · missing/);
  });

  it('checks that a regulated page both selects and names its qualified reviewer', async () => {
    await render(quality(), { mode: 'export', reviewerRequired: true });
    expect(rows().join(' ')).toContain('No qualified reviewer named · missing');

    const reviewer: ContentAuthor = {
      ...ada,
      id: 'r1',
      name: 'Dr. Grace Hopper',
      title: 'Clinical Reviewer',
    };

    await render(quality(), { mode: 'export', reviewer, reviewerRequired: true });
    expect(rows().join(' ')).toContain('Reviewer not named in the page text · missing');

    // Named on the page: the node that goes out with it (reviewerJsonLd's).
    const reviewerLd = reviewerJsonLd(
      'How small teams forecast',
      '<p>Reviewed by Dr. Grace Hopper</p>',
      reviewer,
    );
    await render(quality(), { mode: 'export', reviewer, reviewerRequired: true, reviewerLd });
    expect(rows().join(' ')).toContain('Qualified reviewer: Dr. Grace Hopper · check it');
    expect(dialog().querySelector('pre')!.textContent).toContain('"@type": "WebPage"');
    expect(dialog().querySelector('pre')!.textContent).toContain('"reviewedBy"');
    expect(dialog().querySelector('pre')!.textContent).toContain('"jobTitle": "Clinical Reviewer"');

    // Not named: no WebPage node is shown, as none goes out.
    await render(quality(), { mode: 'export', reviewer, reviewerRequired: true });
    expect(dialog().querySelector('pre')!.textContent).not.toContain('"reviewedBy"');

    // A page no longer read as regulated keeps the reviewer picked for it, and
    // shows what goes out with it: Copy, Export and Send carry them all the same.
    await render(quality(), { mode: 'export', reviewer, reviewerLd });
    expect(rows().join(' ')).toContain('Qualified reviewer: Dr. Grace Hopper · check it');
    expect(dialog().querySelector('pre')!.textContent).toContain('"reviewedBy"');

    // No reviewer and not regulated: no row, no WebPage node.
    await render(quality(), { mode: 'export' });
    expect(rows().join(' ')).not.toContain('reviewer');
    expect(dialog().querySelector('pre')!.textContent).not.toContain('"reviewedBy"');
  });

  it('gives the JSON-LD from the page, author and site to copy, dated today', async () => {
    await render(quality());
    expect(jsonLd()).toMatchObject({
      '@type': 'Article',
      headline: 'How small teams forecast',
      image: 'https://cdn.acme.com/pour-over.jpg',
      author: {
        '@type': 'Person',
        name: 'Ada Lovelace',
        url: 'https://acme.com/ada',
        sameAs: ['https://www.linkedin.com/in/ada'],
      },
      publisher: { '@type': 'Organization', name: 'Acme', url: 'https://acme.com/' },
    });
    expect(jsonLd().datePublished).toBe(jsonLd().dateModified);
    expect(dialog().textContent).toContain("The dates are today's");
    await act(async () => button('Copy JSON-LD')!.click());
    expect(writeText).toHaveBeenCalledWith(dialog().querySelector('pre')!.textContent);
    expect(toast.success).toHaveBeenCalledWith('JSON-LD copied');
  });

  it('says the code is the one GetCito adds, and leaves it out on Leave it out (00448)', async () => {
    await render(quality());
    expect(dialog().textContent).toContain('The code GetCito adds to the page');
    await act(async () => button('Leave it out')!.click());
    expect(onSchemaLeftOut).toHaveBeenCalledWith(true);
  });

  it('says a left-out schema is left out, with the code to paste and Add it back', async () => {
    await render(quality(), { schemaLeftOut: true });
    expect(rows()[2]).toBe(
      "Search engine details left out · check itYou left GetCito's search engine details (Article schema) out of this page, for a CMS that adds its own. If yours doesn't, paste the code below into the page.",
    );
    // The author row no longer says the schema names them.
    expect(rows()[0]).toContain('Author for your CMS');
    expect(dialog().textContent).not.toContain('The code GetCito adds');
    expect(jsonLd()['@type']).toBe('Article');
    await act(async () => button('Add it back')!.click());
    expect(onSchemaLeftOut).toHaveBeenCalledWith(false);
  });

  it('says why GetCito adds none to a page with an Article schema of its own', async () => {
    await render(quality(), { ownArticleSchema: true });
    expect(rows()[2]).toBe(
      'Search engine details on the page · doneYour page already has its search engine details (Article schema), so GetCito leaves its own out.',
    );
    expect(button('Leave it out')).toBeUndefined();
    expect(dialog().querySelector('pre')).toBeNull();
  });

  it('leaves the headline out while the title has a placeholder, and says why', async () => {
    await render(quality(), { title: 'How [number] small teams forecast' });
    expect(jsonLd()).not.toHaveProperty('headline');
    expect(dialog().textContent).toContain(
      'The title still has a placeholder in square brackets, so the code leaves the headline out.',
    );
    expect(button('Copy JSON-LD')).toBeDefined();
  });

  it("leaves the author out while the authors aren't read", async () => {
    await render(quality({ eeat: null, author: null }));
    expect(rows()[0]).toContain("The authors couldn't be read here");
    expect(jsonLd()).not.toHaveProperty('author');
  });

  it('names an author the person confirmed their site names as checked, not missing (00271)', async () => {
    await render(quality({ author: null, authorConfirmed: { real: true, profile: false } }));
    expect(rows()[0]).toContain('Author named on your site · check it');
    expect(rows()[0]).toContain('Check your CMS sets them as the author.');
    // Not the brand's Organization: the author isn't named here, so left out.
    expect(jsonLd()).not.toHaveProperty('author');
  });

  it('asks a product page for no disclosure: it is the brand’s own (CE-052)', async () => {
    const recommends = {
      aiChecks: {
        how: null,
        balanced: null,
        disclosure: { found: false, show: 'Acme Ridge is our pick' },
        answerFirst: null,
      },
    };
    await render(quality(recommends));
    expect(rows().some((row) => row.includes('without a disclosure'))).toBe(true);
    await render(
      quality({
        ...recommends,
        weightsFor: { type: 'product_page', detected: false, profile: 'product' },
      }),
    );
    expect(rows().some((row) => row.includes('without a disclosure'))).toBe(false);
  });

  it('gives a category page its ItemList of the products it links, and asks for two links where it has fewer (CE-054)', async () => {
    const items = [
      { url: 'https://acme.com/products/ridge-28', name: 'Ridge 28' },
      { url: 'https://acme.com/products/ridge-32', name: 'Ridge 32' },
    ];
    await render(quality(), {
      pageType: 'category_page',
      title: 'Daypacks',
      category: { items, status: 'read' },
    });
    expect(rows().some((row) => row.startsWith('ItemList schema with 2 products'))).toBe(true);
    expect(jsonLd()).toMatchObject({
      '@type': 'ItemList',
      name: 'Daypacks',
      numberOfItems: 2,
      itemListElement: [
        { position: 1, url: 'https://acme.com/products/ridge-28', name: 'Ridge 28' },
        { position: 2, url: 'https://acme.com/products/ridge-32', name: 'Ridge 32' },
      ],
    });
    expect(dialog().textContent).toContain(
      "The products are the page's links to your product pages",
    );
    // One product: no list, and it says what to link.
    await render(quality(), {
      pageType: 'category_page',
      title: 'Daypacks',
      category: { items: items.slice(0, 1), status: 'read' },
    });
    expect(
      rows().find((row) => row.startsWith('ItemList schema needs links to your products')),
    ).toContain('GetCito finds one link to your product pages here');
    expect(dialog().querySelector('pre')).toBeNull();
    // The brand's domains not read yet, or not read at all: no "none" said.
    await render(quality(), {
      pageType: 'category_page',
      title: 'Daypacks',
      category: { items: [], status: 'reading' },
    });
    expect(rows().find((row) => row.startsWith('ItemList schema'))).toContain(
      "Reading the page's links to your product pages",
    );
    await render(quality(), {
      pageType: 'category_page',
      title: 'Daypacks',
      category: { items: [], status: 'unknown' },
    });
    expect(rows().find((row) => row.startsWith('ItemList schema'))).toContain(
      "Your brand's domains couldn't be read",
    );
    // A placeholder in the title: the list's name is left out, and it says so.
    await render(quality(), {
      pageType: 'category_page',
      title: '[category name] daypacks',
      category: { items, status: 'read' },
    });
    expect(jsonLd()).not.toHaveProperty('name');
    expect(dialog().textContent).toContain("so the code leaves the list's name out");
  });

  it('gives a product page its Product schema with the price it states, and asks for one it doesn’t (CE-053)', async () => {
    const product = {
      description: 'A daypack for wet hikes.',
      images: ['https://cdn.acme.com/ridge.jpg'],
      offer: { price: 129, currency: 'USD' },
    };
    await render(quality(), { pageType: 'product_page', title: 'Ridge 28 daypack', product });
    // The price as read, for the person to check.
    expect(rows().find((row) => row.startsWith('Product schema with its price'))).toContain(
      "Price read from the page: $129. Check it's the product's.",
    );
    expect(jsonLd()).toMatchObject({
      '@type': 'Product',
      name: 'Ridge 28 daypack',
      offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
    });
    expect(dialog().textContent).toContain('The price, its currency and the images are the page');
    // No name or no price: no code to paste, and it says why.
    await render(quality(), {
      pageType: 'product_page',
      title: '[name of a real person] daypack',
      product,
    });
    expect(rows().some((row) => row.startsWith("Product schema needs the product's name"))).toBe(
      true,
    );
    expect(rows().some((row) => row.startsWith('Product schema needs the price'))).toBe(false);
    expect(dialog().querySelector('pre')).toBeNull();
    await render(quality(), {
      pageType: 'product_page',
      title: 'Ridge 28 daypack',
      product: { ...product, offer: null },
    });
    expect(rows().some((row) => row.startsWith('Product schema needs the price'))).toBe(true);
    // Prices that differ: the code doesn't guess which is the product's.
    await render(quality(), {
      pageType: 'product_page',
      title: 'Ridge 28 daypack',
      product: { ...product, offer: { several: ['$119', '$139'] } },
    });
    expect(rows().find((row) => row.startsWith('Product schema needs one price'))).toContain(
      'more than one price ($119, $139)',
    );
    expect(dialog().querySelector('pre')).toBeNull();
    await render(quality(), {
      pageType: 'product_page',
      title: 'Ridge 28 daypack',
      product: { ...product, offer: null },
    });
    expect(dialog().querySelector('pre')).toBeNull();
    expect(
      [...dialog().querySelectorAll('button')].some((b) => b.textContent === 'Copy JSON-LD'),
    ).toBe(false);
  });

  it('names the brand’s byline as checked on a page type that wants no author (CE-052)', async () => {
    await render(
      quality({
        author: null,
        weightsFor: { type: 'product_page', detected: false, profile: 'product' },
      }),
    );
    expect(rows()[0]).toBe(
      "Your brand's byline · check itThis page type goes out under Acme Team: it needs no author.",
    );
  });

  it('names the team byline as missing, and keeps a live page its published date', async () => {
    await render(quality({ author: null }), { isNew: false, image: null });
    const [author, , schema] = rows();
    expect(author).toBe(
      'No author yet · missingThe page goes out as Acme Team: its search engine details name Acme as the author. A real author raises E-E-A-T.',
    );
    expect(schema).toContain('with Acme as the author');
    expect(jsonLd().author).toEqual({
      '@type': 'Organization',
      name: 'Acme',
      url: 'https://acme.com/',
    });
    expect(jsonLd()).not.toHaveProperty('datePublished');
    expect(jsonLd()).not.toHaveProperty('image');
  });

  it('says what keeps it from being ready to paste, with Fill now for a placeholder (CE-057)', async () => {
    await render(quality({ trust: null }), {
      paste: { placeholders: 2, imagesWithoutAlt: 1, linksBroken: 1, linksUnread: 1 },
    });
    expect(pasteRow()).toBe(
      "Fix before you paste · missing2 placeholders still open · 1 image has no alt text · 1 link doesn't answer · 1 link wasn't read: check it",
    );
    await act(async () => button('Fill now')!.click());
    expect(onFillNow).toHaveBeenCalled();
    await render(quality({ trust: null }), { paste: { ...clean, imagesWithoutAlt: 1 } });
    expect(button('Fill now')).toBeUndefined();
  });

  it('says links are still being read, or were not read, to check them', async () => {
    await render(quality({ trust: null }), {
      paste: { ...clean, linksUnread: 2 },
      linksPending: 2,
    });
    expect(pasteRow()).toBe(
      'Ready for your CMS · check itNo placeholders, all images have alt text; 2 links are still being read.',
    );
    await render(quality({ trust: null }), { paste: { ...clean, linksUnread: 2 } });
    expect(pasteRow()).toBe(
      "Ready for your CMS · check itNo placeholders, all images have alt text; 2 links weren't read: check them.",
    );
  });

  it('tells a link still being read from one no read is coming for', async () => {
    // One read still coming; the other link's site refused its read.
    await render(quality({ trust: null }), {
      paste: { ...clean, linksUnread: 2 },
      linksPending: 1,
    });
    expect(pasteRow()).toBe(
      "Ready for your CMS · check itNo placeholders, all images have alt text; 1 link is still being read, 1 wasn't read: check it.",
    );
    await render(quality({ trust: null }), {
      paste: { ...clean, placeholders: 1, linksUnread: 3 },
      linksPending: 1,
    });
    expect(pasteRow()).toBe(
      "Fix before you paste · missing1 placeholder still open · 1 link is still being read, 2 weren't read: check them",
    );
  });

  it('goes on to Export from Export, the warning saying so, with no log', async () => {
    await render(quality(), { mode: 'export' });
    expect(alert()!.textContent).toContain(
      'Fixing them first could raise Trust to about 94 (an estimate). You can still export it.',
    );
    expect(alert()!.textContent).not.toContain('we note it');
    expect(button('Mark ready anyway')).toBeUndefined();
    // The dialog moves focus in after it opens.
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Continue to export')));
    await act(async () => button('Continue to export')!.click());
    expect(onContinue).toHaveBeenCalled();
    expect(onMarkReady).not.toHaveBeenCalled();
  });

  it('goes on to the Send dialog from Send to CMS, the warning saying so', async () => {
    await render(quality(), { mode: 'send' });
    expect(alert()!.textContent).toContain(
      'Fixing them first could raise Trust to about 94 (an estimate). You can still send it to your CMS.',
    );
    expect(alert()!.textContent).not.toContain('we note it');
    await act(async () => button('Continue to send')!.click());
    expect(onContinue).toHaveBeenCalled();
    expect(onMarkReady).not.toHaveBeenCalled();
  });

  it('folds the code away on Send to CMS, and shows it on a click', async () => {
    await render(quality(), { mode: 'send' });
    expect(dialog().querySelector('pre')).toBeNull();
    // Copy JSON-LD is still there, for a CMS that doesn't add it.
    expect(button('Copy JSON-LD')).toBeDefined();
    await act(async () => button('Show the code GetCito adds')!.click());
    expect(jsonLd()['@type']).toBe('Article');
    // Left out: the code to paste, for a CMS that doesn't add it.
    await render(quality(), { mode: 'send', schemaLeftOut: true });
    expect(
      button("Show the code for search engines (JSON-LD), for a CMS that doesn't add it"),
    ).toBeDefined();
    // Export and Mark ready show it as before.
    await render(quality(), { mode: 'export' });
    expect(dialog().querySelector('pre')).not.toBeNull();
  });

  it('opens and folds the code with one button, its focus on the code it opens', async () => {
    await render(quality(), { mode: 'send' });
    // The dialog moves focus in a frame after it opens: clicked before that, on a
    // slow run, it takes the focus back from the code.
    await vi.waitFor(() => expect(document.activeElement).toBe(button('Continue to send')));
    const show = button('Show the code GetCito adds')!;
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await act(async () => show.click());
    expect(show.getAttribute('aria-expanded')).toBe('true');
    const code = dialog().querySelector('pre')!;
    expect(show.getAttribute('aria-controls')).toBe(code.id);
    expect(document.activeElement).toBe(code);
    await act(async () => show.click());
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(dialog().querySelector('pre')).toBeNull();
    // Export shows its code with no button to fold it.
    await render(quality(), { mode: 'export' });
    expect(dialog().querySelector('[aria-expanded]')).toBeNull();
  });

  it('says the headline is left out with the code folded too', async () => {
    await render(quality(), { mode: 'send', title: 'How [name of a real person] forecasts' });
    expect(dialog().querySelector('pre')).toBeNull();
    expect(dialog().textContent).toContain(
      'The title still has a placeholder in square brackets, so the code leaves the headline out.',
    );
  });

  it('goes straight on to the Send dialog when there is nothing to ask about', async () => {
    const fine = quality({ trust: trustRead({ score: 90 }) });
    await render(fine, { mode: 'send' });
    expect(onContinue).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // Trust read with no score: no figure or dated source to score, nothing to ask.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(quality({ trust: trustRead({ score: null }) }), { mode: 'send' });
    expect(onContinue).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('goes on to the Send dialog once in StrictMode, which runs an effect twice', async () => {
    await render(quality({ trust: trustRead({ score: 90 }) }), { mode: 'send', strict: true });
    expect(onContinue).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks on Send to CMS while Trust, the authors, a category’s products or the shopping links aren’t read yet', async () => {
    const again = async () => {
      await act(async () => root.unmount());
      root = createRoot(container);
    };
    // Trust not read yet.
    await render(quality({ trust: null }), { mode: 'send' });
    expect(button('Continue to send')).toBeDefined();
    await again();
    // The authors not read yet.
    await render(quality({ trust: trustRead({ score: 90 }), eeat: null }), { mode: 'send' });
    expect(button('Continue to send')).toBeDefined();
    await again();
    // A category page whose products are still being read.
    await render(quality({ trust: trustRead({ score: 90 }) }), {
      mode: 'send',
      pageType: 'category_page',
      category: { items: [], status: 'reading' },
    });
    expect(button('Continue to send')).toBeDefined();
    await again();
    // The page's shopping links still being read against the catalog.
    await render(quality({ trust: trustRead({ score: 90 }) }), {
      mode: 'send',
      shopping: 'reading',
    });
    expect(button('Continue to send')).toBeDefined();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('asks on Send to CMS when something is missing, its links still being read, or Trust is under 60', async () => {
    const fine = { trust: trustRead({ score: 90 }) };
    await render(quality({ ...fine, author: null }), { mode: 'send' });
    expect(button('Continue to send')).toBeDefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(quality(fine), { mode: 'send', linksPending: 2 });
    expect(button('Continue to send')).toBeDefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(quality(fine), { mode: 'send', paste: { ...clean, placeholders: 1 } });
    expect(button('Continue to send')).toBeDefined();
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('goes to what would raise Trust from Export too', async () => {
    await render(quality(), { mode: 'export' });
    await act(async () => button('Fix first')!.click());
    expect(onFixFirst).toHaveBeenCalledWith(expect.any(String));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('says the exports put the byline under the H1 for a brand that adds it to content', async () => {
    await render(quality(), { contentByline: 'By Ada Lovelace' });
    expect(rows()[0]).toBe(
      'Byline in the content · check itExports put "By Ada Lovelace" under the H1: this brand adds the byline to content, for a CMS with no author field.',
    );
    // The line as it goes out, in the brand's language.
    await render(quality(), { contentByline: 'Yazar: Ada Lovelace' });
    expect(rows()[0]).toContain('Exports put "Yazar: Ada Lovelace" under the H1');
  });

  it("gives no Article for a page that isn't one", async () => {
    await render(quality(), { pageType: 'product_page' });
    expect(rows()).toEqual([
      expect.stringContaining('Author for your CMS'),
      'Schema for this page type · check itCheck what your CMS adds for it (Product, ItemList…). The code GetCito gives here is for articles.',
      expect.stringContaining('Ready for your CMS'),
    ]);
    expect(dialog().querySelector('pre')).toBeNull();
    expect(button('Copy JSON-LD')).toBeUndefined();
  });

  it('asks a page that puts the brand forward for its disclosure, with Add line (CE-050)', async () => {
    const line = 'Disclosure: the product this page recommends is offered by Acme.';
    const pick = { found: false, show: 'Our top pick is the Acme Ridge 28' };
    onAddDisclosure.mockReset();
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }), {
      disclosureLine: line,
    });
    expect(rows()).toContainEqual(
      expect.stringContaining('The page recommends Acme without a disclosure'),
    );
    await act(async () => button('Add line')!.click());
    expect(onAddDisclosure).toHaveBeenCalledWith(line);
    expect(rows()).toContainEqual(expect.stringContaining('Disclosure added'));
    expect(button('Add line')).toBeUndefined();
    // Opened again before the page is read: the page has the line, so it's added.
    act(() => root.unmount());
    root = createRoot(container);
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }), {
      disclosureLine: line,
      disclosureAdded: true,
    });
    expect(rows()).toContainEqual(expect.stringContaining('Disclosure added'));
    expect(button('Add line')).toBeUndefined();

    // Said: its words. No line in the page's language: the person writes it.
    await render(
      quality({
        aiChecks: { balanced: null, disclosure: { found: true, show: 'Acme makes the Ridge 28' } },
      }),
    );
    expect(rows()).toContainEqual(
      expect.stringContaining('The page says so: "Acme makes the Ridge 28"'),
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render(quality({ aiChecks: { balanced: null, disclosure: pick } }));
    expect(rows()).toContainEqual(
      expect.stringContaining("Add a line saying the product the page recommends is Acme's own"),
    );
    expect(button('Add line')).toBeUndefined();
    // Where it doesn't apply: no row.
    await render(quality({ aiChecks: { balanced: null, disclosure: null } }));
    expect(rows().join(' ')).not.toContain('recommends');
  });
});
