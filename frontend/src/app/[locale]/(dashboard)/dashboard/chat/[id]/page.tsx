import { notFound } from 'next/navigation';
import { ChatThreadView } from '@/components/chat/ChatThreadView';
import { ChatUnavailable } from '@/components/chat/ChatUnavailable';
import { MarkChatRead } from '@/components/chat/MarkChatRead';
import { chatIdOf } from '@/lib/chat/conversations';
import { loadChatThread } from '@/lib/chat/thread';
import { chatComposerSetup, chatPageOpen } from '../_chatPageAccess';

/**
 * A saved chat (CHAT-01 item 1): its messages, each answer as its run works,
 * and the composer docked under them; a run still under way picks up its
 * stream. Opening it marks its result read. A teammate's shared chat is read
 * only. An unknown, deleted or unshared chat says "This chat isn't
 * available." (item 26). Only with the new Chat on for the workspace
 * (CHAT_AGENTIC).
 */
export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const id = chatIdOf((await params).id);
  const [thread, setup] = await Promise.all([
    id ? loadChatThread(id) : Promise.resolve(null),
    chatComposerSetup(),
  ]);
  if (!thread) return <ChatUnavailable />;
  return (
    <>
      <MarkChatRead chatId={thread.conversationId} />
      <ChatThreadView thread={thread} variant="dock" {...setup} />
    </>
  );
}
