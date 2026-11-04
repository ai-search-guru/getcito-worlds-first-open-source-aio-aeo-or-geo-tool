/**
 * The content editor's rules that don't need the editor itself (Content
 * Editor, CE-004): the draft's title, the length target the counter shows,
 * and which links the toolbar accepts.
 */

/** How long typing pauses before the draft saves itself. */
export const AUTOSAVE_DELAY_MS = 1500;

/**
 * How long typing pauses before the side panel and the type chip read the
 * page again: reading it re-renders the editor and parses the page, too much
 * for every keystroke.
 */
export const PAGE_READ_DELAY_MS = 400;

/** The largest body a draft saves, in characters of HTML (about 100 pages). */
export const MAX_BODY_HTML_LENGTH = 500_000;

/** content_drafts.title's limit (00204). */
export const MAX_TITLE_LENGTH = 300;

/** The saved page the editor last saw: a save only goes over this version. */
export interface SavedVersion {
  updatedAt: string;
  bodyHash: string;
}

/**
 * What a save came to. Typed rather than thrown: in production Next.js hides
 * a server action's error message, and the editor says something different
 * for each.
 *   - conflict: someone else changed the page since (another tab, a teammate,
 *     the Content Agent), and it wasn't overwritten;
 *   - too_large: over MAX_BODY_HTML_LENGTH, which no retry can save;
 *   - not_found: the draft is gone, or isn't the member's.
 */
export type SaveDraftResult =
  | ({ ok: true } & SavedVersion)
  | { ok: false; reason: 'conflict' | 'too_large' | 'not_found' | 'invalid' };

/**
 * A fingerprint of a page (SHA-256 of its HTML, in hex), the same in the
 * browser and on the server. A save sends the one it last saw, so the server
 * can tell a page someone else changed from a draft where only another
 * column changed (its status, its type).
 */
export async function bodyHash(html: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The counter's target until the Rules tab (CE-009) lets it be changed: the
 * spec's default Length rule, 3,000 characters; 1,200 for a product page,
 * 800 for a category or collection page, 1,000 for a sizing guide and 1,500
 * for a definition page.
 */
export function lengthTarget(pageType: string | null): number {
  if (pageType === 'product_page') return 1200;
  if (pageType === 'category_page' || pageType === 'collection_page') return 800;
  if (pageType === 'sizing_guide') return 1000;
  if (pageType === 'definition') return 1500;
  return 3000;
}

/** The parts of the editor's JSON (TipTap's getJSON) a title is read from. */
export interface EditorJsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  text?: string;
  content?: EditorJsonNode[];
}

function textOf(node: EditorJsonNode): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(textOf).join('');
}

/**
 * A draft is named by its page's H1, as the Library lists it: the first H1,
 * else the first heading, else the start of the first text. Empty while the
 * page is.
 */
export function draftTitleFromDoc(doc: EditorJsonNode): string {
  const blocks = (doc.content ?? []).filter((node) => textOf(node).trim());
  const pick =
    blocks.find((node) => node.type === 'heading' && node.attrs?.level === 1) ??
    blocks.find((node) => node.type === 'heading') ??
    blocks[0];
  if (!pick) return '';
  const text = textOf(pick).replace(/\s+/g, ' ').trim();
  if (pick.type === 'heading' || text.length <= 80) return text.slice(0, MAX_TITLE_LENGTH);
  // A first paragraph as the title: cut at a word, with an ellipsis.
  const cut = text.slice(0, 80);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : 80)}…`;
}

/**
 * A link the toolbar sets: a path on the brand's own site (an internal
 * link), or an http(s) or mailto address, so a pasted "javascript:" never
 * becomes a link. A bare domain gets https://. Null when it isn't a link.
 */
export function safeLinkHref(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  // "//host" (and "/\host", which browsers read the same) is another site's
  // address with no scheme to check.
  if (/^\/[/\\]/.test(value)) return null;
  if (value.startsWith('/')) return value;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === 'mailto:') return url.href;
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.')) {
      return url.href;
    }
  } catch {
    // Not a URL.
  }
  return null;
}

/** An image the toolbar inserts by address: http(s) only. */
export function safeImageSrc(input: string): string | null {
  const href = safeLinkHref(input);
  return href && /^https?:/.test(href) ? href : null;
}

/**
 * The editor's StarterKit, as its page's schema needs it: H1–H3, no code,
 * code blocks or rules (pages, not code), links only to safe addresses.
 * The server reads a page into the same document (docText.ts pageDoc).
 */
export const EDITOR_STARTER_KIT = {
  heading: { levels: [1, 2, 3] as (1 | 2 | 3)[] },
  code: false,
  codeBlock: false,
  horizontalRule: false,
  link: {
    openOnClick: false,
    defaultProtocol: 'https',
    isAllowedUri: (url: string) => safeLinkHref(url) !== null,
  },
} as const;
