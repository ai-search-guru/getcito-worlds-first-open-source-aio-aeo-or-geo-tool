'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ListDot, ListProgress } from '@/components/agentic/ListDot';
import type { ChatListItem } from '@/lib/chat/conversations';
import { cn } from '@/lib/utils';
import { useChatActions } from './ChatActions';
import { RenameField } from './ChatMenus';

/** A time as the row says it: the clock today ("08:02"), else the day ("Oct 28"). */
export function rowTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A chat's one line under its title (CHAT-01 agentic update, "Chat rows"):
 * the step it is on while it works or waits, the result's time once done,
 * else its brand; amber while it needs the person, red once it stopped.
 * `t` is the `chatShell.menu` translations; `now` decides whether the time is
 * today's (a time) or an earlier day's (a date).
 */
export function chatLineOf(
  chat: ChatListItem,
  t: ReturnType<typeof useTranslations>,
  now: Date = new Date(),
): { line: string | null; tone: 'amber' | 'red' | null } {
  const step = chat.progress ? Math.min(chat.progress.done + 1, chat.progress.total) : 0;
  const total = chat.progress?.total ?? 0;
  switch (chat.state) {
    case 'needsYou':
      return {
        line: total ? t('line.needsYouStep', { step, total }) : t('line.needsYou'),
        tone: 'amber',
      };
    case 'running':
      return {
        line: total
          ? chat.step
            ? t('line.runningStep', { step, total, label: chat.step })
            : t('line.runningCount', { step, total })
          : t('line.running'),
        tone: null,
      };
    case 'paused':
      return {
        line: total ? t('line.pausedStep', { step, total }) : t('line.paused'),
        tone: null,
      };
    case 'done':
      return {
        line: chat.finishedAt
          ? t('line.doneAt', { time: rowTime(chat.finishedAt, now) })
          : t('line.done'),
        tone: null,
      };
    case 'failed':
      return {
        line: chat.finishedAt
          ? t('line.failedAt', { time: rowTime(chat.finishedAt, now) })
          : t('line.failed'),
        tone: 'red',
      };
    default:
      return { line: chat.brand, tone: null };
  }
}

/**
 * A chat in the chat menu (CHAT-01 agentic update, "Chat rows"): its dot,
 * its title — "New chat" shimmering until Chat names it, bold while a result
 * is unread — and one line: the step it is on while it works or waits, the
 * result's time once done, else its brand. A teammate's shared chat shows
 * their initials. A pinned chat shows the pin; double-clicking the title
 * renames it in place. The whole row opens the chat; `actions` (the row's ⋯)
 * sit over its right edge on hover and focus.
 */
export function ChatRow({
  chat,
  active,
  onOpen,
  actions,
  className,
  now,
}: {
  chat: ChatListItem;
  active: boolean;
  onOpen?: () => void;
  actions?: ReactNode;
  className?: string;
  /** The menu's clock, so a row's time and the day groups agree. */
  now?: Date;
}) {
  const t = useTranslations('chatShell.menu');
  const { line, tone: lineTone } = chatLineOf(chat, t, now);
  const title = chat.title ?? t('untitled');
  const chatActions = useChatActions();
  // A pinned chat shows the pin where the dot is, unless it works or waits (CHAT-01 row menu).
  const dot =
    chat.pinned && chat.state === 'idle' ? (
      <span
        aria-hidden
        className="mt-px flex size-4 shrink-0 items-center justify-center text-[10px] text-muted-foreground"
      >
        ⌖
      </span>
    ) : (
      <ListDot state={chat.state} className="mt-px" />
    );

  if (chatActions?.renaming?.id === chat.id && chatActions.renaming.where === 'row') {
    return (
      <div
        className={cn(
          'flex items-start gap-[9px] rounded-[9px] bg-sidebar-accent px-2 py-[7px]',
          className,
        )}
      >
        {dot}
        <RenameField chat={chat} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group/row relative rounded-[9px] hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
        className,
      )}
    >
      <Link
        href={`/dashboard/chat/${chat.id}`}
        data-action="chatMenu.openChat"
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
        className="flex items-start gap-[9px] rounded-[9px] px-2 py-[7px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {dot}
        <span
          className={cn(
            'min-w-0 flex-1 text-[13px]',
            actions && 'group-hover/row:pr-7 group-focus-within/row:pr-7',
          )}
        >
          <span
            title={title}
            onDoubleClick={
              chatActions?.canEdit(chat)
                ? (event) => {
                    event.preventDefault();
                    chatActions.startRename(chat, 'row');
                  }
                : undefined
            }
            className={cn(
              'block truncate',
              chat.unread ? 'font-semibold text-foreground' : 'text-foreground/90',
              !chat.title && 'animate-pulse text-muted-foreground motion-reduce:animate-none',
            )}
          >
            {title}
          </span>
          {(line || chat.ownerInitials) && (
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground',
                lineTone === 'amber' && 'text-amber-700 dark:text-amber-400',
                lineTone === 'red' && 'text-red-700 dark:text-red-400',
              )}
            >
              {chat.ownerInitials && (
                <span
                  title={t('sharedBy', { initials: chat.ownerInitials })}
                  className="shrink-0 rounded-[5px] bg-foreground/10 px-1 text-[10px] leading-4 font-medium text-foreground/80"
                >
                  {chat.ownerInitials}
                </span>
              )}
              {line && <span className="truncate">{line}</span>}
            </span>
          )}
          {chat.state === 'running' && chat.progress && (
            <ListProgress
              className="mt-[5px]"
              value={(chat.progress.done / Math.max(chat.progress.total, 1)) * 100}
            />
          )}
        </span>
      </Link>
      {actions}
    </div>
  );
}
