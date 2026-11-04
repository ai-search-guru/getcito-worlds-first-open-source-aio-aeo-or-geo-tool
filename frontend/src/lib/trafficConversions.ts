/**
 * Where AI visitors convert (AT-014, spec §3.4b): the rules its two cards and
 * their export share. Pure, so the page and the export say the same thing.
 */

import { LOW_SAMPLE_VISITS } from '@/lib/trafficChange';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The window the section falls back to when the range is too thin (spec §3.01). */
export const CONVERSIONS_FALLBACK_DAYS = 30;

/** A row's Analytics figures: its AI sessions and those with a key event. */
export interface ConversionFigures {
  aiVisits: number;
  keyEvents: number;
  keyEventSessions: number;
}

export type ConversionRate =
  | { kind: 'rate'; pct: number }
  /** Below 30 AI visits a rate would mislead (§5.4). */
  | { kind: 'low' }
  /** Key events from sessions synced before Analytics' session rate was read (00177). */
  | { kind: 'unknown' };

/** The share of AI sessions with a key event, as GA4's session key event rate. */
export function conversionRate(f: ConversionFigures): ConversionRate {
  if (f.aiVisits < LOW_SAMPLE_VISITS) return { kind: 'low' };
  if (f.keyEvents > 0 && f.keyEventSessions === 0) return { kind: 'unknown' };
  return { kind: 'rate', pct: Math.round((f.keyEventSessions / f.aiVisits) * 1000) / 10 };
}

/**
 * Whether a range is too thin to rank conversions on: shorter than the
 * fallback window and with fewer than 30 AI visits. All time and the long
 * ranges keep their own window, however few visits they have.
 */
export function widensToLast30Days(
  window: { from?: string; to?: string },
  aiVisits: number,
): boolean {
  if (!window.from || aiVisits >= LOW_SAMPLE_VISITS) return false;
  const to = window.to ? Date.parse(window.to) : Date.now();
  return to - Date.parse(window.from) < CONVERSIONS_FALLBACK_DAYS * DAY_MS - 60 * 60 * 1000;
}
