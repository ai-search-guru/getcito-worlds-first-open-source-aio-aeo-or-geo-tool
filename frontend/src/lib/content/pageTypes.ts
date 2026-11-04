import type { Industry } from '@/types';
import type { PageType } from './drafts';
import { jsonLdScripts } from './htmlAllowlist';

/**
 * Page types by kind of site, and a page's type found from the page itself
 * (Content Editor CE-023, spec §4). A B2B SaaS site writes feature,
 * comparison and pricing pages; a shop, product and category pages; a B2C
 * site, destination and help pages; a mobile app's site (00456), feature,
 * pricing and help pages. Every kind also writes the formats
 * www.getcito.com offers that fit it: how-to guides, comparisons,
 * definitions, best-of lists and FAQs; alternatives, collections and sizing
 * guides where they apply. The brand's site type is set in its settings
 * (brands.site_type, 00205), guessed until someone does.
 */

export const SITE_TYPES = ['b2b', 'ecommerce', 'b2c', 'app'] as const;
export type SiteType = (typeof SITE_TYPES)[number];

export function isSiteType(value: unknown): value is SiteType {
  return typeof value === 'string' && (SITE_TYPES as readonly string[]).includes(value);
}

/** The page types each kind of site writes, in the order the editor offers them. */
export const SITE_PAGE_TYPES: Record<SiteType, readonly PageType[]> = {
  b2b: [
    'feature_page',
    'solution_page',
    'comparison',
    'alternatives',
    'best_of',
    'guide',
    'definition',
    'integration',
    'pricing',
    'docs_faq',
    'blog_post',
  ],
  ecommerce: [
    'product_page',
    'category_page',
    'collection_page',
    'buying_guide',
    'best_of',
    'comparison',
    'alternatives',
    'guide',
    'definition',
    'sizing_guide',
    'help_faq',
    'policy',
    'blog_post',
  ],
  b2c: [
    'destination_page',
    'itinerary',
    'guide',
    'best_of',
    'comparison',
    'definition',
    'help_faq',
    'blog_post',
  ],
  app: [
    'feature_page',
    'comparison',
    'alternatives',
    'best_of',
    'guide',
    'definition',
    'pricing',
    'help_faq',
    'blog_post',
  ],
};

/**
 * Industries that point away from B2B. B2C's page types are a travel site's
 * (destinations, itineraries), so only travel guesses B2C; shops and makers
 * of things sold online guess e-commerce; the rest (software, finance,
 * education…) write feature, pricing and FAQ pages, and guess B2B.
 */
const INDUSTRY_SITE_TYPES: Partial<Record<Industry, SiteType>> = {
  'E-commerce & Retail': 'ecommerce',
  'Fashion & Apparel': 'ecommerce',
  'Consumer Goods': 'ecommerce',
  'Food & Beverage': 'ecommerce',
  Automotive: 'ecommerce',
  'Travel & Hospitality': 'b2c',
};

interface BrandSite {
  siteType?: string | null;
  industry?: string | null;
  shoppingModeEnabled?: boolean;
}

/**
 * A brand's site type before anyone picks one: a shop when Shopping mode is
 * on, else by industry, and B2B when nothing says otherwise.
 */
export function guessSiteType(brand: BrandSite): SiteType {
  if (brand.shoppingModeEnabled) return 'ecommerce';
  return INDUSTRY_SITE_TYPES[brand.industry as Industry] ?? 'b2b';
}

/** The site type the brand chose, or the guess. */
export function siteTypeOf(brand: BrandSite): SiteType {
  return isSiteType(brand.siteType) ? brand.siteType : guessSiteType(brand);
}

/** What a sign means on each kind of site; a site it leaves out skips the sign. */
type BySite = Partial<Record<SiteType, PageType>>;

