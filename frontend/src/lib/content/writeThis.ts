import type { ContentOpportunity } from '@/types';
import { opportunityPageType } from './assetTypes';
import { refreshYears } from './currentYear';
import type { DraftMethod, PageType } from './drafts';
import { opportunityStart } from './opportunityStart';
import { pagePath } from './overlap';
import { detectPageType, type SiteType } from './pageTypes';
import { startPageType } from './start';

/** The draft Write this starts for an opportunity, as Start would open it. */
export interface WriteThisStart {
  method: DraftMethod;
  title: string;
  pageType: PageType;
  /** The page it works on, for an opportunity on an existing page; null for a new page. */
  page: { url: string; title: string | null } | null;
}

/**
 * Write this (customer priorities item 9): the draft New content's Start
 * opens for an opportunity, without its steps. A new page takes the brief's
 * suggested title, else the opportunity's, and the page type the
 * opportunity names, else the one its title reads as. An opportunity on an
 * existing page (optimize, expand, refresh, consolidate or defend) works on
 * that page: its title, and the type its address or title shows, else the
 * opportunity's.
 */
export function writeThisStart(
  opportunity: Pick<ContentOpportunity, 'id' | 'title' | 'decision' | 'sourceData' | 'brief'>,
  siteType: SiteType,
): WriteThisStart {
  const suggested = opportunity.brief?.suggestedTitle?.trim();
  const title = suggested || refreshYears(opportunity.title);
  const pageType =
    opportunityPageType(opportunity.sourceData?.assets?.[0]?.type, siteType) ??
    startPageType({ title }, siteType).pageType;
  const { page } = opportunityStart(opportunity);
  if (!page) return { method: 'create', title, pageType, page: null };
  return {
    method: 'optimize',
    title: page.title || pagePath(page.url),
    pageType: detectPageType({ url: page.url, title: page.title }, siteType) ?? pageType,
    page,
  };
}

/** How many prompts the brief is built from, when the opportunity says. */
export function writeThisPrompts(
  opportunity: Pick<ContentOpportunity, 'clusterId' | 'sourceData'>,
): number | null {
  if (opportunity.sourceData?.fromAction) return null;
  if (!opportunity.clusterId) return 1;
  return opportunity.sourceData?.prompts?.length || null;
}
