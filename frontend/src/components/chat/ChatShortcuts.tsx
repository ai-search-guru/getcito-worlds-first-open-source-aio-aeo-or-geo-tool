'use client';

import { useSyncExternalStore } from 'react';

/**
 * The Chat shell's keys (CHAT-23 P11): `Ctrl+\` (`⌘\`) hides or shows the
 * chat menu, `Ctrl+Shift+O` (`⌘⇧O`) starts a new chat, `Ctrl K` (`⌘K`)
 * opens or closes the search palette, on every Chat route and with focus in
 * the composer too, without the browser's own action. `Ctrl J` (`⌘J`) opens
 * and closes the side panel on every other app page, and on Chat's routes
 * goes to the composer (CHAT-01 item 14). `Ctrl+B` is left alone: it is
 * Bold in the composer.
 */

export type ChatShortcut = 'menu' | 'new' | 'search' | 'panel';

/** Which shortcut a key press is, or null. */
export function chatShortcutOf(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): ChatShortcut | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (!event.shiftKey && (event.key === '\\' || event.code === 'Backslash')) return 'menu';
  if (event.shiftKey && (event.key.toLowerCase() === 'o' || event.code === 'KeyO')) return 'new';
  if (!event.shiftKey && (event.key.toLowerCase() === 'k' || event.code === 'KeyK'))
    return 'search';
  if (
    !event.shiftKey &&
    event.ctrlKey !== event.metaKey &&
    (event.key.toLowerCase() === 'j' || event.code === 'KeyJ')
  ) {
    return 'panel';
  }
  return null;
}

/** The keys as the person's keyboard names them: "Ctrl+\" or "⌘\". */
export function shortcutLabel(shortcut: ChatShortcut, isMac: boolean): string {
  if (shortcut === 'menu') return isMac ? '⌘\\' : 'Ctrl+\\';
  if (shortcut === 'search') return isMac ? '⌘K' : 'Ctrl K';
  if (shortcut === 'panel') return isMac ? '⌘J' : 'Ctrl J';
  return isMac ? '⌘⇧O' : 'Ctrl ⇧ O';
}

const isMacPlatform = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** Whether the keyboard is a Mac's; false while rendering on the server. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    isMacPlatform,
    () => false,
  );
}

/** The sidebar-panel icon of the menu's toggle (mockup `.mtog`). */
export function MenuToggleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-4 fill-none stroke-current"
      strokeWidth={1.6}
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </svg>
  );
}
