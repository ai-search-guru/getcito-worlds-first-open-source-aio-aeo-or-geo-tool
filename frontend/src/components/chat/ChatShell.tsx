'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { RunsTray } from '@/components/agentic/RunsTray';
import { StatusPill, type StatusPillState } from '@/components/agentic/StatusPill';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { saveChatMenuOpen } from '@/lib/actions/chatPrefs';
import { useBrandStore } from '@/state/useBrandStore';
import { useChatRailStore } from '@/state/useChatRailStore';
import { cn } from '@/lib/utils';
import type { ChatListItem } from '@/lib/chat/conversations';
import { menuTitleOf } from '@/lib/chat/pageContext';
import { PANEL_FROM_PARAM, panelReturnOf } from '@/lib/chat/panel';
import { getDashboardNavLabel } from '@/lib/dashboardNavigation';
import { ChatActionsProvider, useChatActions } from './ChatActions';
import { ChatDebugProvider } from './ChatDebug';
import { ChatCrumbContext } from './ChatCrumb';
import { inboxItems } from './ChatInbox';
import { useChatList } from './ChatListProvider';
import { ChatMenu } from './ChatMenu';
import { ChatHeaderMenu, RenameField } from './ChatMenus';
import { ChatSearchPalette } from './ChatSearch';
import { chatShortcutOf, MenuToggleIcon, shortcutLabel, useIsMac } from './ChatShortcuts';

/** At this width and up the chat menu is a column; below it, a drawer (CHAT-01 item 9). */
const WIDE_QUERY = '(min-width: 1100px)';

function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Whether the window is wide enough for the menu column; wide while rendering on the server. */
function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

const CHAT_PATH = /^\/dashboard\/chat\/([0-9a-f-]{36})$/i;
/** A daily suggestion's page: "Chat › Inbox › Daily suggestion · Oct 29" (CHAT-26 #d-detail). */
const SUGGESTION_PATH = /^\/dashboard\/chat\/inbox\/[0-9a-f-]{36}$/i;
/** The page a detail sits under, linked in its breadcrumb before the name the detail sets. */
const DETAIL_PARENTS = {
  inbox: '/dashboard/chat/inbox?tab=suggestions',
} as const;

/**
 * Where the palette opens while the menu is shown: under its Search chats
 * field, or under New chat while the Chats section is folded.
 */
function searchAnchor(): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    document.getElementById('chat-menu-search') ??
    document.querySelector('#chat-menu [data-action="chat.new"]')
  );
}

/**
 * Chat's pages that sit under it (CHAT-01 4b; mockup sub-pages): the header
 * shows ← Back to Chat and the breadcrumb "Chat › {page}".
 */
const SUB_PAGES: Record<string, string> = {
  '/dashboard/chat/inbox': 'inbox',
  '/dashboard/chat/all': 'allChats',
  '/dashboard/chat/activity': 'activity',
  '/dashboard/chat/capabilities': 'capabilities',
  '/dashboard/chat/files': 'files',
  '/dashboard/chat/connections': 'connections',
};
/** Chat's own pages the header names (mockup: Settings, right under Home). */
const TITLED_PAGES: Record<string, string> = { '/dashboard/chat/settings': 'settings' };

/** The last conversation open in this browser tab, for Back to Chat (CHAT-01 4b, 4c). */
const LAST_CHAT_KEY = 'getcito.chat.lastConversation';

function readLastChat(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_CHAT_KEY);
  } catch {
    return null;
  }
}

/** A chat's dot as the pill beside its title, or none while it is idle. */
const PILL_OF: Partial<Record<string, StatusPillState>> = {
  running: 'working',
  needsYou: 'needsYou',
  done: 'done',
  failed: 'failed',
};

/**
 * The Chat shell (CHAT-01 items 5, 9–9f; CHAT-23 G1): the chat menu, 256px,
 * beside the page, and the 52px header. The menu's toggle and `Ctrl+\`
 * hide or show it, and the choice is kept on the person (all devices);
 * hidden, the page takes the whole width and the header starts with a
 * strip — toggle · New chat · Search · runs pill · Inbox — that is gone
 * again once the menu is back. Below 1100px the menu is a drawer the same
 * toggle opens, which leaves the saved choice alone. `Ctrl+Shift+O` starts
 * a new chat; `Ctrl K` opens the search palette under Search chats, or
 * under the strip's Search. The app sidebar beside it is untouched.
 */
