import { notFound } from 'next/navigation';
import { AgentDetail } from '@/components/chat/agents/AgentDetail';
import { agentPageId } from '@/lib/chat/agentView';
import { chatPageOpen } from '../../chat/_chatPageAccess';

/**
 * An agent's detail (CHAT-21 §C; governance mockup #g-agent): its state,
 * buttons, settings, triggers, runs and AI use (CHAT-27 item 25), read from
 * the agents API. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC), and only for an agent's id; otherwise not found.
 */
export default async function ChatAgentPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const id = agentPageId((await params).id);
  if (!id) notFound();
  // Keyed by the agent: a Duplicate opens the copy fresh, not over the original.
  return <AgentDetail key={id} id={id} />;
}
