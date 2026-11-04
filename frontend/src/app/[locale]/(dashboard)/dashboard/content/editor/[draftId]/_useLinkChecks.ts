'use client';

import { useEffect, useRef, useState } from 'react';
import { checkDraftLinks } from '@/lib/actions/contentDrafts';
import type { LinkCheck } from '@/lib/content/qualityChecks';

/** How long after a save the links are asked about. */
export const LINK_CHECK_DELAY_MS = 3_000;

/**
 * The page's links as the API reads them (Trust, Quality spec §2.2). The API
 * reads the draft as saved, so the editor asks a few seconds after the links
 * or the save change, for links it has no read of, and keeps each read; the
 * API keeps each a day. A link without a read (not saved yet, an account
 * link the API leaves out, one over its budget, a failed ask) is asked about
 * again only after the next save: until then the checks it would feed leave
 * it out. One the API never reads (an account link) isn't asked about again.
 * The links are compared as the draft saves them (cleanHref). `pending`
 * counts the links whose read may still come (Before you publish says
 * Trust may change): not read, not one the API never reads, and not asked
 * about at this save without a read (a failed ask, or an answer that left
 * it out: over the hourly reads, or written differently on the saved page).
 *
 * @param hrefs the page's http(s) links now, as it has them
 * @param savedAt when the page was last saved
 */
export function useLinkChecks(
  draftId: string,
  savedAt: string,
  hrefs: string[],
  enabled: boolean,
): { checks: Map<string, LinkCheck>; pending: number } {
  const [checks, setChecks] = useState<Map<string, LinkCheck>>(() => new Map());
  // Links the API never reads, and the save each link's ask failed at or
  // was answered without it.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const [failedAt, setFailedAt] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The links read, and the save each other link was last asked about at.
  const read = useRef(new Set<string>());
  const askedAt = useRef(new Map<string, string>());
  // A read that lands after the page changed still counts; only a closed editor drops it.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const key = hrefs.join('\n');

  useEffect(() => {
    if (!enabled) return;
    const fresh = key
      .split('\n')
      .filter((href) => href && !read.current.has(href) && askedAt.current.get(href) !== savedAt);
    if (!fresh.length) return;
    const timer = setTimeout(() => {
      for (const href of fresh) askedAt.current.set(href, savedAt);
      // Only the links this ask is still the last one about: an older ask
      // answering late doesn't undo a newer save's.
      const failed = (hrefs: string[]) => {
        const own = hrefs.filter((h) => askedAt.current.get(h) === savedAt);
        setFailedAt((prev) => new Map([...prev, ...own.map((h) => [h, savedAt] as const)]));
      };
      void checkDraftLinks(draftId)
        .then((result) => {
          if ('error' in result) {
            console.error('Failed to check the draft links:', result.error);
            if (open.current) failed(fresh);
            return;
          }
          if (!open.current) return;
          if (result.skipped.length) setSkipped((prev) => new Set([...prev, ...result.skipped]));
          // A link the API never reads is as good as read: it isn't asked about again.
          const answered = new Set([...result.links.map((l) => l.href), ...result.skipped]);
          for (const href of answered) read.current.add(href);
          // One the answer left out has no read coming at this save either.
          const missed = fresh.filter((href) => !answered.has(href));
          if (missed.length) failed(missed);
          setChecks((prev) => {
            const next = new Map(prev);
            for (const link of result.links) next.set(link.href, link);
            return next;
          });
        })
        // The call failing on its own (the network, a deploy meanwhile): as a failed read.
        .catch((err) => {
          console.error('Failed to check the draft links:', err);
          if (open.current) failed(fresh);
        });
    }, LINK_CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draftId, savedAt, key, enabled]);

  const pending = enabled
    ? hrefs.filter(
        (href) => href && !checks.has(href) && !skipped.has(href) && failedAt.get(href) !== savedAt,
      ).length
    : 0;
  return { checks, pending };
}
