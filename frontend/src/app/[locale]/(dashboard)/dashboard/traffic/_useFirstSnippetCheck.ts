'use client';

import { useEffect, useRef, useState } from 'react';
import type { TrafficSources } from '@/lib/actions/traffic';
import { checkTrackingSnippet } from '@/lib/trafficSnippetClient';

/** sessionStorage: a brand whose first check already ran in this browser session. */
export const firstCheckKey = (brandId: string) => `aeo:snippet-first-check:${brandId}`;

/**
 * Whether the page looks for the snippet on its own: the brand's home page
 * was never checked (00433), it never sent an AI visit, and it has a domain
 * to check.
 */
export function needsFirstCheck(
  sources: Pick<TrafficSources, 'snippetCheckedAt' | 'snippetLastVisitAt'> | null,
  domain: string | undefined,
): boolean {
  return (
    sources !== null &&
    sources.snippetCheckedAt === null &&
    sources.snippetLastVisitAt === null &&
    Boolean(domain)
  );
}

/** Marks the brand's first check as run; false when it already ran this session. */
function claimFirstCheck(brandId: string): boolean {
  try {
    if (sessionStorage.getItem(firstCheckKey(brandId))) return false;
    sessionStorage.setItem(firstCheckKey(brandId), '1');
  } catch {
    // Storage blocked: the check runs once while the page is open.
  }
  return true;
}

/**
 * AI Traffic's first check: a brand whose home page was never checked for
 * the snippet is checked once when the page opens, as Check again does, and
 * once a browser session. `onChecked` reads the sources again after a check
 * that ran; one that was refused (the rate limit) or failed keeps what the
 * page showed. True while the brand's check runs.
 */
export function useFirstSnippetCheck({
  brandId,
  sources,
  domain,
  onChecked,
}: {
  brandId: string;
  sources: TrafficSources | null;
  domain: string | undefined;
  onChecked: () => void;
}): boolean {
  const [checkingFor, setCheckingFor] = useState<string | null>(null);
  const needed = needsFirstCheck(sources, domain);
  const onCheckedRef = useRef(onChecked);
  useEffect(() => {
    onCheckedRef.current = onChecked;
  }, [onChecked]);
  // Checked once, so a page left open doesn't ask again.
  const startedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!needed || startedRef.current.has(brandId)) return;
    startedRef.current.add(brandId);
    if (!claimFirstCheck(brandId)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one check per brand and session
    setCheckingFor(brandId);
    void checkTrackingSnippet(brandId).then((result) => {
      setCheckingFor((current) => (current === brandId ? null : current));
      if (result.ok) onCheckedRef.current();
    });
  }, [brandId, needed]);

  return checkingFor === brandId;
}
