import type { ContentOpportunity, OpportunityBasket } from '@/types';

/**
 * What the drawer lists of an opportunity: the pages sent (all of its pages
 * when it was sent whole), the prompts to answer and the fan-out queries kept.
 * The action's export lists the same.
 */
export function opportunityLists(
  opportunity: Pick<ContentOpportunity, 'sourceData'>,
  basket: OpportunityBasket,
  pageUrls?: string[],
) {
  const sd = opportunity.sourceData;
  const allPages = [...(sd.targetPages ?? []), ...(sd.assets ?? []).flatMap((a) => a.pages)].filter(
    (p, i, list) => list.findIndex((q) => q.url === p.url) === i,
  );
  return {
    pages: pageUrls?.length ? allPages.filter((p) => pageUrls.includes(p.url)) : allPages,
    prompts: basket.clusters.flatMap((c) => c.prompts),
    queries: basket.queries.filter((q) => q.included),
  };
}
