'use server';

/**
 * The History tab's reads.
 *
 * One query per source, assembled here rather than in the component, so the
 * tab makes a single round trip for a page of rows and the shapes it renders
 * are settled before they reach React.
 *
 * Everything returned is read from rows the product already writes, including
 * `results`: the nightly validation sweep measures a closed action's success
 * metrics before it was raised and after it closed, and this maps that
 * measurement into the shape the table and drawer render. An action that has
 * not been measured yet carries no results and says so.
 */

import { createClient } from '@/lib/supabase/server';
import type { ActionCategory } from '@/lib/action-center/registry';
import {
  ACTION_OUTCOMES,
  dismissReasonOf,
  missingDismissReason,
  type ActionOutcome,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import { SIGNAL_SOURCES, type SignalSource } from '@/lib/signals/registry';
import { parseImproveOutcome } from '@/lib/improveOutcome';
import { storedPriorityLevel } from '@/lib/action-center/priority';
import { readEntityCounts, withEntityCounts } from '@/lib/action-center/entityCounts';
import {
  HISTORY_STATUSES,
  controlNetOf,
  daysBetween,
  type ActionHistoryItem,
  type ActionHistoryTask,
  type ActionResultMetric,
  type AffectedEntity,
  type OutcomeReading,
  type SignalOutcome,
  type TriggerSignal,
} from '@/lib/action-center/history';

interface HistoryRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  status: string;
  outcome: string;
  validation: ValidationSnapshot | null;
  position_outcome: unknown;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  priority_score: number | null;
  priority_level: string | null;
  /** Absent on a database without 00366. */
  dismiss_reason?: string | null;
}

const HISTORY_COLUMNS_BEFORE_00366 =
  'id, action_no, category, kind, status, outcome, validation, position_outcome, payload, kpi_keys, assignee_id, due_date, created_at, completed_at, updated_at, priority_score, priority_level';

const HISTORY_COLUMNS = `${HISTORY_COLUMNS_BEFORE_00366}, dismiss_reason`;

/** What the validation sweep stores on an action. */
interface ValidationSnapshot {
  measuredAt: string;
  // Absent for an action with no metric to measure, kept for its signals.
  beforeWindow?: { from: string; to: string };
  afterWindow?: { from: string; to: string };
  metrics?: {
    metric: string;
    unit: string;
    before: number | null;
    after: number | null;
  }[];
  /** What became of the signals that raised it (learning A3). */
  signals?: SignalOutcome;
  /** The basket it was measured on; 'targets' for the prompts or pages it named (learning A1). */
  scope?: { kind?: string; entity?: string; prompts?: number; pages?: number };
  /** The brand-wide figures, beside a measure on its targets. */
  brandWide?: ValidationSnapshot['metrics'];
  /** A Site Audit fix's pages audited again (learning A2). */
  audit?: { pages?: number; audited?: number; passed?: number };
  /** The metric its result is judged by (learning A4). */
  primary?: string;
  /** Nights tracking missed in each window (learning A6). */
  gaps?: { before?: number; after?: number; tooMany?: boolean };
  /** Its readings, and whether the final one is in (learning B1). */
  readings?: { day?: number; outcome?: string }[];
  final?: boolean;
  /** Its change net of the brand's prompts it didn't touch (learning B2). */
  control?: {
    basis?: string;
    prompts?: number;
    net?: { metric?: string; net?: number; unit?: string }[];
  };
}

/** Its readings, the days known and verdicts it can name, in order. */
function readingsFrom(validation: ValidationSnapshot | null): OutcomeReading[] {
  if (!Array.isArray(validation?.readings)) return [];
  return validation.readings
    .filter(
      (r) =>
        Number.isInteger(r?.day) &&
        (ACTION_OUTCOMES as readonly string[]).includes(r?.outcome ?? ''),
    )
    .map((r) => ({ day: r.day as number, outcome: r.outcome as ActionOutcome }))
    .sort((a, b) => a.day - b.day);
}

/** Nights tracking missed in its windows, when there were any. */
function gapsFrom(
  validation: ValidationSnapshot | null,
): { before: number; after: number; tooMany: boolean } | null {
  const g = validation?.gaps;
  const before = Number(g?.before) || 0;
  const after = Number(g?.after) || 0;
  return before || after ? { before, after, tooMany: g?.tooMany === true } : null;
}

/** A Site Audit fix's pages audited again, when the sweep read them. */
function auditFrom(
  validation: ValidationSnapshot | null,
): { pages: number; audited: number; passed: number } | null {
  const a = validation?.audit;
  const pages = Number(a?.pages) || 0;
  if (!pages) return null;
  return { pages, audited: Number(a?.audited) || 0, passed: Number(a?.passed) || 0 };
}

