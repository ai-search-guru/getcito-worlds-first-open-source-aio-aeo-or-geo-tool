import { createHash } from 'node:crypto';
import type { RunProgress } from '../engineStore';

/**
 * "Notify only if the answer changed" (CHAT-12 item 20; W3-04a): what a
 * scheduled run read, as a fingerprint, so a change-only job whose data is
 * the same as at its last delivered run stops before the writing step —
 * "No change", with no answer written, no file and no writing step's use.
 * The first run always delivers (no fingerprint to match yet).
 *
 * The fingerprint is sha256 of the reads, each tool with its input and
 * result, keys in order, with what changes on every run left out: times and
 * dates (a key named for one, or a value that is an ISO date or time), so
 * "the last 7 days" read on two Mondays with the same numbers matches. A
 * run that read nothing has none. Server only.
 */

/** A key that holds a time ("created_at", "dataAsOf", "date", "period_start"). */
const TIME_KEY =
  /(^|_)(at|as_of|date|dates|day|time|timestamp|generated|updated|created|since|until|from|to|start|end|period(_start|_end)?)$|[a-z](At|AsOf|Date|Time|Since|Until)$/;
/** A value that is a date or a time: "2026-10-26", "2026-10-26T08:00:00.000Z". */
const TIME_VALUE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** A value with its times left out and its keys in order, for a stable hash. */
function steady(value: unknown): unknown {
  if (typeof value === 'string') return TIME_VALUE.test(value.trim()) ? null : value;
  if (Array.isArray(value)) return value.map(steady);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const isTime = (item: unknown) => typeof item === 'string' && TIME_VALUE.test(item.trim());
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => !TIME_KEY.test(key) && !isTime(record[key]))
        .sort()
        .map((key) => [key, steady(record[key])]),
    );
  }
  return value;
}

/** The fingerprint of what a run read (above); null when it read nothing. */
export function readFingerprint(readLog: RunProgress['readLog']): string | null {
  if (readLog.length === 0) return null;
  const reads = readLog.map((read) => ({
    tool: read.tool,
    input: steady(read.input),
    result: steady(read.result),
  }));
  return createHash('sha256').update(JSON.stringify(reads)).digest('hex');
}

/**
 * At the end of a scheduled run's reading (the engine, before the writing
 * step): keeps the fingerprint of what it read on its progress and answers
 * whether it is the same as its change-only job's last delivered run's,
 * which then stops as "No change". Only for a scheduled run.
 */
export function readUnchanged(progress: RunProgress): boolean {
  if (!progress.scheduled) return false;
  const fingerprint = readFingerprint(progress.readLog);
  if (!fingerprint) return false;
  progress.fingerprint = fingerprint;
  const last = progress.changeOnly?.last ?? null;
  if (last === null || last !== fingerprint) return false;
  progress.unchanged = true;
  return true;
}
