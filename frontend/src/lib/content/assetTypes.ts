import { isPageType, type PageType } from './drafts';
import { SITE_PAGE_TYPES, type SiteType } from './pageTypes';

/**
 * What a Content Opportunity's assets are (#857). Opportunities follow the
 * brand's kind of site: an owned asset is one of the Content Editor's page
 * types for it (SITE_PAGE_TYPES), an earned one lives on another site.
 * Opportunities written before keep their old types, read here as the page
 * type they stand for on the brand's site; the rows aren't rewritten.
 */

export const EARNED_ASSET_TYPES = ['third_party_article', 'backlink'] as const;
export type EarnedAssetType = (typeof EARNED_ASSET_TYPES)[number];
export type AssetKind = PageType | EarnedAssetType;

export function isEarnedAssetType(value: string): value is EarnedAssetType {
  return (EARNED_ASSET_TYPES as readonly string[]).includes(value);
}

const ANY_SITE = (type: PageType): Record<SiteType, PageType> => ({
  b2b: type,
  ecommerce: type,
  b2c: type,
  app: type,
});

/** The types opportunities used before they followed the site, on each kind of site. */
const OLDER_TYPES: Record<string, Record<SiteType, PageType>> = {
  pillar_guide: { b2b: 'guide', ecommerce: 'buying_guide', b2c: 'guide', app: 'guide' },
  landing_page: {
    b2b: 'solution_page',
    ecommerce: 'collection_page',
    b2c: 'destination_page',
    app: 'feature_page',
  },
  comparison_page: ANY_SITE('comparison'),
  glossary_page: ANY_SITE('definition'),
  faq_page: { b2b: 'docs_faq', ecommerce: 'help_faq', b2c: 'help_faq', app: 'help_faq' },
  // Also page types of a shop's, where they stay what they are.
  product_page: {
    b2b: 'feature_page',
    ecommerce: 'product_page',
    b2c: 'guide',
    app: 'feature_page',
  },
  category_page: { b2b: 'solution_page', ecommerce: 'category_page', b2c: 'guide', app: 'guide' },
};

/** An asset's type as the brand's site reads it; null when it isn't one. */
export function assetKind(type: string | null | undefined, siteType: SiteType): AssetKind | null {
  if (!type) return null;
  if (isEarnedAssetType(type)) return type;
  if (Object.hasOwn(OLDER_TYPES, type)) return OLDER_TYPES[type][siteType];
  return isPageType(type) ? type : null;
}

/**
 * The page type Start picks for an opportunity: its primary asset's, when
 * the brand's site writes that type; null otherwise (an earned asset, or a
 * type from before the site type changed). A blog post is what opportunities
 * were when nothing more specific fit, so it is null too: what the page or
 * its title shows comes first, and Start falls back to a blog post anyway.
 */
export function opportunityPageType(
  type: string | null | undefined,
  siteType: SiteType,
): PageType | null {
  const kind = assetKind(type, siteType);
  return kind &&
    kind !== 'blog_post' &&
    !isEarnedAssetType(kind) &&
    SITE_PAGE_TYPES[siteType].includes(kind)
    ? kind
    : null;
}
