'use client';

import { useEffect, useRef, useState } from 'react';
import { readAutoHandOff } from '@/lib/content/agentRunsClient';

/**
 * Quality's automatic hand-off (Content Editor Quality spec §5, CE-051): a
 * draft its brand hands off (Settings › Content, as it was when the draft
 * was made) goes to the Content Agent on its own, once, when its page came
 * from elsewhere (an imported page, or one the agent wrote) and the editor
 * has read it: Quality is in and nothing holds Hand off (open suggestions,
 * the agent at work, the month's AI usage spent: it waits for those). Only
 * the browser reads Quality, so the run starts here; the server's row is the
 * claim, so a reopen or a second tab doesn't run it again. Nothing to fix
 * the first time it may run: none this session.
 */
export function useAutoHandOff({
  draftId,
  brandId,
  due,
  ready,
  count,
  run,
}: {
  draftId: string;
  brandId: string;
  /** The brand hands off this draft, and its page didn't start empty here. */
  due: boolean;
  /** Quality is read and Hand off may run now. */
  ready: boolean;
  /** The suggestions it would hand off. */
  count: number;
  run: () => Promise<void>;
}): void {
  // Whether the draft's automatic run is behind it (it had it, or its brand
  // stopped handing off): read once. Unread counts as had, so it never runs twice.
  const [had, setHad] = useState<boolean | null>(null);
  useEffect(() => {
    if (!due) return;
    let live = true;
    void readAutoHandOff(draftId, brandId).then((read) => {
      if (live) setHad(read ?? true);
    });
    return () => {
      live = false;
    };
  }, [draftId, brandId, due]);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });
  const done = useRef(false);
  useEffect(() => {
    if (!due || had !== false || !ready || done.current) return;
    done.current = true;
    if (count > 0) void runRef.current();
  }, [due, had, ready, count]);
}
