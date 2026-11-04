'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { AgentAvatar } from '@/components/agentic/AgentAvatar';
import { useActionStory } from '@/components/action-center/useActionStory';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { buttonVariants } from '@/components/ui/button';
import { actionTexts } from '@/lib/action-center/display';
import { priorityReasonText } from '@/lib/action-center/priority';
import { getActionSignals } from '@/lib/actions/actionCenter';
import {
  openDailySuggestion,
  removeDailySuggestion,
  snoozeDailySuggestion,
  startedDailySuggestion,
  type SuggestionDetail,
  type SuggestionsWriteResult,
} from '@/lib/actions/chatSuggestions';
import { startDraftFromAction } from '@/lib/actions/contentDrafts';
import type { ChatComposerSetup } from '@/lib/chat/composerSetup';
import { actionPromptCount, sentDay } from '@/lib/chat/dailySuggestions';
import { actionPages } from '@/lib/content/actionDrafts';
import { contentEditorPath } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';
import { formatMonthDay } from '@/lib/format';
import type { Signal } from '@/lib/signals/map';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/state/useBrandStore';
import { useChatCrumb } from './ChatCrumb';
import { useNow } from './ChatInbox';
import { ChatThreadView } from './ChatThreadView';
import type { ComposerChip, ComposerDraft } from './composer/ChatComposer';

/** The pages the card names before "+N more". */
const PAGES_SHOWN = 5;
/** A context chip's label at most (the run's schema). */
const CHIP_MAX = 200;
/** Where Not now and Remove go back to: the Inbox's Daily suggestions. */
const INBOX_HREF = '/dashboard/chat/inbox?tab=suggestions';

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** What the page's buttons do, the live part's. */
export interface SuggestionMoves {
  /** A Not now, Remove or start on its way. */
  busy: boolean;
  onEditor: () => void;
  onChat: () => void;
  /** Fills the box with "Start with {page}.": never sends. */
  onFirstPage: (page: string) => void;
  onSnooze: () => void;
  onRemove: () => void;
}

/**
 * A daily suggestion's page (CHAT-26 §2.3, mockup #d-detail), built as
 * "Why did it move?" (#f-why) is: the action's title as the question, with
 * where it came from; "Picked for you today · no AI cost" and what was read;
 * why this, why now and what it takes, from the action's own texts
 * (story.why or its description, "Why this priority?", the time Start now
 * takes); the action from the Action Center with its pages, Content Editor
 * (only when there is writing to do) and Do it with Chat in the
 * workspace's mode; then the next moves: the first page, Not now and
 * Remove. An action done or dismissed since says so, and starts nothing.
 */
