import type { SupabaseClient } from '@supabase/supabase-js';
import type { KeptEntity } from './affected';

/**
 * AC-009: one count for an action, everywhere.
 *
 * An action keeps the list of what it is about (its prompts, pages,
 * competitors…) once, when it is created (action_entities, 00244). Its
 * payload's `targetCount` is that list's size then; a prompt deleted or
 * paused since, or a competitor deleted, is marked removed. Every place reads
 * the action as `withEntityCounts` leaves it: the count less the removed,
 * and which were removed, so the title, the chips, the tasks, the detail,
 * Copy all and the exports all say "12 prompts (1 removed since this action
 * was created)".
 */

/** One row of action_entity_counts (00244). */
export interface EntityCountRow {
  action_id: string;
  entity_type: string;
  /** How many the action was made with, removed ones included. */
  total: number;
  removed: number;
  removed_labels: string[] | null;
  /** The removed ones' keys (a prompt's id…), to leave them out of a list. */
  removed_keys?: string[] | null;
}

/** What was removed from an action's list since it was created. */
export interface RemovedTargets {
  count: number;
  /** Their names, up to 20, for the hover. */
  labels: string[];
}

/** Payload counts that name the same list as targetCount, in the kinds that have them. */
const SAME_LIST_COUNTS = ['promptCount', 'pageCount'] as const;

const numberOf = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0));

/**
 * The payload as the action reads now: `targetCount` (and a promptCount or
 * pageCount that counted the same list) less what was removed, with
 * `createdTargetCount`, `removedCount` and `removedLabels` to say so. An
 * action with nothing removed, or whose list is of another kind than its
 * count, reads as it was.
 */
export function withEntityCounts(
  payload: Record<string, unknown>,
  rows: EntityCountRow[] | undefined,
): Record<string, unknown> {
  const entity = typeof payload.targetEntity === 'string' ? payload.targetEntity : null;
  const created = numberOf(payload.targetCount);
  const row = entity ? rows?.find((r) => r.entity_type === entity) : undefined;
  if (!row || row.removed <= 0 || !(created > 0)) return payload;

  const removed = Math.min(row.removed, created);
  const next: Record<string, unknown> = {
    ...payload,
    targetCount: created - removed,
    createdTargetCount: created,
    removedCount: removed,
    removedLabels: (row.removed_labels ?? []).filter(Boolean).slice(0, Math.min(20, removed)),
    removedKeys: (row.removed_keys ?? []).filter(Boolean),
  };
  for (const key of SAME_LIST_COUNTS) {
    if (numberOf(payload[key]) === created) next[key] = created - removed;
  }
  return next;
}

/** What an action lost since it was created, as withEntityCounts noted it; null when nothing. */
export function removedTargets(payload: Record<string, unknown>): RemovedTargets | null {
  const count = numberOf(payload.removedCount);
  if (!(count > 0)) return null;
  const labels = Array.isArray(payload.removedLabels)
    ? payload.removedLabels.filter((l): l is string => typeof l === 'string')
    : [];
  return { count, labels };
}

/**
 * A planned task's title parameters as the action reads now: a task that
 * named the action's own count ("across 13 prompts") names the count left.
 * With none left it names no count, and reads as its plain title.
 */
export function currentTaskParams(
  params: Record<string, string | number> | undefined,
  payload: Record<string, unknown>,
): Record<string, string | number> | undefined {
  if (!params) return params;
  const created = numberOf(payload.createdTargetCount);
  if (
    !(created > 0) ||
    params.entity !== payload.targetEntity ||
    numberOf(params.count) !== created
  ) {
    return params;
  }
  const left = numberOf(payload.targetCount);
  if (left > 0) return { ...params, count: left };
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => key !== 'count' && key !== 'entity'),
  );
}

/**
 * A priority reason ("Lost ground on 13 prompts") that named the action's
 * count names the count left, as the title does.
 */
export function currentPriorityReason<T>(reason: T, payload: Record<string, unknown>): T {
  const subject = (reason as { subject?: { entity?: unknown; count?: unknown } } | null)?.subject;
  const created = numberOf(payload.createdTargetCount);
  if (
    !subject ||
    !(created > 0) ||
    subject.entity !== payload.targetEntity ||
    numberOf(subject.count) !== created
  ) {
    return reason;
  }
  return {
    ...(reason as object),
    subject: { ...subject, count: numberOf(payload.targetCount) },
  } as T;
}

/**
 * Only what tells which targets were removed: for a list told from part of
 * an action's signals (its Why), which leaves them out but keeps its own count.
 */
export function removedOnly(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    targetEntity: payload.targetEntity,
    removedKeys: payload.removedKeys,
    removedLabels: payload.removedLabels,
  };
}

