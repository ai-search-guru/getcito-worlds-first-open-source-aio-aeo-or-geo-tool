'use client';

import { createContext, useContext, useEffect } from 'react';

/**
 * The last part of the Chat header's breadcrumb a page names itself, as a
 * daily suggestion's page does ("Chat › Inbox › Daily suggestion · Oct 29",
 * CHAT-26): the shell keeps it, the page sets it while it is shown.
 * Outside the shell nothing happens.
 */
export const ChatCrumbContext = createContext<((tail: string | null) => void) | null>(null);

export function useChatCrumb(tail: string | null) {
  const set = useContext(ChatCrumbContext);
  useEffect(() => {
    set?.(tail);
    return () => set?.(null);
  }, [set, tail]);
}
