import { qualityPhase } from './contentQuality.js';

/**
 * The Content Editor's page types (frontend/src/lib/content/drafts.ts, PAGE_TYPES)
 * as the person picks them (frontend/messages/en.json, contentEditor.pageTypes),
 * each with the format it asks for, so the writer, the brief and the Content
 * Agent write the page the person chose rather than read a key such as
 * "solution_page".
 */

export const PAGE_TYPE_FORMATS = {
  feature_page: 'Feature page: one capability, what it does and who it is for',
  solution_page: 'Use case page: how the product serves one use case, industry or team',
  comparison: 'Comparison: the options side by side, with a verdict',
  integration: 'Integration: what connecting one other tool does, and how to set it up',
  pricing: 'Pricing: the plans, their prices and what each includes',
  guide: 'How-to guide: numbered steps to get one thing done',
  blog_post: 'Blog post',
  docs_faq: 'Docs / FAQ: direct answers to questions about the product',
  product_page: 'Product page: one product, its specs, its uses and reasons to buy it',
  category_page: 'Category page: a range of products and how to choose among them',
  buying_guide: 'Buying guide: how to choose, the criteria and the picks',
  best_of: 'Best-of list: ranked picks, with the reason for each',
  policy: 'Policy: shipping, returns or terms, stated plainly',
  destination_page: 'Destination page: a place, what to do there and when to go',
  itinerary: 'Itinerary: a day-by-day plan',
  help_faq: 'Help & FAQ: direct answers to customer questions',
  definition:
    'Definition page: the term defined in the first sentence, then explained with examples',
  alternatives: 'Alternatives page: the options to one product, compared',
  collection_page: 'Collection page: a themed selection of products',
  sizing_guide: 'Sizing guide: how to find the right size, with a size chart',
};

/** A draft's page type as the model reads it: its name and format, or "not set". */
export function pageTypeFormat(pageType) {
  if (!pageType) return 'not set';
  return Object.hasOwn(PAGE_TYPE_FORMATS, pageType) ? PAGE_TYPE_FORMATS[pageType] : pageType;
}

/**
 * What a page type's sections lean to (the brief rules, 2026: format hints),
 * for the brief's v2 prompt (contentBrief.js, CONTENT_BRIEF_RULES). A type
 * not here leans to paragraphs.
 */
export const PAGE_TYPE_SECTION_FORMATS = {
  comparison: 'a table comparing the options, with a verdict',
  alternatives: 'a table comparing the options',
  pricing: 'a table of the plans',
  guide: 'numbered steps',
  itinerary: 'a day-by-day list',
  best_of: 'a ranked list, with the reason for each',
  buying_guide: 'a list of the criteria, and a table of the picks',
  sizing_guide: 'a size chart table',
  docs_faq: 'questions answered directly, as an FAQ',
  help_faq: 'questions answered directly, as an FAQ',
  product_page: 'a specs table',
  category_page: 'a list of the range',
  collection_page: 'a list of the picks',
  definition: 'the term defined in its first sentence, then paragraphs',
};

/**
 * The page types whose picks, prices or terms date (brief rules 2026,
 * freshness): each shows an "Updated" line; a ranked or compared one has the
 * year in its title too ("Best espresso machines in 2026").
 */
export const PAGE_TYPE_FRESHNESS = {
  best_of: { updatedLine: true, yearInTitle: true },
  buying_guide: { updatedLine: true, yearInTitle: true },
  alternatives: { updatedLine: true, yearInTitle: true },
  comparison: { updatedLine: true, yearInTitle: true },
  pricing: { updatedLine: true, yearInTitle: false },
  policy: { updatedLine: true, yearInTitle: false },
};

/** Kinds of site (brands.site_type, 00205), as frontend/src/lib/content/pageTypes.ts has them. */
export const SITE_TYPES = ['b2b', 'ecommerce', 'b2c', 'app'];

/** Each kind of site as Brand settings names it (frontend/messages/en.json, siteTypes). */
export const SITE_TYPE_NAMES = {
  b2b: 'B2B SaaS',
  ecommerce: 'E-commerce',
  b2c: 'B2C',
  app: 'Mobile app',
};

/** The page types each kind of site writes, in the order the editor offers them. */
export const SITE_PAGE_TYPES = {
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

/** Industries that point away from B2B, as the editor guesses them. */
const INDUSTRY_SITE_TYPES = {
  'E-commerce & Retail': 'ecommerce',
  'Fashion & Apparel': 'ecommerce',
  'Consumer Goods': 'ecommerce',
  'Food & Beverage': 'ecommerce',
  Automotive: 'ecommerce',
  'Travel & Hospitality': 'b2c',
};

/**
 * The brand's kind of site: the one picked in Brand settings, else the
 * editor's guess (a shop when Shopping mode is on, else by industry, and B2B
 * when nothing says otherwise).
 *
 * @param {{ siteType?: string|null, industry?: string|null, shoppingModeEnabled?: boolean|null }} brand
 */
export function siteTypeOf({ siteType, industry, shoppingModeEnabled } = {}) {
  if (SITE_TYPES.includes(siteType)) return siteType;
  if (shoppingModeEnabled) return 'ecommerce';
  return Object.hasOwn(INDUSTRY_SITE_TYPES, industry ?? '') ? INDUSTRY_SITE_TYPES[industry] : 'b2b';
}

/** What each kind of site is, for a model prompt: the proof a page asks for follows it. */
export const SITE_TYPE_MEANINGS = {
  b2b: 'software or services sold to businesses',
  ecommerce: 'an online shop selling products',
  b2c: 'a service for consumers',
  app: 'a mobile app people install from an app store',
};

/**
 * The brand's kind of site as a prompt's line (Quality CE-056, the spec's
 * business type), with a line break, once Quality's phase 2 is live; else
 * nothing.
 *
 * @param {{ site_type?: string|null, industry?: string|null, shopping_mode_enabled?: boolean|null }|null} brand
 */
export function siteTypeLine(brand) {
  if (qualityPhase() < 2) return '';
  const type = siteTypeOf({
    siteType: brand?.site_type,
    industry: brand?.industry,
    shoppingModeEnabled: brand?.shopping_mode_enabled,
  });
  return `Site type: ${SITE_TYPE_NAMES[type]} (${SITE_TYPE_MEANINGS[type]})\n`;
}

/** The page types this kind of site writes, one a line with its format, for a model prompt. */
export function sitePageTypeLines(siteType) {
  return SITE_PAGE_TYPES[siteType].map((type) => `- ${type}: ${pageTypeFormat(type)}`).join('\n');
}