const ANY_SITE = (type: PageType): BySite => ({ b2b: type, ecommerce: type, b2c: type, app: type });
const COMPARISON = ANY_SITE('comparison');
const BEST_OF = ANY_SITE('best_of');
const DEFINITION = ANY_SITE('definition');
/** A B2C site has no alternatives page: an "X alternatives" page compares. */
const ALTERNATIVES: BySite = {
  b2b: 'alternatives',
  ecommerce: 'alternatives',
  b2c: 'comparison',
  app: 'alternatives',
};
const FAQ: BySite = { b2b: 'docs_faq', ecommerce: 'help_faq', b2c: 'help_faq', app: 'help_faq' };
const POLICY: BySite = { b2b: 'docs_faq', ecommerce: 'policy', b2c: 'help_faq', app: 'help_faq' };
const GUIDE = ANY_SITE('guide');
/** How to choose: a shop's buying guide, elsewhere a how-to guide. */
const BUYING_GUIDE: BySite = {
  b2b: 'guide',
  ecommerce: 'buying_guide',
  b2c: 'guide',
  app: 'guide',
};
const SIZING: BySite = { ecommerce: 'sizing_guide' };
const COLLECTION: BySite = { ecommerce: 'collection_page' };

/**
 * "What is …" asks for a definition, but not "what is the best …", "what is
 * the difference between …", "what are the benefits of …" or "what is new":
 * the words after it that ask for something else.
 */
const NOT_DEFINED =
  'best|differences?|costs?|prices?|benefits?|advantages?|disadvantages?|pros|cons|new|latest';

/** The words a shop names its category pages with: /collections/, /c/, /product-category/, /kategori/… */
const CATEGORY_WORDS =
  'collections?|categor(y|ies)|product-categor(y|ies)|urun-kategori(si)?|produkt-kategorie|categorie-produit|categoria-(producto|prodotto|produto)|kategori(ler)?|kategorie(n)?|categorie(s)?|categorias?|koleksiyon(lar)?|kollektion(en)?|c|shop|catalog|departments?';
/** A blog's own section at the start of a path: /blog/…, /en/news/…, Shopify's /blogs/…. */
const BLOG_SECTION =
  '(\\/[a-z]{2}(-[a-z]{2})?)?\\/(blogs?|news|articles?|posts?|insights|stories|magazine|journal)\\/';

/**
 * URL paths, the most specific first: /blog/hubspot-vs-salesforce is a
 * comparison before it is a blog post. Matched on the lowercased path with
 * no trailing slash or file extension. A shop's category pages are the
 * shopping path's too (backend/src/lib/catalog/categoryPages.js): both
 * test __fixtures__/category-paths.json.
 */
