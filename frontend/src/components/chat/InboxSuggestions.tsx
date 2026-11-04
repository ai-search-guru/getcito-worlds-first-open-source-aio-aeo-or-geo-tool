'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button';
import { actionTexts } from '@/lib/action-center/display';
import {
  sentDay,
  suggestionDot,
  type DailySuggestion,
  type DailySuggestionsRead,
} from '@/lib/chat/dailySuggestions';
import { formatMonthDay } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The Inbox's rows' grid (mockup `.inbox .ib`): dot · text · time or progress · button. */
export const INBOX_ROW =
  'grid min-h-[62px] cursor-pointer grid-cols-[8px_minmax(0,1fr)_112px_84px] items-center gap-3 rounded-[14px] border bg-card px-[13px] py-[11px] shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] motion-reduce:transition-none motion-reduce:hover:translate-y-0';

/** A suggestion's brand as its row shows it. */
export interface SuggestionBrand {
  /** Its name, when the person has more than one brand; else null. */
  name: string | null;
  /** In the person's brand list: a row whose brand isn't can't open, as it would on another brand. */
  known: boolean;
}

/** What the Inbox does with the person's daily suggestions (CHAT-26 §2.2, §2.4, §5). */
export interface InboxDaily {
  read: DailySuggestionsRead;
  brandOf: (suggestion: DailySuggestion) => SuggestionBrand;
  /** Their feeds were made on this visit (an Agency partner's first Inbox): the line saying so. */
  justStarted: boolean;
  /** A Pause or Turn back on is on its way. */
  busy: boolean;
  onOpen: (suggestion: DailySuggestion) => void;
  /** The suggestions on screen, to mark seen. */
  onSeen: (ids: string[]) => void;
  onPause: () => void;
  onResume: () => void;
}

/**
 * A daily suggestion's row (mockup #d-inbox `.ib`): its dot (new, seen,
 * started), the action's title as the Action Center words it, then its
 * brand (with more than one), number, priority and how it can be done, the
 * day it was sent, and Open. An action done or dismissed since keeps its
 * row, faded, with that status in place of how it can be done. A brand the
 * person's list doesn't have leaves the row closed.
 */
