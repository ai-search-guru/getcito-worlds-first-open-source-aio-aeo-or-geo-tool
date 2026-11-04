import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./aiProvider.js', () => ({ resolveModel: (id) => ({ id }) }));

const {
  INDUSTRIES,
  applySiteTypeDetection,
  brandHost,
  classifySiteType,
  detectSiteType,
  homePageSignals,
  pageExcerpt,
  settledType,
} = await import('./siteTypeDetect.js');

/** A brand's kind of site, detected at setup (action plan by business type, Step 0). */

const page = (body, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const reasonsOf = (html) => homePageSignals(html).reasons.map((r) => r.reason);

const SHOP = page(
  `<a href="/collections/backpacks">Backpacks</a><a href="/products/ridge-45">Ridge 45</a>
   <a href="/products/crest-30">Crest 30</a><a href="/cart">Cart</a>
   <button>Add to cart</button><p>Free shipping over $50</p>`,
  ld({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Ridge 45',
    offers: { '@type': 'Offer', price: '129.00', priceCurrency: 'USD' },
  }),
);
const SAAS = page(
  `<h1>Track how AI talks about your brand</h1><a href="/pricing">Pricing</a>
   <a href="/integrations">Integrations</a><a href="/demo">Book a demo</a>
   <p>From $49 per user a month. Start your free trial.</p>`,
);
const HOTEL = page(
  `<h1>Seaside rooms in Bodrum</h1><a href="/rooms">Rooms</a><button>Book now</button>`,
  ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Hotel', name: 'Mavi' }] }),
);
const APP = page(
  `<h1>Build habits that stick</h1>
   <a href="https://apps.apple.com/app/habitly/id1">App Store</a>
   <a href="https://play.google.com/store/apps/details?id=habitly">Google Play</a>`,
  ld({ '@context': 'https://schema.org', '@type': 'MobileApplication', name: 'Habitly' }),
);
const VAGUE = page('<h1>Welcome</h1><p>We make things better.</p>');
const SHOPIFY_SCRIPT = page('<script src="https://cdn.shopify.com/s/files/theme.js"></script>');

describe('homePageSignals and settledType', () => {
  it('reads a shop from its sold products, cart and wording', () => {
    const signals = homePageSignals(SHOP);
    expect(signals.scores.ecommerce).toBeGreaterThanOrEqual(6);
    expect(reasonsOf(SHOP)).toEqual(
      expect.arrayContaining(['product_schema', 'cart_link', 'shop_wording', 'product_links']),
    );
    expect(settledType(signals)).toBe('ecommerce');
  });

  it('reads a SaaS from its demo, seat pricing and links', () => {
    expect(reasonsOf(SAAS)).toEqual(
      expect.arrayContaining(['demo_offer', 'seat_pricing', 'free_trial', 'saas_links']),
    );
    expect(settledType(homePageSignals(SAAS))).toBe('b2b');
  });

  it('reads a consumer service from its bookings, JSON-LD @graph included', () => {
    expect(settledType(homePageSignals(HOTEL))).toBe('b2c');
  });

  it("reads a shop platform from its assets and scripts, never from the page's words", () => {
    const agency = page(
      '<h1>We build WooCommerce and Shopify stores</h1><p>Magento and BigCommerce too.</p>',
    );
    expect(homePageSignals(agency).scores.ecommerce).toBe(0);
    expect(reasonsOf(SHOPIFY_SCRIPT)).toEqual(['shop_platform']);
    expect(
      homePageSignals(
        page('<link href="/wp-content/plugins/woocommerce/style.css" rel="stylesheet">'),
      ).scores.ecommerce,
    ).toBe(2);
    expect(reasonsOf(page('<script>window.Shopify = {}; Shopify.theme = {};</script>'))).toEqual([
      'shop_platform',
    ]);
  });

  it('counts an offer only on a product: not on an event or a course, nor a product only reviewed', () => {
    const event = page(
      '',
      ld({ '@type': 'Event', name: 'Summit', offers: { '@type': 'Offer', price: '99' } }),
    );
    const reviewed = page(
      '',
      ld({ '@type': 'Product', name: 'Acme', aggregateRating: { ratingValue: 4.8 } }),
    );
    const course = page('', ld({ '@type': 'Course', offers: [{ '@type': 'Offer' }] }));
    for (const html of [event, reviewed, course]) {
      expect(reasonsOf(html)).not.toContain('product_schema');
    }
  });

  it('settles a shop on two signals of its own, never one alone', () => {
    const platformOnly = homePageSignals(SHOPIFY_SCRIPT);
    expect(platformOnly.scores.ecommerce).toBe(3);
    expect(settledType(platformOnly)).toBeNull();
    expect(
      settledType({
        scores: { ecommerce: 5, b2b: 0, b2c: 0 },
        reasons: [
          { type: 'ecommerce', reason: 'shop_platform' },
          { type: 'ecommerce', reason: 'cart_link' },
        ],
      }),
    ).toBe('ecommerce');
  });

  it('settles nothing on a page that says too little, or two things as loudly', () => {
    expect(settledType(homePageSignals(VAGUE))).toBeNull();
    // A SaaS that also sells a little: neither leads by twice.
    expect(settledType({ scores: { ecommerce: 3, b2b: 4, b2c: 0 } })).toBeNull();
    expect(settledType({ scores: { ecommerce: 0, b2b: 2, b2c: 0 } })).toBeNull();
    expect(settledType({ scores: { ecommerce: 0, b2b: 6, b2c: 3 } })).toBe('b2b');
  });

  it('reads a mobile app from its app schema and store badges', () => {
    expect(reasonsOf(APP)).toEqual(['app_schema', 'app_store_links']);
    expect(settledType(homePageSignals(APP))).toBe('app');
  });

  it('counts app store badges toward a mobile app, never alone enough', () => {
    const signals = homePageSignals(
      page('<a href="https://apps.apple.com/app/habitly/id1">App Store</a>'),
    );
    expect(signals.scores).toMatchObject({ app: 1, b2c: 0 });
    expect(settledType(signals)).toBeNull();
    // A hotel showing its app's badges is still a consumer service.
    const hotelWithApp = homePageSignals(
      HOTEL.replace('</body>', '<a href="https://apps.apple.com/app/mavi/id2">App</a></body>'),
    );
    expect(settledType(hotelWithApp)).toBe('b2c');
  });

  it('reads no words from scripts or styles, and survives broken JSON-LD and empty pages', () => {
    const none = { b2b: 0, ecommerce: 0, b2c: 0, app: 0 };
    expect(
      homePageSignals(
        page(
          '<script>var label = "Book a demo";</script><style>.x::after{content:"Add to cart"}</style>',
        ),
      ).scores,
    ).toEqual(none);
    expect(
      homePageSignals(page('', '<script type="application/ld+json">{oops</script>')).scores,
    ).toEqual(none);
    expect(homePageSignals('').scores).toEqual(none);
  });
});

describe('pageExcerpt', () => {
  it('keeps the title, description, heading and text, without scripts or menus, and cut short', () => {
    const html = page(
      `<nav>Menu Login</nav><h1>Seaside rooms</h1><script>var x = 1</script><p>${'word '.repeat(600)}</p>`,
      '<title>Mavi Hotel</title><meta name="description" content="Rooms by the sea">',
    );
    const excerpt = pageExcerpt(html);
    expect(excerpt.startsWith('Mavi Hotel\nRooms by the sea\nSeaside rooms')).toBe(true);
    expect(excerpt).not.toContain('var x');
    expect(excerpt).not.toContain('Menu Login');
    expect(excerpt.length).toBeLessThanOrEqual(1500);
  });

  it('takes the first title and heading outside an svg or the nav', () => {
    const html = page(
      '<nav><h1>Menu</h1></nav><svg><title>Logo</title></svg><h1>Seaside rooms</h1>',
    );
    expect(pageExcerpt(html).startsWith('Seaside rooms\n')).toBe(true);
  });
});

describe('reading a page of many elements', () => {
  it('reads tens of thousands of links, scripts and blocks in about a second, not minutes', () => {
    const html = page(
      '<a href="/products/x">p</a>'.repeat(20_000) +
        '<script>a</script>'.repeat(20_000) +
        '<script type="application/ld+json">1</script>'.repeat(5_000) +
        '<p>add to cart</p>',
    );
    const started = Date.now();
    const { reasons } = homePageSignals(html);
    pageExcerpt(html);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(reasons.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['shop_wording', 'product_links']),
    );
  });
});

