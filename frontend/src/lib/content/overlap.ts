import type { ContentOverlap, OverlapPage } from './drafts';
import { pageKey } from './sources';

/**
 * Start's Overview (Content Editor CE-015, spec §5): the brand's own pages AI
 * already cites for a new page's prompts, shown as information. More of the
 * brand's pages cited for the same prompts is no loss (AI answers aren't a
 * ranking), so Start recommends nothing: it keeps the action the person
 * picked and offers the other one.
 */

/** What Open editor does: write a new page, or optimize an existing one. */
export type OverlapChoice = { kind: 'create' } | { kind: 'optimize'; page: OverlapPage };

export type OverlapOptionKey = 'optimizeGiven' | 'createNew' | 'optimizeInstead';

export interface OverlapOption {
  key: OverlapOptionKey;
  choice: OverlapChoice;
}

/**
 * The choices Start offers: the page the Content plan named, when there is
 * one; a new page; and the page cited for most of these prompts, when it is
 * another. None when a new page is the only one.
 */
export function overlapOptions(
  overlap: ContentOverlap,
  given: OverlapPage | null,
): OverlapOption[] {
  const top = overlap.totalPrompts > 0 ? overlap.pages[0] : undefined;
  const options: OverlapOption[] = [];
  if (given) options.push({ key: 'optimizeGiven', choice: { kind: 'optimize', page: given } });
  options.push({ key: 'createNew', choice: { kind: 'create' } });
  if (top && !(given && samePage(top.url, given.url))) {
    options.push({ key: 'optimizeInstead', choice: { kind: 'optimize', page: top } });
  }
  return options.length > 1 ? options : [];
}

/** Two addresses of one page (pageKey), or the same text when either isn't an address. */
export function samePage(a: string, b: string): boolean {
  const keyA = pageKey(a);
  const keyB = pageKey(b);
  return keyA !== null && keyB !== null ? keyA === keyB : a === b;
}

/** A page as Start names it: its path on the site, or its host for the home page. */
export function pagePath(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return path || parsed.host;
  } catch {
    return url;
  }
}
