'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, History, MessageSquareOff, Plus, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agentic/AgentAvatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import type { ChatListItem } from '@/lib/chat/conversations';
import { MAX_SUGGESTIONS, contextChips, menuTitleOf } from '@/lib/chat/pageContext';
import {
  PANEL_FROM_PARAM,
  PANEL_LAST_CHAT_KEY,
  PANEL_SIZES,
  PANEL_WIDTHS,
  reopenChatId,
  type PanelSize,
} from '@/lib/chat/panel';
import type { ChatThread, ThreadMessage } from '@/lib/chat/thread';
import { getDashboardNavLabel } from '@/lib/dashboardNavigation';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { ChatActionsProvider, useChatActions } from '../ChatActions';
import { ChatPanelMenu, RenameField } from '../ChatMenus';
import { ChatThreadView } from '../ChatThreadView';
import { shortcutLabel, useIsMac } from '../ChatShortcuts';
import { useChatPanel } from './chatPanelContext';

/** What the panel shows under its header. */
type PanelView =
  | { kind: 'chat'; key: number; thread: ChatThread | null }
  | { kind: 'loading'; key: number }
  | { kind: 'unavailable'; key: number };

type HistoryState =
  { status: 'loading' } | { status: 'ready'; chats: ChatListItem[] } | { status: 'error' };

/** Recent chats in History (item 23); All chats has the rest. */
const HISTORY_LIMIT = 20;

