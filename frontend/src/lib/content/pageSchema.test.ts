import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import type { SiteTrust } from './siteTrust';
import {
  articleJsonLd,
  articleSchemaInput,
  articleSchemaPlan,
  firstImage,
  hasArticleSchema,
  isArticlePage,
  itemListJsonLd,
  jsonLdScript,
  listedProducts,
  localDate,
  pageName,
  titleHasPlaceholder,
  openingParagraph,
  pageOffer,
  productJsonLd,
  schemaAuthor,
  webPageJsonLd,
  withArticleSchema,
  type AddedArticleSchema,
} from './pageSchema';

/** Before you publish's JSON-LD (Quality spec §7, CE-041): from the page's facts, nothing made up. */

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: 'Head of Content',
  bio: 'Writes about forecasting.',
  photoUrl: 'https://cdn.acme.com/ada.jpg',
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const base = {
  title: 'How small teams forecast pipeline',
  author: ada,
  authorUrl: 'https://acme.com/authors/ada-lovelace',
  brandName: 'Acme',
  brandUrl: 'https://acme.com/',
  image: 'https://cdn.acme.com/pour-over.jpg',
  isNew: true,
  today: '2026-10-23',
};

describe('articleJsonLd', () => {
  it('gives an Article by the person, with their profile, published and updated today', () => {
    expect(articleJsonLd(base)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'How small teams forecast pipeline',
      image: 'https://cdn.acme.com/pour-over.jpg',
      author: {
        '@type': 'Person',
        name: 'Ada Lovelace',
        jobTitle: 'Head of Content',
        url: 'https://acme.com/authors/ada-lovelace',
        image: 'https://cdn.acme.com/ada.jpg',
        sameAs: ['https://www.linkedin.com/in/ada'],
      },
      publisher: { '@type': 'Organization', name: 'Acme', url: 'https://acme.com/' },
      datePublished: '2026-10-23',
      dateModified: '2026-10-23',
    });
  });

  it("gives the brand's Organization for the team byline, and leaves out what isn't known", () => {
    const result = articleJsonLd({
      ...base,
      author: null,
      brandUrl: null,
      image: null,
      title: '  ',
    });
    expect(result).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Article',
      author: { '@type': 'Organization', name: 'Acme' },
      publisher: { '@type': 'Organization', name: 'Acme' },
      datePublished: '2026-10-23',
      dateModified: '2026-10-23',
    });
    const bare = articleJsonLd({
      ...base,
      author: { ...ada, title: null, photoUrl: null, sameAs: [] },
      authorUrl: null,
    });
    expect(bare.author).toEqual({ '@type': 'Person', name: 'Ada Lovelace' });
  });

  it("leaves the author out while the authors aren't read", () => {
    expect(articleJsonLd({ ...base, author: undefined })).not.toHaveProperty('author');
  });

  it('leaves the headline out while the title has a placeholder', () => {
    const result = articleJsonLd({ ...base, title: 'Forecasting with [figure, source] accuracy' });
    expect(result).not.toHaveProperty('headline');
    expect(result.author).toMatchObject({ name: 'Ada Lovelace' });
    // A footnote, a checkbox or "[sic]" is no placeholder.
    expect(titleHasPlaceholder('Pipeline [1] and [x] [sic]')).toBe(false);
    expect(pageName(' Ridge 28 [1] ')).toBe('Ridge 28 [1]');
    expect(pageName('Ridge [model name]')).toBeNull();
    expect(pageName('  ')).toBeNull();
    expect(titleHasPlaceholder('Interview with [name of a real person]')).toBe(true);
    // The match keeps no state between titles.
    expect(titleHasPlaceholder('Interview with [name of a real person]')).toBe(true);
  });

  it('keeps the published date a live page has: only the updated date', () => {
    const result = articleJsonLd({ ...base, isNew: false });
    expect(result).not.toHaveProperty('datePublished');
    expect(result.dateModified).toBe('2026-10-23');
  });
});