export function SuggestionDetailView({
  detail,
  now,
  why,
  modeLabel,
  moves,
}: {
  detail: SuggestionDetail;
  now: Date | null;
  /** Why this: the action's story or description; null until its signals are read. */
  why: string | null;
  /** The mode a chat started here runs in, as the composer names it. */
  modeLabel: string;
  moves: SuggestionMoves;
}) {
  const t = useTranslations('chatShell.inbox.suggestion');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tPriority = useTranslations('actionCenter.actionsPage.priority');
  const tPage = useTranslations('chatPage');
  const cardId = useId();
  const { suggestion, action, pick, start, auditedAt, today } = detail;
  const closed = suggestion.closed;
  const number = `AC-${action.actionNo}`;
  const title = actionTexts(action, tTexts).title;
  const sent = sentDay(suggestion.sentOn, today);
  // The person's own day once their clock is known; the server's (UTC) until then.
  const day = (iso: string) => formatMonthDay(iso, now ? undefined : 'UTC');
  const pages = actionPages(action.payload);
  const prompts = actionPromptCount(action.payload);

  const read = [
    pages.length > 0 ? t('tools.pages', { count: pages.length }) : null,
    prompts > 0 ? t('tools.prompts', { count: prompts }) : null,
  ].filter((part): part is string => part !== null);
  const ranked = [
    pick.score !== null ? t('tools.priority', { score: pick.score }) : null,
    pick.waitingDays !== null ? t('tools.waiting', { days: pick.waitingDays }) : null,
  ].filter((part): part is string => part !== null);
  const tools = [
    { key: 'read', label: t('tools.read', { number }), detail: read.join(', ') },
    { key: 'ranked', label: t('tools.ranked'), detail: ranked.join(', ') },
    ...(auditedAt
      ? [
          {
            key: 'audited',
            label: t('tools.audited'),
            detail: t('tools.auditedOn', { date: day(auditedAt) }),
          },
        ]
      : []),
  ];

  const lead = [
    why,
    action.priorityReason
      ? t('whyNow', { reason: priorityReasonText(action.priorityReason, tPriority) })
      : null,
    !closed && suggestion.summary.startNow
      ? t('takes', { minutes: suggestion.summary.startNow.minutes })
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  const card = [
    t('card.tasks', { count: action.taskTotal }),
    action.assignee
      ? (action.assignee.fullName ?? action.assignee.email ?? t('card.unassigned'))
      : t('card.unassigned'),
    t('card.opened', { date: day(action.createdAt) }),
  ].join(' · ');
  const shownPages = pages.slice(0, PAGES_SHOWN).map(pagePath);
  const morePages = pages.length - shownPages.length;

  const nextCard =
    'rounded-[14px] border bg-card px-3 py-2.5 text-left text-[13px] shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-[transform,box-shadow] duration-200 ease-out outline-none [overflow-wrap:anywhere] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0';
  const chip =
    'inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs text-foreground/80';

  return (
    <div data-slot="suggestion" data-closed={closed ?? undefined} className="flex flex-col gap-5">
      <div className="flex flex-col items-end gap-1.5">
        <h1 className="m-0 max-w-[80%] rounded-2xl bg-muted px-4 py-2 text-sm font-normal">
          {title}
        </h1>
        <span className={cn(chip, 'text-muted-foreground')}>
          <i>{t('from')}</i>
          <span className="truncate">{t('source', { date: sent.date, number })}</span>
        </span>
      </div>

      <div className="flex gap-2.5">
        <AgentAvatar size="sm" decorative className="mt-0.5" />
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-[13px] text-muted-foreground">
            {sent.today ? t('pickedToday') : t('picked', { date: sent.date })}
          </p>
          <ul aria-label={t('tools.label')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {tools.map((tool) => (
              <li key={tool.key} data-tool={tool.key} className={chip}>
                <Check className="size-3 shrink-0 text-green-600 dark:text-green-500" aria-hidden />
                <span className="truncate">
                  {tool.label}
                  {tool.detail && <span className="text-muted-foreground"> · {tool.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {why === null ? (
            <div aria-hidden data-slot="lead-loading" className="space-y-2">
              <div className="h-3.5 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            </div>
          ) : (
            <p data-slot="lead" className="text-[15px] leading-relaxed">
              {lead}
            </p>
          )}

          <section
            aria-labelledby={cardId}
            className="rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]"
          >
            <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
              <AgentAvatar size="xs" decorative />
              <h2 id={cardId} className="m-0 text-[13px] font-semibold">
                {t('card.title')}
              </h2>
              {closed ? (
                <span
                  data-slot="closed"
                  className="ml-auto rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {t(`card.closed.${closed}`)}
                </span>
              ) : (
                pick.waitingDays !== null && (
                  <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                    {t('card.waiting', { days: pick.waitingDays })}
                  </span>
                )
              )}
            </div>
            <div className="space-y-2.5 px-3.5 py-3">
              <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex size-7 items-center justify-center rounded-lg bg-muted text-[10px] font-semibold"
                >
                  AC
                </span>
                <div className="min-w-0 text-[13px]">
                  <b className="font-semibold">{number}</b> {title}
                  <span className="block truncate text-xs text-muted-foreground">{card}</span>
                </div>
                <Link
                  href={`/dashboard/action-center/actions?action=${action.id}`}
                  data-action="suggestion.openAction"
                  aria-label={t('card.openLabel', { number })}
                  className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                >
                  {t('card.open')}
                </Link>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shownPages.length > 0 && (
                  <span className={chip} title={pages.join('\n')}>
                    <span className="truncate">
                      {shownPages.join(' · ')}
                      {morePages > 0 && ` · ${t('card.morePages', { count: morePages })}`}
                    </span>
                  </span>
                )}
                <span className={chip}>{t('card.noCost')}</span>
              </div>
            </div>
            {!closed && (
              <div className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5">
                <span className="text-xs text-muted-foreground">
                  {t('card.mode', { mode: modeLabel })}
                </span>
                <div className="ml-auto flex flex-wrap gap-2">
                  {start && (
                    <button
                      type="button"
                      data-action="suggestion.openEditor"
                      disabled={moves.busy}
                      onClick={moves.onEditor}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      {t('card.editor')}
                    </button>
                  )}
                  <button
                    type="button"
                    data-action="suggestion.startChat"
                    disabled={moves.busy}
                    onClick={moves.onChat}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    {t('card.chat')}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section data-slot="next-moves" aria-label={tPage('nextMoves')}>
            <h3 className="mx-0.5 mt-0 mb-1.5 text-[11px] font-normal tracking-[.4px] text-muted-foreground uppercase">
              {tPage('nextMoves')}
            </h3>
            <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
              {!closed && pages.length > 0 && (
                <button
                  type="button"
                  data-action="nextMove.open"
                  disabled={moves.busy}
                  onClick={() => moves.onFirstPage(pagePath(pages[0]))}
                  className={nextCard}
                >
                  <span className="block">{t('next.firstPage', { page: pagePath(pages[0]) })}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('next.firstPageSub', { count: pages.length })}
                  </span>
                </button>
              )}
              {!closed && (
                <button
                  type="button"
                  data-action="suggestion.snooze"
                  disabled={moves.busy}
                  onClick={moves.onSnooze}
                  className={nextCard}
                >
                  <span className="block">{t('next.snooze')}</span>
                  <span className="block text-xs text-muted-foreground">{t('next.snoozeSub')}</span>
                </button>
              )}
              <button
                type="button"
                data-action="suggestion.dismiss"
                disabled={moves.busy}
                onClick={moves.onRemove}
                className={nextCard}
              >
                <span className="block">{t('next.remove')}</span>
                <span className="block text-xs text-muted-foreground">{t('next.removeSub')}</span>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A suggestion that isn't there for the person: removed, deleted, or another's. */
export function SuggestionUnavailable() {
  const t = useTranslations('chatShell.inbox.suggestion');
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <Inbox aria-hidden className="size-5 text-muted-foreground" />
      <p className="text-sm">{t('unavailable')}</p>
      <Link
        href={INBOX_HREF}
        data-action="nav.inbox"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('backToInbox')}
      </Link>
    </div>
  );
}

/**
 * One move at a time, held before the buttons show busy, so a double click
 * makes it once. A move that succeeds stays busy while its page opens; one
 * that fails ends, and frees the buttons.
 */
function useOneMove() {
  const [busy, setBusy] = useState(false);
  const moving = useRef(false);
  const begin = useCallback(() => {
    if (moving.current) return false;
    moving.current = true;
    setBusy(true);
    return true;
  }, []);
  const end = useCallback(() => {
    moving.current = false;
    setBusy(false);
  }, []);
  return { busy, begin, end };
}

/** True the first time it's called, then false: the suggestion is marked started once. */
function useFirstTime() {
  const done = useRef(false);
  return useCallback(() => {
    if (done.current) return false;
    done.current = true;
    return true;
  }, []);
}

/**
 * The suggestion's page, live: its breadcrumb, the brand it's for made the
 * active one, opened (a use, §5) unless the workspace is read-only, the
 * action's signals read for its Why as the drawer reads them, and the
 * composer under it, which starts a chat scoped to the action (its chips:
 * the page, the brand and the action, which the run reads). Starting it,
 * here or with Do it with Chat, marks it started in Chat and opens the
 * chat; Content Editor opens the action's draft, marked started there. Not
 * now and Remove go back to the Inbox.
 */
export function ChatSuggestion({
  detail,
  setup,
}: {
  detail: SuggestionDetail;
  setup: ChatComposerSetup;
}) {
  const t = useTranslations('chatShell.inbox.suggestion');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tModes = useTranslations('chatComposer.mode');
  const tReadOnly = useTranslations('readOnly.actions');
  const tDrawer = useTranslations('actionCenter.actionsPage.drawer');
  const router = useRouter();
  const now = useNow();
  const { isLocked, openUpgrade, guard } = useUpgradeGate();
  const brands = useBrandStore((s) => s.brands);
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);
  const { suggestion, action, start } = detail;
  const brandId = suggestion.brandId;
  const brand = brands.find((b) => b.id === brandId) ?? null;
  const number = `AC-${action.actionNo}`;
  const title = actionTexts(action, tTexts).title;
  const route = `/dashboard/chat/inbox/${suggestion.id}`;
  const { busy, begin, end } = useOneMove();
  const [signals, setSignals] = useState<Signal[] | null>(null);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  const opened = useRef(false);
  const firstStart = useFirstTime();

  useChatCrumb(t('crumb', { date: sentDay(suggestion.sentOn, detail.today).date }));

  // The suggestion's brand on screen as the page opens, so a chat started
  // here runs on it; a brand the person picks afterwards stays theirs.
  const branded = useRef(false);
  useEffect(() => {
    if (branded.current || !brand) return;
    branded.current = true;
    if (activeBrandId !== brandId) setActiveBrand(brandId);
  }, [brand, activeBrandId, brandId, setActiveBrand]);

  useEffect(() => {
    if (opened.current || isLocked) return;
    opened.current = true;
    void openDailySuggestion(suggestion.id).catch(() => undefined);
  }, [isLocked, suggestion.id]);

  useEffect(() => {
    let current = true;
    getActionSignals(brandId, action.id)
      .catch(() => [])
      .then((read) => {
        if (current) setSignals(read);
      });
    return () => {
      current = false;
    };
  }, [brandId, action.id]);

  const storyAction = useMemo(
    () => ({
      id: action.id,
      payload: action.payload,
      createdAt: action.createdAt,
      dueDate: action.dueDate,
    }),
    [action],
  );
  const { story, ready } = useActionStory(brandId, storyAction, signals);
  const why = ready ? (story?.why ?? actionTexts(action, tTexts).description) : null;

  const chips = useMemo<ComposerChip[]>(
    () =>
      [
        { key: 'page', label: t('pageChip') },
        ...(brand ? [{ key: 'brand', label: brand.name, value: brand.id }] : []),
        { key: 'action', label: clip(`${number} · ${title}`, CHIP_MAX), value: action.id },
      ].filter((chip) => !removed.has(chip.key)),
    [t, brand, number, title, action.id, removed],
  );

  /** A chat started from here: the suggestion marked started in Chat (once), then the chat. */
  const toChat = useCallback(
    async (chatId: string) => {
      if (firstStart()) {
        await startedDailySuggestion(suggestion.id, 'chat').catch(() => undefined);
      }
      router.push(`/dashboard/chat/${chatId}`);
    },
    [firstStart, suggestion.id, router],
  );

  async function doWithChat() {
    if (!begin()) return;
    const res = await fetch('/api/chat/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: t('doMessage', { number, title }),
        mode: setup.defaultMode,
        brandId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        context: { route, chips },
      }),
    }).catch(() => null);
    const chatId = res?.ok ? res.headers.get('x-chat-conversation') : null;
    if (!res?.ok || !chatId) {
      end();
      const body = (await res?.json().catch(() => null)) as {
        code?: string;
        error?: string;
      } | null;
      if (body?.code === 'subscription_inactive') openUpgrade(tReadOnly('startChat'));
      else toast.error(body?.error ?? t('startFailed'));
      return;
    }
    // The run goes on without this page: the chat picks up its stream.
    void res.body?.cancel().catch(() => undefined);
    await toChat(chatId);
  }

  async function openEditor() {
    if (!start || !begin()) return;
    try {
      const result = await startDraftFromAction(brandId, action.id, start.taskId, {
        page: start.page,
        title,
      });
      if ('error' in result) {
        end();
        toast.error(t('editorFailed'));
        return;
      }
      await startedDailySuggestion(suggestion.id, 'editor').catch(() => undefined);
      if (result.importFailed) toast.warning(tDrawer('task.pageNotRead'));
      router.push(contentEditorPath(result.draftId));
    } catch {
      end();
      toast.error(t('editorFailed'));
    }
  }

  async function change(
    write: (id: string) => Promise<SuggestionsWriteResult>,
    done: string,
    label: string,
  ) {
    if (!begin()) return;
    try {
      const result = await write(suggestion.id);
      if (!result.ok) {
        end();
        if (result.failure === 'read_only') openUpgrade(label);
        else toast.error(t('changeFailed'));
        return;
      }
      toast.success(done);
      router.push(INBOX_HREF);
    } catch {
      end();
      toast.error(t('changeFailed'));
    }
  }

  const snoozeLabel = tReadOnly('snoozeSuggestion');
  const removeLabel = tReadOnly('removeSuggestion');
  const moves: SuggestionMoves = {
    busy,
    onEditor: guard(() => void openEditor(), {
      action: tReadOnly(start?.method === 'optimize' ? 'optimizeContent' : 'createContent'),
    }),
    onChat: guard(() => void doWithChat(), { action: tReadOnly('startChat') }),
    onFirstPage: (page) =>
      setDraft({ nonce: Date.now(), text: t('next.firstPageMessage', { page }) }),
    onSnooze: guard(() => void change(snoozeDailySuggestion, t('snoozed'), snoozeLabel), {
      action: snoozeLabel,
    }),
    onRemove: guard(() => void change(removeDailySuggestion, t('removed'), removeLabel), {
      action: removeLabel,
    }),
  };

  return (
    <div className="@container flex h-full flex-col">
      <ChatThreadView
        thread={null}
        variant="dock"
        {...setup}
        empty={
          <SuggestionDetailView
            detail={detail}
            now={now}
            why={why}
            modeLabel={tModes(setup.defaultMode)}
            moves={moves}
          />
        }
        chips={chips}
        onRemoveChip={(key) => setRemoved((was) => new Set(was).add(key))}
        pageRoute={route}
        draft={draft}
        onConversation={(chatId) => void toChat(chatId)}
      />
    </div>
  );
}
