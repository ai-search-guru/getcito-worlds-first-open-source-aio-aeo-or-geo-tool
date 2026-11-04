'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { ListDot } from '@/components/agentic/ListDot';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChatListItem, ChatListResult } from '@/lib/chat/conversations';
import { agoOf } from '@/lib/chat/home';
import { cn } from '@/lib/utils';
import { useChatList } from './ChatListProvider';
import { useNow } from './ChatInbox';
import { chatLineOf, rowTime } from './ChatRow';
import { useChatSearch } from './ChatSearch';

/**
 * All chats (CHAT-01 agentic update; CHAT-23 `allChats.*`; mockup
 * #s-allchats): every chat the person sees, under Active and Archived, with
 * a search over titles and results, the filters All · Running · Needs you ·
 * Done · Mine · Team, and Archive selected (Unarchive selected under
 * Archived) for the person's own chats. A row opens its chat.
 */

export type AllChatsTab = 'active' | 'archived';
export type AllChatsFilter = 'all' | 'running' | 'needsYou' | 'done' | 'mine' | 'team';

const FILTERS: AllChatsFilter[] = ['all', 'running', 'needsYou', 'done', 'mine', 'team'];

/** All chats reads up to this many rows per tab (the list API's most). */
const ALL_CHATS_LIMIT = 200;
/** Archive selected sends this many changes at a time. */
const BULK_AT_ONCE = 5;
const TOAST_MS = 2_200;

/** Whether a chat passes a filter chip. */
export function passesFilter(chat: ChatListItem, filter: AllChatsFilter): boolean {
  switch (filter) {
    case 'running':
      return chat.state === 'running' || chat.state === 'paused';
    case 'needsYou':
      return chat.state === 'needsYou';
    case 'done':
      return chat.state !== 'running' && chat.state !== 'paused' && chat.state !== 'needsYou';
    case 'mine':
      return chat.mine;
    case 'team':
      return chat.shared;
    default:
      return true;
  }
}

/** The table's columns (mockup `.chats`): select · chat · skill · owner · updated. */
const COLS =
  'grid grid-cols-[24px_minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,.7fr)] items-center gap-3 px-3.5 max-[900px]:grid-cols-[24px_minmax(0,1fr)]';
const HIDE_NARROW = 'max-[900px]:hidden';

function tabList(view: AllChatsTab) {
  return `/api/chat/conversations?view=${view}&limit=${ALL_CHATS_LIMIT}`;
}