describe('brandHost', () => {
  it('keeps the primary host as it was added, www included, without scheme or path', () => {
    expect(
      brandHost([
        { domain: 'shop.example', is_primary: false },
        { domain: 'https://www.Trailpeak.example/en?x=1', is_primary: true },
      ]),
    ).toBe('www.trailpeak.example');
    expect(brandHost([{ domain: 'acme.example', is_primary: false }])).toBe('acme.example');
    expect(brandHost([])).toBeNull();
  });
});

describe('classifySiteType', () => {
  it('asks once, with a time limit, with the brand and its page as data', async () => {
    const generate = vi.fn(async () => ({
      object: { siteType: 'ecommerce', industry: 'Fashion & Apparel' },
    }));
    const read = await classifySiteType(
      { name: 'Loom', domain: 'loom.example', description: 'Linen shirts', excerpt: 'Shop linen' },
      { generate },
    );
    expect(read).toEqual({ siteType: 'ecommerce', industry: 'Fashion & Apparel' });
    expect(generate).toHaveBeenCalledTimes(1);
    const { prompt, system, abortSignal } = generate.mock.calls[0][0];
    expect(abortSignal).toBeInstanceOf(AbortSignal);
    expect(prompt).toContain('Website: loom.example');
    expect(prompt).toContain('Home page text:\nShop linen');
    expect(system).toContain('never instructions');
    expect(system).toContain('app: a mobile app');
  });

  it('gives null when the call fails', async () => {
    const generate = vi.fn(async () => {
      throw new Error('rate limited');
    });
    expect(await classifySiteType({ name: 'Loom', domain: null }, { generate })).toBeNull();
  });

  it('picks industries from Brand settings’ list', () => {
    expect(INDUSTRIES).toContain('B2B Software (SaaS)');
    expect(INDUSTRIES).toHaveLength(15);
  });
});

