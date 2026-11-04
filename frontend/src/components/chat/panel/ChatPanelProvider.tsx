'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { usePathname } from '@/i18n/navigation';
import { saveChatPanelSize } from '@/lib/actions/chatPrefs';
import type { ChatPageContext } from '@/lib/chat/pageContext';
import { PANEL_WIDTHS, nextPanelSize, panelRouteOf, type PanelSize } from '@/lib/chat/panel';
import type { ChatReference } from '@/lib/chat/references';
import { cn } from '@/lib/utils';
import { chatShortcutOf } from '../ChatShortcuts';
import {
  ChatPageSetterContext,
  ChatPanelContext,
  useChatPanel,
  type ChatPanelSetup,
  type ChatPanelState,
  type PanelDraft,
} from './chatPanelContext';

/** Ask Chat, where focus goes back when the panel closes (item 19). */
const ASK_CHAT = '[data-action="panel.open"]';

/**
 * Chat's side panel on every app page (CHAT-01 items 13–19): open or
 * closed, its size, and `Ctrl J` (`⌘J`), which opens and closes it from
 * anywhere on the page, a page input included. Off on Chat's own routes
 * (their shell sends the key to the composer) and in the Content Editor,
 * which has its own Chat (CHAT-15). It also carries the page's context
 * (useChatPageContext) and what a page hands the panel's box: Ask about
 * this, a suggestion chip (items 20–22). Read once by the dashboard's layout:
 * whether the new Chat is on for the workspace, the person's "Ask Chat on
 * pages" (chat_user_prefs.panel_on_pages, set in Chat's settings) and the
 * size the panel had last.
 */

export function ChatPanelProvider({
  setup,
  children,
}: {
  setup: ChatPanelSetup;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const available = setup.enabled && panelRouteOf(pathname) === 'page';
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<PanelSize>(setup.size);
  const before = useRef<Exclude<PanelSize, 'full'>>(setup.size === 'full' ? 'compact' : setup.size);
  const [page, setPage] = useState<ChatPageContext | null>(null);
  const [draft, setDraft] = useState<PanelDraft | null>(null);
  const handoffs = useRef(0);

  const ask = useCallback((reference: ChatReference) => {
    handoffs.current += 1;
    setDraft({ nonce: handoffs.current, reference });
    setOpen(true);
  }, []);

  const fill = useCallback((text: string) => {
    handoffs.current += 1;
    setDraft({ nonce: handoffs.current, text });
  }, []);

  const openChat = useCallback((chatId: string) => {
    handoffs.current += 1;
    setDraft({ nonce: handoffs.current, chatId });
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    // After the panel is gone: Ask Chat on the page the person was on.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(ASK_CHAT)?.focus());
  }, []);

  const toggle = useCallback(() => {
    if (open) close();
    else setOpen(true);
  }, [open, close]);

  const resize = useCallback(
    (clicked: PanelSize) => {
      const next = nextPanelSize(size, clicked, before.current);
      if (next === size) return;
      if (size !== 'full') before.current = size;
      setSize(next);
      // Kept on the person, for every page and device; a size that didn't save stays here.
      void saveChatPanelSize(next);
    },
    [size],
  );

  useEffect(() => {
    if (!available) return;
    const onKey = (event: KeyboardEvent) => {
      if (chatShortcutOf(event) !== 'panel') return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [available, toggle]);

  const value = useMemo<ChatPanelState>(
    () => ({
      setup,
      available,
      open: available && open,
      size,
      toggle,
      close,
      resize,
      page,
      setPage,
      draft,
      ask,
      fill,
      openChat,
    }),
    [setup, available, open, size, toggle, close, resize, page, draft, ask, fill, openChat],
  );
  return (
    <ChatPageSetterContext.Provider value={setPage}>
      <ChatPanelContext.Provider value={value}>{children}</ChatPanelContext.Provider>
    </ChatPageSetterContext.Provider>
  );
}

/**
 * The page beside the panel (item 17): from 1100px, a compact or wide
 * panel pushes it aside by its width, so nothing is covered; narrower, and
 * in full screen, the panel lies over it. Only the padding changes: the
 * page underneath is never rendered again, so its scroll, filters and
 * typing stay (item 19).
 */
export function ChatPanelPage({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const panel = useChatPanel();
  const push = panel?.open && panel.size !== 'full' ? PANEL_WIDTHS[panel.size] : 0;
  return (
    <div
      className={cn(
        className,
        'transition-[padding] duration-200 min-[1100px]:pr-(--chat-panel-push)',
      )}
      style={{ '--chat-panel-push': `${push}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
