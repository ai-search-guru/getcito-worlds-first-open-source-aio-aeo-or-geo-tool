'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { DotLegend } from '@/components/agentic/DotLegend';
import { NewPill } from '@/components/agentic/NewPill';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { Skeleton } from '@/components/ui/skeleton';
import { aiUsageTone, percentLabel } from '@/lib/billing/aiUsage';
import type { ChatListItem } from '@/lib/chat/conversations';
import { AT_WORK_ROWS, chatMenuLists, type DayGroup } from '@/lib/chat/menuGroups';
import { cn } from '@/lib/utils';
import { readAgentsSeen } from './agents/AgentsSeen';
import { ConnectionsMenu } from './connections/ConnectionsMenu';
import { useChatList, type ChatListStatus } from './ChatListProvider';
import { ChatRowMenu } from './ChatMenus';
import { ChatRow } from './ChatRow';
import { useChatSearch } from './ChatSearch';
import { MenuToggleIcon, shortcutLabel, useIsMac } from './ChatShortcuts';

/** The menu's sections the person folded, remembered in this browser. */
const SECTIONS_KEY = 'getcito.chatMenu.sections';
type Section = 'menu' | 'atWork' | 'chats' | 'connections';

/** As the menu opens: every section shown, but Connections' list (agentic plan §6: closed by default). */
const FOLDED: Record<Section, boolean> = {
  menu: false,
  atWork: false,
  chats: false,
  connections: true,
};

function readFolded(): Record<Section, boolean> {
  const none = FOLDED;
  try {
    const raw = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) ?? '{}');
    return { ...none, ...(typeof raw === 'object' && raw ? raw : {}) };
  } catch {
    return none;
  }
}

function saveFolded(folded: Record<Section, boolean>) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(folded));
  } catch {
    // Private windows and full storage: it is only folded for this visit.
  }
}

/** The ▴ / ▾ at a section's right: hides or shows the section. */
function FoldButton({
  folded,
  label,
  controls,
  action,
  onClick,
}: {
  folded: boolean;
  label: string;
  controls: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-action={action}
      aria-label={label}
      title={label}
      aria-expanded={!folded}
      aria-controls={controls}
      onClick={onClick}
      className="ml-auto flex size-[22px] items-center justify-center rounded-md text-[13px] text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {folded ? '▾' : '▴'}
    </button>
  );
}

/** A section's small uppercase title, with its count and controls. */
function SectionHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mx-2 mt-3 mb-1 flex items-center gap-1.5 text-[11px] tracking-[.4px] text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Count({ value, title }: { value: number; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-md bg-foreground/10 px-[5px] text-[10.5px] tracking-normal text-foreground/80 tabular-nums normal-case"
    >
      {value.toLocaleString('en-US')}
    </span>
  );
}

