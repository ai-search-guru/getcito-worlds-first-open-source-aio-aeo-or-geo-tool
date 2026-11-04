/**
 * A rough "about N min left" for a tracking run, from the pace its checks
 * have been finishing at in this tab. Answers come in bursts with quiet
 * gaps, so only the last few minutes count, and nothing is said until there
 * is enough to go on: a minute or more, and a few checks done in it. Before
 * that, the banner keeps its general "a few minutes to 1–2 hours".
 */

/** One reading of a run's progress: when, and how many of its checks were done. */
export interface ProgressSample {
  at: number;
  current: number;
}

/** Readings older than this (from the newest) no longer set the pace. */
export const PACE_WINDOW_MS = 10 * 60_000;
/** The pace needs readings this far apart… */
const MIN_SPAN_MS = 60_000;
/** …and this many checks done between them. */
const MIN_DONE = 5;

/**
 * The readings with a new one added: kept only when the count moved (or it is
 * the first), and only the ones within PACE_WINDOW_MS of it. A count that
 * went back (a new run) starts over.
 */
export function withSample(samples: ProgressSample[], sample: ProgressSample): ProgressSample[] {
  const last = samples[samples.length - 1];
  if (last && sample.current < last.current) return [sample];
  if (last && sample.current === last.current) return samples;
  return [...samples, sample].filter((s) => sample.at - s.at <= PACE_WINDOW_MS);
}

/**
 * Whole minutes left at the pace of the readings; null without enough to go
 * on, or when nothing has moved for PACE_WINDOW_MS (a quiet gap: the old
 * pace would promise too much).
 */
export function minutesLeft(
  samples: ProgressSample[],
  total: number,
  now: number = Date.now(),
): number | null {
  if (samples.length < 2 || total <= 0) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (now - last.at > PACE_WINDOW_MS) return null;
  const span = last.at - first.at;
  const done = last.current - first.current;
  if (span < MIN_SPAN_MS || done < MIN_DONE || last.current >= total) return null;
  return Math.max(1, Math.ceil((total - last.current) / (done / span) / 60_000));
}

/**
 * How the time left reads: minutes up to 90 (to the nearest 5 past 10), whole
 * hours past it.
 */
export function etaParts(minutes: number): { minutes: number } | { hours: number } {
  if (minutes > 90) return { hours: Math.round(minutes / 60) };
  return { minutes: minutes > 10 ? Math.round(minutes / 5) * 5 : minutes };
}