const PATH_SIGNS: [RegExp, BySite][] = [
  [/\/(pricing|plans|plans-and-pricing)(\/|$)/, { b2b: 'pricing', app: 'pricing' }],
  // A size guide, also at the end of a slug: /collections/hiking-boots-size-guide.
  [/(^|[/-])(size-?(guides?|charts?)|sizing-guides?|fit-guides?)([/-]|$)|\/sizing([/-]|$)/, SIZING],
  [/(^|[/-])alternatives?([/-]|$)/, ALTERNATIVES],
  [/(^|[/-])(vs|versus)([/-]|$)|\/(compare|comparisons?)(\/|$)/, COMPARISON],
  [
    new RegExp(
      `\\/(glossary|definitions?|dictionary)([/-]|$)|\\/what-(is|are)(?!-(the-)?(${NOT_DEFINED})([/-]|$))([/-]|$)`,
    ),
    DEFINITION,
  ],
  [
    /\/(shipping|delivery|returns?|refunds?|exchanges?|warranty|polic(y|ies)|terms|privacy|legal)([/-]|$)/,
    POLICY,
  ],
  [/\/(docs|documentation|help|help-center|support|faqs?|knowledge-base|kb)(\/|$)/, FAQ],
  [/\/(integrations?|apps|marketplace|connectors?)\//, { b2b: 'integration' }],
  [/\/(buying-guides?|buyers?-guides?|how-to-choose)([/-]|$)/, BUYING_GUIDE],
  [/\/(the-)?(best(?!-(practices?|time|ways?|sellers?)([/-]|$))|top-?\d+)([/-]|$)/, BEST_OF],
  [/\/(features?|capabilities|platform)(\/|$)/, { b2b: 'feature_page', app: 'feature_page' }],
  [
    /\/(solutions?|industries|industry|use-cases?|teams)(\/|$)|\/for-[a-z]/,
    { b2b: 'solution_page' },
  ],
  [/\/(products?|p|dp|items?)\/[^/]+/, { b2b: 'feature_page', ecommerce: 'product_page' }],
  // A themed collection (gifts, bundles, a sale, "for …") before a shop's
  // categories, on whole words of the slug: /collections/kitchen,
  // /collections/limited-edition and /collections/wholesale-boxes are categories.
  [
    /\/collections?\/(?:[^/]*-)?(gifts?|bundles?|kits?|sets?|best-?sellers?|new-arrivals?|picks|edit|sale|clearance|outlet|deals?|offers?)(?:-|\/|$)|\/collections?\/(?:[^/]*-)?for-[a-z]/,
    COLLECTION,
  ],
  // A shop's categories, WooCommerce's /product-category/ and the same words
  // in Turkish, German, French and Spanish among them; never in a blog's own
  // section (/blog/category/… is WordPress's archive of the blog's posts).
  [
    new RegExp(`^(?!${BLOG_SECTION}).*\\/(${CATEGORY_WORDS})(\\/|$)`),
    { ecommerce: 'category_page' },
  ],
  [/\/(itinerar(y|ies)|trips?|tours?)(\/|$)|\/\d+-days?-/, { b2c: 'itinerary' }],
  [
    /\/(destinations?|places|cities|regions|countries|locations?|hotels?|resorts?)(\/|$)/,
    { b2c: 'destination_page' },
  ],
  [/\/services?(\/|$)/, { b2b: 'solution_page', b2c: 'destination_page' }],
  [/\/(guides?|how-to|learn|academy|resources|tutorials?)([/-]|$)/, GUIDE],
  [/\/(blog|news|articles?|posts?|insights|stories|magazine|journal)(\/|$)/, ANY_SITE('blog_post')],
];

/** Schema.org types in the page's JSON-LD, the most telling first. */
const SCHEMA_SIGNS: [readonly string[], BySite][] = [
  [
    ['Product', 'ProductGroup', 'IndividualProduct'],
    { b2b: 'feature_page', ecommerce: 'product_page' },
  ],
  [
    ['SoftwareApplication', 'WebApplication', 'MobileApplication'],
    { b2b: 'feature_page', app: 'feature_page' },
  ],
  [['TouristTrip'], { b2c: 'itinerary' }],
  [
    [
      'TouristDestination',
      'TouristAttraction',
      'City',
      'Place',
      'LodgingBusiness',
      'Hotel',
      'Resort',
    ],
    { b2c: 'destination_page' },
  ],
  [['Service'], { b2b: 'solution_page', b2c: 'destination_page' }],
  [['CollectionPage', 'OfferCatalog'], { ecommerce: 'category_page' }],
  [['DefinedTerm', 'DefinedTermSet'], DEFINITION],
  [['HowTo'], GUIDE],
  [['BlogPosting', 'Article', 'NewsArticle', 'TechArticle'], ANY_SITE('blog_post')],
  [['FAQPage'], FAQ],
  [['ItemList'], BEST_OF],
];

/** Words in the title, for a page with no telling URL or schema. */
const TITLE_SIGNS: [RegExp, BySite][] = [
  [/\bsize (guide|chart)s?\b|\bsizing\b|\bfit guide\b/i, SIZING],
  [/\balternatives?\b/i, ALTERNATIVES],
  [/\b(vs\.?|versus)\s/i, COMPARISON],
  [/\bpricing\b/i, { b2b: 'pricing', app: 'pricing' }],
  [/\bpolic(y|ies)\b/i, POLICY],
  // "Shipping FAQ" is a policy page, as /pages/shipping-faq is: the policy
  // words before FAQ, in the paths' order.
  [
    /^(?=.*\b(faqs?|frequently asked)\b).*\b(shipping|delivery|returns?|refunds?|exchanges?|warranty|terms|privacy|legal)\b/i,
    POLICY,
  ],
  [/\bfaqs?\b|\bfrequently asked\b/i, FAQ],
  [/\bbuying guide\b|\bhow to choose\b/i, BUYING_GUIDE],
  [/^(the\s+)?(\d+\s+)?best\b(?!\s+(time|way|practices?)\b)|\btop\s+\d+\b/i, BEST_OF],
  // "What is single-origin coffee?", not "What is the best …" (NOT_DEFINED).
  [
    new RegExp(
      `^what\\s+(is|are)\\s+(?!(the\\s+)?(${NOT_DEFINED})\\b)|\\b(definition|meaning) of\\b|\\bglossary\\b`,
      'i',
    ),
    DEFINITION,
  ],
  [/\bgifts? for\b|\bcollection\b/i, COLLECTION],
  [/\b\d+[-\s]days?\b|\bitinerar(y|ies)\b/i, { b2c: 'itinerary' }],
  [/\bintegrations?\b|\bintegrates? with\b/i, { b2b: 'integration' }],
  [
    /\bfor\s+(\S+\s+){0,3}(teams|companies|businesses|agencies|startups|enterprises?)\b/i,
    { b2b: 'solution_page' },
  ],
  [/\bhow to\b|\bguide\b|\btutorial\b|\bstep[-\s]by[-\s]step\b/i, GUIDE],
];

export interface PageSigns {
  /** The page's address, or its path on the brand's site. */
  url?: string | null;
  /** Its title or first heading. */
  title?: string | null;
  /** Its HTML, read for JSON-LD. */
  html?: string | null;
}

/**
 * A page's type on this kind of site, from its URL first, then the schema in
 * its JSON-LD, then its title; null when nothing tells. Only types the site
 * writes come back: a shop's /vs/ page is a best-of, a SaaS site's a
 * comparison.
 */
export function detectPageType(page: PageSigns, siteType: SiteType): PageType | null {
  const path = page.url ? urlPath(page.url) : null;
  const types = page.html ? schemaTypes(page.html) : null;
  const title = page.title?.trim();
  return (
    (path ? firstSign(PATH_SIGNS, siteType, (pattern) => pattern.test(path)) : null) ??
    (types?.size
      ? firstSign(SCHEMA_SIGNS, siteType, (names) => names.some((name) => types.has(name)))
      : null) ??
    (title ? firstSign(TITLE_SIGNS, siteType, (pattern) => pattern.test(title)) : null)
  );
}

function firstSign<T>(
  signs: [T, BySite][],
  siteType: SiteType,
  matches: (sign: T) => boolean,
): PageType | null {
  for (const [sign, bySite] of signs) {
    const type = bySite[siteType];
    if (type && matches(sign)) return type;
  }
  return null;
}

/** "/Blog/Post.html?x=1" → "/blog/post"; null when it isn't a URL or path. */
function urlPath(url: string): string | null {
  try {
    const path = new URL(url.trim(), 'https://site.invalid').pathname
      .toLowerCase()
      .replace(/\.(html?|php|aspx?)$/, '')
      .replace(/\/+$/, '');
    return path || '/';
  } catch {
    return null;
  }
}

/** The @types in a page's JSON-LD, including @graph items and main entities. */
function schemaTypes(html: string): Set<string> {
  const types = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const type = item['@type'];
    for (const name of Array.isArray(type) ? type : [type]) {
      if (typeof name === 'string') types.add(name.replace(/^https?:\/\/schema\.org\//, ''));
    }
    visit(item['@graph']);
    visit(item.mainEntity);
  };
  for (const { text } of jsonLdScripts(html)) {
    try {
      visit(JSON.parse(text));
    } catch {
      // Not JSON: nothing to read.
    }
  }
  return types;
}