/** A menu item (Home, Activity…): one 32px row; grey while it is the page shown. */
function MenuItem({
  href,
  action,
  active,
  onNavigate,
  label,
  children,
}: {
  href: string;
  action: string;
  active: boolean;
  onNavigate?: () => void;
  /** Its name for a screen reader when the visible words and counts don't say it all. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-action={action}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] leading-[18px] text-foreground/80 outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'bg-sidebar-accent font-medium text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The workspace's AI usage this month beside Settings (mockup `.usg2`): a
 * 30px bar and its percent, amber from 80%, red when used up. In the free
 * trial it names no share, as the header's meter (AI usage spec §3.1):
 * "Trial credit", "Almost used" from 80%, then "Used up". Nothing where
 * there is no allowance to meter (self-hosted) or before it is read.
 */
function UsageMeter() {
  const t = useTranslations('chatShell.menu');
  const tMeter = useTranslations('aiUsage.meter');
  const { usage } = useAiUsage();
  if (!usage || usage.percentUsed === null) return null;
  const tone = aiUsageTone(usage);
  if (usage.trial && tone !== 'unlimited') {
    return (
      <span
        title={tMeter(`trialLabel.${tone}`)}
        className={cn(
          'ml-auto text-[11.5px] font-normal text-muted-foreground',
          tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          tone === 'exhausted' && 'text-red-700 dark:text-red-400',
        )}
      >
        {tMeter(`trial.${tone}`)}
      </span>
    );
  }
  return (
    <span
      title={t('usageTip')}
      className="ml-auto inline-flex items-center gap-[5px] text-[11.5px] font-normal text-muted-foreground tabular-nums"
    >
      <span aria-hidden className="h-1 w-[30px] overflow-hidden rounded bg-foreground/10">
        <i
          className={cn(
            'block h-full rounded',
            tone === 'exhausted'
              ? 'bg-red-600 dark:bg-red-400'
              : tone === 'warning'
                ? 'bg-amber-600 dark:bg-amber-400'
                : 'bg-foreground',
          )}
          style={{ width: `${Math.min(100, usage.percentUsed)}%` }}
        />
      </span>
      {percentLabel(usage.percentUsed)}
    </span>
  );
}

function groupLabel(group: DayGroup, t: ReturnType<typeof useTranslations>, now: Date): string {
  if (group.kind !== 'calendar') return t(`groups.${group.kind}`);
  return group.month.toLocaleDateString('en-US', {
    month: 'long',
    ...(group.month.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export interface ChatMenuViewProps {
  status: ChatListStatus;
  chats: ChatListItem[];
  total: number;
  /** The person's archived chats ("Archived · 2 ›"). */
  archived?: number;
  pathname: string;
  /** Whether the menu is shown: its toggle says Hide or Show. */
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onRetry: () => void;
  /** After a link is followed: the drawer closes. */
  onNavigate?: () => void;
  /** Each row's ⋯ menu. */
  rowActions?: (chat: ChatListItem) => ReactNode;
  now?: Date;
}

/**
 * The chat menu, top to bottom (CHAT-01 items 6, 9a; agentic update; mockup
 * CHAT-mockup-v2.html, the menu on every #s-… screen): the toggle and
 * "＋ New chat"; Menu (Home; Inbox, with its count and an amber dot while
 * something needs the person; Agents, with "New" until it is first opened
 * (governance mockup #cnav); Settings, with the month's AI usage; Files); Governance (Activity, What Chat can do, Tool
 * policy: the governance mockup's menu, #cnav); Agents at work (needs you,
 * running, unread results: three rows, See all, Show less, the dots'
 * legend); Chats with its count, Search chats (typing lists the chats
 * whose title or messages match, in place of the days; Ctrl K opens the
 * palette under it), Pinned, then by day, and All chats and Archived at the
 * end. Items whose pages aren't built yet stay out (Skills, Integrations,
 * Scheduled). Sections fold, remembered in this
 * browser.
 */
export function ChatMenuView({
  status,
  chats,
  total,
  archived = 0,
  pathname,
  open,
  onToggle,
  onNewChat,
  onRetry,
  onNavigate,
  rowActions,
  now: nowProp,
}: ChatMenuViewProps) {
  const t = useTranslations('chatShell.menu');
  const tAttention = useTranslations('agentic.attention');
  const isMac = useIsMac();
  const [folded, setFolded] = useState<Record<Section, boolean>>(FOLDED);
  const [allRuns, setAllRuns] = useState(false);
  const [query, setQuery] = useState('');
  const found = useChatSearch(query);
  const searching = query.trim() !== '';
  // The "New" pill beside Agent Center, until it is first opened in this browser.
  const [agentsNew, setAgentsNew] = useState(false);
  useEffect(() => {
    // Browser storage exists only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolded(readFolded());
    setAgentsNew(!readAgentsSeen());
  }, []);
  const fold = (section: Section) =>
    setFolded((was) => {
      const next = { ...was, [section]: !was[section] };
      saveFolded(next);
      return next;
    });

  // Read the clock again with every list read, so a menu left open past
  // midnight moves Today's chats to Yesterday.
  const { now, atWork, groups } = useMemo(() => {
    const at = nowProp ?? new Date();
    return { now: at, ...chatMenuLists(chats, at) };
  }, [chats, nowProp]);
  // The Inbox holds the person's own chats in Agents at work: its count, with
  // an amber dot while any needs them.
  const inboxRows = atWork.filter((chat) => chat.mine);
  const needsYou = inboxRows.filter((chat) => chat.state === 'needsYou').length;
  const inbox = inboxRows.length;
  const inboxLabel = needsYou
    ? t('inboxLabelNeedsYou', { count: inbox, needsYou })
    : t('inboxLabel', { count: inbox });
  const shownRuns = allRuns ? atWork : atWork.slice(0, AT_WORK_ROWS);
  const row = (chat: ChatListItem) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      active={pathname === `/dashboard/chat/${chat.id}`}
      onOpen={onNavigate}
      actions={rowActions?.(chat)}
      now={now}
    />
  );

  return (
    <nav aria-label={t('label')} className="flex h-full min-h-0 flex-col gap-1 p-3 text-[13px]">
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          data-action="chatMenu.toggle"
          aria-label={open ? t('hide') : t('show')}
          title={t(open ? 'hideTip' : 'showTip', { keys: shortcutLabel('menu', isMac) })}
          aria-expanded={open}
          aria-controls="chat-menu"
          onClick={onToggle}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <MenuToggleIcon />
        </button>
        <button
          type="button"
          data-action="chat.new"
          title={t('newChatTip', { keys: shortcutLabel('new', isMac) })}
          onClick={onNewChat}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] border bg-card px-2.5 font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span aria-hidden>＋</span>
          {t('newChat')}
          <kbd className="ml-auto font-sans text-[11px] text-muted-foreground">
            {shortcutLabel('new', isMac)}
          </kbd>
        </button>
      </div>

      <SectionHead className="mt-0">
        {t('menu')}
        {folded.menu && inbox > 0 && (
          <Link
            href="/dashboard/chat/inbox"
            data-action="chatMenu.openInbox"
            aria-label={inboxLabel}
            title={inboxLabel}
            onClick={onNavigate}
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground/10 px-1.5 text-[10.5px] leading-4 tracking-normal text-foreground/80 normal-case outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {needsYou > 0 && (
              <span aria-hidden className="size-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
            )}
            {inbox}
          </Link>
        )}
        <FoldButton
          folded={folded.menu}
          label={t('toggleMenu')}
          controls="chat-menu-items"
          action="chatMenu.toggleMenuSection"
          onClick={() => fold('menu')}
        />
      </SectionHead>
      {!folded.menu && (
        <div id="chat-menu-items" className="flex flex-col gap-0.5">
          <MenuItem
            href="/dashboard/chat"
            action="chatMenu.openHome"
            active={pathname === '/dashboard/chat'}
            onNavigate={onNavigate}
          >
            {t('home')}
          </MenuItem>
          <MenuItem
            href="/dashboard/chat/inbox"
            action="chatMenu.openInbox"
            active={pathname === '/dashboard/chat/inbox'}
            onNavigate={onNavigate}
            label={inbox > 0 ? inboxLabel : undefined}
          >
            {t('inbox')}
            {inbox > 0 && (
              <span className="ml-auto inline-flex items-center gap-1.5">
                {needsYou > 0 && (
                  <span
                    aria-hidden
                    title={tAttention('needsYou', { count: needsYou })}
                    className="size-[7px] rounded-full bg-amber-600 dark:bg-amber-400"
                  />
                )}
                <span className="min-w-[22px] rounded-md bg-foreground/10 px-1.5 text-center text-[11px] leading-[18px] text-foreground/80 tabular-nums">
                  {inbox}
                </span>
              </span>
            )}
          </MenuItem>
          {/* Agent Center is its own page, out of Chat: never the one open here. */}
          <MenuItem
            href="/dashboard/agents"
            action="chatMenu.openAgents"
            active={false}
            onNavigate={onNavigate}
          >
            {t('agents')}
            {agentsNew && <NewPill className="ml-auto" />}
          </MenuItem>
          <MenuItem
            href="/dashboard/chat/skills"
            action="chatMenu.openSkills"
            active={pathname === '/dashboard/chat/skills'}
            onNavigate={onNavigate}
          >
            {t('skills')}
          </MenuItem>
          {/* Connections right under Skills (agentic plan §6). */}
          <ConnectionsMenu
            open={!folded.connections}
            onToggle={() => fold('connections')}
            active={pathname === '/dashboard/chat/connections'}
            onNavigate={onNavigate}
          />
          <MenuItem
            href="/dashboard/chat/settings"
            action="chatMenu.openSettings"
            active={pathname === '/dashboard/chat/settings'}
            onNavigate={onNavigate}
          >
            {t('settings')}
            <UsageMeter />
          </MenuItem>
          <MenuItem
            href="/dashboard/chat/files"
            action="chatMenu.openFiles"
            active={pathname === '/dashboard/chat/files'}
            onNavigate={onNavigate}
          >
            {t('files')}
          </MenuItem>
        </div>
      )}

      <SectionHead>{t('governance')}</SectionHead>
      <div className="flex flex-col gap-0.5">
        <MenuItem
          href="/dashboard/chat/activity"
          action="chatMenu.openActivity"
          active={pathname === '/dashboard/chat/activity'}
          onNavigate={onNavigate}
        >
          {t('activity')}
        </MenuItem>
        <MenuItem
          href="/dashboard/chat/capabilities"
          action="chatMenu.openCapabilities"
          active={pathname === '/dashboard/chat/capabilities'}
          onNavigate={onNavigate}
        >
          {t('capabilities')}
        </MenuItem>
        <MenuItem
          href="/dashboard/settings/chat"
          action="chatMenu.openPolicy"
          active={false}
          onNavigate={onNavigate}
        >
          {t('policy')}
        </MenuItem>
      </div>

      {atWork.length > 0 && (
        <>
          <SectionHead>
            {t('atWork')}
            <Count value={atWork.length} />
            <DotLegend className="ml-0.5" />
            <FoldButton
              folded={folded.atWork}
              label={t('toggleAtWork')}
              controls="chat-menu-at-work"
              action="chatMenu.toggleAgentsAtWork"
              onClick={() => fold('atWork')}
            />
          </SectionHead>
          {!folded.atWork && (
            <div id="chat-menu-at-work">
              <div className={cn(allRuns && 'max-h-[260px] overflow-y-auto chat-scroll')}>
                {shownRuns.map(row)}
              </div>
              {atWork.length > AT_WORK_ROWS && (
                <button
                  type="button"
                  data-action={allRuns ? 'chatMenu.showLessRuns' : 'chatMenu.seeAllRuns'}
                  aria-expanded={allRuns}
                  aria-controls="chat-menu-at-work"
                  onClick={() => setAllRuns((was) => !was)}
                  className="block w-full rounded-lg py-[5px] pr-2 pl-[33px] text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {allRuns ? t('showLess') : t('seeAll', { count: atWork.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="chat-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <SectionHead>
          {t('chats')}
          {status === 'ready' && <Count value={total} />}
          <FoldButton
            folded={folded.chats}
            label={t('toggleChats')}
            controls="chat-menu-chats"
            action="chatMenu.toggleChats"
            onClick={() => fold('chats')}
          />
        </SectionHead>
        {!folded.chats && (
          <div id="chat-menu-chats">
            {status === 'loading' && (
              <div className="flex flex-col gap-2 px-2 py-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {status === 'error' && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
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
            {status === 'ready' && (
              <input
                id="chat-menu-search"
                type="search"
                data-action="chatMenu.searchChats"
                aria-label={t('searchLabel')}
                title={t('searchTip', { keys: shortcutLabel('search', isMac) })}
                placeholder={t('searchPlaceholder', { keys: shortcutLabel('search', isMac) })}
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && query) {
                    event.stopPropagation();
                    setQuery('');
                  }
                }}
                className="mt-1.5 mb-1 block w-full rounded-lg border bg-background px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-muted-foreground focus:border-foreground/30 [&::-webkit-search-cancel-button]:hidden"
              />
            )}
            {searching ? (
              <div role="region" aria-label={t('searchResults')} aria-live="polite">
                {found.chats.map(row)}
                {found.status === 'ready' && found.chats.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">
                    {t('noMatch')}{' '}
                    <button
                      type="button"
                      data-action="emptyState.clearFilters"
                      onClick={() => setQuery('')}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      {t('clearSearch')}
                    </button>
                  </p>
                )}
                {found.status === 'error' && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">{t('searchFailed')}</p>
                )}
              </div>
            ) : (
              <>
                {status === 'ready' && groups.length === 0 && atWork.length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">{t('empty')}</p>
                )}
                {groups.map((group) => (
                  <div key={group.key}>
                    <SectionHead>{groupLabel(group.group, t, now)}</SectionHead>
                    {group.chats.map(row)}
                  </div>
                ))}
              </>
            )}
            {status === 'ready' && (
              <div className="mt-1">
                <Link
                  href="/dashboard/chat/all"
                  data-action="chatMenu.openAllChats"
                  onClick={onNavigate}
                  className="block w-full rounded-lg p-2 text-[12.5px] text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t('allChats', { count: total })}
                </Link>
                <Link
                  href="/dashboard/chat/all?tab=archived"
                  data-action="chatMenu.openArchived"
                  onClick={onNavigate}
                  className="block w-full rounded-lg p-2 text-[12.5px] text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {t('archivedLink', { count: archived })}
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

/** The chat menu with the person's chats from the shell's list. */
export function ChatMenu(
  props: Omit<
    ChatMenuViewProps,
    'status' | 'chats' | 'total' | 'archived' | 'pathname' | 'onRetry'
  >,
) {
  const { status, chats, total, archived, refresh } = useChatList();
  const pathname = usePathname();
  return (
    <ChatMenuView
      rowActions={(chat) => <ChatRowMenu chat={chat} />}
      {...props}
      status={status}
      chats={chats}
      total={total}
      archived={archived}
      pathname={pathname}
      onRetry={() => void refresh()}
    />
  );
}
