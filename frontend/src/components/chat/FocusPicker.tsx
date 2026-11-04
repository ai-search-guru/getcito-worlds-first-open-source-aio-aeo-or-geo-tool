'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { markFocusPrompted, saveChatFocus, skipChatFocus } from '@/lib/actions/chatPrefs';
import { FOCUS_AREAS, type FocusArea, type FocusSource } from '@/lib/chat/focus';
import { cn } from '@/lib/utils';

/**
 * What Chat focuses on for the person (CHAT-24 §3; mockup #s-dept): the
 * picker that opens once on their first Chat Home, starting with the areas
 * their work areas suggest, and again from Home's pill; the pill itself;
 * and the label both show ("Product and Markets and sources", "Big
 * picture, Competitors +2"). Focus only changes what Chat suggests.
 */

/** The focus's label: one or two areas by name, more as the first two and how many else. */
export function useFocusLabel(): (areas: readonly FocusArea[]) => string {
  const t = useTranslations('chatShell.focus');
  return (areas) => {
    const names = areas.map((area) => t(`areas.${area}.name`));
    if (names.length <= 1) return t('label.one', { a: names[0] ?? '' });
    if (names.length === 2) return t('label.two', { a: names[0], b: names[1] });
    return t('label.more', { a: names[0], b: names[1], count: names.length - 2 });
  };
}

interface ChatFocusValue {
  /** The picked areas, in order; empty with none. */
  focus: FocusArea[];
  /** Opens the picker with the current picks on (Home's pill). */
  edit: () => void;
}

const ChatFocusContext = createContext<ChatFocusValue | null>(null);

/** The person's focus on Chat Home, or null outside it. */
export function useChatFocus(): ChatFocusValue | null {
  return useContext(ChatFocusContext);
}

/**
 * The picker (mockup #s-dept): eight areas that toggle, Continue once one
 * is on, Skip for now. Presentational: the gate keeps what it answers.
 */
