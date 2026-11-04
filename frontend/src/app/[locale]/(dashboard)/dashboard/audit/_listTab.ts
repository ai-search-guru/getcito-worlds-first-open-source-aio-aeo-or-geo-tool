/**
 * The Site Audit hub's two lists, each with its own address (?tab=pages,
 * ?tab=opportunities), so a link can open one: the auto-audit e-mail opens
 * Pages, where the run's audits are.
 */
export type ListTab = 'opportunities' | 'pages';

/** The list an address asks for; null for none or another value. */
export function parseListTab(value: string | null): ListTab | null {
  return value === 'pages' || value === 'opportunities' ? value : null;
}

/** The address with `tab` set to the list, the rest of it kept. */
export function withListTab(href: string, tab: ListTab): string {
  const url = new URL(href);
  url.searchParams.set('tab', tab);
  return `${url.pathname}${url.search}${url.hash}`;
}
