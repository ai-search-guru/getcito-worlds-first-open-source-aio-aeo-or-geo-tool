/**
 * "What AI cites in your topics" on the Content plan (CE-014, spec v2 §4):
 * one row per page type of the brand's kind of site, with two mixes side by
 * side: the share of AI citations in the brand's tracked answers going to
 * that type of page, and the share of the brand's own cited pages' citations
 * that type holds. A type AI leans on 10 points or more beyond the brand's
 * own mix is a gap: AI cites it, the brand's cited pages don't cover it. The
 * addresses come from content_plan_insights (00221): the own pages and the
 * others cited most; their type is read from the address and title, as the
 * editor detects a page's (pageTypes.ts).
 */

import { SITE_PAGE_TYPES, detectPageType, type SiteType } from './pageTypes';
import type { PageType } from './drafts';
import { pageKey } from './sources';

/** One cited address, as content_plan_insights returns it. */
export interface CitedAddress {
  url: string;
  title: string | null;
  /** One of the brand's own pages. */
  own: boolean;
  citations: number;
}

export interface MixRow {
  pageType: PageType;
  /** The type's share of the citations whose type is known, in whole percent. */
  aiShare: number;
  /** The type's share of the brand's own pages' citations whose type is known. */
  yourShare: number;
  /** The brand's pages of the type AI cited. */
  pages: number;
  /** AI leans on the type 10 points or more beyond the brand's own mix. */
  gap: boolean;
}

export const GAP_POINTS = 10;

/**
 * A path sign written for the brand's own site that misreads others: a
 * Substack or Instagram post (/p/…) or a blog's /products/ section isn't a
 * product or feature page. Another site's address with it is typed by its
 * title alone.
 */
const OWN_SITE_PATH = /\/(products?|p|dp|items?)\/[^/]+/;

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/**
 * The page types AI cites, the most cited first; types neither AI nor the
 * brand cites are left out. The shares are of the addresses whose type can
 * be read: `covered` says what share of all the period's citations
 * (`totalCitations`, the long tail beyond the list included) that is, in
 * whole percent. Forum threads, encyclopedia entries and the tail aren't in it.
 */
export function pageTypeMix(
  cited: CitedAddress[],
  siteType: SiteType,
  totalCitations: number,
): { rows: MixRow[]; covered: number } {
  const types = SITE_PAGE_TYPES[siteType];
  const byType = new Map<PageType, { all: number; own: number; pages: Set<string> }>();
  let total = 0;
  let ownTotal = 0;
  let listed = 0;
  for (const address of cited) {
    if (address.citations <= 0) continue;
    listed += address.citations;
    const url = address.own || !OWN_SITE_PATH.test(pathOf(address.url)) ? address.url : null;
    const type = detectPageType({ url, title: address.title }, siteType);
    if (!type || !types.includes(type)) continue;
    total += address.citations;
    const entry = byType.get(type) ?? { all: 0, own: 0, pages: new Set<string>() };
    entry.all += address.citations;
    if (address.own) {
      entry.own += address.citations;
      ownTotal += address.citations;
      entry.pages.add(pageKey(address.url) ?? address.url);
    }
    byType.set(type, entry);
  }
  const whole = Math.max(totalCitations, listed);
  const covered = whole ? Math.round((total / whole) * 100) : 0;
  if (!total) return { rows: [], covered };
  const rows = types
    .flatMap((pageType) => {
      const entry = byType.get(pageType);
      if (!entry) return [];
      const aiShare = Math.round((entry.all / total) * 100);
      const yourShare = ownTotal ? Math.round((entry.own / ownTotal) * 100) : 0;
      return [
        {
          pageType,
          aiShare,
          yourShare,
          pages: entry.pages.size,
          gap: aiShare - yourShare >= GAP_POINTS,
        },
      ];
    })
    .sort((a, b) => b.aiShare - a.aiShare || b.yourShare - a.yourShare);
  return { rows, covered };
}

/** What AI-referred visitors did on the site, as content_plan_insights reads it. */
export interface PlanResults {
  visits: number;
  keyEvents: number;
  transactions: number;
  revenue: number;
  /** Google Analytics is connected for the brand and has synced, as AI Traffic says. */
  analytics: boolean;
  /** The property reported purchases in the period. */
  purchases: boolean;
}
