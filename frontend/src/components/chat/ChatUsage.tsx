'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, X } from 'lucide-react';
import { AiUsageBanner } from '@/components/ai-usage/AiUsageBanner';
import { AiUsageMeter } from '@/components/ai-usage/AiUsageMeter';
import { useGetMore } from '@/components/ai-usage/getMoreContext';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { saveUsageNoticePeriod } from '@/lib/actions/chatPrefs';
import { aiUsageTone, percentLabel, type AiUsage } from '@/lib/billing/aiUsage';

/**
 * The first day of an AI usage period, as chat_user_prefs.usage_notice_period
 * keeps the one whose 80% line the person saw (CHAT-04 item 16); null
 * without a period.
 */
export function usagePeriodDay(usage: AiUsage): string | null {
  return usage.periodStart ? usage.periodStart.slice(0, 10) : null;
}

/** The periods whose line this tab already showed: a new chat on the same visit says it no more. */
const shownThisVisit = new Set<string>();

/** The period whose cap opened the Get more window in this browser (CHAT-18 agentic update). */
const GET_MORE_OPENED_KEY = 'getcito.chat.getMoreOpened';
/** The periods whose cap opened it on this visit, for a browser without storage. */
const getMoreOpenedThisVisit = new Set<string>();

/** Whether the Get more window opened for this period's cap here already; marks it when not. */
function getMoreOpenedFor(period: string): boolean {
  if (getMoreOpenedThisVisit.has(period)) return true;
  getMoreOpenedThisVisit.add(period);
  try {
    if (window.localStorage.getItem(GET_MORE_OPENED_KEY) === period) return true;
    window.localStorage.setItem(GET_MORE_OPENED_KEY, period);
  } catch {
    // Without storage it may open again on another visit: still once a visit.
  }
  return false;
}

/**
 * Whether Chat stops at the cap (CHAT-04 item 17): the allowance is used up
 * and Chat draws on it. On the workspace's own key (`onOwnKey`, as the page
 * read it) it keeps working: the server holds nothing on the budget for it.
 */
export function chatAtCap(usage: AiUsage | null | undefined, onOwnKey = false): boolean {
  return !onOwnKey && !!usage && aiUsageTone(usage) === 'exhausted' && usage.chatMetered !== false;
}

/**
 * The AI usage meter in the line under Chat's composer (CHAT-04 item 15,
 * mockup usgHTML): the header's meter, its popover included, drawn small:
 * the bar and its share, amber from 80%, red once used up.
 */
export function ComposerUsageMeter() {
  return (
    <AiUsageMeter className="h-6 gap-1.5 rounded-[7px] border-transparent bg-transparent px-1.5 text-[11.5px] font-normal" />
  );
}

/**
 * What Chat says about the AI usage above its composer (CHAT-04 items
 * 16–17): from 80%, one amber line once per person per period, on every
 * device: kept on the person (chat_user_prefs.usage_notice_period) the first
 * time it shows, and × closes it; used up, the red banner with where to get
 * more (other members are told to ask an Admin), while the composer is off.
 * `seenPeriod` is the period the person already saw it in, as the page read
 * it.
 */
export function ChatUsageNotice({
  seenPeriod = null,
  onOwnKey = false,
}: {
  seenPeriod?: string | null;
  /** Chat runs on the workspace's own key: the cap doesn't pause it, so no window opens. */
  onOwnKey?: boolean;
}) {
  const t = useTranslations('aiUsage.banner');
  const tChat = useTranslations('chatComposer.usage');
  const { usage } = useAiUsage();
  const [closed, setClosed] = useState(false);
  // What was seen when this opened: the line seen here stays until ×.
  const [seenBefore] = useState(() => new Set([...shownThisVisit, seenPeriod ?? '']));
  const tone = usage && !usage.unlimited ? aiUsageTone(usage) : null;
  const period = usage ? usagePeriodDay(usage) : null;
  const shown = tone === 'warning' && !closed && !(period && seenBefore.has(period));
  const openGetMore = useGetMore();
  const atCap = chatAtCap(usage, onOwnKey) && !usage?.trial;

  // At the cap, the Get more window opens once a period (the trial can't buy packs).
  useEffect(() => {
    if (!atCap || !openGetMore || !period || getMoreOpenedFor(period)) return;
    openGetMore('ai');
  }, [atCap, openGetMore, period]);

  // Shown: kept on the person, so it isn't said again this period.
  useEffect(() => {
    if (!shown || !period || shownThisVisit.has(period)) return;
    shownThisVisit.add(period);
    void saveUsageNoticePeriod(period);
  }, [shown, period]);

  if (!usage || tone === null) return null;
  if (tone === 'exhausted') return <AiUsageBanner />;
  if (!shown) return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
      <span className="min-w-0 flex-1">
        {usage.trial
          ? t('warningTrial', { percent: percentLabel(usage.percentUsed ?? 0) })
          : t('warning', { percent: percentLabel(usage.percentUsed ?? 0) })}
      </span>
      <button
        type="button"
        data-action="usage.closeNotice"
        onClick={() => setClosed(true)}
        aria-label={tChat('close')}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  );
}