describe('schemaAuthor (customer priorities item 7)', () => {
  const read = { authorsOn: true, authorsRead: true, confirmedReal: false };
  it("names the page's author, else the brand", () => {
    expect(schemaAuthor({ ...read, author: ada })).toBe(ada);
    expect(schemaAuthor({ ...read, author: null })).toBeNull();
  });

  it('leaves the author out while unknown, or when the site names its own (00271)', () => {
    expect(schemaAuthor({ ...read, authorsRead: false, author: null })).toBeUndefined();
    expect(schemaAuthor({ ...read, author: null, confirmedReal: true })).toBeUndefined();
    // A picked author still counts.
    expect(schemaAuthor({ ...read, author: ada, confirmedReal: true })).toBe(ada);
  });

  it('goes out under the brand while authors are off (Quality phase 0)', () => {
    expect(
      schemaAuthor({ authorsOn: false, authorsRead: false, author: null, confirmedReal: false }),
    ).toBeNull();
  });
});

describe('articleSchemaInput', () => {
  const siteTrust = {
    checks: {
      organizationSchema: { ok: true, url: 'https://acme.com/' },
      authorPages: {
        ok: true,
        authors: [{ name: 'Ada Lovelace', url: 'https://acme.com/authors/ada-lovelace' }],
      },
    },
  } as unknown as SiteTrust;

  it("takes the author's and the brand's pages from Site trust, when it read them", () => {
    expect(
      articleSchemaInput({ title: 'T', author: ada, siteTrust, brandName: 'Acme', isNew: true }),
    ).toEqual({
      title: 'T',
      author: ada,
      authorUrl: 'https://acme.com/authors/ada-lovelace',
      brandName: 'Acme',
      brandUrl: 'https://acme.com/',
      isNew: true,
    });
    expect(
      articleSchemaInput({
        title: 'T',
        author: null,
        siteTrust: null,
        brandName: 'Acme',
        isNew: false,
      }),
    ).toMatchObject({ authorUrl: null, brandUrl: null });
  });
});

describe('hasArticleSchema', () => {
  const script = (value: unknown) =>
    `<p>Hi</p><script type="application/ld+json">${JSON.stringify(value)}</script>`;

  it('finds an Article, or a kind of one, in the page’s own JSON-LD, its @graph too', () => {
    expect(hasArticleSchema(script({ '@type': 'Article' }))).toBe(true);
    expect(hasArticleSchema(script({ '@type': 'BlogPosting' }))).toBe(true);
    expect(hasArticleSchema(script({ '@type': ['WebPage', 'NewsArticle'] }))).toBe(true);
    expect(
      hasArticleSchema(
        script({ '@graph': [{ '@type': 'Organization' }, { '@type': 'TechArticle' }] }),
      ),
    ).toBe(true);
    expect(hasArticleSchema(script({ '@type': 'https://schema.org/Article' }))).toBe(true);
  });

  it('is false for other schema, broken JSON or none', () => {
    expect(hasArticleSchema(script({ '@type': 'FAQPage' }))).toBe(false);
    expect(hasArticleSchema('<script type="application/ld+json">{oops</script>')).toBe(false);
    expect(hasArticleSchema('<p>No schema</p>')).toBe(false);
  });
});

describe('articleSchemaPlan and withArticleSchema (00448)', () => {
  const schema = (over: Partial<AddedArticleSchema> = {}): AddedArticleSchema => ({
    input: {
      title: 'How small teams forecast pipeline',
      author: ada,
      authorUrl: null,
      brandName: 'Acme',
      brandUrl: null,
      isNew: true,
    },
    pageType: 'blog_post',
    leftOut: false,
    ...over,
  });
  const page =
    '<h1>How small teams forecast pipeline</h1><img src="https://cdn.acme.com/a.jpg"><p>Text.</p>';
  const now = new Date(2026, 10, 1, 12);
  const added = (html: string) => {
    const [, json] = html.match(/<script type="application\/ld\+json">([\s\S]*)<\/script>$/) ?? [];
    return json ? JSON.parse(json) : null;
  };

  it("adds the Article schema at the page's end, its author in it; the page's text stays", () => {
    const html = withArticleSchema(page, schema(), now);
    expect(html.startsWith(page)).toBe(true);
    expect(added(html)).toMatchObject({
      '@type': 'Article',
      headline: 'How small teams forecast pipeline',
      author: { '@type': 'Person', name: 'Ada Lovelace' },
      image: 'https://cdn.acme.com/a.jpg',
      datePublished: '2026-11-01',
      dateModified: '2026-11-01',
    });
    // No author picked: the brand, as its Organization.
    expect(
      added(withArticleSchema(page, schema({ input: { ...schema().input, author: null } }), now))
        .author,
    ).toEqual({
      '@type': 'Organization',
      name: 'Acme',
    });
    expect(articleSchemaPlan(page, 'blog_post', false)).toBe('added');
  });

  it('adds none when left out, when the page has its own, or for a page that isn’t an article', () => {
    expect(withArticleSchema(page, schema({ leftOut: true }), now)).toBe(page);
    expect(articleSchemaPlan(page, 'blog_post', true)).toBe('leftOut');

    const own = `${page}<script type="application/ld+json">{"@type":"BlogPosting"}</script>`;
    expect(withArticleSchema(own, schema(), now)).toBe(own);
    expect(articleSchemaPlan(own, 'blog_post', true)).toBe('own');

    expect(withArticleSchema(page, schema({ pageType: 'product_page' }), now)).toBe(page);
    expect(articleSchemaPlan(page, 'product_page', false)).toBe('none');
  });
});

