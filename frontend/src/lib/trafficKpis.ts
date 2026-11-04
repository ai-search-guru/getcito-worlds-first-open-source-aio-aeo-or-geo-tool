/**
 * The rules behind the AI Traffic page's KPI cards (AT-017, spec §3.2), kept
 * apart from the cards so they're tested on their own.
 */

import type { DateRangePreset } from '@/components/filters/DateRangeFilter';
import { formatNumber } from '@/lib/format';

/**
 * How many of Search Console's latest reported days a short range reads, or
 * null to read the range as it is. Google reports about two days late, so
 * the last 24 hours or 7 days ending today would read as no clicks at all
 * (spec §3.01).
 */
export function gscLatestDays(preset: DateRangePreset): number | null {
  if (preset === '24h') return 1;
  if (preset === '7d') return 7;
  return null;
}

/** The ranges where a quiet stretch is likely, so an empty card offers 30 days instead. */
export function isShortRange(preset: DateRangePreset): boolean {
  return gscLatestDays(preset) !== null;
}

/**
 * A part of a whole as a percent: "0.5%", "75%". One decimal below 10%, where
 * whole percents would read as 0 or 1; "<0.1%" for a sliver that isn't zero.
 * Null when there is no whole to take a share of.
 */
export function formatShare(part: number, whole: number): string | null {
  if (whole <= 0) return null;
  const pct = (part / whole) * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  const rounded = pct < 10 ? Math.round(pct * 10) / 10 : Math.round(pct);
  return `${formatNumber(rounded)}%`;
}

/** A change as the cards write it: "+12%", "−6%" (a true minus, as on the Insights cards). */
export function formatPctChange(pct: number): string {
  return `${pct > 0 ? '+' : '−'}${formatNumber(Math.abs(pct))}%`;
}

/**
 * Search Console's days as a card names them: "Oct 15", or "Oct 10 – Oct 16".
 * They are calendar days in UTC, so they're written in UTC: read in the
 * member's own zone, a day west of Greenwich would show as the day before.
 */
export function formatGoogleDays(since: string | null, until: string): string {
  const day = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return !since || since === until ? day(until) : `${day(since)} – ${day(until)}`;
}

/** The sample a conversion comparison needs on each side (spec §5.4). */
export const COMPARISON_MIN_SESSIONS = 30;
export const COMPARISON_MIN_KEY_EVENTS = 5;

/**
 * AI visitors' key event rate against Google organic's, as a multiple
 * ("2x organic"), or null when either side is too small to compare (§5.4:
 * at least 30 sessions and 5 key events each) or a rate is unknown. The rate
 * is sessions with a key event over sessions, as GA4 reports it.
 */
export function organicRatio(
  ai: { sessions: number; keyEvents: number; keyEventSessions: number },
  organic: { sessions: number; keyEvents: number; keyEventSessions: number },
): number | null {
  const enough = (side: typeof ai) =>
    side.sessions >= COMPARISON_MIN_SESSIONS &&
    side.keyEvents >= COMPARISON_MIN_KEY_EVENTS &&
    side.keyEventSessions > 0;
  if (!enough(ai) || !enough(organic)) return null;
  return ai.keyEventSessions / ai.sessions / (organic.keyEventSessions / organic.sessions);
}

/** A multiple as the cards write it: "1.8×", "0.6×". */
export function formatRatio(ratio: number): string {
  return `${formatNumber(Math.round(ratio * 10) / 10)}×`;
}
