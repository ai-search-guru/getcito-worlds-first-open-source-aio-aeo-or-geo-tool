import { notFound } from 'next/navigation';
import { SkillUpdate } from '@/components/chat/skills/SkillUpdate';
import { chatPageOpen } from '../../../_chatPageAccess';

/**
 * An imported skill's update (CHAT-13 items 16 and 19, Chat Wave 4 W4-31):
 * what changed in its SKILL.md at its source, the scan of the new version,
 * and its source; an Admin approves it. The API says who may see it (an
 * Admin, or its creator). Only with the new Chat on for the workspace.
 */
export default async function ChatSkillUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const { id } = await params;
  return <SkillUpdate id={id} />;
}