/** Sends one change to a chat; whether it was kept. */
async function setArchived(id: string, archived: boolean): Promise<boolean> {
  const res = await fetch(`/api/chat/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ archived }),
  }).catch(() => null);
  return !!res?.ok;
}

export function ChatAllChats({
  initialTab = 'active',
  ownInitials,
}: {
  initialTab?: AllChatsTab;
  /** The person's own initials, for the Owner of their chats. */
  ownInitials: string | null;
}) {
  const t = useTranslations('chatShell.allChats');
  const tMenu = useTranslations('chatShell.menu');
  const tActions = useTranslations('chatShell.actions');
  const router = useRouter();
  const now = useNow();
  const { refresh: refreshMenu } = useChatList();
  const [tab, setTab] = useState<AllChatsTab>(initialTab);
  const [filter, setFilter] = useState<AllChatsFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lists, setLists] = useState<{
    status: 'loading' | 'ready' | 'error';
    active: ChatListItem[];
    archived: ChatListItem[];
    total: number;
    archivedCount: number;
  }>({ status: 'loading', active: [], archived: [], total: 0, archivedCount: 0 });

  const load = useCallback(async () => {
    const read = async (view: AllChatsTab) => {
      const res = await fetch(tabList(view), { cache: 'no-store' }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as
        ({ ok: true } & ChatListResult) | { ok: false } | null;
      return res?.ok && body?.ok ? body : null;
    };
    const [active, archived] = await Promise.all([read('active'), read('archived')]);
    if (!active || !archived) {
      setLists((was) => (was.status === 'ready' ? was : { ...was, status: 'error' }));
      return;
    }
    setLists({
      status: 'ready',
      active: active.chats,
      archived: archived.chats,
      total: active.total,
      archivedCount: active.archived,
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const found = useChatSearch(query, tab);
  const searching = query.trim() !== '';
  const source = searching ? found.chats : tab === 'active' ? lists.active : lists.archived;
  const rows = useMemo(() => source.filter((chat) => passesFilter(chat, filter)), [source, filter]);
  const counts = useMemo(() => {
    const all = tab === 'active' ? lists.active : lists.archived;
    return {
      running: all.filter((c) => passesFilter(c, 'running')).length,
      needsYou: all.filter((c) => passesFilter(c, 'needsYou')).length,
    };
  }, [lists, tab]);
  const filtered = searching || filter !== 'all';
  const loading =
    lists.status === 'loading' || (searching && found.status === 'loading' && rows.length === 0);

  const switchTab = (next: AllChatsTab) => {
    setTab(next);
    setSelected(new Set());
    try {
      window.history.replaceState(
        null,
        '',
        next === 'archived' ? '/dashboard/chat/all?tab=archived' : '/dashboard/chat/all',
      );
    } catch {
      // The address only remembers the tab; the page works without it.
    }
  };

  const toggle = (id: string) =>
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulk = async () => {
    if (busy || selected.size === 0) return;
    const archive = tab === 'active';
    const ids = [...selected];
    setBusy(true);
    let done = 0;
    for (let i = 0; i < ids.length; i += BULK_AT_ONCE) {
      const kept = await Promise.all(
        ids.slice(i, i + BULK_AT_ONCE).map((id) => setArchived(id, archive)),
      );
      done += kept.filter(Boolean).length;
    }
    setBusy(false);
    setSelected(new Set());
    if (done > 0) {
      toast(t(archive ? 'archivedMany' : 'unarchivedMany', { count: done }), {
        duration: TOAST_MS,
      });
    }
    if (done < ids.length) toast.error(tActions('failed'));
    await load();
    void refreshMenu();
  };

  const owner = (chat: ChatListItem) => (chat.mine ? ownInitials : chat.ownerInitials) ?? '—';
  const when = (iso: string) => {
    if (!now) return '';
    const ago = agoOf(iso, now);
    if (ago.kind === 'now') return t('ago.now');
    if (ago.kind === 'minutes') return t('ago.minutes', { minutes: ago.minutes });
    if (ago.kind === 'yesterday') return t('ago.yesterday');
    return rowTime(iso, now);
  };

  return (
    <div className="max-w-[1100px]">
      <div className="mb-3.5 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            data-action={
              tab === 'active' ? 'allChats.archiveSelected' : 'allChats.unarchiveSelected'
            }
            disabled={selected.size === 0 || busy}
            title={selected.size === 0 ? t('selectFirst') : undefined}
            onClick={() => void bulk()}
          >
            {t(tab === 'active' ? 'archiveSelected' : 'unarchiveSelected')}
          </Button>
        </div>
      </div>

      <div
        role="tablist"
        aria-label={t('title')}
        className="mb-3 flex gap-[18px] border-b text-[13.5px]"
      >
        {(['active', 'archived'] as const).map((view) => (
          <button
            key={view}
            type="button"
            role="tab"
            data-action="allChats.tab"
            aria-selected={tab === view}
            onClick={() => switchTab(view)}
            className={cn(
              'py-2 text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tab === view &&
                'font-semibold text-foreground shadow-[inset_0_-2px_0_var(--foreground)]',
            )}
          >
            {t(`tabs.${view}`)}
            {lists.status === 'ready' && (
              <i className="ml-1 rounded-md bg-foreground/10 px-[5px] text-[11px] font-medium not-italic text-foreground/80 tabular-nums">
                {(view === 'active' ? lists.total : lists.archivedCount).toLocaleString('en-US')}
              </i>
            )}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          data-action="allChats.search"
          aria-label={t('searchPlaceholder')}
          placeholder={t('searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-7 min-w-[200px] rounded-lg border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
        />
        {FILTERS.map((f) => {
          const count = f === 'running' ? counts.running : f === 'needsYou' ? counts.needsYou : 0;
          return (
            <button
              key={f}
              type="button"
              data-action="allChats.filter"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-7 rounded-full border bg-card px-2.5 text-[12.5px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                filter === f && 'border-foreground/40 bg-muted font-medium text-foreground',
              )}
            >
              {t(`filters.${f}`)}
              {count > 0 && (
                <i className="ml-1 rounded-md bg-foreground/10 px-[5px] text-[11px] font-medium not-italic text-foreground/80 tabular-nums">
                  {count}
                </i>
              )}
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-[14px] border">
        <div
          className={cn(
            COLS,
            'bg-muted/50 py-2.5 text-[11px] tracking-[.3px] text-muted-foreground uppercase max-[900px]:hidden',
          )}
        >
          <span />
          <span>{t('columns.chat')}</span>
          <span>{t('columns.skill')}</span>
          <span>{t('columns.owner')}</span>
          <span>{t('columns.updated')}</span>
        </div>
        {loading && (
          <div aria-hidden className="flex flex-col gap-2 border-t p-3.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        )}
        {lists.status === 'error' && (
          <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
            {t('loadFailed')}{' '}
            <button
              type="button"
              onClick={() => void load()}
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t('retry')}
            </button>
          </p>
        )}
        {!loading &&
          lists.status === 'ready' &&
          rows.map((chat) => {
            const { line, tone } = chatLineOf(chat, tMenu, now ?? undefined);
            const href = `/dashboard/chat/${chat.id}`;
            return (
              <div
                key={chat.id}
                role="link"
                tabIndex={0}
                data-action="allChats.openChat"
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    router.push(href);
                  }
                }}
                className={cn(
                  COLS,
                  'min-h-[58px] cursor-pointer border-t py-2.5 text-sm outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
                )}
              >
                <span>
                  {chat.mine && (
                    <input
                      type="checkbox"
                      data-action="allChats.select"
                      aria-label={t('select')}
                      checked={selected.has(chat.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggle(chat.id)}
                      className="size-3.5 accent-foreground"
                    />
                  )}
                </span>
                <span className="flex min-w-0 items-start gap-2">
                  <ListDot state={chat.state} className="mt-0.5" />
                  <span className="min-w-0">
                    <b
                      className={cn(
                        'block truncate',
                        chat.unread ? 'font-semibold' : 'font-medium',
                      )}
                      title={chat.title ?? undefined}
                    >
                      {chat.title ?? tMenu('untitled')}
                    </b>
                    {line && (
                      <em
                        className={cn(
                          'block truncate text-xs not-italic text-muted-foreground',
                          tone === 'amber' && 'text-amber-700 dark:text-amber-400',
                          tone === 'red' && 'text-red-700 dark:text-red-400',
                        )}
                      >
                        {line}
                      </em>
                    )}
                  </span>
                </span>
                <span className={cn('text-muted-foreground', HIDE_NARROW)}>{t('noSkill')}</span>
                <span className={cn('text-[13px]', HIDE_NARROW)}>{owner(chat)}</span>
                <span className={cn('text-[13px] text-muted-foreground', HIDE_NARROW)}>
                  {when(chat.lastMessageAt)}
                </span>
              </div>
            );
          })}
        {!loading && lists.status === 'ready' && rows.length === 0 && (
          <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
            {t('noMatch')}
            {filtered && (
              <>
                {' '}
                <button
                  type="button"
                  data-action="emptyState.clearFilters"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('clearFilters')}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
