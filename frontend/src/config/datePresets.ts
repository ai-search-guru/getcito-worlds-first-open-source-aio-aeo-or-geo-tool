/**
 * The shared date range control's presets (#713), in a plain module: the
 * control (components/filters/DateRangeFilter.tsx) is a client component,
 * whose exports are client references on the server, and Chat's route
 * registry (lib/chat/routes.ts) reads the list there.
 */

export type DateRangePreset = '24h' | '7d' | '30d' | '90d' | 'all' | 'custom';

export const ALL_DATE_PRESETS: readonly DateRangePreset[] = [
  '24h',
  '7d',
  '30d',
  '90d',
  'all',
  'custom',
];
