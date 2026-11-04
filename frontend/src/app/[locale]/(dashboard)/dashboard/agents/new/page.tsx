import { notFound } from 'next/navigation';
import { AgentForm } from '@/components/chat/agents/AgentForm';
import { readAgentFormSetup } from '@/lib/chat/agentFormSetup';
import { readyPreset } from '@/lib/chat/agents/catalog';
import { chatPageOpen } from '../../chat/_chatPageAccess';

/**
 * Create an agent (CHAT-21 §D; governance mockup #g-agent-new): four steps
 * and Save as draft or Turn on. `?skill=winback` starts from a skill (a
 * skill's Create agent); `?preset=weekly-report` from a ready-to-use agent
 * (Agent Center › Ready to use), filled in and saved only by the person.
 * Only with the new Chat on for the workspace (CHAT_AGENTIC); otherwise not
 * found. Analysts and Agency partners see a read-only line instead of the
 * form.
 */
export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string | string[]; preset?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const setup = await readAgentFormSetup();
  if (!setup) notFound();
  const { skill, preset } = await searchParams;
  return (
    <AgentForm
      setup={setup}
      initialSkill={typeof skill === 'string' ? skill : null}
      preset={readyPreset(typeof preset === 'string' ? preset : null)}
    />
  );
}
