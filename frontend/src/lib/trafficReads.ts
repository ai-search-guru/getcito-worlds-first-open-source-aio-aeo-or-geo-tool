import type * as traffic from '@/lib/actions/traffic';
import type * as aiBots from '@/lib/actions/aiBots';

/**
 * The AI Traffic page's reads, from the browser, through one route
 * (/api/traffic/read) rather than as server actions.
 *
 * Next runs a page's server actions one at a time: a range change asked a
 * dozen sections for data, and each read waited for the one before it, so
 * the page took the sum of every read. Fetches to a route run side by side,
 * so it takes the slowest one. Each function keeps its server action's name
 * and arguments; the route calls that action with the member's session.
 */

export const TRAFFIC_READS = [
  'sources',
  'summary',
  'trend',
  'logs',
  'pages',
  'conversions',
  'googleTotals',
  'googleTrend',
  'googlePages',
  'untrackedQueries',
  'bots',
  'botConnections',
] as const;
export type TrafficRead = (typeof TRAFFIC_READS)[number];

async function read<T>(name: TrafficRead, args: unknown[]): Promise<T> {
  const res = await fetch('/api/traffic/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ read: name, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(body.error || `Failed to load ${name}`);
  return body.data as T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Read = (...args: any[]) => Promise<unknown>;
const via =
  <F extends Read>(name: TrafficRead) =>
  (...args: Parameters<F>) =>
    read<Awaited<ReturnType<F>>>(name, args);

export const getTrafficSources = via<typeof traffic.getTrafficSources>('sources');
export const getTrafficSummary = via<typeof traffic.getTrafficSummary>('summary');
export const getTrafficTrend = via<typeof traffic.getTrafficTrend>('trend');
export const getTrafficLogs = via<typeof traffic.getTrafficLogs>('logs');
const readTrafficPages = via<typeof traffic.getTrafficPages>('pages');
export const getTrafficConversions = via<typeof traffic.getTrafficConversions>('conversions');
export const getTrafficGoogleTotals = via<typeof traffic.getTrafficGoogleTotals>('googleTotals');
export const getTrafficGoogleTrend = via<typeof traffic.getTrafficGoogleTrend>('googleTrend');
export const getTrafficGooglePages = via<typeof traffic.getTrafficGooglePages>('googlePages');
const readUntrackedGoogleQueries =
  via<typeof traffic.getUntrackedGoogleQueries>('untrackedQueries');
export const getTrafficBots = via<typeof traffic.getTrafficBots>('bots');
export const getBotConnections = via<typeof aiBots.getBotConnections>('botConnections');

/**
 * A count another section's read already carries is taken from it. The
 * Pages card's read returns every tab's count, and the Google section's list
 * its total, so the summary line's Cited, not clicked and untracked-queries
 * counts don't run those statements a second time on each range change.
 * The latest such read per brand and range is kept for a few seconds; a
 * count asks a turn later, so a section mounting in the same render has
 * sent its read first. Without one (the section isn't on the page), the
 * count reads on its own.
 */
const SHARE_MS = 5_000;
const shared = new Map<string, { at: number; promise: Promise<unknown> }>();

function shareKey(read: string, brandId: string, window: traffic.TrafficDateWindow | undefined) {
  return `${read}|${brandId}|${window?.dateFrom ?? ''}|${window?.dateTo ?? ''}`;
}

function keep<T>(key: string, promise: Promise<T>): Promise<T> {
  shared.set(key, { at: Date.now(), promise });
  // A failed read is no one's to share.
  promise.catch(() => shared.delete(key));
  return promise;
}

async function sharedRead<T>(key: string): Promise<T | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const hit = shared.get(key);
  if (!hit || Date.now() - hit.at > SHARE_MS) return undefined;
  return hit.promise as Promise<T>;
}

export const getTrafficPages: typeof readTrafficPages = (brandId, window, options) =>
  keep(shareKey('pages', brandId, window), readTrafficPages(brandId, window, options));

export const getUntrackedGoogleQueries: typeof readUntrackedGoogleQueries = (
  brandId,
  window,
  options,
) => {
  const read = readUntrackedGoogleQueries(brandId, window, options);
  // A count-only read (limit 0) has no rows to share.
  return options?.limit === 0 ? read : keep(shareKey('untracked', brandId, window), read);
};

/** Every Pages tab's count for the range (AT-006). */
export async function getTrafficPageCounts(
  brandId: string,
  window: traffic.TrafficDateWindow | undefined,
): Promise<traffic.TrafficPages['counts']> {
  const pages =
    (await sharedRead<traffic.TrafficPages>(shareKey('pages', brandId, window))) ??
    (await readTrafficPages(brandId, window, { tab: 'citedNotClicked', limit: 0 }));
  return pages.counts;
}

/** How many Google queries no prompt tracks in the range (AT-009). */
export async function getUntrackedQueryCount(
  brandId: string,
  window: traffic.TrafficDateWindow | undefined,
): Promise<{ count: number; capped: boolean }> {
  const queries =
    (await sharedRead<traffic.TrafficUntrackedQueries>(shareKey('untracked', brandId, window))) ??
    (await readUntrackedGoogleQueries(brandId, window, { limit: 0 }));
  return { count: queries.count, capped: queries.capped };
}
