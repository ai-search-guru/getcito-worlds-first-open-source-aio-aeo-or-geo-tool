/**
 * Earlier rounds of an action (learning B5): the brand's closed actions of
 * the same kind, with the tasks each one carried, which were done, and what
 * its result read. The writer is shown them so it builds on what improved
 * results here and doesn't hand out again what was done for nothing. A
 * dismissed round says why it was turned down. The brand's own actions only,
 * never another brand's.
 */

import supabaseAdmin from '../../../config/supabase.js';

/** Earlier rounds the writer is shown, newest first. */
export const PAST_ROUNDS = 3;

/** Tasks of a round it is shown, done and not done each. */
const TASKS_PER_ROUND = 6;

const str = (value) => (typeof value === 'string' ? value.trim() : '');
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** "refresh_content" → "Refresh content": a template task, by its key. */
function keyWords(key) {
  const words = str(key).replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * One earlier round as the writer reads it.
 *
 * @param {{ status: string, outcome?: string | null, validation?: object | null,
 *   dismiss_reason?: string | null, completed_at?: string | null, updated_at?: string | null }} row
 * @param {Array<{ task_key?: string | null, title?: string | null, status: string }>} tasks
 */
export function pastRound(row, tasks) {
  if (row.status === 'dismissed') {
    return {
      closed: str(row.updated_at).slice(0, 10) || null,
      dismissed: true,
      reason: row.dismiss_reason ?? null,
    };
  }
  const named = tasks
    .map((task) => ({ title: str(task.title) || keyWords(task.task_key), status: task.status }))
    .filter((task) => task.title);
  const titles = (keep) =>
    named
      .filter(keep)
      .map((task) => task.title)
      .slice(0, TASKS_PER_ROUND);

  // Its main metric before it was raised and after it closed (learning A4).
  const validation = row.validation ?? {};
  const main = (Array.isArray(validation.metrics) ? validation.metrics : []).find(
    (m) => m?.metric === validation.primary && num(m.before) !== null && num(m.after) !== null,
  );
  return {
    closed: str(row.completed_at).slice(0, 10) || null,
    result: row.outcome ?? 'pending_measurement',
    // Read for the last time, a month on (learning B1), or measured once
    // before readings began, which the sweep never reads again (as History
    // and the MCP read it); a reading so far otherwise.
    final:
      validation.final === true ||
      (row.outcome != null &&
        row.outcome !== 'pending_measurement' &&
        !Array.isArray(validation.readings)),
    mainMetric: main ? { metric: main.metric, before: main.before, after: main.after } : null,
    done: titles((task) => task.status === 'completed'),
    notDone: titles((task) => task.status !== 'completed'),
  };
}

/**
 * The brand's last closed rounds of this action's kind, newest first.
 *
 * @param {{ id: string, brand_id: string, kind: string }} action
 * @param {{ skip?: (task: { task_key?: string | null }) => boolean, limit?: number }} [options]
 *   skip: tasks to leave out, such as the product's own analysis steps
 */
export async function loadPastRounds(action, { skip = () => false, limit = PAST_ROUNDS } = {}) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, status, outcome, validation, dismiss_reason, completed_at, updated_at')
    .eq('brand_id', action.brand_id)
    .eq('kind', action.kind)
    .in('status', ['completed', 'dismissed'])
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(`past rounds read failed: ${error.message}`);
  const rows = (data ?? []).filter((row) => row.id !== action.id).slice(0, limit);
  if (rows.length === 0) return [];

  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('action_tasks')
    .select('action_id, position, task_key, title, status')
    .in(
      'action_id',
      rows.map((row) => row.id),
    )
    .order('position');
  if (tasksError) throw new Error(`past rounds' tasks read failed: ${tasksError.message}`);
  const byAction = new Map();
  for (const task of tasks ?? []) {
    if (skip(task)) continue;
    if (!byAction.has(task.action_id)) byAction.set(task.action_id, []);
    byAction.get(task.action_id).push(task);
  }
  return rows.map((row) => pastRound(row, byAction.get(row.id) ?? []));
}
