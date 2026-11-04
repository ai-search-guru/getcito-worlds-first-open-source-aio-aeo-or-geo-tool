'use client';

import { useEffect, useState } from 'react';
import { runUnderWay, sameRun, type AgentRun, type AgentRunKind } from '@/lib/content/agentRuns';
import { readAgentRun } from '@/lib/content/agentRunsClient';
import { AGENT_POLL_MS } from '@/lib/content/drafts';

/** How long after one read of the run the next goes: its steps take a second or more. */
export const RUN_POLL_MS = 1000;

/**
 * The draft's Content Agent run while one is under way (v1.1 CE-027/035),
 * read from the browser while `active` (the editor waits on the agent): its
 * steps as the server writes them. The next read goes a second after the last
 * answered, so slow reads never pile up; in a hidden tab every AGENT_POLL_MS,
 * and at once when it shows again. Null otherwise, and before the run's
 * first step reads — never an earlier run's steps, nor another kind's (a
 * rewrite still under way when Fix starts, until the server closes it).
 */
export function useAgentRun(
  draftId: string,
  active: boolean,
  kinds: readonly AgentRunKind[],
): AgentRun | null {
  const [run, setRun] = useState<AgentRun | null>(null);
  const kindsKey = kinds.join();
  useEffect(() => {
    if (!active) return;
    const wanted = kindsKey.split(',');
    let done = false;
    let reading = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      reading = true;
      const next = await readAgentRun(draftId).catch(() => null);
      reading = false;
      if (done) return;
      const shown = next && runUnderWay(next) && wanted.includes(next.kind) ? next : null;
      setRun((last) => (sameRun(last, shown) ? last : shown));
      timer = setTimeout(() => void read(), document.hidden ? AGENT_POLL_MS : RUN_POLL_MS);
    };
    // Shown again: read now, unless a read is out (it sets the next one).
    const onVisible = () => {
      if (document.hidden || reading) return;
      clearTimeout(timer);
      void read();
    };
    document.addEventListener('visibilitychange', onVisible);
    void read();
    return () => {
      done = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      // The next wait starts from nothing, never this one's last steps.
      setRun(null);
    };
  }, [draftId, active, kindsKey]);
  return active && run && runUnderWay(run) ? run : null;
}