export function FocusPicker({
  initial,
  busy,
  editing = false,
  onContinue,
  onSkip,
}: {
  initial: readonly FocusArea[];
  busy: boolean;
  /** Opened to change a focus (Home's pill): its way out is Cancel, which keeps it. */
  editing?: boolean;
  onContinue: (picks: FocusArea[]) => void;
  onSkip: () => void;
}) {
  const t = useTranslations('chatShell.focus');
  const [picks, setPicks] = useState<FocusArea[]>(() => [...initial]);
  const heading = useRef<HTMLHeadingElement>(null);
  const toggle = (area: FocusArea) =>
    setPicks((was) => (was.includes(area) ? was.filter((a) => a !== area) : [...was, area]));

  // It opens in Home's place: keyboard and screen-reader users start at its question.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  return (
    <div className="@container mx-auto w-full max-w-[720px] px-5 pb-6">
      <div className="mt-[34px] text-center">
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-2xl font-bold tracking-[-.6px] outline-none"
        >
          {t('title')}
        </h1>
        <p className="mt-1.5 text-muted-foreground">{t('intro')}</p>
      </div>
      <div
        role="group"
        aria-label={t('groupLabel')}
        className="mt-[18px] mb-1.5 grid grid-cols-2 gap-2.5 @2xl:grid-cols-4"
      >
        {FOCUS_AREAS.map((area) => {
          const on = picks.includes(area);
          return (
            <button
              key={area}
              type="button"
              data-action="dept.pick"
              data-dept={area}
              aria-pressed={on}
              onClick={() => toggle(area)}
              className={cn(
                'flex min-h-24 flex-col items-start gap-1 rounded-[14px] border bg-card p-3.5 text-left text-[13.5px] outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on && 'border-foreground shadow-[inset_0_0_0_1px_var(--foreground)]',
              )}
            >
              <b className="text-sm font-semibold">
                {t(`areas.${area}.title`)}
                {on && (
                  <span aria-hidden className="text-green-600 dark:text-green-400">
                    {' '}
                    ✓
                  </span>
                )}
              </b>
              <span className="text-[12.5px] leading-[1.45] text-muted-foreground">
                {t(`areas.${area}.note`)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-2.5 text-[12.5px] text-muted-foreground">
        <span data-slot="focus-count">
          {picks.length ? t('countSome', { count: picks.length }) : t('countNone')}
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            data-action="dept.skip"
            disabled={busy}
            onClick={onSkip}
            className="h-8 rounded-lg border bg-card px-3 text-[13px] text-foreground outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {editing ? t('cancel') : t('skip')}
          </button>
          <button
            type="button"
            data-action="dept.continue"
            disabled={busy || picks.length === 0}
            onClick={() => onContinue(picks)}
            className="h-8 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {t('continue')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Home's pill under the greeting (CHAT-24 §3 item 3): "Focused on … ·
 * Edit", or "Get suggestions for what you work on · Choose focus". Both
 * open the picker.
 */
export function FocusPill({ areas, onEdit }: { areas: readonly FocusArea[]; onEdit: () => void }) {
  const t = useTranslations('chatShell.focus');
  const label = useFocusLabel();
  return (
    <span
      data-slot="focus-pill"
      title={areas.length ? areas.map((area) => t(`areas.${area}.name`)).join(', ') : undefined}
      className="mt-2.5 inline-flex items-center gap-2 rounded-full border bg-card py-[3px] pr-1 pl-2.5 text-xs text-muted-foreground"
    >
      {areas.length ? t('pill.focused', { label: label(areas) }) : t('pill.none')}
      <button
        type="button"
        data-action="dept.change"
        onClick={onEdit}
        className="rounded-full bg-muted px-[9px] py-0.5 text-xs text-foreground outline-none hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {areas.length ? t('pill.edit') : t('pill.choose')}
      </button>
    </span>
  );
}

/**
 * Chat Home with the person's focus: the picker in place of Home and its
 * composer the first time (once: it is marked shown as it opens), or when
 * the pill opens it; Home otherwise. Under the picker Home stays laid out
 * but unseen and out of reach (not display: none), so the composer sizes
 * itself and a draft survives. A pick that isn't kept stays in the picker
 * and says so. Closed, it hands focus back: to the pill that opened it, or
 * to the composer after the first opening.
 */
export function ChatFocusGate({
  focus: saved,
  ask,
  prefill,
  children,
}: {
  focus: FocusArea[] | null;
  ask: boolean;
  prefill: FocusArea[];
  children: ReactNode;
}) {
  const t = useTranslations('chatShell.focus');
  const label = useFocusLabel();
  const [focus, setFocus] = useState<FocusArea[]>(saved ?? []);
  // The picker's starting picks and where it opened; null while it is closed.
  const [picking, setPicking] = useState<{ picks: FocusArea[]; source: FocusSource } | null>(
    ask ? { picks: prefill, source: 'first_open' } : null,
  );
  const [busy, setBusy] = useState(false);
  const home = useRef<HTMLDivElement>(null);
  // Where the picker that just closed opened from, for focus to land; null otherwise.
  const closed = useRef<FocusSource | null>(null);

  useEffect(() => {
    if (picking || !closed.current) return;
    const from = closed.current;
    closed.current = null;
    const pill = home.current?.querySelector<HTMLElement>('[data-action="dept.change"]');
    const composer = home.current?.querySelector<HTMLTextAreaElement>(
      '[data-action="composer.input"]',
    );
    // A composer that can't be typed in (read-only) leaves it on the pill.
    (from === 'first_open' && composer && !composer.disabled ? composer : pill)?.focus();
  }, [picking]);

  useEffect(() => {
    if (!ask) return;
    void markFocusPrompted().catch(() => undefined);
  }, [ask]);

  const edit = useCallback(() => {
    setPicking({ picks: focus.length ? focus : prefill, source: 'home_pill' });
  }, [focus, prefill]);

  const keep = async (picks: FocusArea[]) => {
    if (!picking) return;
    setBusy(true);
    const kept = await saveChatFocus(picks).catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!kept.ok) {
      toast.error(t('failed'));
      return;
    }
    setFocus(picks);
    closed.current = picking.source;
    setPicking(null);
    toast(t('saved', { label: label(picks) }));
  };

  const skip = async () => {
    // From Home's pill the person is changing a focus they have: leaving
    // keeps it as it was. Only the first, unasked opening keeps "no focus".
    if (picking?.source === 'home_pill') {
      closed.current = 'home_pill';
      setPicking(null);
      return;
    }
    setBusy(true);
    const kept = await skipChatFocus().catch(() => ({ ok: false as const }));
    setBusy(false);
    if (!kept.ok) {
      toast.error(t('failed'));
      return;
    }
    setFocus([]);
    closed.current = 'first_open';
    setPicking(null);
    toast(t('skipped'));
  };

  return (
    <ChatFocusContext.Provider value={{ focus, edit }}>
      {picking && (
        <FocusPicker
          initial={picking.picks}
          busy={busy}
          editing={picking.source === 'home_pill'}
          onContinue={keep}
          onSkip={skip}
        />
      )}
      <div
        ref={home}
        data-slot="focus-home"
        className={picking ? 'invisible h-0 overflow-hidden' : 'contents'}
      >
        {children}
      </div>
    </ChatFocusContext.Provider>
  );
}
