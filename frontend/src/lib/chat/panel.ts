/**
 * Chat's side panel on every app page (CHAT-01 items 13–24): its sizes, the
 * routes it stays off, and the chat it opens on. No React here: the
 * provider, the Ask Chat button and the panel read these; its key is
 * chat-shortcuts' `panel`.
 */

export const PANEL_SIZES = ['compact', 'wide', 'full'] as const;
export type PanelSize = (typeof PANEL_SIZES)[number];

/** Compact and wide, in px (item 16); full screen is the viewport less the app sidebar. */
export const PANEL_WIDTHS: Record<Exclude<PanelSize, 'full'>, number> = {
  compact: 420,
  wide: 640,
};

/** From this viewport width a compact or wide panel pushes the page aside (item 17). */
export const PANEL_PUSH_MIN = 1100;

/** Below this viewport width the panel is full width, with no size buttons (item 18). */
export const PANEL_NARROW_MAX = 760;

/** A size saved on the person (chat_user_prefs.panel_size); compact when none. */
export function panelSizeOf(value: unknown): PanelSize {
  return PANEL_SIZES.find((size) => size === value) ?? 'compact';
}

/**
 * The size a header button leads to (mockup's Compact · Wide · Full screen
 * group): the one clicked, except Full screen again, which goes back to the
 * size before it (item 16).
 */
export function nextPanelSize(
  current: PanelSize,
  clicked: PanelSize,
  before: Exclude<PanelSize, 'full'>,
): PanelSize {
  return clicked === 'full' && current === 'full' ? before : clicked;
}

/**
 * Where the person is, for the panel: on Chat's own routes `Ctrl J` goes to
 * the composer; the Content Editor has its own Chat (CHAT-15); every other
 * app page has the panel. The path is the app's, without the locale.
 */
export function panelRouteOf(pathname: string): 'chat' | 'editor' | 'page' {
  if (pathname === '/dashboard/chat' || pathname.startsWith('/dashboard/chat/')) return 'chat';
  if (pathname.startsWith('/dashboard/content/editor/')) return 'editor';
  return 'page';
}

/** localStorage: the panel's chat and when it was last used, to reopen it (item 24). */
export const PANEL_LAST_CHAT_KEY = 'aeo:chat-panel-last';

/** A panel chat used within this long opens again with the panel (item 24). */
export const PANEL_REOPEN_MS = 30 * 60 * 1000;

/** The chat the panel opens on: the last one, when used in the last 30 minutes. */
export function reopenChatId(stored: string | null, now: number): string | null {
  if (!stored) return null;
  try {
    const last = JSON.parse(stored) as { id?: unknown; at?: unknown };
    if (typeof last.id !== 'string' || typeof last.at !== 'number') return null;
    return now - last.at <= PANEL_REOPEN_MS && last.at <= now ? last.id : null;
  } catch {
    return null;
  }
}

/** The full chat page's query parameter for the page a panel chat was opened from (CHAT-22). */
export const PANEL_FROM_PARAM = 'from';

/**
 * Where "↙ Back to {page}" returns (CHAT-22: the panel's ⤢ and back): the
 * app page the chat was opened from, with its query, as the full chat
 * page got it; null for anything else: another site, Chat itself, a path
 * outside the dashboard.
 */
export function panelReturnOf(from: string | null | undefined): string | null {
  if (!from || from.length > 2000 || !from.startsWith('/dashboard/')) return null;
  if (/[\s\\]/.test(from) || from.includes('//')) return null;
  const path = from.split(/[?#]/)[0];
  // A `.` or `..` segment (also as %2e) resolves to another path: out of
  // the dashboard, or into Chat.
  if (path.split('/').some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return null;
  return panelRouteOf(path) === 'page' ? from : null;
}