/** The prompts or pages it was measured on, when it was measured on its own targets. */
function measuredOnFrom(
  validation: ValidationSnapshot | null,
): { entity: 'prompts' | 'pages'; count: number } | null {
  const scope = validation?.scope;
  if (scope?.kind !== 'targets') return null;
  const entity = scope.entity === 'pages' ? 'pages' : 'prompts';
  const count = Number(entity === 'pages' ? scope.pages : scope.prompts) || 0;
  return count > 0 ? { entity, count } : null;
}

/** The signals' counts, when the sweep kept them and they add up. */
function signalsFrom(validation: ValidationSnapshot | null): SignalOutcome | null {
  const s = validation?.signals;
  if (!s || typeof s !== 'object') return null;
  const n = (value: unknown) => (typeof value === 'number' && value >= 0 ? value : 0);
  const counts = {
    total: n(s.total),
    ended: n(s.ended),
    replaced: n(s.replaced),
    dismissed: n(s.dismissed),
    open: n(s.open),
  };
  return counts.total > 0 ? counts : null;
}

/**
 * The measured pairs, as metrics the UI can render.
 *
 * Deltas are computed here rather than read from storage, so a displayed
 * change can never contradict the two values it came from. A metric missing
 * either half is dropped: it was not measured, and a half-measurement shown
 * as a number is worse than an honest absence.
 */
function resultsFrom(validation: ValidationSnapshot | null): ActionResultMetric[] {
  if (!validation?.metrics) return [];
  return validation.metrics
    .filter((m) => m.before != null && m.after != null)
    .map((m) => {
      const before = m.before as number;
      const after = m.after as number;
      return {
        id: m.metric,
        label: m.metric,
        metric: m.metric as ActionResultMetric['metric'],
        before,
        after,
        delta: Math.round((after - before) * 10) / 10,
        // A before of zero has no ratio; the absolute delta carries it.
        ...(before === 0
          ? {}
          : { deltaPercent: Math.round(((after - before) / before) * 1000) / 10 }),
        unit: m.unit as ActionResultMetric['unit'],
        // Every metric the sweep measures reads higher-is-better.
        direction: 'higher_is_better',
      } satisfies ActionResultMetric;
    });
}

function num(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === 'number' ? value : 0;
}

/**
 * What an action touched, from its payload.
 *
 * Generic by design: the subject is prompts for one kind and pages for
 * another, so this reports whichever counts the payload actually carries
 * rather than forcing every action into the same two columns.
 */
function affectedFrom(
  kind: string,
  payload: Record<string, unknown>,
  signalCount: number,
): AffectedEntity[] {
  const entities: AffectedEntity[] = [];
  const add = (type: AffectedEntity['type'], count: number) => {
    if (count > 0) entities.push({ id: `${type}-${count}`, type, name: type, count });
  };

  add('prompt', num(payload, 'promptCount'));
  add('url', num(payload, 'pageCount'));
  add('citation', num(payload, 'citationCount'));

  const competitors = Array.isArray(payload.competitorNames)
    ? (payload.competitorNames as string[])
    : [];
  for (const name of competitors.slice(0, 5)) {
    entities.push({ id: `competitor-${name}`, type: 'competitor', name });
  }

  // Every action has at least its signals to show, so a row is never blank.
  if (entities.length === 0 && signalCount > 0) {
    entities.push({
      id: `citation-${signalCount}`,
      type: 'citation',
      name: 'citation',
      count: signalCount,
    });
  }
  return entities;
}

/**
 * A page of history for one brand.
 *
 * Filtering and sorting happen in Postgres so pagination counts what the user
 * is actually looking at; search runs client-side, because an action's title
 * is composed from i18n templates and never stored as text.
 */