export function SuggestionRow({
  suggestion,
  brand,
  today,
  now,
  onOpen,
}: {
  suggestion: DailySuggestion;
  brand: SuggestionBrand;
  /** The person's today as the read dated it. */
  today: string | null;
  now: Date | null;
  onOpen: (suggestion: DailySuggestion) => void;
}) {
  const t = useTranslations('chatShell.inbox.suggestions');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tActions = useTranslations('actionCenter.actionsPage');
  const { summary, closed } = suggestion;
  const dot = suggestionDot(suggestion);
  const title =
    actionTexts({ kind: summary.kind, payload: summary.payload }, tTexts).title || t('untitled');
  const open = brand.known ? () => onOpen(suggestion) : null;

  let how: string | null = null;
  if (closed) {
    how = t(`closed.${closed}`);
  } else if (suggestion.startedAt) {
    // The person's own day once their clock is known; the server's (UTC) until then.
    const date = formatMonthDay(suggestion.startedAt, now ? undefined : 'UTC');
    how = t(suggestion.startedVia === 'chat' ? 'how.startedChat' : 'how.startedEditor', { date });
  } else if (summary.startNow) {
    how = t('how.startNow', { minutes: summary.startNow.minutes });
  } else {
    how = t('how.chat');
  }
  const line = [
    brand.name,
    summary.actionNo !== null ? `AC-${summary.actionNo}` : null,
    summary.priorityLevel ? tActions(`priority.levels.${summary.priorityLevel}`) : null,
    how,
  ]
    .filter(Boolean)
    .join(' · ');
  const sent = sentDay(suggestion.sentOn, today);

  return (
    <div
      role={open ? 'link' : undefined}
      tabIndex={open ? 0 : undefined}
      data-action="inbox.openItem"
      data-suggestion={suggestion.id}
      data-closed={closed ?? undefined}
      // On the row: the disabled Open takes no pointer.
      title={open ? undefined : t('brandMissing')}
      onClick={open ?? undefined}
      onKeyDown={(event) => {
        if (!open || event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      className={cn(
        INBOX_ROW,
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        !open && 'cursor-default',
        closed && 'opacity-60',
      )}
    >
      <span
        role="img"
        aria-label={t(`dot.${dot}`)}
        title={t(`dot.${dot}`)}
        data-dot={dot}
        className={cn(
          'size-2 rounded-full',
          dot === 'new' && 'bg-blue-600 dark:bg-blue-400',
          dot === 'seen' && 'bg-foreground',
          dot === 'started' && 'bg-green-600 dark:bg-green-400',
        )}
      />
      <span className="min-w-0 truncate text-[13.5px]">
        {title}
        <span className="block truncate text-xs text-muted-foreground">{line}</span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {sent.today ? t('today', { date: sent.date }) : sent.date}
      </span>
      <button
        type="button"
        data-action="inbox.openItem"
        disabled={!open}
        onClick={(event) => {
          event.stopPropagation();
          open?.();
        }}
        className={cn(
          buttonVariants({ variant: dot === 'new' && !closed ? 'default' : 'outline', size: 'sm' }),
          'w-full',
        )}
      >
        {t('open')}
      </button>
    </div>
  );
}

/**
 * The Daily suggestions tab (mockup #d-inbox, #d-paused): the line above
 * the rows with Pause daily suggestions while they're on; the paused banner
 * with Turn back on while they're paused (by the job) or off (by the
 * person); then the rows of the last 7 days.
 */
export function SuggestionsPanel({ daily, now }: { daily: InboxDaily; now: Date | null }) {
  const t = useTranslations('chatShell.inbox.suggestions');
  const { state, suggestions } = daily.read;
  const stopped = state === 'paused' || state === 'off';

  return (
    <>
      {stopped ? (
        <div className="mb-3 grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border border-amber-200 bg-amber-50/40 px-3.5 py-[13px] dark:border-amber-900 dark:bg-amber-950/20">
          <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
          <div className="min-w-0">
            <b className="block text-[13.5px] font-semibold">{t('paused.title')}</b>
            <span className="block text-xs text-muted-foreground">
              {t(state === 'paused' ? 'paused.body' : 'paused.offBody')}
            </span>
          </div>
          <button
            type="button"
            data-action="suggestions.resume"
            disabled={daily.busy}
            onClick={daily.onResume}
            className={buttonVariants({ size: 'sm' })}
          >
            {t('paused.resume')}
          </button>
        </div>
      ) : (
        <p className="-mt-1.5 mb-3 text-[12.5px] text-muted-foreground">
          {t('note')}{' '}
          <button
            type="button"
            data-action="suggestions.pause"
            disabled={daily.busy}
            onClick={daily.onPause}
            className="text-foreground underline decoration-foreground/25 underline-offset-2 hover:decoration-foreground disabled:opacity-60"
          >
            {t('pause')}
          </button>
        </p>
      )}
      {stopped && <p className="px-0.5 py-[18px] text-[13px] text-muted-foreground">{t('next')}</p>}
      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SuggestionRows daily={daily} now={now} />
        </div>
      ) : (
        !stopped && (
          <p className="px-0.5 py-[18px] text-[13px] text-muted-foreground">{t('empty')}</p>
        )
      )}
    </>
  );
}

/**
 * The suggestions' rows, and, when the read listed fewer than there are,
 * the line saying how many it shows.
 */
export function SuggestionRows({ daily, now }: { daily: InboxDaily; now: Date | null }) {
  const t = useTranslations('chatShell.inbox.suggestions');
  const { suggestions, total, today } = daily.read;
  return (
    <>
      {suggestions.map((suggestion) => (
        <SuggestionRow
          key={suggestion.id}
          suggestion={suggestion}
          brand={daily.brandOf(suggestion)}
          today={today}
          now={now}
          onOpen={daily.onOpen}
        />
      ))}
      {total > suggestions.length && (
        <p className="px-0.5 pt-1 text-[12.5px] text-muted-foreground">
          {t('showing', { shown: suggestions.length, total })}
        </p>
      )}
    </>
  );
}
