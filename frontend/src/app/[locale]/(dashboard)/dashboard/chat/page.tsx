import { notFound } from 'next/navigation';
import { ChatHome } from '@/components/chat/ChatHome';
import { ChatThreadView } from '@/components/chat/ChatThreadView';
import { ChatFocusGate } from '@/components/chat/FocusPicker';
import { HomeDraftProvider } from '@/components/chat/HomeDraft';
import { composeText } from '@/lib/chat/composeParam';
import { chatComposerSetup, chatFirstName, chatFocusState, chatPageOpen } from './_chatPageAccess';

/**
 * Chat Home (CHAT-01 items 1, 10–12; mockup #s-home): the greeting, what
 * needs the person, "For you now" (CHAT-08 v2), and the composer to start a new
 * chat (W1-10…13). The first time, the focus picker (CHAT-24) opens in
 * their place, once. `?compose=` fills the box, not sent (a skill's
 * Schedule on the Skills page, W3-07). Only with the new Chat on for the
 * workspace (CHAT_AGENTIC).
 */
export default async function ChatHomePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const [firstName, setup, focus, { compose }] = await Promise.all([
    chatFirstName(),
    chatComposerSetup(),
    chatFocusState(),
    searchParams,
  ]);
  const text = composeText(compose);
  return (
    <ChatFocusGate {...focus}>
      <HomeDraftProvider>
        <ChatHome firstName={firstName} />
        <ChatThreadView
          thread={null}
          variant="home"
          {...setup}
          draft={text ? { nonce: 1, text } : null}
        />
      </HomeDraftProvider>
    </ChatFocusGate>
  );
}
