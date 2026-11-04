'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Inbox as InboxIcon } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { ListProgress } from '@/components/agentic/ListDot';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import type { ChatNotice } from '@/lib/actions/chatNotices';
import type { ChatListItem } from '@/lib/chat/conversations';
import { agoOf } from '@/lib/chat/home';
import { chatMenuLists } from '@/lib/chat/menuGroups';
import { cn } from '@/lib/utils';
import type { ChatListStatus } from './ChatListProvider';
import { INBOX_ROW, SuggestionRows, SuggestionsPanel, type InboxDaily } from './InboxSuggestions';
import { NoticeRows } from './InboxNotices';

/**
 * The Inbox's rows: what needs the person, what runs, and unread results —
 * their own chats in Agents at work. A teammate's shared chat waits on its
 * author, who alone can answer it, so it is never one that "needs you".
 */
export function inboxItems(chats: ChatListItem[], now = new Date()): ChatListItem[] {
  return chatMenuLists(chats, now).atWork.filter((chat) => chat.mine);
}

/** The Inbox's counts: needs you, running, and results that came in today. */
export function inboxCounts(items: ChatListItem[], now = new Date()) {
  const today = now.toDateString();
  return {
    total: items.length,
    needsYou: items.filter((c) => c.state === 'needsYou').length,
    running: items.filter((c) => c.state === 'running' || c.state === 'paused').length,
    doneToday: items.filter(
      (c) =>
        (c.state === 'done' || c.state === 'failed') &&
        !!c.finishedAt &&
        new Date(c.finishedAt).toDateString() === today,
    ).length,
  };
}

/**
 * The Inbox's topics (CHAT-26 §2.1): everything, the daily suggestions, what
 * needs the person, and their agents' runs. Reports and Alerts stay hidden
 * until they have something to hold (scheduled reports, CHAT-12; watch
 * rules, CHAT-22).
 */
export const INBOX_TABS = ['all', 'suggestions', 'needsYou', 'runs'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

/** A topic from the address (`?tab=`): All for none, or one that isn't a topic. */
export function inboxTabOf(value: string | null | undefined): InboxTab {
  return (INBOX_TABS as readonly string[]).includes(value ?? '') ? (value as InboxTab) : 'all';
}

/**
 * Each topic's rows: Needs you and Runs split the chats; All holds them and
 * the suggestions. Notices (00441) are in Needs you and All.
 */
export function inboxTabCounts(
  items: ChatListItem[],
  suggestions: number,
  notices = 0,
): Record<InboxTab, number> {
  const needsYou = items.filter((c) => c.state === 'needsYou').length;
  return {
    all: items.length + suggestions + notices,
    suggestions,
    needsYou: needsYou + notices,
    runs: items.length - needsYou,
  };
}

/** The chats a topic lists: none on Daily suggestions. */
export function inboxTabChats(items: ChatListItem[], tab: InboxTab): ChatListItem[] {
  if (tab === 'suggestions') return [];
  if (tab === 'needsYou') return items.filter((c) => c.state === 'needsYou');
  if (tab === 'runs') return items.filter((c) => c.state !== 'needsYou');
  return items;
}

/** The person's clock, read after hydration: null while rendering on the server. */
function useNow(): Date | null {
  const minute = useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, 60_000);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return useMemo(() => (minute === null ? null : new Date(minute * 60_000)), [minute]);
}

function InboxRow({ chat, now }: { chat: ChatListItem; now: Date | null }) {
  const t = useTranslations('chatShell.inbox');
  const tLine = useTranslations('chatShell.menu');
  const router = useRouter();
  const href = `/dashboard/chat/${chat.id}`;
  const step = chat.progress ? Math.min(chat.progress.done + 1, chat.progress.total) : 0;
  const total = chat.progress?.total ?? 0;
  const needs = chat.state === 'needsYou';
  const running = chat.state === 'running' || chat.state === 'paused';
  const failed = chat.state === 'failed';

  let line: string | null = chat.step;
  if (needs) line = total ? tLine('line.needsYouStep', { step, total }) : tLine('line.needsYou');
  else if (running && total) {
    line = chat.step
      ? tLine('line.runningStep', { step, total, label: chat.step })
      : tLine('line.runningCount', { step, total });
  } else if (running) line = tLine('line.running');
  else if (failed) line = tLine('line.failed');
  else line = chat.brand;

  const ago = now ? agoOf(chat.finishedAt ?? chat.lastMessageAt, now) : null;
  const when = !ago
    ? ''
    : ago.kind === 'minutes'
      ? t('ago.minutes', { minutes: ago.minutes })
      : ago.kind === 'day'
        ? ago.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : t(`ago.${ago.kind}`);

  return (
    <div
      role="link"
      tabIndex={0}
      data-action="inbox.openItem"
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          router.push(href);
        }
      }}
      className={cn(
        INBOX_ROW,
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        needs && 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          needs && 'bg-amber-600 dark:bg-amber-400',
          running && 'bg-foreground',
          chat.state === 'done' && 'bg-green-600 dark:bg-green-400',
          failed && 'bg-red-600 dark:bg-red-400',
        )}
      />
      <span className="min-w-0 truncate text-[13.5px]">
        <span className={cn(chat.unread && 'font-semibold')}>
          {chat.title ?? tLine('untitled')}
        </span>
        {line && (
          <span
            className={cn(
              'block truncate text-xs text-muted-foreground',
              needs && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {line}
          </span>
        )}
      </span>
      {running && chat.progress ? (
        <ListProgress
          className="h-1.5 w-full"
          value={(chat.progress.done / Math.max(chat.progress.total, 1)) * 100}
        />
      ) : (
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">{when}</span>
      )}
      <Link
        href={href}
        data-action={needs ? 'inbox.review' : running ? 'inbox.watch' : 'inbox.openReport'}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          buttonVariants({ variant: needs ? 'default' : 'outline', size: 'sm' }),
          'w-full',
        )}
      >
        {t(needs ? 'review' : running ? 'watch' : 'open')}
      </Link>
    </div>
  );
}

