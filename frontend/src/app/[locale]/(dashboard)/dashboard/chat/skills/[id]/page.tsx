import { notFound } from 'next/navigation';
import { SkillReview } from '@/components/chat/skills/SkillReview';
import { chatPageOpen } from '../../_chatPageAccess';

/**
 * Review an imported skill (mockup #s-skill-review; CHAT-13 items 15–18,
 * Chat Wave 3 W3-09): its cleaned SKILL.md, the scan, what was removed and
 * its source; an Admin approves or rejects it. The API says who may see it
 * (an Admin, or its creator). Only with the new Chat on for the workspace.
 */
export default async function ChatSkillReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const { id } = await params;
  return <SkillReview id={id} />;
}
