/**
 * The Pages section's work lists (AT-006, spec §3.5), as 00178 sorts pages
 * into them (and 00186 Broken AI links, AT-012), for the card's labels and
 * the export's Status column.
 */

import type { TrafficPageRow } from '@/lib/actions/traffic';

/** Cited at least this often with no AI visit: answers show the page, nobody clicks. */
export const CITED_NOT_CLICKED_MIN = 20;

export type TrafficPageStatus =
  | 'noAiTraffic'
  | 'citedNotClicked'
  | 'trafficNoPrompt'
  | 'brokenAiLinks';

/** The lists a page is on, in the tabs' order; none for a page doing fine. */
export function pageStatuses(
  row: Pick<TrafficPageRow, 'aiVisits' | 'citations' | 'sessions' | 'inSitemap' | 'broken'>,
): TrafficPageStatus[] {
  const statuses: TrafficPageStatus[] = [];
  if (row.aiVisits === 0 && (row.sessions > 0 || row.inSitemap)) statuses.push('noAiTraffic');
  if (row.aiVisits === 0 && row.citations >= CITED_NOT_CLICKED_MIN)
    statuses.push('citedNotClicked');
  // A missing page needs a redirect, not prompts.
  if (row.aiVisits > 0 && row.citations === 0 && !row.broken) statuses.push('trafficNoPrompt');
  if (row.broken) statuses.push('brokenAiLinks');
  return statuses;
}

/**
 * Why a page gets no AI visit, as the old "Pages AI engines aren't sending
 * traffic to" card said it: answers cite it anyway, a tracked prompt points
 * at it and no answer cites it, or nothing you track points at it.
 */
export type CitationState = 'cited' | 'targeted_not_cited' | 'not_targeted';

export function citationState(
  row: Pick<TrafficPageRow, 'citations' | 'targetingPrompts'>,
): CitationState {
  if (row.citations > 0) return 'cited';
  if (row.targetingPrompts > 0) return 'targeted_not_cited';
  return 'not_targeted';
}

/**
 * A listed page's full URL on the brand's domain, for auditing it. The
 * domain may be stored with its scheme or a trailing slash.
 */
export function pageUrl(domain: string, page: string): string {
  const host = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  return `https://${host}${page}`;
}
