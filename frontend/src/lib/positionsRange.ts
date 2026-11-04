/**
 * The Positions panel's own range (PROMPT-002) and its URL mirror, so an open
 * panel can be shared: ?positions=<promptId>&positionsRange=7d, plus
 * positionsFrom / positionsTo for a custom range.
 */

import { isPromptRangePreset, type PromptRangePreset } from '@/config/promptOptions';
import { dayIn } from '@/lib/timeZone';

/** The panel's own window choice; `from` / `to` are YYYY-MM-DD and only used by custom. */
export interface PositionsRange {
  preset: PromptRangePreset;
  from: string;
  to: string;
}

/** URL params that mirror an open panel; null removes the param. */
export function positionsUrlParams(
  promptId: string | null,
  range: PositionsRange,
): Record<'positions' | 'positionsRange' | 'positionsFrom' | 'positionsTo', string | null> {
  const custom = promptId !== null && range.preset === 'custom';
  return {
    positions: promptId,
    positionsRange: promptId ? range.preset : null,
    positionsFrom: custom && range.from ? range.from : null,
    positionsTo: custom && range.to ? range.to : null,
  };
}

/** The panel range a shared link asks for, falling back to the table's preset. */
export function parsePositionsRange(
  params: { get(name: string): string | null },
  fallback: PromptRangePreset,
): PositionsRange {
  const raw = params.get('positionsRange');
  return {
    preset: isPromptRangePreset(raw) ? raw : fallback,
    from: params.get('positionsFrom') ?? '',
    to: params.get('positionsTo') ?? '',
  };
}

/**
 * The range the panel opens on from the table: the table's preset and, for a
 * custom range, the days its window covers. The window holds instants, which
 * read as those days only on the viewer's clock, so they are taken in
 * `timeZone` rather than cut from the ISO string (which is UTC).
 */
export function panelRangeFromTable(
  preset: PromptRangePreset,
  window: { from: string; to?: string },
  timeZone: string,
): PositionsRange {
  if (preset !== 'custom') return { preset, from: '', to: '' };
  return {
    preset,
    from: dayIn(window.from, timeZone),
    to: window.to ? dayIn(window.to, timeZone) : '',
  };
}
