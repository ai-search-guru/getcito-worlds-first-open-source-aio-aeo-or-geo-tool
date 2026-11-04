/** /dashboard/brands/<id> and anything under it; "new" is the new-brand page. */
const BRAND_PAGE = /^\/dashboard\/brands\/(?!new(?:\/|$))[^/]+(\/.*)?$/;

/**
 * The same brand page for another brand: switching brands on
 * /dashboard/brands/A/settings opens /dashboard/brands/B/settings. Null off a
 * brand's pages, where switching brands stays on the page.
 */
export function brandPagePath(pathname: string, brandId: string): string | null {
  const match = BRAND_PAGE.exec(pathname);
  return match ? `/dashboard/brands/${brandId}${match[1] ?? ''}` : null;
}
