'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { ChatListItem } from '@/lib/chat/conversations';
import { cn } from '@/lib/utils';
import { useChatList } from './ChatListProvider';
import { chatLineOf } from './ChatRow';
import { shortcutLabel, useIsMac } from './ChatShortcuts';

/**
 * Search chats (CHAT-01 item 6; CHAT-23 G2, `chatMenu.searchChats`,
 * `allChats.search`): the chats whose title or messages hold every word
 * typed, from GET /api/chat/conversations/search, asked a moment after the
 * person stops typing. And the Ctrl K palette (`search.open`, mockup
 * `#msearch`): New chat, the matching chats (the latest ones before anything
 * is typed) and the Chat pages by name.
 */

/** How long typing rests before the search is asked. */
export const CHAT_SEARCH_DEBOUNCE_MS = 200;
/** Chats the palette shows before anything is typed. */
const RECENT_IN_PALETTE = 8;

export type ChatSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatSearchState {
  status: ChatSearchStatus;
  chats: ChatListItem[];
}

/**
 * The chats matching `query` in `view` (active: not archived; archived: the
 * person's archived ones). Idle while the query is empty; while a new one
 * is asked, the last results stay.
 */
export function useChatSearch(
  query: string,
  view: 'active' | 'archived' = 'active',
): ChatSearchState {
  const q = query.trim();
  const key = `${view}:${q}`;
  const [answer, setAnswer] = useState<{ key: string } & ChatSearchState>({
    key: '',
    status: 'idle',
    chats: [],
  });

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q, view });
      const res = await fetch(`/api/chat/conversations/search?${params}`, {
        cache: 'no-store',
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        { ok: true; chats: ChatListItem[] } | { ok: false } | null;
      if (cancelled) return;
      setAnswer(
        res?.ok && body?.ok
          ? { key: `${view}:${q}`, status: 'ready', chats: body.chats }
          : { key: `${view}:${q}`, status: 'error', chats: [] },
      );
    }, CHAT_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, view]);

  if (!q) return { status: 'idle', chats: [] };
  if (answer.key !== key) return { status: 'loading', chats: answer.chats };
  return { status: answer.status, chats: answer.chats };
}

/** A Chat page the palette opens by name (only pages that are built). */
export interface ChatSearchPage {
  key: string;
  href: string;
  glyph: string;
}

/** The Chat pages the palette lists, in the mockup's order. */
export const CHAT_SEARCH_PAGES: ChatSearchPage[] = [
  { key: 'allChats', href: '/dashboard/chat/all', glyph: '☰' },
  // Agent Center, its own page under Chat on the app's menu.
  { key: 'agents', href: '/dashboard/agents', glyph: '✦' },
  { key: 'files', href: '/dashboard/chat/files', glyph: '▤' },
  { key: 'connections', href: '/dashboard/chat/connections', glyph: '⇄' },
  { key: 'settings', href: '/dashboard/chat/settings', glyph: '⚙' },
];

/** The menus' look (mockup `.pop2`, `.mi2`): opaque, 14px corners, soft shadow. */
const ITEM =
  'flex w-full min-w-0 items-center gap-2 rounded-[9px] px-2 py-[7px] text-left text-[13px] text-foreground outline-none hover:bg-accent';
const HEAD = 'px-2 pt-2 pb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase';

type PaletteItem =
  | { kind: 'new'; id: string }
  | { kind: 'chat'; id: string; chat: ChatListItem }
  | { kind: 'page'; id: string; page: ChatSearchPage };

export interface ChatSearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  /** The strip's Search button, the palette's trigger; without it the palette opens at `anchor`. */
  trigger?: boolean;
  /** Where the palette opens without a trigger: under the menu's Search chats field. */
  anchor?: () => Element | null;
  /** The pages it can open (CHAT_SEARCH_PAGES by default). */
  pages?: ChatSearchPage[];
}

/**
 * The Ctrl K palette (CHAT-23 G2; mockup `#msearch`). Typing filters chats
 * (titles and messages, on the server) and pages (by name, here); ↑ ↓ move,
 * Enter opens the highlighted row — the first match by default, or a new
 * chat when nothing matches; Esc, ✕-less click outside or Ctrl K again close
 * it. Opening a row closes it.
 */
