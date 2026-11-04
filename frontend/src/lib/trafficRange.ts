/**
 * The AI Traffic page's range (AT-017, spec §3.01): it opens on the last 24
 * hours and remembers the member's last choice. Client-side: the presets
 * are the range control's (config/datePresets.ts). How a window is
 * bucketed is trafficBuckets.ts.
 */

import { ALL_DATE_PRESETS, type DateRangePreset } from '@/config/datePresets';

/** The range a first visit opens on. */
export const DEFAULT_TRAFFIC_PRESET: DateRangePreset = '24h';

/** localStorage: the last range chosen, kept per browser like the app's other view settings. */
export const TRAFFIC_RANGE_KEY = 'aeo:traffic-range';

export interface TrafficRangeChoice {
  preset: DateRangePreset;
  /** A custom range's days (YYYY-MM-DD); empty for a preset. */
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The browser's localStorage, or null where reading it throws (blocked storage). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The remembered range, or the default. Anything unreadable — no storage
 * (private mode), a value from an older shape, a preset that no longer
 * exists — falls back to the default rather than throwing.
 */
export function readTrafficRange(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): TrafficRangeChoice {
  const fallback = { preset: DEFAULT_TRAFFIC_PRESET, from: '', to: '' };
  try {
    const raw = storage?.getItem(TRAFFIC_RANGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<TrafficRangeChoice>;
    if (!ALL_DATE_PRESETS.includes(value.preset as DateRangePreset)) return fallback;
    const day = (d: unknown) => (typeof d === 'string' && DAY.test(d) ? d : '');
    return value.preset === 'custom'
      ? { preset: 'custom', from: day(value.from), to: day(value.to) }
      : { preset: value.preset as DateRangePreset, from: '', to: '' };
  } catch {
    return fallback;
  }
}

export function writeTrafficRange(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  choice: TrafficRangeChoice,
): void {
  try {
    storage?.setItem(
      TRAFFIC_RANGE_KEY,
      JSON.stringify(
        choice.preset === 'custom' ? choice : { preset: choice.preset, from: '', to: '' },
      ),
    );
  } catch {
    // Storage full or blocked: the page still works, it just won't remember.
  }
}