function keep(id: string) {
  try {
    localStorage.setItem(PANEL_LAST_CHAT_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Storage blocked: the panel starts empty next time.
  }
}

function forget() {
  try {
    localStorage.removeItem(PANEL_LAST_CHAT_KEY);
  } catch {
    // Storage blocked: nothing kept.
  }
}

/**
 * One chat with its messages and runs, and its row (the ⋯ menu's), as the
 * panel opens it; null when it isn't there for them.
 */
async function readThread(id: string): Promise<{ thread: ChatThread; row: ChatListItem } | null> {
  const res = await fetch(`/api/chat/conversations/${id}`, { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    { ok: true; chat: ChatListItem; messages: ThreadMessage[] } | { ok: false } | null;
  if (!res?.ok || !body?.ok) return null;
  return {
    thread: {
      conversationId: body.chat.id,
      title: body.chat.title,
      brandId: null,
      mine: body.chat.mine,
      messages: body.messages,
    },
    row: body.chat,
  };
}

/** A chat just started in the panel, as its row reads before Chat names it. */
const newRow = (id: string): ChatListItem => ({
  id,
  title: null,
  brand: null,
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: new Date().toISOString(),
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
});

/** The panel's title: "Chat", or the chat's name being renamed in its place. */
function PanelTitle({ row }: { row: ChatListItem | null }) {
  const t = useTranslations('chatPanel');
  const actions = useChatActions();
  if (row && actions?.renaming?.id === row.id) {
    return <RenameField chat={row} className="min-w-0 flex-1 text-sm font-semibold" />;
  }
  return <h2 className="text-sm font-semibold">{t('title')}</h2>;
}

/** The size group's icons (mockup `.szg`): the panel's share of a window. */
function SizeIcon({ size }: { size: PanelSize }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-4 fill-none stroke-current"
      strokeWidth={1.4}
    >
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        fill={size === 'full' ? 'currentColor' : 'none'}
      />
      {size === 'compact' && <rect x="10.5" y="2.5" width="4" height="11" fill="currentColor" />}
      {size === 'wide' && <rect x="7.5" y="2.5" width="7" height="11" fill="currentColor" />}
    </svg>
  );
}

/**
 * Chat's side panel (CHAT-01 items 15–26, mockup `#s-panel-app`): it slides
 * in from the right with the page's chat in it. The header has New chat,
 * History, the sizes (Compact 420px, Wide 640px, Full screen; none below
 * 760px, where it is full width and ← goes back to the page) and Close.
 * Empty, it greets the person;
 * it opens again on its last chat when that was used in the last 30
 * minutes (item 24). A panel chat is a chat like any other: in Recents, and
 * on the full page with everything in it. Closed, it stays as it was, a
 * run under way included, until it opens again.
 *
 * The page's context (W1-08, items 20–22) is in its box as chips: the page,
 * the brand, the date range and filters, following the page while it is
 * open; × keeps one off on this page until New chat. The empty panel offers
 * the page's suggestions, which fill the box; Ask about this attaches its
 * object as an @ chip.
 */
export function ChatSidePanel() {
  const t = useTranslations('chatPanel');
  const tUnavailable = useTranslations('chatShell.unavailable');
  const tNav = useTranslations('nav');
  const panel = useChatPanel();
  const pathname = usePathname();
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const isMac = useIsMac();
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<PanelView>({ kind: 'chat', key: 0, thread: null });
  const [history, setHistory] = useState<HistoryState | null>(null);
  /** The chat in the panel, once it has one: its ⋯ menu, and New chat says it stays in the list. */
  const [row, setRow] = useState<ChatListItem | null>(null);
  /** The panel was off (Chat's page, the editor) with a chat in it: read it again when back. */
  const [away, setAway] = useState(false);
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  /** The chat asked for last: an earlier one that answers later is dropped. */
  const asked = useRef<string | null>(null);
  /** The chips × took off, on the page they were taken off on. */
  const [removed, setRemoved] = useState<{ route: string; keys: string[] }>({
    route: pathname,
    keys: [],
  });
  /** Hand-offs up to this one belong to a chat no longer in the panel. */
  const [draftFloor, setDraftFloor] = useState(0);
  const [seenDraft, setSeenDraft] = useState(0);
  const open = !!panel?.open;
  const draft = panel?.draft ?? null;

  // A new hand-off (Ask about this) goes to the chat: History closes, and a
  // chat that isn't available makes way for a new one.
  if (draft && draft.nonce !== seenDraft) {
    setSeenDraft(draft.nonce);
    setHistory(null);
    if (view.kind === 'unavailable') setView({ kind: 'chat', key: view.key + 1, thread: null });
  }

  const remember = useCallback((id: string) => {
    keep(id);
    setRow((was) => (was?.id === id ? was : newRow(id)));
  }, []);

  const openChat = useCallback(async (id: string) => {
    asked.current = id;
    setHistory(null);
    setView((was) => ({ kind: 'loading', key: was.key + 1 }));
    const read = await readThread(id);
    if (asked.current !== id) return;
    if (read) {
      keep(id);
      setRow(read.row);
    } else {
      forget();
      setRow(null);
    }
    setView((was) =>
      read
        ? { kind: 'chat', key: was.key + 1, thread: read.thread }
        : { kind: 'unavailable', key: was.key + 1 },
    );
  }, []);

  /** The panel empty again: after New chat, or once its chat is archived or deleted. */
  const startOver = useCallback(() => {
    asked.current = null;
    forget();
    setHistory(null);
    setView((was) => ({ kind: 'chat', key: was.key + 1, thread: null }));
    setRemoved({ route: pathname, keys: [] });
    setDraftFloor(draft?.nonce ?? 0);
    setRow(null);
  }, [pathname, draft]);

  const newChat = useCallback(() => {
    if (row) toast(t('newChatToast'));
    startOver();
  }, [row, t, startOver]);

  /**
   * ⤢ Open as full page (CHAT-22): the same chat on Chat's own page, which
   * offers ↙ Back to this page; the panel reads it again on the way back.
   */
  const openFullPage = useCallback(() => {
    if (!row) return;
    const from = `${pathname}${window.location.search}`;
    router.push(`/dashboard/chat/${row.id}?${PANEL_FROM_PARAM}=${encodeURIComponent(from)}`);
  }, [row, pathname, router]);

  // Back from the full page, or any page without the panel: the chat as it is now.
  const available = !!panel?.available;
  if (!available && row && !away) setAway(true);
  useEffect(() => {
    if (!available || !away) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAway(false);
    if (row) void openChat(row.id);
  }, [available, away, row, openChat]);

  // The first time it opens on this visit: its last chat, when recent.
  useEffect(() => {
    if (!open || started) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStarted(true);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PANEL_LAST_CHAT_KEY);
    } catch {
      // Storage blocked: start empty.
    }
    const id = reopenChatId(stored, Date.now());
    if (id) void openChat(id);
  }, [open, started, openChat]);

  // A chat handed over by the page (Run agent on an action, CHAT-21 §F item
  // 29): opened in place of the last one, each hand-off once.
  const openedHandoff = useRef(0);
  const chatHandoff = draft?.chatId ? draft : null;
  useEffect(() => {
    if (!chatHandoff?.chatId || chatHandoff.nonce <= openedHandoff.current) return;
    openedHandoff.current = chatHandoff.nonce;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStarted(true);
    void openChat(chatHandoff.chatId);
  }, [chatHandoff, openChat]);

  // Opened: the composer has focus, ready to type.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      root.current?.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, view.key]);

  async function showHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory({ status: 'loading' });
    const res = await fetch(`/api/chat/conversations?limit=${HISTORY_LIMIT}`, {
      cache: 'no-store',
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as
      { ok: true; chats: ChatListItem[] } | { ok: false } | null;
    const read: HistoryState =
      res?.ok && body?.ok ? { status: 'ready', chats: body.chats } : { status: 'error' };
    // Closed (or a chat opened) while it loaded: it stays closed.
    setHistory((was) => (was ? read : was));
  }

  if (!panel || !started) return null;
  const { size, setup, page } = panel;
  const menuTitle = menuTitleOf(pathname);
  const chips = contextChips(
    page,
    {
      pageName: menuTitle ? getDashboardNavLabel(menuTitle, tNav) : null,
      brand: brand ? { id: brand.id, name: brand.name } : null,
    },
    new Set(removed.route === pathname ? removed.keys : []),
  );
  const suggestions = (page?.suggestions ?? []).slice(0, MAX_SUGGESTIONS);

  return (
    <ChatActionsProvider
      onUpdated={(chat) => setRow((was) => (was?.id === chat.id ? chat : was))}
      onGone={(chat) => {
        if (chat.id === row?.id) startOver();
      }}
    >
      <aside
        ref={root}
        id="chat-side-panel"
        aria-label={t('label')}
        className={cn(
          'fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-xl duration-200 animate-in slide-in-from-right motion-reduce:animate-none min-[760px]:w-(--chat-panel-width)',
          size !== 'full' && 'min-[1100px]:shadow-none',
          !open && 'hidden',
        )}
        style={
          {
            '--chat-panel-width':
              size === 'full' ? 'calc(100vw - 240px)' : `${PANEL_WIDTHS[size]}px`,
          } as CSSProperties
        }
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="panel.backToPage"
            aria-label={t('backToPage')}
            title={t('backToPage')}
            onClick={panel.close}
            className="min-[760px]:hidden"
          >
            <ArrowLeft aria-hidden />
          </Button>
          <AgentAvatar size="sm" state="idle" decorative />
          <PanelTitle row={row} />
          <div className="ml-auto flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="panel.newChat"
              aria-label={t('newChat')}
              title={t('newChat')}
              onClick={newChat}
            >
              <Plus aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="panel.history"
              aria-label={t('history')}
              title={t('history')}
              aria-pressed={!!history}
              onClick={() => void showHistory()}
              className={cn(history && 'bg-muted')}
            >
              <History aria-hidden />
            </Button>
            <div
              role="group"
              aria-label={t('sizes')}
              className="mx-1 hidden items-center rounded-lg border p-0.5 min-[760px]:flex"
            >
              {PANEL_SIZES.map((option) => (
                <button
                  key={option}
                  type="button"
                  data-action="panel.size"
                  data-psize={option}
                  aria-label={t(`size.${option}`)}
                  title={t(`size.${option}`)}
                  aria-pressed={size === option}
                  onClick={() => panel.resize(option)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground',
                    size === option && 'bg-muted text-foreground',
                  )}
                >
                  <SizeIcon size={option} />
                </button>
              ))}
            </div>
            {row && <ChatPanelMenu chat={row} onOpenFullPage={openFullPage} />}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-action="panel.close"
              aria-label={t('close')}
              title={t('closeTip', { keys: shortcutLabel('panel', isMac) })}
              onClick={panel.close}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {history && (
            <nav aria-label={t('history')} className="flex flex-col gap-1 p-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t('recent')}</h3>
              {history.status === 'loading' &&
                [0, 1, 2].map((row) => <Skeleton key={row} className="h-9 w-full" />)}
              {history.status === 'error' && (
                <p className="px-2 text-sm text-muted-foreground">{t('historyFailed')}</p>
              )}
              {history.status === 'ready' && history.chats.length === 0 && (
                <p className="px-2 text-sm text-muted-foreground">{t('noChats')}</p>
              )}
              {history.status === 'ready' &&
                history.chats.map((chat) => (
                  <button
                    key={chat.id}
                    type="button"
                    data-action="panel.openChat"
                    onClick={() => {
                      setDraftFloor(draft?.nonce ?? 0);
                      void openChat(chat.id);
                    }}
                    className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className={cn('min-w-0 flex-1 truncate', chat.unread && 'font-semibold')}>
                      {chat.title ?? t('untitled')}
                    </span>
                    {chat.brand && (
                      <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                        {chat.brand}
                      </span>
                    )}
                  </button>
                ))}
              <Link
                href="/dashboard/chat"
                data-action="panel.allChats"
                className="mt-1 px-2 text-sm font-medium underline-offset-4 hover:underline"
              >
                {t('allChats')}
              </Link>
            </nav>
          )}
          <div className={cn('flex min-h-full flex-col', history && 'hidden')}>
            {view.kind === 'loading' ? (
              <div role="status" aria-label={t('loading')} className="flex flex-col gap-3 p-4">
                <Skeleton className="ml-auto h-9 w-3/5" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="ml-auto h-9 w-2/5" />
              </div>
            ) : view.kind === 'unavailable' ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                <MessageSquareOff aria-hidden className="size-5 text-muted-foreground" />
                <p className="text-sm">{tUnavailable('title')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-action="panel.newChat"
                  onClick={newChat}
                >
                  {tUnavailable('newChat')}
                </Button>
              </div>
            ) : (
              <ChatThreadView
                key={view.key}
                thread={view.thread}
                variant="panel"
                defaultMode={setup.defaultMode}
                fullAutoOpen={setup.fullAutoOpen}
                fullAutoOffByAdmin={setup.fullAutoOffByAdmin}
                onOwnKey={setup.onOwnKey}
                keyFailure={setup.keyFailure}
                usageNoticeSeen={setup.usageNoticeSeen}
                skills={setup.skills}
                onConversation={remember}
                chips={chips}
                onRemoveChip={(key) =>
                  setRemoved((was) => ({
                    route: pathname,
                    keys: [...(was.route === pathname ? was.keys : []), key],
                  }))
                }
                pageReferences={page?.referenceables}
                pageRoute={pathname}
                draft={draft && draft.nonce > draftFloor ? draft : null}
                empty={
                  <div className="flex flex-col items-center gap-3 pt-6 text-center">
                    <p className="text-sm text-muted-foreground">
                      {setup.firstName
                        ? t('greeting', { name: setup.firstName })
                        : t('greetingNoName')}
                    </p>
                    {suggestions.length > 0 && (
                      <ul className="m-0 flex list-none flex-col items-center gap-2 p-0">
                        {suggestions.map((question) => (
                          <li key={question}>
                            <button
                              type="button"
                              data-action="panel.suggestion"
                              onClick={() => panel.fill(question)}
                              className="rounded-full border bg-background px-3 py-1.5 text-left text-[13px] hover:bg-muted"
                            >
                              {question}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                }
              />
            )}
          </div>
        </div>
      </aside>
    </ChatActionsProvider>
  );
}
