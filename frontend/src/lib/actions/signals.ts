'use server';

/**
 * Action Center signals — reads and triage writes.
 *
 * The rows are produced nightly by the server's detectors; this module only
 * reads them and moves their status. Titles and descriptions do not exist in
 * the database (they are i18n templates composed in the UI from `kind` +
 * `payload`), which is also why the free-text search box filters
 * client-side: there is no stored text to search.
 */

import { readEntityCounts, withEntityCounts } from '@/lib/action-center/entityCounts';
import { createClient } from '@/lib/supabase/server';
import { after } from 'next/server';
import { API_BASE_URL } from '@/config/api';
import {
  OPEN_SIGNAL_STATUSES,
  type SignalCategory,
  type SignalImpact,
  type SignalSource,
  type SignalStatus,
} from '@/lib/signals/registry';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type Signal, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/promptPlaces';
import type { ActionStatus } from '@/lib/action-center/registry';
import { assertWritable } from '@/lib/subscriptionGuard';

export type { Signal } from '@/lib/signals/map';

export interface SignalFilters {
  category?: SignalCategory;
  impact?: SignalImpact;
  status?: SignalStatus;
  source?: SignalSource;
  /** ISO day bounds, inclusive. A signal is in the window when its lifetime
   *  overlaps it — same semantics as the summary's "total". */
  dayFrom: string;
  dayTo: string;
}

/**
 * A brand's signals for the window, newest first. Fetched whole (up to the
 * PostgREST 1000-row cap) rather than paged: per-brand signal counts are
 * tens — the detectors' own thresholds and dedup bound them — and search
 * plus pagination happen client-side over composed titles anyway.
 *
 * The brand's prompts are read alongside, so each signal can say which
 * platforms and locations it is about (AC-002).
 */
export async function getSignals(brandId: string, filters: SignalFilters): Promise<Signal[]> {
  const supabase = await createClient();
  let query = supabase
    .from('signals')
    .select(SIGNAL_ROW_COLUMNS)
    .eq('brand_id', brandId)
    .lt('detected_at', nextDay(filters.dayTo))
    .or(`resolved_at.is.null,resolved_at.gte.${filters.dayFrom}T00:00:00.000Z`)
    .order('detected_at', { ascending: false })
    .limit(1000);

  if (filters.category) query = query.eq('category', filters.category);
  if (filters.impact) query = query.eq('impact', filters.impact);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.source) query = query.contains('source', [filters.source]);

  const [{ data, error }, prompts] = await Promise.all([
    query,
    readPromptPlaces(supabase, brandId),
  ]);
  if (error) throw new Error(error.message);

  return mapSignalRows((data ?? []) as SignalRow[], prompts);
}

/** An action a signal feeds, as its drawer lists it under "Used by actions". */
export interface SignalAction {
  id: string;
  actionNo: number;
  kind: string;
  status: ActionStatus;
  payload: Record<string, unknown>;
}

/**
 * Every action a signal has been used by (spec §10: signal → action
 * traceability), through action_signals (AC-007): not only its current
 * `action_id` but the earlier ones it supported, closed ones included, the
 * latest link first. Read when a drawer opens rather than with the list, so
 * the list stays one query of signals.
 */
export async function getSignalActions(brandId: string, signalId: string): Promise<SignalAction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('action_signals')
    .select('actions!inner(id, action_no, kind, status, payload)')
    .eq('signal_id', signalId)
    .eq('actions.brand_id', brandId)
    .order('linked_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map(({ actions: row }) => row);
  // Named as on Actions (AC-009): the count left.
  const counts = await readEntityCounts(
    supabase,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    actionNo: Number(row.action_no),
    kind: row.kind,
    status: row.status as ActionStatus,
    payload: withEntityCounts((row.payload ?? {}) as Record<string, unknown>, counts.get(row.id)),
  }));
}

