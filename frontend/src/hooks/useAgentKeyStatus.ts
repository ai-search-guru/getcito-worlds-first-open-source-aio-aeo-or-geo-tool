'use client';

import { useEffect, useState } from 'react';

/**
 * Module-level cache so we only hit /api/settings/ai-providers once per
 * page-load session — not on every navigation. The sidebar and mobile nav
 * both consume this hook; sharing the cache means a single inflight request
 * even when both components mount simultaneously (e.g. on a resize boundary).
 *
 * The cache intentionally resets on a full page reload (module re-evaluation),
 * which satisfies the acceptance criterion: "after the key is saved, the badge
 * disappears on next load fine — no realtime requirement."
 */
let cachedStatus: 'loading' | 'configured' | 'missing' = 'loading';
let fetchPromise: Promise<void> | null = null;

export function fetchKeyStatus(): Promise<void> {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      const res = await fetch('/api/settings/ai-providers');
      if (!res.ok) {
        cachedStatus = 'missing';
        return;
      }
      const body = (await res.json()) as { configured?: boolean };
      cachedStatus = body.configured ? 'configured' : 'missing';
    } catch {
      cachedStatus = 'missing';
    }
  })();
  return fetchPromise;
}

/** Exposed for tests only — reads the current module-level cache value. */
export function getCachedStatus() {
  return cachedStatus;
}

/**
 * Returns whether the org has a provider key for Chat to use.
 *
 * On self-host this is a no-op — the key lives in the server env and no
 * network call is made. So it is with the new Chat on for the workspace
 * (CHAT_AGENTIC): that one runs on the plan's AI limit, a key of its own
 * being Enterprise's (lib/chat/key.ts). Only cloud instances with it off
 * probe the endpoint, gated by the same `NEXT_PUBLIC_IS_CLOUD` flag the rest
 * of the dashboard uses.
 *
 * @param probe - whether to ask: `isCloud` from `useFeatureGate()` with the
 *   new Chat off (`useChatAgentic()`), so this hook stays pure and testable
 *   without a real PlanContext.
 */
export function useAgentKeyStatus(probe: boolean): 'loading' | 'configured' | 'missing' {
  // Self-host and the new Chat never need a key check — return a stable value immediately.
  if (!probe) return 'configured';

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [status, setStatus] = useState<'loading' | 'configured' | 'missing'>(cachedStatus);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    // Already resolved from a prior render or sibling mount — nothing to do.
    if (cachedStatus !== 'loading') {
      setStatus(cachedStatus);
      return;
    }
    let cancelled = false;
    fetchKeyStatus().then(() => {
      if (!cancelled) setStatus(cachedStatus);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
