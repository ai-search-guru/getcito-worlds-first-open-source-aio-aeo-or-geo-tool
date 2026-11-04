import { describe, expect, it } from 'vitest';
import categoryPaths from './__fixtures__/category-paths.json';
import { PAGE_TYPES } from './drafts';
import {
  SITE_PAGE_TYPES,
  SITE_TYPES,
  detectPageType,
  guessSiteType,
  siteTypeOf,
} from './pageTypes';

describe('site types', () => {
  it('offers each kind of site its own page types, all of them known', () => {
    expect(SITE_PAGE_TYPES.b2b).toContain('feature_page');
    expect(SITE_PAGE_TYPES.ecommerce).toContain('product_page');
    expect(SITE_PAGE_TYPES.b2c).toContain('destination_page');
    expect(SITE_PAGE_TYPES.app).toEqual(expect.arrayContaining(['feature_page', 'pricing']));
    expect(SITE_PAGE_TYPES.app).not.toContain('destination_page');
    for (const site of SITE_TYPES) {
      for (const type of SITE_PAGE_TYPES[site]) expect(PAGE_TYPES).toContain(type);
    }
  });

  it('guesses a shop from Shopping mode first, then from the industry, else B2B', () => {
    expect(guessSiteType({ industry: 'B2B Software (SaaS)', shoppingModeEnabled: true })).toBe(
      'ecommerce',
    );
    expect(guessSiteType({ industry: 'Fashion & Apparel' })).toBe('ecommerce');
    expect(guessSiteType({ industry: 'Travel & Hospitality' })).toBe('b2c');
    expect(guessSiteType({ industry: 'Technology' })).toBe('b2b');
    expect(guessSiteType({ industry: 'Finance & Banking' })).toBe('b2b');
    expect(guessSiteType({ industry: 'Food & Beverage' })).toBe('ecommerce');
    expect(guessSiteType({ industry: null })).toBe('b2b');
  });

  it('keeps the site type the brand chose over the guess', () => {
    expect(siteTypeOf({ siteType: 'b2c', industry: 'B2B Software (SaaS)' })).toBe('b2c');
    expect(siteTypeOf({ siteType: 'app', shoppingModeEnabled: true })).toBe('app');
    expect(siteTypeOf({ siteType: null, industry: 'E-commerce & Retail' })).toBe('ecommerce');
    expect(siteTypeOf({ siteType: 'nonsense', industry: 'Technology' })).toBe('b2b');
  });
});