export interface ChatInboxViewProps {
  status: ChatListStatus;
  items: ChatListItem[];
  now: Date | null;
  onRetry: () => void;
  /**
   * The person's daily suggestions (CHAT-26): the topic tabs and the
   * suggestions' rows. Absent while the new Chat is off for the workspace
   * or they couldn't be read: the Inbox is then as it was.
   */
  daily?: InboxDaily | null;
  /** The topic open first, from the address (`?tab=`). */
  initialTab?: InboxTab;
  /** The person's open notices (00441), at the top of Needs you. */
  notices?: ChatNotice[];
}

/**
 * The Inbox (mockup #s-inbox; CHAT-01 agentic update): results from the
 * person's agents land here — what needs their OK first (Review), then what
 * runs (its progress, Watch), then results they haven't opened (Open). A
 * row opens its chat. One line and an icon when there is nothing. With the
 * daily suggestions, the same in topic tabs (mockup #d-inbox).
 */
export function ChatInboxView({ daily, initialTab, ...props }: ChatInboxViewProps) {
  return daily ? (
    <TabbedInboxView {...props} daily={daily} initialTab={initialTab} />
  ) : (
    <PlainInboxView {...props} />
  );
}

/** The Inbox before its topic tabs (CHAT-01): one list. */
function PlainInboxView({
  status,
  items,
  now,
  onRetry,
  notices = [],
}: Omit<ChatInboxViewProps, 'daily' | 'initialTab'>) {
  const t = useTranslations('chatShell.inbox');
  const counts = inboxCounts(items, now ?? new Date());
  const needsYou = counts.needsYou + notices.length;
  const summary = [
    needsYou ? t('summary.needsYou', { count: needsYou }) : null,
    counts.running ? t('summary.running', { count: counts.running }) : null,
    counts.doneToday ? t('summary.doneToday', { count: counts.doneToday }) : null,
  ].filter(Boolean);

  return (
    <div className="max-w-[880px]">
      <div className="mb-3.5 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
      </div>
      {status === 'ready' && items.length + notices.length > 0 && (
        <p className="-mt-1 mb-3.5 text-[13px] text-muted-foreground">
          {summary.length > 0 && `${summary.join(' · ')}. `}
          {t('lands')}
        </p>
      )}
      {status === 'loading' && (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px] w-full rounded-[14px]" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <p className="text-sm text-muted-foreground">
          {t('loadFailed')}{' '}
          <button
            type="button"
            onClick={onRetry}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t('retry')}
          </button>
        </p>
      )}
      {status === 'ready' && items.length + notices.length === 0 && (
        <div className="flex items-center gap-2 rounded-[14px] border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <InboxIcon aria-hidden className="size-4" />
          {t('empty')}
        </div>
      )}
      {status === 'ready' && items.length + notices.length > 0 && (
        <div className="flex flex-col gap-2">
          <NoticeRows notices={notices} />
          {items.map((chat) => (
            <InboxRow key={chat.id} chat={chat} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Inbox in topic tabs (CHAT-26 §2.1, §2.2; mockup #d-inbox): the
 * subtitle keeps its counts, with the week's suggestions; each tab shows
 * its count and only its rows. All opens first, or the topic the address
 * names (`?tab=`), which the address keeps as the person moves between
 * them, so coming back from a row opens the same one. The arrow keys move
 * between the topics. The suggestions on screen (All or Daily suggestions)
 * are marked seen. An Analyst, who gets no daily suggestions, has no Daily
 * suggestions tab.
 */
function TabbedInboxView({
  status,
  items,
  now,
  onRetry,
  daily,
  initialTab = 'all',
  notices = [],
}: Omit<ChatInboxViewProps, 'daily'> & { daily: InboxDaily }) {
  const t = useTranslations('chatShell.inbox');
  const gets = daily.read.roleFeed !== 'never';
  const tabFor = (named: InboxTab): InboxTab => (gets || named !== 'suggestions' ? named : 'all');
  const [tab, setTab] = useState<InboxTab>(() => tabFor(initialTab));
  // The address named another topic from outside (the menu's Inbox link): follow it.
  const [named, setNamed] = useState(initialTab);
  if (named !== initialTab) {
    setNamed(initialTab);
    setTab(tabFor(initialTab));
  }
  const ids = useId();
  const tabButtons = useRef<Partial<Record<InboxTab, HTMLButtonElement | null>>>({});
  const suggestions = gets ? daily.read.suggestions : [];
  const suggestionsTotal = gets ? daily.read.total : 0;
  const tabs = INBOX_TABS.filter((name) => gets || name !== 'suggestions');
  const ready = status === 'ready';
  const counts = inboxCounts(items, now ?? new Date());
  const tabCounts = inboxTabCounts(items, suggestionsTotal, notices.length);
  const summary = [
    tabCounts.needsYou ? t('summary.needsYou', { count: tabCounts.needsYou }) : null,
    counts.running ? t('summary.running', { count: counts.running }) : null,
    counts.doneToday ? t('summary.doneToday', { count: counts.doneToday }) : null,
    suggestionsTotal ? t('summary.suggestions', { count: suggestionsTotal }) : null,
  ].filter(Boolean);

  const switchTab = (next: InboxTab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    } catch {
      // The address only remembers the topic; the page works without it.
    }
  };
  // Arrow keys, Home and End move to a topic and open it (the roving tab stop).
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const to =
      event.key === 'ArrowRight'
        ? (i + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (i - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    switchTab(tabs[to]);
    tabButtons.current[tabs[to]]?.focus();
  };

  const onScreen = tab === 'all' || tab === 'suggestions' ? suggestions : [];
  const unseen = onScreen
    .filter((suggestion) => !suggestion.seenAt)
    .map((suggestion) => suggestion.id)
    .join(',');
  const { onSeen } = daily;
  useEffect(() => {
    if (unseen) onSeen(unseen.split(','));
  }, [unseen, onSeen]);

  const chats = inboxTabChats(items, tab);
  // Notices lead Needs you, and All with it.
  const noticesShown = tab === 'all' || tab === 'needsYou' ? notices : [];
  const rows =
    (tab === 'all' ? chats.length + suggestions.length : chats.length) + noticesShown.length;

  return (
    <div className="max-w-[880px]">
      <div className="mb-3.5 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
      </div>
      {ready && (
        <p className="-mt-1 mb-3.5 text-[13px] text-muted-foreground">
          {summary.length > 0 ? `${summary.join(' · ')}. ` : `${t('nothingNeedsYou')} `}
          {t(gets ? 'landsWithSuggestions' : 'lands')}
        </p>
      )}
      <div role="tablist" aria-label={t('tabs.label')} className="mb-4 flex flex-wrap gap-1">
        {tabs.map((name, i) => (
          <button
            key={name}
            ref={(button) => {
              tabButtons.current[name] = button;
            }}
            type="button"
            role="tab"
            id={`${ids}-tab-${name}`}
            aria-controls={`${ids}-panel`}
            tabIndex={tab === name ? 0 : -1}
            data-action="inbox.tab"
            data-tab={name}
            aria-selected={tab === name}
            onClick={() => switchTab(name)}
            onKeyDown={(event) => onTabKey(event, i)}
            className={cn(
              'rounded-lg px-2.5 py-1 text-[12.5px] text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              tab === name && 'bg-muted font-medium text-foreground',
            )}
          >
            {t(`tabs.${name}`)}
            {(ready || name === 'suggestions') && (
              <span className="ml-[5px] text-muted-foreground tabular-nums">
                {tabCounts[name].toLocaleString('en-US')}
              </span>
            )}
          </button>
        ))}
      </div>
      {daily.justStarted && (
        <p className="-mt-1.5 mb-3 text-[12.5px] text-muted-foreground">
          {t('suggestions.started')}
        </p>
      )}
      <div role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>
        {tab === 'suggestions' ? (
          <SuggestionsPanel daily={daily} now={now} />
        ) : (
          <>
            {status === 'loading' && (
              <div className="mb-2 flex flex-col gap-2" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[62px] w-full rounded-[14px]" />
                ))}
              </div>
            )}
            {status === 'error' && (
              <p className="mb-2 text-sm text-muted-foreground">
                {t('loadFailed')}{' '}
                <button
                  type="button"
                  onClick={onRetry}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {rows > 0 ? (
              <div className="flex flex-col gap-2">
                <NoticeRows notices={noticesShown} />
                {chats.map((chat) => (
                  <InboxRow key={chat.id} chat={chat} now={now} />
                ))}
                {tab === 'all' && <SuggestionRows daily={daily} now={now} />}
              </div>
            ) : (
              ready && (
                <div className="flex items-center gap-2 rounded-[14px] border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  <InboxIcon aria-hidden className="size-4" />
                  {t('tabEmpty')}
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { useNow };
