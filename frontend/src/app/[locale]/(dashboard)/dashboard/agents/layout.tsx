import type { ReactNode } from 'react';
import { AgentsSeen } from '@/components/chat/agents/AgentsSeen';

/**
 * Agent Center's pages: opening any of them counts as having seen it, so the
 * chat menu's "New" beside Agent Center goes, whichever way it was opened.
 */
export default function AgentCenterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AgentsSeen />
      {children}
    </>
  );
}
