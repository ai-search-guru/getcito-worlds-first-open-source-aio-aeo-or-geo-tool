import { notFound } from 'next/navigation';
import { AgentCenter } from '@/components/chat/agents/AgentCenter';
import { agentCenterTabOf } from '@/lib/chat/agentView';
import { readMyWorkAreas, readPresetLocks } from '@/lib/chat/agents/readySetup';
import { chatPageOpen } from '../chat/_chatPageAccess';

/**
 * Agent Center (CHAT-21 §B; governance mockup #g-agents; AGENTS plan §1):
 * Ready to use, the ready-to-use agents with the plan locks of this
 * workspace and the person's work areas (theirs first), and Your agents (`?tab=yours`), the agents the person may see
 * with their AI use (CHAT-27 item 24). Its own item under Chat on the menu,
 * no longer inside Chat; /dashboard/chat/agents redirects here. Only with
 * the new Chat on for the workspace (CHAT_AGENTIC), as Chat's pages;
 * otherwise not found.
 */
export default async function AgentCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const { tab } = await searchParams;
  const [locks, workAreas] = await Promise.all([readPresetLocks(), readMyWorkAreas()]);
  return <AgentCenter initialTab={agentCenterTabOf(tab)} locks={locks} workAreas={workAreas} />;
}