export interface SignalsSummary {
  /** Conditions active in the window (lifetime overlaps it). */
  total: number;
  prevTotal: number;
  /** High-impact subset of `total`. */
  important: number;
  prevImportant: number;
  /** Conditions first detected inside the window. */
  newCount: number;
  prevNew: number;
  /** Conditions resolved inside the window. */
  resolved: number;
  prevResolved: number;
  /** ISO day → count series for the card sparklines. */
  byDayActive: Record<string, number>;
  byDayImportant: Record<string, number>;
  byDayNew: Record<string, number>;
  byDayResolved: Record<string, number>;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

export async function getSignalsSummary(
  brandId: string,
  dayFrom: string,
  dayTo: string,
): Promise<SignalsSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('signals_summary', {
    p_brand_id: brandId,
    p_from: `${dayFrom}T00:00:00.000Z`,
    p_to: nextDay(dayTo),
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as {
    total?: number;
    prev_total?: number;
    important?: number;
    prev_important?: number;
    new?: number;
    prev_new?: number;
    resolved?: number;
    prev_resolved?: number;
    by_day_active?: Record<string, number>;
    by_day_important?: Record<string, number>;
    by_day_new?: Record<string, number>;
    by_day_resolved?: Record<string, number>;
    by_category?: Record<string, number>;
    by_source?: Record<string, number>;
  };
  return {
    total: Number(raw.total ?? 0),
    prevTotal: Number(raw.prev_total ?? 0),
    important: Number(raw.important ?? 0),
    prevImportant: Number(raw.prev_important ?? 0),
    newCount: Number(raw.new ?? 0),
    prevNew: Number(raw.prev_new ?? 0),
    resolved: Number(raw.resolved ?? 0),
    prevResolved: Number(raw.prev_resolved ?? 0),
    byDayActive: raw.by_day_active ?? {},
    byDayImportant: raw.by_day_important ?? {},
    byDayNew: raw.by_day_new ?? {},
    byDayResolved: raw.by_day_resolved ?? {},
    byCategory: raw.by_category ?? {},
    bySource: raw.by_source ?? {},
  };
}

/**
 * Untriaged signals for the Action Center tab badge, counted the way the list
 * shows them: copies of one finding count once (signals_new_count, 00141).
 * One number back, immune to the row cap.
 */
export async function getNewSignalCount(brandId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('signals_new_count', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/**
 * Triage: any org member can move signals through their lifecycle (RLS
 * enforces membership). Several at once for a group's menu, which acts on
 * every copy. Resolving stamps resolved_at; leaving the resolved state
 * clears it so the summary's "Resolved" count stays truthful.
 */
export async function updateSignalStatus(
  brandId: string,
  signalIds: string[],
  status: SignalStatus,
): Promise<void> {
  await assertWritable({ brandId });
  if (signalIds.length === 0) return;
  const supabase = await createClient();
  const { data: before } = await supabase
    .from('signals')
    .select('id, status')
    .eq('brand_id', brandId)
    .in('id', signalIds);
  const { data, error } = await supabase
    .from('signals')
    .update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('brand_id', brandId)
    .in('id', signalIds)
    .select('id, action_id');
  if (error) throw new Error(error.message);

  // When a signal starts or stops supporting its action, the action's support
  // and confidence follow at once, not the next night (AC-007). Acknowledging
  // leaves it open, so nothing changes for the action. Copies of one finding
  // move together and usually share their action: it is scored once.
  const isOpen = (value: unknown) => OPEN_SIGNAL_STATUSES.includes(value as SignalStatus);
  const wasOpen = new Map((before ?? []).map((row) => [row.id, isOpen(row.status)]));
  const byAction = new Map<string, string>();
  for (const row of data ?? []) {
    if (!row.action_id || wasOpen.get(row.id) === isOpen(status)) continue;
    if (!byAction.has(row.action_id)) byAction.set(row.action_id, row.id);
  }
  if (byAction.size === 0) return;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;
  for (const signalId of byAction.values()) scheduleRescore(signalId, session.access_token);
}

/**
 * Asks the server to score again the active actions a signal supports, once
 * the response has gone: the click doesn't wait for it. Best effort, as the
 * status change is saved either way and the nightly pass scores every action
 * again.
 */
function scheduleRescore(signalId: string, accessToken: string) {
  after(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/action-center/signals/${signalId}/rescore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) console.warn(`[signals] action rescore failed: ${res.status}`);
    } catch (err) {
      console.warn('[signals] action rescore failed:', err);
    }
  });
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
}
