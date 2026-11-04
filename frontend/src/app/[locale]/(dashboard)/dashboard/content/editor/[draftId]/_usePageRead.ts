'use client';

import { useEffect, useRef, useState } from 'react';
import { readDraftPage } from '@/lib/actions/contentDrafts';
import type { PageRead } from '@/lib/content/pageRead';

/** How long after a save the page is asked about, as the claims are. */
export const PROOF_READ_DELAY_MS = 3_000;
/** Asks no closer together than this: the API reads a changed page once a minute. */
export const PROOF_READ_EVERY_MS = 60_000;
/**
 * Slack on the API's minute: it counts from when the last ask reached it,
 * which may be a little after the editor sent it.
 */
export const PROOF_READ_SLACK_MS = 5_000;

export interface PageReadState {
  /** The page's spots and proof asks, null until the first read. */
  read: PageRead | null;
  /** The workspace's AI budget is spent: no more asks this session. */
  paused: boolean;
  /** The draft's page reads for the day are made: no more asks this session. */
  limited: boolean;
  /**
   * An ask is out, the page changed within the API's minute, or a save is
   * still to be asked about (its read may move the scores).
   */
  reading: boolean;
  /**
   * The read's first answer is in (a read, a failure, its limits, or off):
   * what waits on the proof to-dos (Next step's skips) can read them.
   */
  settled: boolean;
}

/**
 * The page's read for proof (Quality CE-049). The API reads the draft as
 * saved and keeps its read by the page's hash, so the editor asks a few
 * seconds after a save, PROOF_READ_EVERY_MS apart at most, one ask at a
 * time, and not while there are changes to save. An answer the API kept
 * from before the page changed (`pending`) is asked about again a minute
 * later, without a save. A spent AI budget or the day's reads made stop the
 * asks for the session; an API with them off stops them silently; a failed
 * ask waits for the next save.
 */
export function usePageRead(
  draftId: string,
  savedAt: string,
  enabled: boolean,
  unsaved: boolean,
): PageReadState {
  const [read, setRead] = useState<PageRead | null>(null);
  const [paused, setPaused] = useState(false);
  const [limited, setLimited] = useState(false);
  const [off, setOff] = useState(false);
  const [failed, setFailed] = useState(false);
  const [out, setOut] = useState(false);
  const [pending, setPending] = useState(false);
  // The save the last ask went out for: a later one is still to be read.
  const [askedSave, setAskedSave] = useState<string | null>(null);
  // Bumped when the next ask needn't wait for a save.
  const [again, setAgain] = useState(0);
  const asking = useRef(false);
  const latest = useRef(savedAt);
  const askedFor = useRef<string | null>(null);
  const lastAsk = useRef(0);
  const left = useRef(false);
  const open = useRef(true);
  useEffect(() => {
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
    const wait = Math.max(
      PROOF_READ_DELAY_MS,
      lastAsk.current + PROOF_READ_EVERY_MS + PROOF_READ_SLACK_MS - Date.now(),
    );
    const timer = setTimeout(() => {
      // One at a time: a save while one is out is asked about after it.
      if (asking.current) return;
      asking.current = true;
      askedFor.current = savedAt;
      setAskedSave(savedAt);
      lastAsk.current = Date.now();
      left.current = false;
      setOut(true);
      readDraftPage(draftId)
        .then((result) => {
          if (!open.current) return;
          if ('error' in result) {
            if (result.error === 'off') setOff(true);
            // Failed: asked about again after the next save, not on a timer.
            else {
              console.error('Failed to read the page:', result.error);
              setFailed(true);
              setPending(false);
            }
            return;
          }
          const { pending: kept, limited: full, paused: spent, ...page } = result;
          setRead(page);
          setPending(kept);
          if (spent) setPaused(true);
          else if (full) setLimited(true);
          else if (kept) left.current = true;
        })
        .catch((err) => {
          console.error('Failed to read the page:', err);
          if (!open.current) return;
          setFailed(true);
          setPending(false);
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

  // A save not asked about yet counts, as the claims' does (useClaims).
  const reading =
    enabled && !paused && !limited && !off && (out || pending || askedSave !== savedAt);
  const settled = !enabled || read !== null || failed || off || paused || limited;
  return { read, paused, limited, reading, settled };
}
