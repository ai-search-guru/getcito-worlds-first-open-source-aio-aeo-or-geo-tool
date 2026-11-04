import { notFound } from 'next/navigation';
import { ChatSkills } from '@/components/chat/skills/ChatSkills';
import { chatPageOpen } from '../_chatPageAccess';

/**
 * Skills (mockup #s-skills; CHAT-13 items 8–10, Chat Wave 3 W3-07):
 * GetCito's skills and the workspace's own, to run, schedule, build an
 * agent on, or turn on and off. Only with the new Chat on for the
 * workspace (CHAT_AGENTIC).
 */
export default async function ChatSkillsPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatSkills />;
}