describe('detectPageType from the URL', () => {
  it.each([
    ['https://northwind.com/features/pipeline-forecasting', 'feature_page'],
    ['/solutions/real-estate', 'solution_page'],
    ['/for-agencies', 'solution_page'],
    ['/blog/northwind-vs-hubspot', 'comparison'],
    ['/hubspot-alternatives/', 'alternatives'],
    ['/best-crm-for-startups', 'best_of'],
    ['/glossary/lead-scoring', 'definition'],
    ['/blog/what-is-pipeline-coverage', 'definition'],
    ['/what-is', 'definition'],
    ['/integrations/slack', 'integration'],
    ['/en/pricing', 'pricing'],
    ['/guides/clean-crm-data', 'guide'],
    ['/how-to-clean-crm-data', 'guide'],
    ['/blog/crm-data-hygiene', 'blog_post'],
    ['/blog/best-practices-for-pipeline-reviews', 'blog_post'],
    ['/docs/api/auth', 'docs_faq'],
    ['/product/analytics', 'feature_page'],
  ])('B2B: %s → %s', (url, type) => {
    expect(detectPageType({ url }, 'b2b')).toBe(type);
  });

  it.each([
    ['https://shop.example/products/trail-runner-x?variant=2', 'product_page'],
    ['/p/daypack-22l.html', 'product_page'],
    ['/collections/ultralight-tents', 'category_page'],
    ['/collections/kitchen', 'category_page'],
    ['/collections/kitchen-appliances', 'category_page'],
    ['/collections/closets', 'category_page'],
    ['/collections/sunset-lamps', 'category_page'],
    ['/collections/limited-edition', 'category_page'],
    ['/collections/toothpicks', 'category_page'],
    ['/collections/gifts-for-hikers', 'collection_page'],
    ['/collections/camp-kitchen-kits', 'collection_page'],
    ['/collections/gift-sets/', 'collection_page'],
    ['/collections/best-sellers', 'collection_page'],
    ['/collections/editors-picks', 'collection_page'],
    ['/collections/the-edit', 'collection_page'],
    ['/collections/for-her', 'collection_page'],
    ['/collections/tents-for-beginners', 'collection_page'],
    ['/pages/size-guide', 'sizing_guide'],
    ['/nespresso-alternatives', 'alternatives'],
    ['/compare/tent-a-vs-tent-b', 'comparison'],
    ['/faq', 'help_faq'],
    ['/guides/how-to-pitch-a-tent', 'guide'],
    ['/buying-guides/tents', 'buying_guide'],
    ['/best-hiking-boots', 'best_of'],
    ['/pages/returns-policy', 'policy'],
    ['/help/shipping', 'policy'],
    ['/blog/trail-season', 'blog_post'],
  ])('e-commerce: %s → %s', (url, type) => {
    expect(detectPageType({ url }, 'ecommerce')).toBe(type);
  });

  it.each([
    ['/destinations/lisbon', 'destination_page'],
    ['/itineraries/lisbon-with-kids', 'itinerary'],
    ['/trips/3-days-in-porto', 'itinerary'],
    ['/best-hotels-in-porto', 'best_of'],
    ['/help/cancellation', 'help_faq'],
    ['/guides/azores-in-winter', 'guide'],
    ['/porto-vs-lisbon', 'comparison'],
    ['/airbnb-alternatives', 'comparison'],
    ['/blog/best-time-to-visit-madeira', 'blog_post'],
  ])('B2C: %s → %s', (url, type) => {
    expect(detectPageType({ url }, 'b2c')).toBe(type);
  });

  it.each([
    ['/features/streaks', 'feature_page'],
    ['/pricing', 'pricing'],
    ['/habitly-vs-streaks', 'comparison'],
    ['/streaks-alternatives', 'alternatives'],
    ['/best-habit-tracker-apps', 'best_of'],
    ['/help/restore-purchases', 'help_faq'],
    ['/privacy', 'help_faq'],
    ['/guides/morning-routine', 'guide'],
    ['/blog/habit-stacking', 'blog_post'],
    ['/destinations/lisbon', null],
    ['/solutions/teams', null],
  ])('Mobile app: %s → %s', (url, type) => {
    expect(detectPageType({ url }, 'app')).toBe(type);
  });

  it('gives a sign the site’s own type, or skips it when the site writes no such page', () => {
    expect(detectPageType({ url: '/vs/hubspot' }, 'b2b')).toBe('comparison');
    expect(detectPageType({ url: '/vs/hubspot' }, 'ecommerce')).toBe('comparison');
    // Only a shop writes sizing guides.
    expect(detectPageType({ url: '/size-guide' }, 'b2b')).toBeNull();
    // A shop has no pricing page type: the URL tells nothing, the title does.
    expect(
      detectPageType({ url: '/pricing', title: 'Daypack 22L buying guide' }, 'ecommerce'),
    ).toBe('buying_guide');
  });

  it('finds nothing in the home page or a plain path', () => {
    expect(detectPageType({ url: 'https://northwind.com/' }, 'b2b')).toBeNull();
    expect(detectPageType({ url: '/about-us' }, 'b2b')).toBeNull();
  });

  it("keeps a blog's own pages as they were: only its /category/ archives left a shop's categories", () => {
    expect(detectPageType({ url: '/blog/category/hiking-boots' }, 'ecommerce')).toBe('blog_post');
    expect(detectPageType({ url: '/blog/how-to-clean-boots' }, 'ecommerce')).toBe('guide');
    expect(detectPageType({ url: '/blog/trips/porto' }, 'b2c')).toBe('itinerary');
    expect(detectPageType({ url: '/collections/hiking-boots-size-guide' }, 'b2b')).toBeNull();
  });
});

// The shopping path reads a shop's category pages by the same cases
// (backend/src/lib/catalog/categoryPages.test.js, categorySlug).
describe('category pages, as the shopping path reads them (category-paths.json)', () => {
  it.each(categoryPaths.cases)('$url: a category page when its slug is $slug', ({ url, slug }) => {
    expect(detectPageType({ url }, 'ecommerce') === 'category_page').toBe(slug !== null);
  });
});

