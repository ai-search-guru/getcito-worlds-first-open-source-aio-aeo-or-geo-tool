'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the new Chat is on for the workspace (CHAT_AGENTIC, lib/chat/flag.ts),
 * read once by the dashboard's layout on the server: the variables never
 * reach the browser, only this answer. The pages that show Chat's access
 * and plan (Roles & access, Your access, the sidebar's role line) appear
 * only while it's on.
 */
const ChatAgenticContext = createContext(false);

export function ChatAgenticProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <ChatAgenticContext.Provider value={enabled}>{children}</ChatAgenticContext.Provider>;
}

export function useChatAgentic(): boolean {
  return useContext(ChatAgenticContext);
}
