import { notFound } from 'next/navigation';
import { AgentForm } from '@/components/chat/agents/AgentForm';
import { readAgentEdit } from '@/lib/chat/agentFormSetup';
import { agentPageId } from '@/lib/chat/agentView';
import { chatPageOpen } from '../../../chat/_chatPageAccess';

/**
 * Edit an agent (CHAT-21 §C item 14, §D): the four steps filled with its
 * current version; a change to what it does saves a new version. Only with
 * the new Chat on for the workspace (CHAT_AGENTIC), and only for an agent
 * the person can see; otherwise not found. Without the right to change it
 * (`can.edit`), a read-only line instead of the form.
 */
export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const id = agentPageId((await params).id);
  if (!id) notFound();
  const found = await readAgentEdit(id);
  if (!found) notFound();
  // Keyed by the agent, its version and its last save: a saved change opens
  // fresh, and so does Reload after a save that made no new version (a name,
  // sharing, a cap, triggers, Pause), or the form would keep the old one and
  // be refused again.
  return (
    <AgentForm
      key={`${id}:${found.agent.version}:${found.agent.updatedAt}`}
      setup={found.setup}
      agent={found.agent}
    />
  );
}
