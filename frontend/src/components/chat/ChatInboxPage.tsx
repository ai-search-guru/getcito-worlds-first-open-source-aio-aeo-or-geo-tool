'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { useUpgradeDialog } from '@/components/context/upgradeGate';
import {
  markDailySuggestionsSeen,
  readDailySuggestions,
  setDailySuggestions,
  startDailySuggestions,
  type SuggestionsReadResult,
} from '@/lib/actions/chatSuggestions';
import type { ChatNoticesRead } from '@/lib/actions/chatNotices';
import type { DailySuggestion, DailySuggestionsRead } from '@/lib/chat/dailySuggestions';
import { useBrandStore } from '@/state/useBrandStore';
import { ChatInboxView, inboxItems, inboxTabOf, useNow } from './ChatInbox';
import { useChatList } from './ChatListProvider';
import type { InboxDaily, SuggestionBrand } from './InboxSuggestions';

/*
 * The Inbox page's live part, kept apart from ChatInbox.tsx: it calls the
 * daily suggestions' server actions, which the Chat shell, Home and All
 * chats, importing the Inbox's helpers, don't need.
 */

/**
 * The person's daily suggestions for the Inbox, from the page's read, and
 * what their clicks do: null while the new Chat is off or they couldn't be
 * read, and the Inbox is as it was.
 *
 * - An Agency partner's first Inbox makes their feeds (startDailySuggestions)
 *   and shows the line explaining them.
 * - Rows on screen are marked seen; opening one opens its page (W2-26), on
 *   its brand, which marks it opened and its feed used. A row whose brand
 *   isn't in the person's list doesn't open (it would on the brand on
 *   screen); with more than one brand, each row names its own.
 * - Pause and Turn back on change every feed of theirs, then read again.
 *
 * In a read-only workspace the list shows, and nothing is written: seeing
 * and opening only read (the page too), and Pause and Turn back on open
 * the plan dialog.
 */
export function useInboxDaily(
  initial: SuggestionsReadResult | null | undefined,
): InboxDaily | null {
  const t = useTranslations('chatShell.inbox.suggestions');
  const tReadOnly = useTranslations('readOnly.actions');
  const router = useRouter();
  const dialog = useUpgradeDialog();
  const readOnly = !!dialog?.isLocked && !dialog.isDemo;
  const openUpgrade = dialog?.openUpgrade;
  const brands = useBrandStore((s) => s.brands);
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const setActiveBrand = useBrandStore((s) => s.setActiveBrand);
  const [read, setRead] = useState<DailySuggestionsRead | null>(initial?.ok ? initial.read : null);
  const [justStarted, setJustStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set<string>());
  const starting = useRef(false);

  const brandOf = useMemo(() => {
    const names = new Map(brands.map((brand) => [brand.id, brand.name]));
    const several = brands.filter((brand) => !brand.isDemo).length > 1;
    return (suggestion: DailySuggestion): SuggestionBrand => ({
      name: several ? (names.get(suggestion.brandId) ?? null) : null,
      known: names.has(suggestion.brandId),
    });
  }, [brands]);

  const reload = useCallback(async () => {
    const result = await readDailySuggestions();
    if (result.ok) setRead(result.read);
  }, []);

  useEffect(() => {
    if (!read || read.roleFeed !== 'opt_in' || read.state !== 'none') return;
    if (readOnly || starting.current) return;
    starting.current = true;
    void startDailySuggestions()
      .then(async (result) => {
        if (!result.ok || result.made === 0) return;
        setJustStarted(true);
        await reload();
      })
      .catch(() => undefined);
  }, [read, readOnly, reload]);

  const onSeen = useCallback(
    (ids: string[]) => {
      if (readOnly) return;
      const fresh = ids.filter((id) => !seen.current.has(id));
      if (fresh.length === 0) return;
      for (const id of fresh) seen.current.add(id);
      void markDailySuggestionsSeen(fresh).catch(() => undefined);
    },
    [readOnly],
  );

  const onOpen = useCallback(
    (suggestion: DailySuggestion) => {
      if (!brands.some((brand) => brand.id === suggestion.brandId)) return;
      if (suggestion.brandId !== activeBrandId) setActiveBrand(suggestion.brandId);
      router.push(`/dashboard/chat/inbox/${suggestion.id}`);
    },
    [activeBrandId, brands, setActiveBrand, router],
  );

  const change = useCallback(
    async (on: boolean) => {
      const label = tReadOnly(on ? 'resumeDailySuggestions' : 'pauseDailySuggestions');
      if (readOnly) {
        openUpgrade?.(label);
        return;
      }
      setBusy(true);
      try {
        const result = await setDailySuggestions(on);
        if (!result.ok) {
          if (result.failure === 'read_only') openUpgrade?.(label);
          else toast.error(t('changeFailed'));
          return;
        }
        await reload();
      } catch {
        toast.error(t('changeFailed'));
      } finally {
        setBusy(false);
      }
    },
    [readOnly, openUpgrade, reload, t, tReadOnly],
  );

  if (!read) return null;
  return {
    read,
    brandOf,
    justStarted,
    busy,
    onOpen,
    onSeen,
    onPause: () => void change(false),
    onResume: () => void change(true),
  };
}

/**
 * The Inbox with the person's chats from the shell's list, and their daily
 * suggestions as the page read them (absent, as it was), on the topic the
 * address names (`?tab=`).
 */
export function ChatInbox({
  suggestions,
  notices,
}: {
  suggestions?: SuggestionsReadResult | null;
  /** The person's open notices (00441), as the page read them; none when they couldn't be. */
  notices?: ChatNoticesRead | null;
}) {
  const { status, chats, refresh } = useChatList();
  const now = useNow();
  const items = useMemo(() => inboxItems(chats), [chats]);
  const daily = useInboxDaily(suggestions);
  const searchParams = useSearchParams();
  const tab = inboxTabOf(searchParams?.get('tab'));
  return (
    <ChatInboxView
      status={status}
      items={items}
      now={now}
      onRetry={() => void refresh()}
      daily={daily}
      initialTab={tab}
      notices={notices?.ok ? notices.notices : []}
    />
  );
}
