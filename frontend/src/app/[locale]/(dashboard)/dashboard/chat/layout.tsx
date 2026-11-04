import type { ReactNode } from 'react';
import { ChatListProvider } from '@/components/chat/ChatListProvider';
import { ChatShell } from '@/components/chat/ChatShell';
import { chatShellPrefs } from './_chatPageAccess';

/**
 * Every Chat route's frame (CHAT-01 items 4f, 5, 9a–9f): the chat menu
 * beside the page, hidden or shown as the person left it, and the app
 * sidebar beside it as the rail or expanded, as they left that. While the
 * new Chat is off for the workspace (CHAT_AGENTIC) there is no frame: the
 * pages answer as they do today.
 */
export default async function ChatLayout({ children }: { children: ReactNode }) {
  const prefs = await chatShellPrefs();
  if (!prefs) return children;
  return (
    <ChatListProvider>
      <ChatShell menuOpen={prefs.menuOpen} railOpen={prefs.railOpen} staff={prefs.staff}>
        {children}
      </ChatShell>
    </ChatListProvider>
  );
}
