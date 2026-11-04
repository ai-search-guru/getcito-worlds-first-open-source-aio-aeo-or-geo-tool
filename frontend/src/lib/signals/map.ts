import {
  isSignalKind,
  type SignalCategory,
  type SignalImpact,
  type SignalKind,
  type SignalSource,
  type SignalStatus,
} from './registry';
import { NO_WHERE, signalWhere, type PromptPlace, type SignalWhere } from './where';

/**
 * Row → domain mapping for signals, shared by every server action that
 * returns them (the Signals page's own reads and the Action drawer's
 * linked-signals read). Kept out of the 'use server' modules because those
 * may only export async functions.
 */

export interface Signal {
  id: string;
  category: SignalCategory;
  kind: SignalKind;
  impact: SignalImpact;
  status: SignalStatus;
  source: SignalSource[];
  detectedAt: string;
  lastDetectedAt: string;
  resolvedAt: string | null;
  previousValue: number | null;
  currentValue: number | null;
  changeValue: number | null;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  actionId: string | null;
  /** The platforms and locations the signal is about; empty when it has none. */
  where: SignalWhere;
}

export interface SignalRow {
  id: string;
  category: string;
  kind: string;
  impact: string;
  status: string;
  source: string[];
  detected_at: string;
  last_detected_at: string;
  resolved_at: string | null;
  previous_value: number | null;
  current_value: number | null;
  change_value: number | null;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  action_id: string | null;
}

export const SIGNAL_ROW_COLUMNS =
  'id, category, kind, impact, status, source, detected_at, last_detected_at, resolved_at, previous_value, current_value, change_value, payload, kpi_keys, action_id';

/** Maps rows, silently skipping unknown kinds (a detector removed from the
 *  registry must not take down a page). Without the brand's prompts, `where`
 *  holds only what the payload itself names. */
export function mapSignalRows(
  rows: SignalRow[],
  prompts: ReadonlyMap<string, PromptPlace> = new Map(),
): Signal[] {
  return rows
    .filter((row) => isSignalKind(row.kind))
    .map((row) => ({
      id: row.id,
      category: row.category as SignalCategory,
      kind: row.kind as SignalKind,
      impact: row.impact as SignalImpact,
      status: row.status as SignalStatus,
      source: (row.source ?? []) as SignalSource[],
      detectedAt: row.detected_at,
      lastDetectedAt: row.last_detected_at,
      resolvedAt: row.resolved_at,
      previousValue: row.previous_value === null ? null : Number(row.previous_value),
      currentValue: row.current_value === null ? null : Number(row.current_value),
      changeValue: row.change_value === null ? null : Number(row.change_value),
      payload: row.payload ?? {},
      kpiKeys: row.kpi_keys ?? [],
      actionId: row.action_id,
      where: row.payload ? signalWhere(row.payload, prompts) : NO_WHERE,
    }));
}