export async function getActionHistory(
  brandId: string,
  opts?: { from?: string; to?: string },
): Promise<ActionHistoryItem[]> {
  const supabase = await createClient();

  const read = (columns: string) => {
    let query = supabase
      .from('actions')
      .select(columns)
      .eq('brand_id', brandId)
      .in('status', HISTORY_STATUSES as string[])
      .order('created_at', { ascending: false })
      .limit(500);

    // The window covers when an action closed, falling back to when it was
    // raised for one still running — which is the date the row shows.
    if (opts?.from) query = query.gte('created_at', opts.from);
    if (opts?.to) query = query.lte('created_at', opts.to);
    return query;
  };

  let { data, error } = await read(HISTORY_COLUMNS);
  // A database without 00366 has no dismiss_reason (42703): the tab reads
  // the rest, and no action says why it was dismissed.
  if (missingDismissReason(error)) ({ data, error } = await read(HISTORY_COLUMNS_BEFORE_00366));
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as HistoryRow[];
  if (rows.length === 0) return [];

  const actionIds = rows.map((row) => row.id);
  const assigneeIds = [...new Set(rows.map((row) => row.assignee_id).filter(Boolean))] as string[];

  const [tasksRes, signalsRes, profilesRes, entityCounts] = await Promise.all([
    supabase
      .from('action_tasks')
      .select('id, action_id, position, task_key, title, status')
      .in('action_id', actionIds)
      .order('position'),
    // Every signal each action took as evidence (AC-007): a closed action
    // keeps the ones that have since moved on to a later cycle.
    supabase
      .from('action_signals')
      .select('action_id, signals!inner(id, kind, source, detected_at)')
      .in('action_id', actionIds),
    assigneeIds.length > 0
      ? supabase.from('profiles').select('id, full_name, avatar_url').in('id', assigneeIds)
      : Promise.resolve({ data: [], error: null }),
    // The count each action shows on Actions too (AC-009).
    readEntityCounts(supabase, actionIds),
  ]);
  if (tasksRes.error) throw new Error(tasksRes.error.message);
  if (signalsRes.error) throw new Error(signalsRes.error.message);
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const tasksByAction = new Map<string, ActionHistoryTask[]>();
  for (const task of tasksRes.data ?? []) {
    const list = tasksByAction.get(task.action_id) ?? [];
    list.push({
      id: task.id,
      // Resolved by the caller through i18n when there is no user title; the
      // key travels in `title` so the component can tell the two apart.
      title: task.title ?? task.task_key ?? '',
      status: task.status as TaskStatus,
    });
    tasksByAction.set(task.action_id, list);
  }

  const signalsByAction = new Map<string, TriggerSignal[]>();
  const sourcesByAction = new Map<string, Set<SignalSource>>();
  for (const { action_id: actionId, signals: signal } of signalsRes.data ?? []) {
    if (!signal) continue;
    const list = signalsByAction.get(actionId) ?? [];
    list.push({ signalId: signal.id, kind: signal.kind, detectedAt: signal.detected_at });
    signalsByAction.set(actionId, list);

    // `source` is an array — one signal can be corroborated by several feeds.
    const set = sourcesByAction.get(actionId) ?? new Set<SignalSource>();
    for (const source of (signal.source ?? []) as string[]) {
      if ((SIGNAL_SOURCES as readonly string[]).includes(source)) set.add(source as SignalSource);
    }
    if (set.size > 0) sourcesByAction.set(actionId, set);
  }

  const profiles = new Map(
    (profilesRes.data ?? []).map((p) => [
      p.id as string,
      {
        id: p.id as string,
        fullName: (p.full_name as string | null) ?? null,
        avatarUrl: (p.avatar_url as string | null) ?? null,
      },
    ]),
  );

  return rows.map((row) => {
    const triggerSignals = signalsByAction.get(row.id) ?? [];
    const results = resultsFrom(row.validation);
    const score = row.priority_score === null ? null : Number(row.priority_score);
    return {
      id: row.id,
      actionNo: Number(row.action_no),
      kind: row.kind,
      type: row.category as ActionCategory,
      priorityScore: score,
      priorityLevel: storedPriorityLevel(row.priority_level, score),
      status: row.status as ActionStatus,
      outcome: row.outcome as ActionOutcome,
      positionOutcome: parseImproveOutcome(row.position_outcome ?? null),
      payload: withEntityCounts(row.payload ?? {}, entityCounts.get(row.id)),
      kpiKeys: row.kpi_keys ?? [],
      sources: [...(sourcesByAction.get(row.id) ?? [])],
      triggerSignals,
      affected: affectedFrom(row.kind, row.payload ?? {}, triggerSignals.length),
      results,
      // Only while it is dismissed: another status leaves an earlier reason in place.
      dismissReason: row.status === 'dismissed' ? dismissReasonOf(row.dismiss_reason) : null,
      signalsAfter: signalsFrom(row.validation),
      measuredOn: measuredOnFrom(row.validation),
      auditAfter: auditFrom(row.validation),
      dataGaps: gapsFrom(row.validation),
      readings: readingsFrom(row.validation),
      outcomeFinal: row.validation?.final === true,
      // Shown only when it was measured: a main metric with no pair says nothing.
      primaryMetric: resultsFrom(row.validation).some((m) => m.metric === row.validation?.primary)
        ? (row.validation?.primary ?? null)
        : null,
      brandWideResults: resultsFrom(
        row.validation?.brandWide ? { ...row.validation, metrics: row.validation.brandWide } : null,
      ),
      controlNet: controlNetOf(row.validation),
      tasks: tasksByAction.get(row.id) ?? [],
      assignee: row.assignee_id ? (profiles.get(row.assignee_id) ?? null) : null,
      dueDate: row.due_date ?? null,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      timeToCloseDays: row.completed_at ? daysBetween(row.created_at, row.completed_at) : null,
    };
  });
}
