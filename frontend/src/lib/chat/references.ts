/**
 * What the composer's @ menu references (CHAT-02 items 15–17, agentic
 * update): a chart, metric or table on the page (the page's own, W1-08), a
 * tracked prompt, one of the brand's pages, or an open Action Center task.
 * A pick shows as a chip by its label; the type, id and scope go with the
 * message, never on screen.
 */

export const CHAT_REFERENCE_TYPES = ['chart', 'metric', 'table', 'prompt', 'page', 'task'] as const;
export type ChatReferenceType = (typeof CHAT_REFERENCE_TYPES)[number];

export interface ChatReference {
  type: ChatReferenceType;
  /** The object's handle: a row id, a page's address, a chart's key. Never shown. */
  id: string;
  label: string;
  /** Where on the page it was (a chart's filters), for the run. */
  scope?: Record<string, string>;
}

/** The most rows the @ menu lists (CHAT-02 item 16). */
export const MAX_REFERENCES = 8;

/** The longest search the @ menu sends. */
export const MAX_REFERENCE_QUERY = 100;

/**
 * A search as a pattern part: what PostgREST's filters read as their own
 * (%, _, \, the * PostgREST reads as % in like and ilike, and the commas
 * and brackets of or()) becomes a space.
 */
export function referenceQuery(q: string): string {
  return q
    .slice(0, MAX_REFERENCE_QUERY)
    .replace(/[%_*\\,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The menu's rows from each source's matches, in turn (a prompt, a page, a
 * task, then again), so one source doesn't fill it; an object twice is
 * listed once.
 */
export function pickReferences(
  lists: readonly (readonly ChatReference[])[],
  max = MAX_REFERENCES,
): ChatReference[] {
  const out: ChatReference[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < max && lists.some((list) => i < list.length); i += 1) {
    for (const list of lists) {
      const ref = list[i];
      if (!ref || out.length >= max) continue;
      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

/** A page's address as a label: no scheme, no trailing slash ("getcito.com/pricing"). */
export const pageLabel = (url: string) =>
  url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
