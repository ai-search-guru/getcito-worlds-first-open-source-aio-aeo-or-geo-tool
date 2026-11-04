'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Chat's staff Debug switch (CHAT-03 item 25; W1-15): whether the person is
 * GetCito staff, as the server read it (STAFF_EMAILS), and whether they
 * switched Debug on in the open chat's ⋯ menu. Kept for the visit, across
 * the chats opened in Chat's shell. Only the switch lives here: the debug
 * record itself comes from the staff-only endpoint, which checks the person
 * again on the server.
 */
export interface ChatDebugState {
  staff: boolean;
  on: boolean;
  toggle: () => void;
}

const ChatDebugContext = createContext<ChatDebugState | null>(null);

export function ChatDebugProvider({ staff, children }: { staff: boolean; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const value = useMemo<ChatDebugState>(
    () => ({ staff, on: staff && on, toggle: () => setOn((was) => !was) }),
    [staff, on],
  );
  return <ChatDebugContext.Provider value={value}>{children}</ChatDebugContext.Provider>;
}

/** The Debug switch; null outside Chat's shell (the side panel). */
export function useChatDebug(): ChatDebugState | null {
  return useContext(ChatDebugContext);
}
