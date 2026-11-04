'use client';

import { useContext, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { TakeDownDialog } from '@/components/content/TakeDownDialog';
import { RoleContext } from '@/components/context/RoleProvider';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { Send } from 'lucide-react';
import {
  closeChatNotice,
  markChatNoticesRead,
  type ChatNotice,
  type ScheduleNotice,
} from '@/lib/actions/chatNotices';
import { hostOf } from '@/lib/action-center/affected';
import { CMS_NAMES } from '@/lib/content/cmsNames';
import { cn } from '@/lib/utils';
import { INBOX_ROW } from './InboxSuggestions';

/**
 * Notices at the top of the Inbox's Needs you (AGENT-OWN-KEY §5.3, 00441):
 * the workspace's own AI key fails, with Fix it; or its agents reached 80%
 * or all of their monthly limit on it (§4.2 item 4), with the way to the
 * limit. Admins get them; a row goes once the key works again, the month
 * renews or the limit is raised. An agent sent a page out on its own, with
 * Open page and Open run, and Take down for a page it published (PR 10); or
 * an edit stopped it, with Open agent (AUTONOMOUS-GO-LIVE §6.4, §7.2,
 * 00446): its owner and the people it notifies get them, and opening one
 * closes it. A scheduled job's run failed, or the job paused (00461), with
 * Open. Shown, they are marked read.
 */
export function NoticeRows({ notices }: { notices: ChatNotice[] }) {
  const unread = notices
    .filter((notice) => !notice.read)
    .map((notice) => notice.id)
    .join(',');
  useEffect(() => {
    if (unread) void markChatNoticesRead(unread.split(','));
  }, [unread]);

  return notices.map((notice) => <NoticeRow key={notice.id} notice={notice} />);
}

function NoticeRow({ notice }: { notice: ChatNotice }) {
  switch (notice.kind) {
    case 'own_key_limit':
      return <KeyLimitRow notice={notice} />;
    case 'agent_went_live':
      return <WentLiveRow notice={notice} />;
    case 'agent_go_live_off':
      return <GoLiveOffRow notice={notice} />;
    case 'schedule_failed':
    case 'schedule_paused':
      return <ScheduleNoticeRow notice={notice} />;
    default:
      return <KeyFailedRow notice={notice} />;
  }
}

/** Amber, as the Inbox's other needs-you rows that wait on an Admin. */
const NOTICE_ROW = cn(
  INBOX_ROW,
  'cursor-default border-amber-200 bg-amber-50/40 hover:translate-y-0 hover:shadow-[0_1px_2px_rgba(10,10,10,.04)] dark:border-amber-900 dark:bg-amber-950/20',
);

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const dollars = (usd: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(usd);

/** A scheduled job's notice (00461): "{Job} didn't run", or "{Job} is paused", why, and Open. */
function ScheduleNoticeRow({ notice }: { notice: ScheduleNotice }) {
  const t = useTranslations('chatShell.inbox.notice');
  return (
    <div data-slot="inbox-notice" data-kind={notice.kind} className={NOTICE_ROW}>
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {t(notice.kind === 'schedule_failed' ? 'scheduleFailed' : 'schedulePaused', {
            title: notice.title,
          })}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
          {notice.reason}
        </span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href={notice.href}
        data-action="inbox.openSchedule"
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
      >
        {t('open')}
      </Link>
    </div>
  );
}

function KeyLimitRow({ notice }: { notice: Extract<ChatNotice, { kind: 'own_key_limit' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  const reached = notice.level === 100;
  const renews = notice.renewsAt
    ? new Date(notice.renewsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;
  const detail = reached
    ? renews
      ? t('limitPaused', { date: renews })
      : t('limitPausedNoDate')
    : renews
      ? t('limitUsed', { used: dollars(notice.usedUsd), cap: dollars(notice.capUsd), date: renews })
      : t('limitUsedNoDate', { used: dollars(notice.usedUsd), cap: dollars(notice.capUsd) });
  return (
    <div
      data-slot="inbox-notice"
      data-kind={`${notice.kind}_${notice.level}`}
      className={NOTICE_ROW}
    >
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {t(reached ? 'limit100' : 'limit80')}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">{detail}</span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href="/dashboard/settings/ai-providers"
        data-action="inbox.keyLimit"
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
      >
        {t(reached ? 'raiseLimit' : 'reviewLimit')}
      </Link>
    </div>
  );
}

function KeyFailedRow({ notice }: { notice: Extract<ChatNotice, { kind: 'own_key_failed' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  const tOwnKey = useTranslations('chatAgents.ownKey');
  const tProviders = useTranslations('settings.agent_providers');
  const provider = tProviders.has(`${notice.provider}.name`)
    ? tProviders(`${notice.provider}.name`)
    : notice.provider;
  const why = tOwnKey(`why.${notice.class}`, { provider });
  return (
    <div data-slot="inbox-notice" data-kind={notice.kind} className={NOTICE_ROW}>
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {tOwnKey('banner', { provider })}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
          {notice.reminder ? t('reminder', { why }) : why}
        </span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href="/dashboard/settings/ai-providers"
        data-action="inbox.fixKey"
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
      >
        {t('fix')}
      </Link>
    </div>
  );
}

/** A row that tells, not asks: the Inbox's own card, not hovered as a link. */
const INFO_ROW = cn(
  INBOX_ROW,
  'cursor-default hover:translate-y-0 hover:shadow-[0_1px_2px_rgba(10,10,10,.04)]',
);

/** Opening it closes it (00446): it leaves Needs you on the next read. */
const closeOnOpen = (id: string) => () => void closeChatNotice(id);

/** How long a published page's notice offers Take down (§6.4); the Library does after. */
const TAKE_DOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * An agent sent a page out on its own (AUTONOMOUS-GO-LIVE §6.4): what, to
 * which CMS, as a draft there; Open page, and Open run beside why it could.
 */
function WentLiveRow({ notice }: { notice: Extract<ChatNotice, { kind: 'agent_went_live' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  const tTakeDown = useTranslations('contentEditor.takeDown');
  const { role } = useContext(RoleContext);
  const [takingDown, setTakingDown] = useState(false);
  const [takenDown, setTakenDown] = useState(false);
  // Read once: an older notice leaves Take down to the Library.
  const [recent] = useState(() => Date.now() - Date.parse(notice.createdAt) < TAKE_DOWN_MS);
  const cms = CMS_NAMES[notice.target];
  // Published live (PR 9): on its site, Open page opens the live page.
  const site = notice.url ? hostOf(notice.url) : null;
  const live = notice.url !== null && !takenDown;
  // Take down (PR 10): an Admin's or a Manager's click, never the agent's.
  const canTakeDown = live && recent && (role === 'admin' || role === 'manager');
  const words = site
    ? t('published', { agent: notice.agent, title: notice.title, site })
    : t('wentLive', { agent: notice.agent, title: notice.title, cms });
  return (
    <div
      data-slot="inbox-notice"
      data-kind={site ? 'agent_published' : notice.kind}
      className={INFO_ROW}
    >
      <Send aria-hidden className="size-2.5 text-foreground/70" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')} title={words}>
          {words}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {/* The headline may be cut on a long title: the site it went live on stays readable. */}
          {takenDown
            ? t('takenDown', { cms })
            : site
              ? t('publishedDetail', { site })
              : t('wentLiveDetail')}
          {notice.chatId && (
            <>
              {' · '}
              <Link
                href={`/dashboard/chat/${notice.chatId}`}
                data-action="inbox.openGoLiveRun"
                onClick={closeOnOpen(notice.id)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('openRun')}
              </Link>
            </>
          )}
          {canTakeDown && (
            <>
              {' · '}
              <button
                type="button"
                data-action="inbox.takeDown"
                onClick={() => setTakingDown(true)}
                className="text-red-700 underline underline-offset-2 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                {tTakeDown('action')}
              </button>
            </>
          )}
        </span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      {live && notice.url ? (
        <a
          href={notice.url}
          target="_blank"
          rel="noreferrer noopener"
          data-action="inbox.openGoLivePage"
          onClick={closeOnOpen(notice.id)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
        >
          {t('openPage')}
        </a>
      ) : (
        <Link
          href={`/dashboard/content/editor/${notice.draftId}`}
          data-action="inbox.openGoLivePage"
          onClick={closeOnOpen(notice.id)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
        >
          {t('openPage')}
        </Link>
      )}
      {takingDown && (
        <TakeDownDialog
          page={{
            draftId: notice.draftId,
            title: notice.title,
            url: notice.url,
            target: notice.target,
          }}
          onClose={() => setTakingDown(false)}
          onDone={() => setTakenDown(true)}
        />
      )}
    </div>
  );
}

/** An edit stopped an agent from going live on its own (§7.2): the Admin may turn it on again. */
function GoLiveOffRow({ notice }: { notice: Extract<ChatNotice, { kind: 'agent_go_live_off' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  return (
    <div data-slot="inbox-notice" data-kind={notice.kind} className={NOTICE_ROW}>
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {t('goLiveOff', { agent: notice.agent })}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
          {t('goLiveOffDetail')}
        </span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href={`/dashboard/agents/${notice.agentId}`}
        data-action="inbox.openGoLiveAgent"
        onClick={closeOnOpen(notice.id)}
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
      >
        {t('openAgent')}
      </Link>
    </div>
  );
}
