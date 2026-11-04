import type {
  ActionAssignee,
  ActionEvent,
  ActionItem,
  ActionKpiRef,
  ActionTask,
} from '@/lib/actions/actionCenter';
import type {
  ActionCategory,
  ActionImpact,
  ActionStatus,
  TaskStatus,
} from '@/lib/action-center/registry';
import type { KpiTimeframe } from '@/lib/kpis/registry';
import { parsePriorityReason, storedPriorityLevel } from '@/lib/action-center/priority';
import { parseTaskDetails } from '@/lib/action-center/taskDetails';
import {
  currentPriorityReason,
  withEntityCounts,
  type EntityCountRow,
} from '@/lib/action-center/entityCounts';
import { COMPETITOR_TASK_KEY, parseCompetitorFindings } from './competitorFindings';
import { WINNING_TASK_KEY, parseWinningFindings } from './winningFindings';

/**
 * Action Center rows → the shapes the dashboard reads, shared by its server
 * actions (as the signed-in user) and the API's export (through an API key).
 * Kept out of the 'use server' module, which may only export async functions.
 */

export interface ActionRow {
  id: string;
  action_no: number;
  category: string;
  kind: string;
  impact: string;
  status: string;
  payload: Record<string, unknown>;
  kpi_keys: string[];
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  priority_score: number | null;
  priority_level: string | null;
  priority_reason: unknown;
  priority_updated_at: string | null;
  stale_at?: string | null;
}

export const ACTION_COLUMNS =
  'id, action_no, category, kind, impact, status, payload, kpi_keys, assignee_id, due_date, created_at, updated_at, priority_score, priority_level, priority_reason, priority_updated_at, stale_at';

export const TASK_COLUMNS =
  'id, position, task_key, title, status, skip_reason, title_params, depends_on, details, output';

export const EVENT_COLUMNS = 'id, event, data, actor_id, created_at';

/** An action row, with what the list counts beside it. */
export function actionItemFromRow(
  row: ActionRow,
  extra: {
    assignee: ActionAssignee | null;
    taskTotal: number;
    taskCompleted: number;
    signalCount: number;
    /** Its list's counts (AC-009): the payload then reads the count left. */
    entityCounts?: EntityCountRow[];
  },
): ActionItem {
  const score = row.priority_score === null ? null : Number(row.priority_score);
  const payload = withEntityCounts(row.payload ?? {}, extra.entityCounts);
  return {
    id: row.id,
    actionNo: Number(row.action_no),
    category: row.category as ActionCategory,
    kind: row.kind,
    impact: row.impact as ActionImpact,
    status: row.status as ActionStatus,
    payload,
    kpiKeys: row.kpi_keys ?? [],
    assignee: extra.assignee,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskTotal: extra.taskTotal,
    taskCompleted: extra.taskCompleted,
    signalCount: extra.signalCount,
    staleAt: row.stale_at ?? null,
    priorityScore: score,
    priorityLevel: storedPriorityLevel(row.priority_level, score),
    // "Lost ground on 12 prompts", as the title counts them (AC-009).
    priorityReason: currentPriorityReason(
      parsePriorityReason(row.priority_reason, { scoredAt: row.priority_updated_at }),
      payload,
    ),
  };
}

export function taskFromRow(task: Record<string, unknown>): ActionTask {
  return {
    id: task.id as string,
    position: task.position as number,
    taskKey: (task.task_key as string | null) ?? null,
    title: (task.title as string | null) ?? null,
    status: task.status as TaskStatus,
    titleParams: (task.title_params ?? {}) as Record<string, string | number>,
    dependsOn: (task.depends_on ?? []) as string[],
    skipReason: (task.skip_reason as string | null) ?? null,
    details: parseTaskDetails(task.details),
    // What Analyze competitor content found, once it ran (learning C1).
    competitorFindings:
      task.task_key === COMPETITOR_TASK_KEY ? parseCompetitorFindings(task.output) : null,
    // What Find what sets your winning pages apart found (learning C4).
    winningFindings: task.task_key === WINNING_TASK_KEY ? parseWinningFindings(task.output) : null,
  };
}

export function eventFromRow(event: Record<string, unknown>): ActionEvent {
  return {
    id: event.id as string,
    event: event.event as string,
    data: (event.data ?? {}) as Record<string, unknown>,
    actorId: (event.actor_id as string | null) ?? null,
    createdAt: event.created_at as string,
  };
}

export function kpiFromRow(kpi: Record<string, unknown>): ActionKpiRef {
  return {
    kpiKey: kpi.kpi_key as string,
    target: Number(kpi.target),
    timeframe: kpi.timeframe as KpiTimeframe,
  };
}