describe('detectPageType from the page', () => {
  const jsonLd = (value: unknown) =>
    `<p>Text</p><script type="application/ld+json">${JSON.stringify(value)}</script>`;

  it('reads the schema in the JSON-LD, the most telling type first', () => {
    const product = jsonLd({
      '@context': 'https://schema.org',
      '@graph': [{ '@type': 'FAQPage' }, { '@type': 'Product', name: 'Trail Runner X' }],
    });
    expect(detectPageType({ html: product }, 'ecommerce')).toBe('product_page');
    expect(detectPageType({ html: jsonLd({ '@type': ['BlogPosting'] }) }, 'b2b')).toBe('blog_post');
    expect(detectPageType({ html: jsonLd({ '@type': 'FAQPage' }) }, 'b2c')).toBe('help_faq');
    expect(detectPageType({ html: jsonLd({ '@type': 'MobileApplication' }) }, 'app')).toBe(
      'feature_page',
    );
    expect(
      detectPageType(
        { html: jsonLd({ '@type': 'WebPage', mainEntity: { '@type': 'TouristDestination' } }) },
        'b2c',
      ),
    ).toBe('destination_page');
  });

  it('ignores JSON-LD that isn’t JSON', () => {
    expect(
      detectPageType({ html: '<script type="application/ld+json">{oops</script>' }, 'b2b'),
    ).toBeNull();
  });

  it('prefers the URL to the schema, and the schema to the title', () => {
    const article = jsonLd({ '@type': 'Article' });
    expect(detectPageType({ url: '/pricing', html: article, title: 'How to' }, 'b2b')).toBe(
      'pricing',
    );
    expect(detectPageType({ html: article, title: 'Northwind vs HubSpot' }, 'b2b')).toBe(
      'blog_post',
    );
  });

  it.each([
    ['Northwind vs HubSpot', 'b2b', 'comparison'],
    ['Best HubSpot alternatives', 'b2b', 'alternatives'],
    ['HubSpot vs Salesforce', 'b2b', 'comparison'],
    ['The 10 best CRMs for startups', 'b2b', 'best_of'],
    ['What is single-origin coffee?', 'ecommerce', 'definition'],
    ['Shoe size chart', 'ecommerce', 'sizing_guide'],
    ['Gifts for coffee lovers', 'ecommerce', 'collection_page'],
    ['Shipping FAQ', 'ecommerce', 'policy'],
    ['Frequently asked questions about returns', 'ecommerce', 'policy'],
    ['Espresso machine FAQ', 'ecommerce', 'help_faq'],
    ['CRM for real estate teams', 'b2b', 'solution_page'],
    ['Slack integration', 'b2b', 'integration'],
    ['How to clean CRM data', 'b2b', 'guide'],
    ['Pricing', 'b2b', 'pricing'],
    ['The 7 best ultralight tents', 'ecommerce', 'best_of'],
    ['Returns policy', 'ecommerce', 'policy'],
    ['Tent buying guide', 'ecommerce', 'buying_guide'],
    ['Lisbon with kids: 3-day plan', 'b2c', 'itinerary'],
    ['Cancellation policy', 'b2c', 'help_faq'],
  ] as const)('reads the title "%s" on a %s site as %s', (title, site, type) => {
    expect(detectPageType({ title }, site)).toBe(type);
  });

  it.each([
    'What is the best espresso machine?',
    'What is the difference between a latte and a flat white?',
    'What are the benefits of single-origin coffee?',
    'What is the cost of an espresso machine?',
    'What is new in espresso this year',
  ])('doesn’t read “%s” as a definition', (title) => {
    expect(detectPageType({ title }, 'ecommerce')).toBeNull();
  });

  it.each(['/what-is-the-best-crm', '/what-is-new', '/blog/what-are-the-benefits-of-a-crm'])(
    'doesn’t read the path %s as a definition',
    (url) => {
      expect(detectPageType({ url }, 'b2b')).not.toBe('definition');
    },
  );

  it('reads a shipping FAQ as Start reads its address: a policy page', () => {
    expect(detectPageType({ url: '/pages/shipping-faq' }, 'ecommerce')).toBe('policy');
    expect(detectPageType({ title: 'Shipping FAQ' }, 'ecommerce')).toBe('policy');
  });

  it('finds nothing when no sign tells', () => {
    expect(detectPageType({ title: 'Pipeline forecasting' }, 'b2b')).toBeNull();
    expect(detectPageType({ title: 'Best time to visit Lisbon' }, 'b2c')).toBeNull();
    expect(detectPageType({}, 'b2b')).toBeNull();
  });
});
