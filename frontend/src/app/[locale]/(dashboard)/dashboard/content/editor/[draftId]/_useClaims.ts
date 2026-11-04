'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkDraftClaims } from '@/lib/actions/contentDrafts';
import type { ClaimBlock } from '@/lib/content/claims';

/** How long after a save the claims are asked about, as the sources' kinds are. */
export const CLAIMS_DELAY_MS = 3_000;
/** Asks no closer together than this: a save every few seconds of typing asks once. */
export const CLAIMS_EVERY_MS = 30_000;

export interface ClaimsRead {
  /** Each block's claims, null until the first read. */
  blocks: ClaimBlock[] | null;
  /** The workspace's AI budget is spent: no more asks this session. */
  paused: boolean;
  /** The draft's claim reads for the day are made: no more asks this session. */
  limited: boolean;
  /** Some of the page isn't read yet: an ask is out, or blocks wait for the next. */
  reading: boolean;
  /**
   * The person has left the block the last ask left for later (the editor
   * lost focus): it is read with the next ask, CLAIMS_EVERY_MS after the
   * last one, with no save needed.
   */
  recheck: () => void;
}

/**
 * The claims in the draft's own words (Quality CE-045). The API reads the
 * draft as saved and keeps each block's read, so the editor asks a few
 * seconds after a save, CLAIMS_EVERY_MS apart at most, one ask at a time,
 * and not while a save is waiting or under way (the API would read the page
 * before it; a failed save isn't one, the page as last saved is read). It
 * leaves the block the person is writing in (`writingIn`, read when it
 * asks; null when they aren't), and asks again for one left,
 * or for blocks an ask had no calls left for, without waiting for a save.
 * A spent AI budget or the day's reads made stop the asks for the session;
 * an API with them off stops them silently; a failed ask waits for the next
 * save.
 */
export function useClaims(
  draftId: string,
  savedAt: string,
  enabled: boolean,
  unsaved: boolean,
  writingIn: () => string | null,
): ClaimsRead {
  const [blocks, setBlocks] = useState<ClaimBlock[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [limited, setLimited] = useState(false);
  const [off, setOff] = useState(false);
  const [out, setOut] = useState(false);
  const [pending, setPending] = useState(0);
  // The save the last ask went out for: a later one is still to be read.
  const [askedSave, setAskedSave] = useState<string | null>(null);
  // Bumped when the next ask needn't wait for a save: one is out, or
  // something was left for later.
  const [again, setAgain] = useState(0);
  const asking = useRef(false);
  const latest = useRef(savedAt);
  const askedFor = useRef<string | null>(null);
  const lastAsk = useRef(0);
  // What the last ask left: the block being written, or blocks past its calls.
  const skipped = useRef<string | null>(null);
  const left = useRef(false);
  const reader = useRef(writingIn);
  const open = useRef(true);
  useEffect(() => {
    reader.current = writingIn;
    latest.current = savedAt;
  });
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  useEffect(() => {
    // Changes not saved yet: their save asks.
    if (!enabled || paused || limited || off || unsaved) return;
    if (askedFor.current === savedAt && !left.current) return;
    const wait = Math.max(CLAIMS_DELAY_MS, lastAsk.current + CLAIMS_EVERY_MS - Date.now());
    const timer = setTimeout(() => {
      // One at a time: a save while one is out is asked about after it.
      if (asking.current) return;
      const skip = reader.current();
      asking.current = true;
      askedFor.current = savedAt;
      setAskedSave(savedAt);
      lastAsk.current = Date.now();
      skipped.current = skip;
      left.current = false;
      setOut(true);
      void checkDraftClaims(draftId, skip)
        .then((result) => {
          if (!open.current) return;
          if ('error' in result) {
            if (result.error === 'ai_budget') setPaused(true);
            else if (result.error === 'off') setOff(true);
            // Failed: asked about again after the next save, not on a timer.
            else console.error('Failed to read the claims:', result.error);
            setBlocks((prev) => prev ?? []);
            setPending(0);
            return;
          }
          setBlocks(result.blocks);
          setPending(result.pending);
          if (result.limited) setLimited(true);
          else if (result.pending > 0) left.current = true;
        })
        .catch((err) => {
          console.error('Failed to read the claims:', err);
          if (!open.current) return;
          setBlocks((prev) => prev ?? []);
          setPending(0);
        })
        .finally(() => {
          asking.current = false;
          if (!open.current) return;
          setOut(false);
          if (latest.current !== askedFor.current || left.current) setAgain((n) => n + 1);
        });
    }, wait);
    return () => clearTimeout(timer);
  }, [draftId, savedAt, enabled, paused, limited, off, unsaved, again]);

  const recheck = useCallback(() => {
    if (skipped.current === null) return;
    skipped.current = null;
    left.current = true;
    // One out asks again when it's back.
    if (!asking.current) setAgain((n) => n + 1);
  }, []);

  // A save not asked about yet counts: its claims may move Trust once read.
  const reading =
    enabled &&
    !paused &&
    !limited &&
    !off &&
    (blocks === null || out || pending > 0 || askedSave !== savedAt);
  return { blocks, paused, limited, reading, recheck };
}
