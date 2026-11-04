'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { getDraftBrief, getDraftSources } from '@/lib/actions/contentDrafts';
import type { DraftBrief } from '@/lib/content/brief';
import type { DraftSourceChoice, DraftSourcesData } from '@/lib/content/sources';
import type { BriefState } from './_BriefTab';

export type SourcesRead =
  | { data: DraftSourcesData; choices: DraftSourceChoice[]; failed: false }
  | { data: null; choices: []; failed: true };

export interface DraftReads {
  brief: BriefState;
  /** Null while the sources are read. */
  sources: SourcesRead | null;
  /** The brief as a rebuild or an edit left it. */
  setBrief: (brief: DraftBrief | null) => void;
  /** The sources as the Sources tab changed them (a source left out or kept). */
  setSources: Dispatch<SetStateAction<SourcesRead | null>>;
  reloadBrief: () => void;
  /** Reads the sources again: prompts, a page or a query joined the draft. */
  reloadSources: () => void;
}

/**
 * A draft's brief and sources (CE-007, CE-008), read once when the editor
 * opens and shared: the rules check against them (CE-009), the side panel's
 * Brief and Sources tabs show them, and Rebuild outline builds from them. A
 * rebuild, an edit or a source checked changes them here, so the rules never
 * check against a brief or sources the person no longer sees.
 */
export function useDraftReads(draftId: string): DraftReads {
  const [brief, setBriefState] = useState<BriefState>({ status: 'loading' });
  const [sources, setSources] = useState<SourcesRead | null>(null);
  const [briefAttempt, setBriefAttempt] = useState(0);
  const [sourcesAttempt, setSourcesAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getDraftBrief(draftId)
      .then((result) => {
        if (!cancelled) {
          setBriefState(result ? { status: 'ready', brief: result.brief } : { status: 'failed' });
        }
      })
      .catch((err) => {
        console.error('Failed to read the brief:', err);
        if (!cancelled) setBriefState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, briefAttempt]);

  useEffect(() => {
    let cancelled = false;
    getDraftSources(draftId)
      .then((result) => {
        if (cancelled) return;
        setSources(
          result
            ? { data: result.data, choices: result.choices, failed: false }
            : { data: null, choices: [], failed: true },
        );
      })
      .catch((err) => {
        console.error('Failed to read the draft sources:', err);
        if (!cancelled) setSources({ data: null, choices: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [draftId, sourcesAttempt]);

  const setBrief = useCallback(
    (next: DraftBrief | null) => setBriefState({ status: 'ready', brief: next }),
    [],
  );
  const reloadBrief = useCallback(() => {
    setBriefState({ status: 'loading' });
    setBriefAttempt((n) => n + 1);
  }, []);
  const reloadSources = useCallback(() => {
    setSources(null);
    setSourcesAttempt((n) => n + 1);
  }, []);

  return { brief, sources, setBrief, setSources, reloadBrief, reloadSources };
}
