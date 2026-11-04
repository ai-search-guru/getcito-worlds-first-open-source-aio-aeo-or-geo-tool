/**
 * The Signals page's summary cards (AC-008): which population each counts,
 * and how a change against the previous period is coloured.
 *
 * More signals usually means more losses and gaps, so a change in how many
 * there are is not good news by itself: it is shown neutral, whichever way it
 * goes. Only more resolved is plainly good. Fewer resolved isn't plainly bad
 * either (fewer problems may have come up), so it stays neutral too.
 */

export type SignalMetric = 'total' | 'important' | 'new' | 'resolved';

export type ChangeTone = 'positive' | 'neutral';

export function signalChangeTone(metric: SignalMetric, change: number): ChangeTone {
  return metric === 'resolved' && change > 0 ? 'positive' : 'neutral';
}

/**
 * "+550%", "−40%", "0%": a change against the previous period, with its
 * direction in the text. With the colour neutral, an icon alone would leave
 * it to shape, and screen readers would hear no direction at all.
 */
export function signedPercent(change: number): string {
  if (change > 0) return `+${change}%`;
  if (change < 0) return `−${Math.abs(change)}%`;
  return '0%';
}
