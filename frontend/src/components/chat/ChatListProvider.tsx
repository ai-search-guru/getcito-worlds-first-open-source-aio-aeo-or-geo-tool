'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from '@/i18n/navigation';
import type { ChatListItem, ChatListResult } from '@/lib/chat/conversations';
import { anyUnderWay } from '@/lib/chat/menuGroups';

/**
 * The person's chats for every part of the Chat shell (the menu, Home's
 * Inbox, the header's title): read once from GET /api/chat/conversations
 * and shared, read again when the page changes, when the window comes
 * back, every few seconds while a chat works, and every half
 * minute otherwise. A change made here (a rename, a pin) shows at once
 * through `update`, before the next read.
 */

/** How often the list is read while a chat works. */
export const CHAT_LIST_POLL_BUSY_MS = 5_000;
/** How often it is read otherwise. */
export const CHAT_LIST_POLL_IDLE_MS = 30_000;

export type ChatListStatus = 'loading' | 'ready' | 'error';

export interface ChatListState {
  status: ChatListStatus;
  chats: ChatListItem[];
  /** "Chats 148": every chat the person sees that isn't archived. */
  total: number;
  /** "Archived · 2". */
  archived: number;
  /** Reads the list again now. */
  refresh: () => Promise<void>;
  /** Changes the rows here at once (an optimistic edit); the next read wins. */
  update: (change: (chats: ChatListItem[]) => ChatListItem[]) => void;
}

const ChatListContext = createContext<ChatListState | null>(null);

export function ChatListProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<ChatListStatus>('loading');
  const [list, setList] = useState<ChatListResult>({
    chats: [],
    total: 0,
    archived: 0,
  });
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { cache: 'no-store' }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as
      ({ ok: true } & ChatListResult) | { ok: false } | null;
    if (!res?.ok || !body?.ok) {
      // A failed read keeps the rows already shown; only a first one says so.
      setStatus((was) => (was === 'ready' ? was : 'error'));
      return;
    }
    busy.current = anyUnderWay(body.chats);
    setList({ chats: body.chats, total: body.total, archived: body.archived });
    setStatus('ready');
  }, []);

  // Again on every page change: a chat started or opened there shows at once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!stopped) {
        timer = setTimeout(tick, busy.current ? CHAT_LIST_POLL_BUSY_MS : CHAT_LIST_POLL_IDLE_MS);
      }
    };
    timer = setTimeout(tick, CHAT_LIST_POLL_BUSY_MS);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const update = useCallback((change: (chats: ChatListItem[]) => ChatListItem[]) => {
    setList((was) => ({ ...was, chats: change(was.chats) }));
  }, []);

  const value = useMemo<ChatListState>(
    () => ({ status, ...list, refresh, update }),
    [status, list, refresh, update],
  );
  return <ChatListContext.Provider value={value}>{children}</ChatListContext.Provider>;
}

/** The shell's chats; outside the provider, an empty list that is never read. */
export function useChatList(): ChatListState {
  return (
    useContext(ChatListContext) ?? {
      status: 'loading',
      chats: [],
      total: 0,
      archived: 0,
      refresh: async () => undefined,
      update: () => undefined,
    }
  );
}
