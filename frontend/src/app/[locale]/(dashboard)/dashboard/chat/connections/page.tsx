import { notFound } from 'next/navigation';
import { ChatConnections } from '@/components/chat/connections/ChatConnections';
import { chatPageOpen } from '../_chatPageAccess';

/**
 * Connections (agentic plan §6; mockup #s-conns; W4-25): what the brand
 * open now has connected, and what it could connect. Only with the new
 * Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatConnectionsPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatConnections />;
}