describe('webPageJsonLd', () => {
  it('keeps the qualified reviewer separate from the Article author', () => {
    expect(webPageJsonLd({ title: 'A guide', reviewer: ada })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'A guide',
      reviewedBy: {
        '@type': 'Person',
        name: 'Ada Lovelace',
        jobTitle: 'Head of Content',
        image: 'https://cdn.acme.com/ada.jpg',
        sameAs: ['https://www.linkedin.com/in/ada'],
      },
    });
  });
});

describe('jsonLdScript', () => {
  it("wraps it to paste, so a title can't close the tag", () => {
    const script = jsonLdScript(articleJsonLd({ ...base, title: 'Tags </script> in titles' }));
    expect(script.startsWith('<script type="application/ld+json">\n{')).toBe(true);
    expect(script.endsWith('}\n</script>')).toBe(true);
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(JSON.parse(script.slice(36, -10)).headline).toBe('Tags </script> in titles');
  });
});

describe('firstImage', () => {
  it("takes the page's first image with a full https address", () => {
    expect(
      firstImage(
        '<p><img src="/local.png"><img src="data:image/png;base64,AA"></p>' +
          '<img src="https://cdn.acme.com/a.jpg"><img src="https://cdn.acme.com/b.jpg">',
      ),
    ).toBe('https://cdn.acme.com/a.jpg');
    expect(firstImage('<p>No images.</p>')).toBeNull();
  });
});

describe('isArticlePage', () => {
  it('reads articles, and a page with no type yet, as one', () => {
    expect(isArticlePage('blog_post')).toBe(true);
    expect(isArticlePage(null)).toBe(true);
    expect(isArticlePage('product_page')).toBe(false);
    expect(isArticlePage('pricing')).toBe(false);
  });
});

