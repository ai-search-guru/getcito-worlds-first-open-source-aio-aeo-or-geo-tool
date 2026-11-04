import { notFound } from 'next/navigation';
import { ChatInbox } from '@/components/chat/ChatInboxPage';
import { readChatNotices } from '@/lib/actions/chatNotices';
import { readDailySuggestions } from '@/lib/actions/chatSuggestions';
import { chatPageOpen } from '../_chatPageAccess';

/**
 * Chat's Inbox (mockup #s-inbox): what needs the person, what their agents
 * are running, and the results they haven't opened, with their daily
 * suggestions in topic tabs (CHAT-26, mockup #d-inbox), and an Admin's
 * notices when the workspace's own AI key fails (00441) at the top of Needs
 * you. Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatInboxPage() {
  if (!(await chatPageOpen())) notFound();
  const [suggestions, notices] = await Promise.all([readDailySuggestions(), readChatNotices()]);
  return <ChatInbox suggestions={suggestions} notices={notices} />;
}