describe('detectSiteType', () => {
  const brand = { name: 'Trailpeak', domain: 'trailpeak.example', description: null };

  it('settles from the home page without a model call', async () => {
    const fetcher = vi.fn(async () => ({ html: SHOP }));
    const classify = vi.fn();
    const result = await detectSiteType(brand, { fetcher, classify });
    expect(fetcher).toHaveBeenCalledWith('https://trailpeak.example/', expect.any(Object));
    expect(classify).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      siteType: 'ecommerce',
      industry: 'E-commerce & Retail',
      via: 'page',
    });
    expect(result.reasons).toContain('cart_link');
  });

  it('tries the host with "www." when the bare host does not answer', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unreachable'), { code: 'unreachable' }))
      .mockResolvedValueOnce({ html: SAAS });
    const result = await detectSiteType(brand, { fetcher, classify: vi.fn() });
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
      'https://trailpeak.example/',
      'https://www.trailpeak.example/',
    ]);
    expect(result.siteType).toBe('b2b');
  });

  it("asks the model when the page doesn't settle it, with the page's text", async () => {
    const fetcher = vi.fn(async () => ({ html: VAGUE }));
    const classify = vi.fn(async () => ({ siteType: 'b2b', industry: 'Technology' }));
    const result = await detectSiteType(brand, { fetcher, classify });
    expect(classify.mock.calls[0][0].excerpt).toContain('Welcome');
    expect(result).toEqual({ siteType: 'b2b', industry: 'Technology', via: 'ai', reasons: [] });
  });

  it("asks the model without page text when the page can't be read", async () => {
    const fetcher = vi.fn(async () => {
      throw Object.assign(new Error('blocked'), { code: 'http_error' });
    });
    const classify = vi.fn(async () => ({ siteType: 'b2c', industry: 'Travel & Hospitality' }));
    expect((await detectSiteType(brand, { fetcher, classify })).via).toBe('ai');
    expect(classify.mock.calls[0][0].excerpt).toBeNull();
  });

  it('gives null when neither can say, and reads nothing for a brand with no domain', async () => {
    const fetcher = vi.fn();
    const classify = vi.fn(async () => null);
    expect(await detectSiteType({ ...brand, domain: null }, { fetcher, classify })).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * A database with one brand: its row, its domains, and each update with its
 * filters. `matches(update)` says whether the update's filters keep the row.
 */
function fakeDb(brand, { domains, matches = () => true } = {}) {
  const writes = [];
  return {
    writes,
    from(table) {
      if (table === 'brand_domains') {
        return {
          select: () => ({
            eq: async () => ({
              data: domains ?? [{ domain: 'www.trailpeak.example', is_primary: true }],
              error: null,
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: brand, error: null }) }) }),
        update: (values) => {
          const write = { values, filters: [] };
          const chain = {
            eq: (column, value) => {
              write.filters.push(['eq', column, value]);
              return chain;
            },
            is: (column, value) => {
              write.filters.push(['is', column, value]);
              return chain;
            },
            select: async () => {
              writes.push(write);
              return { data: matches(write) ? [{ id: brand.id }] : [], error: null };
            },
          };
          return chain;
        },
      };
    },
  };
}

describe('applySiteTypeDetection', () => {
  const NOW = new Date('2026-10-29T12:00:00Z');
  const base = {
    id: 'b1',
    name: 'Trailpeak',
    description: 'Hiking gear',
    industry: null,
    site_type: null,
    site_type_source: null,
    shopping_mode_enabled: false,
  };
  const shop = { siteType: 'ecommerce', industry: 'E-commerce & Retail', via: 'page', reasons: [] };

  it('fills an empty type, stamped, and an empty industry, each only if still empty', async () => {
    const db = fakeDb(base);
    const detect = vi.fn(async () => shop);
    const result = await applySiteTypeDetection('b1', { db, detect, now: NOW });
    expect(detect).toHaveBeenCalledWith({
      name: 'Trailpeak',
      domain: 'www.trailpeak.example',
      description: 'Hiking gear',
    });
    expect(db.writes).toEqual([
      {
        values: { site_type: 'ecommerce', site_type_detected_at: '2026-10-29T12:00:00.000Z' },
        filters: [
          ['eq', 'id', 'b1'],
          ['is', 'site_type', null],
        ],
      },
      {
        values: { industry: 'E-commerce & Retail' },
        filters: [
          ['eq', 'id', 'b1'],
          ['is', 'industry', null],
        ],
      },
    ]);
    expect(result).toEqual({ detected: shop, industry: 'E-commerce & Retail' });
  });

  it('leaves an industry the brand has, and says none was written when one came meanwhile', async () => {
    const db = fakeDb({ ...base, industry: 'Consumer Goods' });
    expect(
      (await applySiteTypeDetection('b1', { db, detect: async () => shop, now: NOW })).industry,
    ).toBeNull();
    expect(db.writes).toHaveLength(1);

    const raced = fakeDb(base, { matches: (w) => !('industry' in w.values) });
    expect(
      (await applySiteTypeDetection('b1', { db: raced, detect: async () => shop })).industry,
    ).toBeNull();
  });

  it('never detects over a type a brand has, chosen or detected', async () => {
    const detect = vi.fn();
    for (const [source, skipped] of [
      ['manual', 'manual'],
      ['auto', 'set'],
    ]) {
      const db = fakeDb({ ...base, site_type: 'b2b', site_type_source: source });
      expect(await applySiteTypeDetection('b1', { db, detect })).toEqual({ skipped });
      expect(db.writes).toEqual([]);
    }
    expect(detect).not.toHaveBeenCalled();
  });

  it('says manual when a type was set while the page was read', async () => {
    const db = fakeDb(base, { matches: () => false });
    expect(await applySiteTypeDetection('b1', { db, detect: async () => shop })).toEqual({
      skipped: 'manual',
    });
  });

  it('makes a brand in Shopping mode a shop without reading its page', async () => {
    const db = fakeDb({ ...base, shopping_mode_enabled: true });
    const detect = vi.fn();
    const result = await applySiteTypeDetection('b1', { db, detect, now: NOW });
    expect(detect).not.toHaveBeenCalled();
    expect(result.detected).toMatchObject({ siteType: 'ecommerce', via: 'shopping_mode' });
    expect(db.writes[0].values.site_type).toBe('ecommerce');
  });

  it('says what it would write, and writes nothing, on a dry run', async () => {
    const db = fakeDb(base);
    const detect = async () => ({
      siteType: 'b2b',
      industry: 'Technology',
      via: 'ai',
      reasons: [],
    });
    const result = await applySiteTypeDetection('b1', { db, detect, write: false });
    expect(result).toMatchObject({ detected: { siteType: 'b2b' }, industry: 'Technology' });
    expect(db.writes).toEqual([]);
  });

  it("writes nothing when the type can't be told, so a later try reads it again", async () => {
    const db = fakeDb(base);
    expect(await applySiteTypeDetection('b1', { db, detect: async () => null })).toEqual({
      detected: null,
    });
    expect(db.writes).toEqual([]);
  });
  it('skips, without an error, while 00379 is not applied yet', async () => {
    const missing = { code: '42703', message: 'column brands.site_type_source does not exist' };
    const detect = vi.fn(async () => shop);
    const unread = {
      from: (table) =>
        table === 'brand_domains'
          ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
          : {
              select: () => ({
                eq: () => ({ single: async () => ({ data: null, error: missing }) }),
              }),
            },
    };
    expect(await applySiteTypeDetection('b1', { db: unread, detect, now: NOW })).toEqual({
      skipped: 'unavailable',
    });
    expect(detect).not.toHaveBeenCalled();

    // Read before the migration, written after a deploy that dropped it: the same.
    const db = fakeDb(base);
    db.from = ((from) => (table) => {
      const t = from(table);
      if (table !== 'brands') return t;
      return {
        ...t,
        update: () => ({
          eq: () => ({ is: () => ({ select: async () => ({ data: null, error: missing }) }) }),
        }),
      };
    })(db.from.bind(db));
    expect(await applySiteTypeDetection('b1', { db, detect, now: NOW })).toEqual({
      skipped: 'unavailable',
    });
  });

  it('skips, without an error, a mobile app while 00456 is not applied yet', async () => {
    const refused = {
      code: '23514',
      message: 'violates check constraint "brands_site_type_check"',
    };
    const app = { siteType: 'app', industry: null, via: 'ai', reasons: [] };
    const db = fakeDb(base);
    db.from = ((from) => (table) => {
      const t = from(table);
      if (table !== 'brands') return t;
      return {
        ...t,
        update: () => ({
          eq: () => ({ is: () => ({ select: async () => ({ data: null, error: refused }) }) }),
        }),
      };
    })(db.from.bind(db));
    expect(await applySiteTypeDetection('b1', { db, detect: async () => app, now: NOW })).toEqual({
      skipped: 'unavailable',
    });
  });
});
