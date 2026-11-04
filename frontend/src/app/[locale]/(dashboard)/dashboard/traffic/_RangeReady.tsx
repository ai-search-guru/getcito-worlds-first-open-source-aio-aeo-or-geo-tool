'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TrafficDateWindow } from '@/lib/actions/traffic';

/**
 * Whether the AI Traffic page has every section's data for the range on
 * screen. A new range shows only a spinner until then, rather than one
 * range's numbers beside another's while the sections fill in.
 *
 * Each section says whether it has its data for the current range
 * (useRangeReady); the page (useRangeGate) waits for all of them and its own
 * reads. Once a range has settled it stays settled: a section reading again
 * for a tab or a Track doesn't hide the page.
 */

type Report = (id: string, range: string | null) => void;

const RangeReadyContext = createContext<{
  rangeKey: string;
  report: Report;
  unregister: (id: string) => void;
} | null>(null);

export const RangeReadyProvider = RangeReadyContext.Provider;

/** The range a page's data answers, for comparing one with another. */
export function rangeKeyOf(window: TrafficDateWindow): string {
  return `${window.dateFrom ?? ''}|${window.dateTo ?? ''}`;
}

/**
 * A section says whether it has its data for the page's current range — or
 * has none to read (a source not connected), which is ready too.
 */
export function useRangeReady(id: string, ready: boolean) {
  const ctx = useContext(RangeReadyContext);
  const rangeKey = ctx?.rangeKey ?? null;
  useEffect(() => {
    ctx?.report(id, ready ? rangeKey : null);
  }, [ctx, id, ready, rangeKey]);
  useEffect(() => () => ctx?.unregister(id), [ctx, id]);
}

/**
 * The page's side: settled once its own reads (`ownReady`) and every section
 * that reported have the range. Checked a turn later, so a section mounting
 * in the same render reports first. A read that hangs doesn't keep the page
 * hidden past `maxWaitMs`, about the reads' statement timeout: the section
 * then shows its own loading state.
 */
export function useRangeGate(rangeKey: string, ownReady: boolean, { maxWaitMs = 10_000 } = {}) {
  const reports = useRef(new Map<string, string | null>());
  const [version, setVersion] = useState(0);
  // Each range change waits anew, even back to a range that settled before
  // (All time → 7d → All time): its key alone would read as settled at once,
  // over whatever landed meanwhile.
  const [wait, setWait] = useState({ rangeKey, id: 0 });
  if (wait.rangeKey !== rangeKey) setWait({ rangeKey, id: wait.id + 1 });
  const [settledId, setSettledId] = useState<number | null>(null);

  const report = useCallback<Report>((id, range) => {
    if (reports.current.has(id) && reports.current.get(id) === range) return;
    reports.current.set(id, range);
    setVersion((v) => v + 1);
  }, []);
  const unregister = useCallback((id: string) => {
    if (reports.current.delete(id)) setVersion((v) => v + 1);
  }, []);

  const waitId = wait.id;
  useEffect(() => {
    if (settledId === waitId || !ownReady) return;
    const id = window.setTimeout(() => {
      if ([...reports.current.values()].every((range) => range === rangeKey)) {
        setSettledId(waitId);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, [rangeKey, waitId, ownReady, version, settledId]);

  useEffect(() => {
    if (settledId === waitId) return;
    const id = window.setTimeout(() => setSettledId(waitId), maxWaitMs);
    return () => window.clearTimeout(id);
  }, [waitId, settledId, maxWaitMs]);

  const value = useMemo(() => ({ rangeKey, report, unregister }), [rangeKey, report, unregister]);
  return { settled: settledId === wait.id && wait.rangeKey === rangeKey, value };
}