describe('localDate', () => {
  it('gives the local day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});

describe('pageOffer (Phase 3, CE-053)', () => {
  const ridge = { price: 129, currency: 'USD' };

  it('reads one price as the Offer, a range written as one as low and high', () => {
    expect(pageOffer(['The Ridge 28 costs $129.'])).toEqual(ridge);
    expect(pageOffer(['Small: $129.', 'In stock. Small: $129.'])).toEqual(ridge);
    expect(pageOffer(['Sizes run $119–$139.'])).toEqual({ low: 119, high: 139, currency: 'USD' });
    expect(pageOffer(['From $119-139, by size.', 'The large is $139.'])).toEqual({
      low: 119,
      high: 139,
      currency: 'USD',
    });
    expect(pageOffer(['Zwischen 119 € und 139 €.'])).toEqual({
      low: 119,
      high: 139,
      currency: 'EUR',
    });
    // A tax-inclusive price is the price.
    expect(pageOffer(['129 € inkl. MwSt.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Fiyatı 1.299 TL, KDV dahil.'])).toEqual({ price: 1299, currency: 'TRY' });
    expect(pageOffer(['$129, tax included.'])).toEqual(ridge);
    // Words that name the product aren't another bill.
    expect(pageOffer(['Extra large: $129.'])).toEqual(ridge);
    expect(pageOffer(['The over-ear Ridge headphones cost $129.'])).toEqual(ridge);
    expect(pageOffer(['A 2-person tent for $129.'])).toEqual(ridge);
    expect(pageOffer(['Ridge 28 for $129.'])).toEqual(ridge);
    expect(pageOffer(['Ridge Plus: $129.'])).toEqual(ridge);
    expect(pageOffer(['Comes with all accessories for $129.'])).toEqual(ridge);
    // A model's number before its price is no price, nor a range.
    expect(pageOffer(['Ridge 28 $129.'])).toEqual(ridge);
    expect(pageOffer(['Ridge 28 – $129.'])).toEqual(ridge);
    expect(pageOffer(['$129 – 150 reviews.'])).toEqual(ridge);
    // Free shipping is no bill.
    expect(pageOffer(['The Ridge 28 with free shipping costs $129.'])).toEqual(ridge);
    expect(pageOffer(['Versandkostenfrei für nur 129 €.'])).toEqual({
      price: 129,
      currency: 'EUR',
    });
    expect(pageOffer(['Kostenloser Versand für 129 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Ücretsiz kargo ile 999 TL.'])).toEqual({ price: 999, currency: 'TRY' });
    // An old price that is the page's only one is its price.
    expect(pageOffer(['Regular price $129.00'])).toEqual(ridge);
    // A currency after its amount stays with it; a code after a sign says whose dollar.
    expect(pageOffer(['129,00 € 2 Jahre Garantie.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['1.299,00 TL 3 taksit imkânı.'])).toEqual({ price: 1299, currency: 'TRY' });
    // A code before a dollar sign, a Swiss apostrophe.
    expect(pageOffer(['CAD $129.00'])).toEqual({ price: 129, currency: 'CAD' });
    expect(pageOffer(['MX$1,299'])).toEqual({ price: 1299, currency: 'MXN' });
    expect(pageOffer(["CHF 1'299.–"])).toEqual({ price: 1299, currency: 'CHF' });
    expect(pageOffer(["1'299.00 CHF"])).toEqual({ price: 1299, currency: 'CHF' });
    expect(pageOffer(['$129.00 CAD'])).toEqual({ price: 129, currency: 'CAD' });
    expect(pageOffer(['Galaxy S24+: $999.99 (Regular price $1,099.99)'])).toEqual({
      price: 999.99,
      currency: 'USD',
    });
    expect(pageOffer(['Heats up in 3 min. $129 (reg. $159).'])).toEqual(ridge);
    expect(pageOffer(['Kids 10-12 $129.'])).toEqual(ridge);
  });

  it('keeps the price beside an amount that isn’t it', () => {
    // A sale: the price now, not the old one.
    expect(pageOffer(['Now $129, was $159.'])).toEqual(ridge);
    expect(pageOffer(['$129 (was $159).'])).toEqual(ridge);
    expect(pageOffer(['$129 (reg. $159).'])).toEqual(ridge);
    expect(pageOffer(['$129 instead of $159.'])).toEqual(ridge);
    expect(pageOffer(['Regular price $159.00 Sale price $129.00'])).toEqual(ridge);
    expect(pageOffer(['129,00 € 159,00 € statt'])).toEqual({ several: ['129,00 €', '159,00 €'] });
    expect(pageOffer(['Original price $159. Now $129.'])).toEqual(ridge);
    expect(pageOffer(['Au lieu de 159 €, 129 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Antes 159 €, ahora 129 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Bisher 159 €, jetzt 129 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['Eski fiyat 1.299 TL, şimdi 999 TL.'])).toEqual({
      price: 999,
      currency: 'TRY',
    });
    expect(pageOffer(['₺1.299 yerine ₺999.'])).toEqual({ price: 999, currency: 'TRY' });
    // Savings, worth and rewards.
    expect(pageOffer(['Save $30: it’s $129 this week.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Save up to $30.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'You save 19% ($30).'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Free gift worth $30.'])).toEqual(ridge);
    expect(pageOffer(['$129 ($30 value).'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Earn $13 in rewards.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Get up to $200 trade-in credit.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Get a $10 coupon.'])).toEqual(ridge);
    // Thresholds and shipping.
    expect(pageOffer(['It costs $129 and ships free on orders over $50.'])).toEqual(ridge);
    expect(pageOffer(['Free shipping on orders over $50.', 'It costs $129.'])).toEqual(ridge);
    expect(pageOffer(['Min. order $50.', 'Price $129.'])).toEqual(ridge);
    expect(pageOffer(['$129 with free shipping.'])).toEqual(ridge);
    expect(pageOffer(['Shipping: $5.99.', 'Price: $129.'])).toEqual(ridge);
    expect(pageOffer(['$129 + $9.95 shipping.'])).toEqual(ridge);
    expect(pageOffer(['Plus $9.95 shipping.', '$129.'])).toEqual(ridge);
    expect(pageOffer(['129,00 € inkl. MwSt., zzgl. 4,95 € Versand'])).toEqual({
      price: 129,
      currency: 'EUR',
    });
    expect(pageOffer(['Kostenloser Versand ab 50 €.', 'Preis: 129 €.'])).toEqual({
      price: 129,
      currency: 'EUR',
    });
    expect(pageOffer(['Free shipping on all orders $50+', '$129.'])).toEqual(ridge);
    expect(pageOffer(['Kostenloser Versand für Bestellungen über 50 €.', 'Preis: 129 €.'])).toEqual(
      { price: 129, currency: 'EUR' },
    );
    expect(pageOffer(['Envío gratuito en pedidos superiores a 50 €.', '129 €.'])).toEqual({
      price: 129,
      currency: 'EUR',
    });
    expect(
      pageOffer(['Livraison gratuite pour toute commande supérieure à 50 €.', '129 €.']),
    ).toEqual({ price: 129, currency: 'EUR' });
    // A member's, a subscriber's or a code's price, a unit price, PayPal, a balance.
    expect(pageOffer(['Regular price $129, or $116 with Subscribe & Save.'])).toEqual(ridge);
    expect(pageOffer(['Regular price $129.00 Member price $116.10'])).toEqual(ridge);
    expect(pageOffer(['$129. With code SPRING10: $116.10'])).toEqual(ridge);
    expect(pageOffer(['Regular price $129.00 Unit price $12.90 / per 100g'])).toEqual(ridge);
    expect(pageOffer(['UVP 129,00 € Grundpreis 25,80 € / 1 kg'])).toEqual({
      price: 129,
      currency: 'EUR',
    });
    expect(pageOffer(['Regular price $129.00', 'Pay in 4 with PayPal: $32.25'])).toEqual(ridge);
    expect(pageOffer(['Liste fiyatı 1.599 TL, 300 TL indirimle.'])).toEqual({
      price: 1599,
      currency: 'TRY',
    });
    expect(
      pageOffer(['$129.', 'Pre-order with a $50 deposit, balance of $79 at shipping.']),
    ).toEqual(ridge);
    expect(pageOffer(['Free shipping on orders between $50 and $100.', '$129.'])).toEqual(ridge);
    // Savings and installments in other languages.
    expect(pageOffer(['129 €.', 'Sie sparen 30 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['129 €.', 'Économisez 30 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['129 €, o 3 plazos de 43 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['129 €, oder 3 Raten à 43 €.'])).toEqual({ price: 129, currency: 'EUR' });
    expect(pageOffer(['500 TL üzeri kargo bedava.', 'Fiyatı 999 TL.'])).toEqual({
      price: 999,
      currency: 'TRY',
    });
    // Financing, a unit price, a bundle, an add-on.
    expect(pageOffer(['$129, or 4 interest-free payments of $32.25 with Klarna.'])).toEqual(ridge);
    expect(pageOffer(['$129, or as low as $12/mo with Affirm.'])).toEqual(ridge);
    expect(pageOffer(['$129 ($0.50/oz).'])).toEqual(ridge);
    expect(pageOffer(['$129 each, or 2 for $239.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Add a waterproof rain cover for $19.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Accessories: rain cover $19.'])).toEqual(ridge);
    expect(pageOffer(['$129.', 'Rain cover ($19, sold separately).'])).toEqual(ridge);
  });

  it('guesses none: no price, prices that differ, or a range that isn’t one', () => {
    expect(pageOffer(['A sturdy daypack for wet hikes.'])).toBeNull();
    expect(pageOffer(['Save $30 this week.'])).toBeNull();
    // A subscription's price is a plan's, not the product's.
    expect(pageOffer(['$12 a month.'])).toBeNull();
    expect(pageOffer(['$10–$20 a month.'])).toBeNull();
    expect(pageOffer(['10–20 € pro Monat.'])).toBeNull();
    expect(pageOffer(['$10–$20 monthly.'])).toBeNull();
    // Prices that differ, or in two currencies: the person says which.
    expect(pageOffer(['Small: $119.', 'Large: $139.'])).toEqual({ several: ['$119', '$139'] });
    expect(pageOffer(['Regular: $119.95', 'Long: $129.95'])).toEqual({
      several: ['$119.95', '$129.95'],
    });
    expect(pageOffer(['$129.', 'Order now: $129.00.'])).toEqual(ridge);
    // An old price with no lower one beside it isn't dropped for an amount elsewhere.
    expect(pageOffer(['Regular price $129.00', 'Refer a friend and get $20.'])).toEqual({
      several: ['$129.00', '$20'],
    });
    // "From" and a range written loosely may be several prices.
    expect(pageOffer(['From $119.'])).toEqual({ several: ['$119'] });
    for (const from of [
      'From just $129.',
      'Starting at just $129.',
      'As low as $129.',
      'Pricing begins at $129.',
      'A partir de 129 €.',
      'A partire da 129 €.',
      'Vanaf € 129.',
      'Ab nur 129 €.',
      "1.299 TL'den başlıyor.",
    ]) {
      expect(pageOffer([from])).toHaveProperty('several');
    }
    // A number written onto a price: the person says which.
    expect(pageOffer(['PlayStation 5 549,99 €'])).toEqual({ several: ['5 549,99 €'] });
    expect(pageOffer(['Ridge 28 € 129'])).toEqual({ several: ['28 €'] });
    expect(pageOffer(['999 TL 3 taksit imkânı.'])).toEqual({ several: ['999 TL'] });
    // Another product's range beside the price isn't its range.
    expect(pageOffer(['Comparable headphones cost $200–$400, but the X1 is $299.'])).toHaveProperty(
      'several',
    );
    expect(pageOffer(['From $119 up to $139.'])).toEqual({ several: ['$119'] });
    expect(pageOffer(['Preis: 119 – 139 €.'])).toEqual({ several: ['119 – 139 €'] });
    expect(pageOffer(['Fiyat: 999 - 1.299 TL.'])).toEqual({ several: ['999 - 1.299 TL'] });
    expect(pageOffer(['$129 in the US, €119 in Europe.'])).toEqual({ several: ['$129', '€119'] });
    // A number after a price isn't its range's end.
    expect(pageOffer(['Only $19 - 100% organic cotton.'])).toEqual({ price: 19, currency: 'USD' });
    expect(pageOffer(['$25 - 30-day money-back guarantee.'])).toEqual({
      price: 25,
      currency: 'USD',
    });
    expect(pageOffer(['€20 – 30 Tage Rückgaberecht.'])).toEqual({ price: 20, currency: 'EUR' });
    expect(pageOffer(['$5 a 12-pack.'])).toEqual({ price: 5, currency: 'USD' });
  });
});

describe('openingParagraph', () => {
  it('gives the first paragraph past a byline, cut at a word under 500 characters', () => {
    expect(
      openingParagraph('<h1>Ridge 28</h1><p>By Acme Team</p><p>A daypack for wet hikes.</p>'),
    ).toBe('A daypack for wet hikes.');
    const long = openingParagraph(`<p>${'word '.repeat(150)}end.</p>`)!;
    expect(long.length).toBeLessThanOrEqual(501);
    expect(long.endsWith('…')).toBe(true);
    expect(openingParagraph('<h1>Ridge 28</h1>')).toBeNull();
  });
});

describe('productJsonLd', () => {
  it('gives a Product with its Offer, or an AggregateOffer for a range, and only what the page states', () => {
    expect(
      productJsonLd({
        name: 'Ridge 28 daypack',
        description: 'A daypack for wet hikes.',
        images: ['https://cdn.acme.com/ridge.jpg'],
        brandName: 'Acme',
        offer: { price: 129, currency: 'USD' },
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Ridge 28 daypack',
      description: 'A daypack for wet hikes.',
      image: 'https://cdn.acme.com/ridge.jpg',
      brand: { '@type': 'Brand', name: 'Acme' },
      offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
    });
    const range = productJsonLd({
      name: 'Ridge 28',
      description: 'A daypack in [color] for wet hikes.',
      images: [],
      brandName: 'Acme',
      offer: { low: 119, high: 139, currency: 'EUR' },
    });
    // A placeholder in the description leaves it out; no availability or reviews are made up.
    expect(range).not.toHaveProperty('description');
    expect(range).not.toHaveProperty('image');
    expect(range.offers).toEqual({
      '@type': 'AggregateOffer',
      lowPrice: '119.00',
      highPrice: '139.00',
      priceCurrency: 'EUR',
    });
  });
});

describe('listedProducts (Phase 3, CE-054)', () => {
  it('reads the page’s links to the brand’s product pages, in order, each once, with their names', () => {
    const html =
      '<h1>Daypacks</h1>' +
      '<ul><li><a href="https://www.acme.com/products/ridge-28?variant=1">Ridge 28</a></li>' +
      '<li><a href="/products/ridge-32#specs">Ridge 32</a></li>' +
      // The same products again: another form of the address, a collection's path.
      '<li><a href="https://acme.com/products/ridge-28/">Ridge 28 again</a></li>' +
      '<li><a href="/collections/daypacks/products/ridge-32">Ridge 32 again</a></li>' +
      '<li><a href="https://shop.acme.com/urun/kanyon"><img src="https://cdn.acme.com/k.jpg" alt="Kanyon"></a></li>' +
      '<li><a href="/product-page/summit">Summit</a></li></ul>' +
      // Another site's product (one that only starts like the brand's too), a
      // collection, a post, an image, a product's sub-page.
      '<p><a href="https://rival.com/products/peak">Peak</a> · <a href="https://acme.com.evil.com/products/x">X</a> · ' +
      '<a href="/collections/daypacks">All</a> · <a href="/blog/how-to-pack">Packing</a> · ' +
      '<a href="https://news.acme.com/p/how-to-pack">Post</a> · <a href="/cdn/shop/products/ridge.jpg">Photo</a> · ' +
      '<a href="/products/ridge-28/reviews">See 24 reviews</a></p>';
    expect(listedProducts(html, ['acme.com'], 'https://acme.com')).toEqual([
      { url: 'https://www.acme.com/products/ridge-28', name: 'Ridge 28' },
      { url: 'https://acme.com/products/ridge-32', name: 'Ridge 32' },
      { url: 'https://shop.acme.com/urun/kanyon', name: 'Kanyon' },
      { url: 'https://acme.com/product-page/summit', name: 'Summit' },
    ]);
    // A relative link with no site read: against the brand's first domain; none at all, left out.
    expect(listedProducts('<a href="/products/x">X</a>', ['acme.com'], null)).toEqual([
      { url: 'https://acme.com/products/x', name: 'X' },
    ]);
    expect(listedProducts('<a href="/products/x">X</a>', [], null)).toEqual([]);
  });

  it('names a product by its card’s words, without its price or a button’s word, an HTML block’s too', () => {
    const card = '<a href="/products/ridge-28"><h3>Ridge 28</h3><span>$129.00</span></a>';
    const block = btoa(
      '<div class="grid"><a href="/products/ridge-32">Shop now</a><a href="/products/ridge-32">Ridge 32</a></div>',
    );
    expect(
      listedProducts(
        `${card}<div data-html-block="${block}"></div><a href="/products/summit"><img src="s.jpg"></a><a href="/products/summit">Summit</a>`,
        ['acme.com'],
        'https://acme.com',
      ),
    ).toEqual([
      { url: 'https://acme.com/products/ridge-28', name: 'Ridge 28' },
      // A later link's name fills one the first didn't give.
      { url: 'https://acme.com/products/ridge-32', name: 'Ridge 32' },
      { url: 'https://acme.com/products/summit', name: 'Summit' },
    ]);
  });
});

describe('itemListJsonLd', () => {
  it('lists the products in order under the page’s name, a placeholder name left out', () => {
    expect(
      itemListJsonLd({
        name: 'Daypacks',
        items: [
          { url: 'https://acme.com/products/ridge-28', name: 'Ridge 28' },
          { url: 'https://acme.com/products/ridge-32', name: '[product name]' },
        ],
      }),
    ).toEqual({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Daypacks',
      numberOfItems: 2,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          url: 'https://acme.com/products/ridge-28',
          name: 'Ridge 28',
        },
        { '@type': 'ListItem', position: 2, url: 'https://acme.com/products/ridge-32' },
      ],
    });
    expect(itemListJsonLd({ name: null, items: [] })).not.toHaveProperty('name');
  });
});
