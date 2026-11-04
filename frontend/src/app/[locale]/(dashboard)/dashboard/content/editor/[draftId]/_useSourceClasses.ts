'use client';

import { useEffect, useRef, useState } from 'react';
import { classifyDraftSources } from '@/lib/actions/contentDrafts';
import { MAX_SOURCE_SITES, type AiSourceClass } from '@/lib/content/sourceClass';

/** How long after a save the sites are asked about, as the links are. */
export const SOURCE_CLASS_DELAY_MS = 3_000;

/**
 * The model's reads of the sites the rules can't place (Quality CE-046,
 * part b). The API reads the draft as saved, so the editor asks a few
 * seconds after a save, for sites it has no read of and hasn't asked about
 * at this save nor being asked about, MAX_SOURCE_SITES at a time; each read
 * is kept. A spent AI budget pauses the asks for the session (`paused`):
 * those sources stay out of Trust, and Quality says why; an API with the
 * reads off stops them too, silently. Sites the API's day's reads leave out
 * are asked about again after the next save.
 *
 * @param sites the sites the rules can't place now (unplacedSites)
 * @param savedAt when the page was last saved
 */
export function useSourceClasses(
  draftId: string,
  savedAt: string,
  sites: string[],
  enabled: boolean,
): { kinds: ReadonlyMap<string, AiSourceClass>; paused: boolean; reading: boolean } {
  const [kinds, setKinds] = useState<ReadonlyMap<string, AiSourceClass>>(() => new Map());
  const [paused, setPaused] = useState(false);
  // The API has them off (its Quality phase under 2): nothing to ask.
  const [off, setOff] = useState(false);
  // Each site's last answer (or failure), by the save it was asked at.
  const [answered, setAnswered] = useState<ReadonlyMap<string, string>>(() => new Map());
  const askedAt = useRef(new Map<string, string>());
  // Sites an ask is out for: a save meanwhile doesn't ask about them again.
  const asking = useRef(new Set<string>());
  // A read that lands after the page changed still counts; only a closed editor drops it.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const key = sites.join('\n');

  useEffect(() => {
    if (!enabled || paused || off) return;
    const fresh = key
      .split('\n')
      .filter(
        (site) =>
          site &&
          !kinds.has(site) &&
          !asking.current.has(site) &&
          askedAt.current.get(site) !== savedAt,
      )
      .slice(0, MAX_SOURCE_SITES);
    if (!fresh.length) return;
    const timer = setTimeout(() => {
      for (const site of fresh) {
        askedAt.current.set(site, savedAt);
        asking.current.add(site);
      }
      // A call that fails on its own (the network, a deploy meanwhile) lets
      // its sites go too: they're asked about again after the next save.
      void classifyDraftSources(draftId, fresh)
        .then((result) => {
          if (!open.current) return;
          if ('error' in result) {
            if (result.error === 'ai_budget') setPaused(true);
            else if (result.error === 'off') setOff(true);
            else console.error('Failed to read the sources:', result.error);
            return;
          }
          setKinds((prev) => {
            const next = new Map(prev);
            for (const { site, kind } of result.classes) next.set(site, kind);
            return next;
          });
        })
        .catch((err) => console.error('Failed to read the sources:', err))
        .finally(() => {
          for (const site of fresh) asking.current.delete(site);
          if (open.current) {
            setAnswered(
              (prev) => new Map([...prev, ...fresh.map((site) => [site, savedAt] as const)]),
            );
          }
        });
    }, SOURCE_CLASS_DELAY_MS);
    return () => clearTimeout(timer);
    // Each answer (a failed one too) lets the sites past the batch, or held
    // while their ask was out, be asked at this save.
  }, [draftId, savedAt, key, enabled, paused, off, kinds, answered]);

  // A site with no read and none answered at this save is still to be read.
  const reading =
    enabled &&
    !paused &&
    !off &&
    sites.some((site) => site && !kinds.has(site) && answered.get(site) !== savedAt);
  return { kinds, paused, reading };
}