export function ChatSearchPalette({
  open,
  onOpenChange,
  onNewChat,
  trigger = false,
  anchor,
  pages = CHAT_SEARCH_PAGES,
}: ChatSearchPaletteProps) {
  const t = useTranslations('chatShell.search');
  const tMenu = useTranslations('chatShell.menu');
  const isMac = useIsMac();
  const router = useRouter();
  const { chats: recent } = useChatList();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const found = useChatSearch(query);
  const q = query.trim().toLowerCase();

  // Each opening starts empty.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');
    setActive(0);
  }, [open]);

  const chats = useMemo(
    () =>
      q
        ? found.chats
        : [...recent]
            .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
            .slice(0, RECENT_IN_PALETTE),
    [found.chats, q, recent],
  );
  const shownPages = pages.filter((page) => !q || t(`pages.${page.key}`).toLowerCase().includes(q));
  const items: PaletteItem[] = [
    { kind: 'new', id: 'new' },
    ...chats.map((chat) => ({ kind: 'chat' as const, id: `chat-${chat.id}`, chat })),
    ...shownPages.map((page) => ({ kind: 'page' as const, id: `page-${page.key}`, page })),
  ];
  // Typing highlights the first match: the first chat, else the first page, else New chat.
  const first = q ? Math.min(1, items.length - 1) : 0;
  const current = Math.min(active === -1 ? first : active, items.length - 1);

  const pick = (item: PaletteItem) => {
    onOpenChange(false);
    if (item.kind === 'new') onNewChat();
    else if (item.kind === 'chat') router.push(`/dashboard/chat/${item.chat.id}`);
    else router.push(item.page.href);
  };

  const row = (item: PaletteItem, index: number, children: ReactNode, action: string) => (
    <button
      key={item.id}
      id={`chat-search-${item.id}`}
      type="button"
      role="option"
      aria-selected={index === current}
      data-action={action}
      onMouseMove={() => setActive(index)}
      onClick={() => pick(item)}
      className={cn(ITEM, index === current && 'bg-accent')}
    >
      {children}
    </button>
  );

  const searching = q && found.status === 'loading' && chats.length === 0;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <PopoverTrigger
          data-action="search.open"
          aria-haspopup="dialog"
          title={t('openTip', { keys: shortcutLabel('search', isMac) })}
          className="flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t('open')}
          <kbd className="rounded-[4px] border px-1 font-sans text-[11px] font-normal text-muted-foreground">
            {shortcutLabel('search', isMac)}
          </kbd>
        </PopoverTrigger>
      )}
      <PopoverContent
        anchor={trigger ? undefined : anchor}
        align="start"
        initialFocus={input}
        aria-label={t('label')}
        className="w-[320px] max-w-[calc(100vw-32px)] rounded-[14px] p-1.5 shadow-[0_12px_32px_rgba(10,10,10,.12)] ring-0 border motion-reduce:animate-none!"
      >
        <input
          ref={input}
          data-action="search.input"
          role="combobox"
          aria-expanded
          aria-controls="chat-search-list"
          aria-activedescendant={items[current] ? `chat-search-${items[current].id}` : undefined}
          aria-label={t('placeholder')}
          placeholder={t('placeholder')}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((current + step + items.length) % items.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              // Nothing matches: Enter starts a new chat.
              const item = q && items.length === 1 ? items[0] : items[current];
              if (item) pick(item);
            }
          }}
          className="mx-0.5 mt-0.5 mb-1.5 block w-[calc(100%-4px)] rounded-lg border bg-background px-[9px] py-1.5 text-[12.5px] outline-none focus:border-foreground/30"
        />
        <div id="chat-search-list" role="listbox" aria-label={t('label')}>
          {row(
            items[0],
            0,
            <>
              <span aria-hidden className="w-3.5 shrink-0 text-center">
                ＋
              </span>
              <span className="flex-1">{tMenu('newChat')}</span>
            </>,
            'chat.new',
          )}
          <div className={HEAD}>{t('chats')}</div>
          {chats.map((chat, i) => {
            const { line } = chatLineOf(chat, tMenu);
            return row(
              items[i + 1],
              i + 1,
              <>
                <span className="min-w-0 flex-1 truncate">{chat.title ?? tMenu('untitled')}</span>
                {line && (
                  <span className="max-w-[45%] shrink-0 truncate text-[11.5px] text-muted-foreground">
                    {line}
                  </span>
                )}
              </>,
              'search.openChat',
            );
          })}
          {searching && (
            <p className="px-2 py-2 text-[12.5px] text-muted-foreground">{t('searching')}</p>
          )}
          {q && found.status === 'error' && chats.length === 0 && (
            <p className="px-2 py-2 text-[12.5px] text-muted-foreground">{t('failed')}</p>
          )}
          {((q && found.status === 'ready') || !q) && chats.length === 0 && (
            <p className="px-2 py-2 text-[12.5px] text-muted-foreground">{t('noMatch')}</p>
          )}
          {shownPages.length > 0 && <div className={HEAD}>{t('pagesHead')}</div>}
          {shownPages.map((page, i) =>
            row(
              items[chats.length + 1 + i],
              chats.length + 1 + i,
              <>
                <span aria-hidden className="w-3.5 shrink-0 text-center">
                  {page.glyph}
                </span>
                <span className="flex-1">{t(`pages.${page.key}`)}</span>
              </>,
              'search.openPage',
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