export function ChatShell({
  staff = false,
  ...props
}: {
  menuOpen: boolean;
  railOpen?: boolean;
  /** GetCito staff (STAFF_EMAILS): the open chat's ⋯ menu offers Debug (W1-15). */
  staff?: boolean;
  children: ReactNode;
}) {
  return (
    <ChatActionsProvider>
      <ChatDebugProvider staff={staff}>
        <ChatShellFrame {...props} />
      </ChatDebugProvider>
    </ChatActionsProvider>
  );
}

/** The open chat's name in the header, edited there by its ⋯ menu's Rename. */
function ChatTitle({ chat, fallback }: { chat: ChatListItem; fallback: string }) {
  const actions = useChatActions();
  if (actions?.renaming?.id === chat.id && actions.renaming.where === 'header') {
    return <RenameField chat={chat} className="max-w-md text-sm font-semibold" />;
  }
  return (
    <h1 className="min-w-0 truncate text-sm font-semibold" title={chat.title ?? undefined}>
      {chat.title ?? fallback}
    </h1>
  );
}

function ChatShellFrame({
  menuOpen,
  railOpen = false,
  children,
}: {
  menuOpen: boolean;
  railOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('chatShell.menu');
  const tNav = useTranslations('chatShell.nav');
  const tMenu = useTranslations('nav');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isWide = useIsWide();
  const isMac = useIsMac();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { chats, status } = useChatList();
  const inbox = useMemo(() => inboxItems(chats).length, [chats]);
  const [open, setOpen] = useState(menuOpen);
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lastChat, setLastChat] = useState<string | null>(null);
  // The breadcrumb's last part a page names, as a daily suggestion's page does.
  const [crumbTail, setCrumbTail] = useState<string | null>(null);
  const stripToggle = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  // Opened as a full page from the side panel (CHAT-22): ↙ Back to that page.
  const backToPage = panelReturnOf(searchParams?.get(PANEL_FROM_PARAM) ?? null);
  const backToTitle = backToPage ? menuTitleOf(backToPage.split(/[?#]/)[0]) : null;

  const toggle = useCallback(() => {
    if (!window.matchMedia(WIDE_QUERY).matches) {
      setDrawer((was) => !was);
      return;
    }
    focusAfterToggle.current = true;
    setOpen((was) => {
      void saveChatMenuOpen(!was);
      return !was;
    });
  }, []);

  // The toggle moves with the menu: hidden, focus goes to the strip's toggle;
  // shown, to the menu's (CHAT-23 chatMenu.toggle).
  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    if (open)
      document.querySelector<HTMLElement>('#chat-menu [data-action="chatMenu.toggle"]')?.focus();
    else stripToggle.current?.focus();
  }, [open]);

  const newChat = useCallback(() => {
    setDrawer(false);
    router.push('/dashboard/chat');
  }, [router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = chatShortcutOf(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'menu') toggle();
      else if (shortcut === 'search') setSearching((was) => !was);
      else if (shortcut === 'new') newChat();
      // On Chat's own routes the side panel's key goes to the composer (CHAT-01 item 14).
      else document.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, newChat]);

  const chatId = CHAT_PATH.exec(pathname)?.[1] ?? null;

  // The app sidebar beside Chat: the rail, or expanded as the person left it (CHAT-01 4f).
  useEffect(() => {
    useChatRailStore.getState().setOpen(railOpen);
  }, [railOpen]);

  // The conversation open now is where Back to Chat returns, in this tab.
  useEffect(() => {
    if (chatId) {
      try {
        window.sessionStorage.setItem(LAST_CHAT_KEY, chatId);
      } catch {
        // Private windows: Back to Chat then opens Chat Home.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastChat(chatId ?? readLastChat());
  }, [chatId]);

  // A chat that is gone (deleted, no longer shared) isn't gone back to.
  const backTo =
    lastChat && (status !== 'ready' || chats.some((chat) => chat.id === lastChat))
      ? `/dashboard/chat/${lastChat}`
      : '/dashboard/chat';
  const suggestionPage = SUGGESTION_PATH.test(pathname);
  const detailOf: keyof typeof DETAIL_PARENTS | undefined = suggestionPage ? 'inbox' : undefined;
  const subPage = SUB_PAGES[pathname] ?? detailOf;
  const titled = TITLED_PAGES[pathname];
  const current = chatId ? chats.find((chat) => chat.id === chatId) : undefined;
  const pill = current ? PILL_OF[current.state] : undefined;
  // A chat, Home or a suggestion's page (a chat to be) fills the page itself;
  // the other Chat pages get the usual padding.
  const padded = pathname !== '/dashboard/chat' && !chatId && !suggestionPage;
  const strip = !isWide || !open;
  const runs = <RunsTray brandId={brandId} />;

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] min-w-0 md:h-screen">
      <div
        id="chat-menu"
        className={cn(
          'getcito-chat-menu hidden shrink-0 overflow-hidden border-r bg-sidebar transition-[width] duration-150 ease-out motion-reduce:transition-none min-[1100px]:block',
          open ? 'w-64' : 'w-0 border-r-0',
        )}
        inert={!open || undefined}
      >
        <div className="h-full w-64">
          <ChatMenu open={open} onToggle={toggle} onNewChat={newChat} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b px-[18px] py-2.5">
          {strip && (
            <div
              role="toolbar"
              aria-label={t('strip')}
              className="flex shrink-0 items-center gap-1.5"
            >
              <button
                ref={stripToggle}
                type="button"
                data-action="chatMenu.toggle"
                aria-label={t('show')}
                title={t('showTip', { keys: shortcutLabel('menu', isMac) })}
                aria-expanded={isWide ? false : drawer}
                aria-controls="chat-menu"
                onClick={toggle}
                className="flex size-7 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <MenuToggleIcon />
              </button>
              <button
                type="button"
                data-action="chat.new"
                title={t('newChatTip', { keys: shortcutLabel('new', isMac) })}
                onClick={newChat}
                className="flex h-7 items-center gap-1 rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span aria-hidden>＋</span>
                {t('newChat')}
              </button>
              <ChatSearchPalette
                trigger
                open={searching}
                onOpenChange={setSearching}
                onNewChat={newChat}
              />
              {runs}
              <Link
                href="/dashboard/chat/inbox"
                data-action="chatMenu.openInbox"
                onClick={() => setDrawer(false)}
                className="flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {t('inbox')}
                {inbox > 0 && (
                  <span className="min-w-[22px] rounded-md bg-foreground/10 px-1.5 text-center text-[11px] leading-[18px] text-foreground/80 tabular-nums">
                    {inbox}
                  </span>
                )}
              </Link>
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            </div>
          )}
          {subPage && (
            <>
              <Link
                href={backTo}
                data-action="nav.backToChat"
                title={tNav(backTo === '/dashboard/chat' ? 'backHomeTip' : 'backChatTip')}
                className="flex h-7 shrink-0 items-center rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {tNav('backToChat')}
              </Link>
              <nav
                aria-label={tNav('breadcrumb')}
                className="min-w-0 truncate text-sm font-semibold"
              >
                <Link
                  href="/dashboard/chat"
                  data-action="nav.breadcrumb"
                  className="font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                >
                  {tNav('chat')}
                </Link>
                <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/70">
                  ›
                </span>
                {detailOf ? (
                  <>
                    <Link
                      href={DETAIL_PARENTS[detailOf]}
                      data-action="nav.breadcrumb"
                      className="font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                    >
                      {tNav(`pages.${subPage}`)}
                    </Link>
                    {crumbTail && (
                      <>
                        <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/70">
                          ›
                        </span>
                        <span aria-current="page">{crumbTail}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span aria-current="page">{tNav(`pages.${subPage}`)}</span>
                )}
              </nav>
            </>
          )}
          {titled && (
            <h1 className="min-w-0 truncate text-sm font-semibold">{tNav(`pages.${titled}`)}</h1>
          )}
          {chatId && backToPage && (
            <Link
              href={backToPage}
              data-action="nav.backToPage"
              title={tNav('backToPageTip')}
              className="flex h-7 shrink-0 items-center rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {tNav('backToPage', {
                page: backToTitle ? getDashboardNavLabel(backToTitle, tMenu) : tNav('page'),
              })}
            </Link>
          )}
          {current && (
            <>
              <ChatTitle chat={current} fallback={t('untitled')} />
              {pill && <StatusPill state={pill} />}
            </>
          )}
          {!strip && (
            // With the menu shown, the palette opens under its Search chats field.
            <ChatSearchPalette
              open={searching}
              onOpenChange={setSearching}
              onNewChat={newChat}
              anchor={searchAnchor}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {!strip && runs}
            {current && <ChatHeaderMenu chat={current} />}
          </div>
        </header>
        <div className={cn('chat-scroll min-h-0 flex-1 overflow-y-auto', padded && 'p-6')}>
          <ChatCrumbContext.Provider value={setCrumbTail}>{children}</ChatCrumbContext.Provider>
        </div>
      </div>

      <Sheet open={drawer && !isWide} onOpenChange={setDrawer}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="getcito-chat-menu w-64 bg-sidebar p-0 sm:max-w-64"
        >
          <SheetTitle className="sr-only">{t('label')}</SheetTitle>
          <ChatMenu
            open={drawer}
            onToggle={() => setDrawer(false)}
            onNewChat={newChat}
            onNavigate={() => setDrawer(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
