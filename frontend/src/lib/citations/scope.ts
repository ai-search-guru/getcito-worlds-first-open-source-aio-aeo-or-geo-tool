import type { SourceCategory } from './classify';

/** Which sources the Citations URL list covers. */
export type CitationsSourceScope = 'all' | 'own' | 'competitors' | 'third_party';

/**
 * Whether a source of this category is in the scope: the Domains and URLs
 * tabs' rows, and the Domains tab's count, so the count is the list's.
 */
export function inSourceScope(
  category: SourceCategory,
  scope: CitationsSourceScope | undefined,
): boolean {
  switch (scope) {
    case 'own':
      return category === 'you';
    case 'competitors':
      return category === 'competitor';
    case 'third_party':
      return category !== 'you' && category !== 'competitor';
    case 'all':
    default:
      return true;
  }
}

/** The classified domain rows the Domains tab is built from. */
interface ClassifiedDomain {
  domain: string;
  category: SourceCategory;
}

/**
 * A source scope, expressed as domains `citations_urls` can filter on (#745).
 *
 * The URL list is capped at the top 2,000 by citation count, so a scope
 * applied to the rows that arrived reports a slice of the global top N as
 * though it were the whole scope — 125 competitor URLs on a brand that has
 * 2,794. Pushing the scope into the query means the cap applies inside it.
 *
 * Returns an include list for the two narrow scopes and an *exclude* list for
 * Third-party, which says the same thing in far less space: on the largest
 * brand a window holds 17,532 cited domains, of which fourteen are the
 * brand's own or a competitor's. Naming the fourteen beats sending 17,518.
 *
 * `rows` is the already-classified domain list, so what counts as a brand or
 * competitor domain keeps exactly one definition — `classifyDomain`, applied
 * once, upstream of both tabs. Nothing here re-decides it.
 */
export function scopeDomainArgs(
  scope: CitationsSourceScope | undefined,
  rows: ClassifiedDomain[],
): { p_domains?: string[]; p_exclude_domains?: string[] } {
  if (!scope || scope === 'all') return {};

  const own = rows.filter((r) => r.category === 'you').map((r) => r.domain);
  const competitors = rows.filter((r) => r.category === 'competitor').map((r) => r.domain);

  // An empty include list is meaningful — the scope genuinely covers nothing,
  // and the query must return nothing rather than everything.
  if (scope === 'own') return { p_domains: own };
  if (scope === 'competitors') return { p_domains: competitors };

  const excluded = [...own, ...competitors];
  // An empty exclude list is the opposite case: Third-party is then the whole
  // set, so the parameter is left off rather than sent as an empty array.
  return excluded.length > 0 ? { p_exclude_domains: excluded } : {};
}
