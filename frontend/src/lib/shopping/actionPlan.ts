import type { ShoppingProductDetail } from '@/lib/actions/shopping';
import type { CategoryRow } from '@/lib/shopping/categories';

/**
 * The work Product Visibility proposes to get a product or a category on the
 * AI shelf (ECOM-013, spec §3.7), in its four types, each with the line the
 * person reads (en.json shopping.plan.lines, by key and values) and who does
 * it by default: the agent for the page and the content, a person for the
 * listings and the technical fixes.
 */

export type WorkType = 'optimize_page' | 'create_content' | 'get_listed' | 'technical';

export interface PlannedWork {
  type: WorkType;
  who: 'me' | 'agent';
  /** Where the work happens (en.json shopping.plan.where). */
  where: string;
  line: { key: string; values?: Record<string, string | number> };
  /** Whether the agent can take it: technical fixes and sending outreach are a person's. */
  agentCan: boolean;
}

/** The work for one product, from its page: what it misses beside the winner. */
export function productPlan(detail: ShoppingProductDetail): PlannedWork[] {
  const { product, focus, readiness } = detail;
  const words = focus?.missing.slice(0, 3).join(', ');
  const plan: PlannedWork[] = [
    {
      type: 'optimize_page',
      who: 'agent',
      where: 'productMode',
      agentCan: true,
      line: words
        ? { key: 'optimizeWords', values: { words } }
        : { key: 'optimizeQuestion', values: { prompt: focus?.promptText ?? product.title } },
    },
    {
      type: 'create_content',
      who: 'agent',
      where: 'newPage',
      agentCan: true,
      line: focus?.winner
        ? { key: 'compare', values: { product: product.title, winner: focus.winner.title } }
        : { key: 'guide', values: { product: product.title } },
    },
    {
      type: 'get_listed',
      who: 'me',
      where: 'outreach',
      agentCan: true,
      line: { key: 'listed', values: { product: product.title } },
    },
  ];
  const technical = readiness.missing.filter((check) => check === 'gtin' || check === 'image');
  plan.push({
    type: 'technical',
    who: 'me',
    where: 'feed',
    agentCan: false,
    line: technical.includes('gtin') ? { key: 'gtinSchema' } : { key: 'schema' },
  });
  return plan;
}

/** The work for one category, from its row. */
export function categoryPlan(row: CategoryRow): PlannedWork[] {
  const category = row.leaf.toLowerCase();
  return [
    {
      type: 'optimize_page',
      who: 'agent',
      where: 'categoryMode',
      agentCan: true,
      line: { key: 'categoryPage' },
    },
    {
      type: 'create_content',
      who: 'agent',
      where: 'newPost',
      agentCan: true,
      line: { key: 'buyingGuide', values: { category } },
    },
    {
      type: 'get_listed',
      who: 'me',
      where: 'outreach',
      agentCan: true,
      line: { key: 'bestLists', values: { category } },
    },
    {
      type: 'technical',
      who: 'me',
      where: 'feed',
      agentCan: false,
      line: { key: 'feedFields', values: { count: row.products } },
    },
  ];
}