/**
 * A signal without the ids a big group lists past the 50 it names (AC-009):
 * up to a thousand keys the action keeps for its count, which no reader of
 * the signal needs.
 */
export function withoutTargetIds<T extends { payload?: unknown }>(row: T): T {
  const payload = row.payload as Record<string, unknown> | null | undefined;
  if (!payload || typeof payload !== 'object' || !('targetIds' in payload)) return row;
  const rest = { ...payload };
  delete rest.targetIds;
  return { ...row, payload: rest };
}

/** The RPC takes up to this many actions a call (00244). */
export const ENTITY_COUNTS_PER_CALL = 500;

/**
 * Each action's list counts (action_entity_counts), by action. Read through
 * the caller's client: the member's own, under their policy, or the admin
 * one for the MCP. A database without 00244 has none, and a failed read
 * leaves the actions as created: the count saved then.
 */
export async function readEntityCounts(
  client: SupabaseClient,
  actionIds: string[],
): Promise<Map<string, EntityCountRow[]>> {
  const byAction = new Map<string, EntityCountRow[]>();
  for (let i = 0; i < actionIds.length; i += ENTITY_COUNTS_PER_CALL) {
    const { data, error } = await client.rpc('action_entity_counts', {
      p_action_ids: actionIds.slice(i, i + ENTITY_COUNTS_PER_CALL),
    });
    if (error) {
      if (error.code !== 'PGRST202') console.error('Failed to read action counts:', error.message);
      return byAction;
    }
    for (const row of (data ?? []) as EntityCountRow[]) {
      const rows = byAction.get(row.action_id) ?? [];
      rows.push(row);
      byAction.set(row.action_id, rows);
    }
  }
  return byAction;
}

/** A row of action_entities as a list reads it. */
interface KeptRow {
  entity_type: string;
  entity_key: string;
  label: string | null;
  removed_at: string | null;
}

const keptOf = (row: KeptRow): KeptEntity => ({
  type: row.entity_type,
  key: row.entity_key,
  label: row.label,
  removed: row.removed_at !== null,
});

/** A failed read of the lists: quiet on a database without 00244, logged otherwise. */
function keptReadFailed(error: { code?: string; message: string }) {
  // A database without 00244 has no list: the rows come from the signals, quietly.
  if (error.code !== 'PGRST205' && error.code !== '42P01') {
    console.error('Failed to read an action’s list:', error.message);
  }
}

/**
 * What an action kept when it was created, removed ones marked
 * (action_entities, 00244, members may read it): the rows of its Affected
 * list (affectedOf). Null when it can't be read, so the list is built from
 * the signals as before.
 */
export async function readKeptEntities(
  client: SupabaseClient,
  actionId: string,
): Promise<KeptEntity[] | null> {
  try {
    const { data, error } = await client
      .from('action_entities')
      .select('entity_type, entity_key, label, removed_at')
      .eq('action_id', actionId)
      // A steady order: the rows don't move between opens.
      .order('label')
      .order('entity_key')
      .limit(1000);
    if (error) {
      keptReadFailed(error);
      return null;
    }
    return ((data ?? []) as KeptRow[]).map(keptOf);
  } catch (err) {
    console.error('Failed to read an action’s list:', err);
    return null;
  }
}

/** Kept rows per page when many actions' lists are read at once. */
const KEPT_PAGE_SIZE = 1000;

/**
 * Many actions' lists (readKeptEntities) in one read, by action, for the
 * actions list's Export CSV: page by page, as their rows together can be
 * more than one response returns. An action with none is left out. Null
 * when they can't be read, so their rows come from the signals as before.
 */
export async function readKeptEntityLists(
  client: SupabaseClient,
  actionIds: string[],
): Promise<Map<string, KeptEntity[]> | null> {
  const byAction = new Map<string, KeptEntity[]>();
  try {
    for (let from = 0; ; from += KEPT_PAGE_SIZE) {
      const { data, error } = await client
        .from('action_entities')
        .select('action_id, entity_type, entity_key, label, removed_at')
        .in('action_id', actionIds)
        // Each action's rows in the drawer's order, made whole so pages don't shuffle.
        .order('action_id')
        .order('label')
        .order('entity_key')
        .order('entity_type')
        .range(from, from + KEPT_PAGE_SIZE - 1);
      if (error) {
        keptReadFailed(error);
        return null;
      }
      const batch = (data ?? []) as (KeptRow & { action_id: string })[];
      for (const row of batch) {
        const list = byAction.get(row.action_id) ?? [];
        list.push(keptOf(row));
        byAction.set(row.action_id, list);
      }
      if (batch.length < KEPT_PAGE_SIZE) return byAction;
    }
  } catch (err) {
    console.error('Failed to read an action’s list:', err);
    return null;
  }
}
