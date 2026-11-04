/**
 * Carry out one action task automatically (#818, phase 7).
 *
 * Deliberately a script rather than a cron step. The nightly engine that
 * produces these tasks spent six days failing silently before anyone noticed
 * (#829); an execution layer that runs unattended belongs after the
 * verification that the thing it executes for is running, not before. When
 * that verification exists, this function is what a schedule or a button
 * calls — the decision is about when to pull the trigger, not about whether
 * the mechanism works.
 *
 * `--dry` reports what would happen and why, without running anything: the
 * same refusal the runner would give, which is the useful half when the
 * question is "why has this task not run".
 *
 * Run: node src/scripts/runActionTask.js <taskId> [--dry]
 */
import 'dotenv/config';
import supabaseAdmin from '../config/supabase.js';
import { getTask } from '../lib/action-center/tasks/registry.js';
import { getTool } from '../lib/action-center/execution/tools.js';
import { blockedReason, runTask } from '../lib/action-center/execution/run.js';
import { resolveBrandSources } from '../lib/action-center/sources.js';

const taskId = process.argv[2];
const dry = process.argv.includes('--dry');

if (!taskId) {
  console.error('Usage: node src/scripts/runActionTask.js <taskId> [--dry]');
  process.exit(1);
}

if (dry) {
  const { data: task, error } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, task_key, status, depends_on, approved_by')
    .eq('id', taskId)
    .single();
  if (error) throw new Error(error.message);

  const { data: action } = await supabaseAdmin
    .from('actions')
    .select('brand_id')
    .eq('id', task.action_id)
    .single();
  const { data: siblings } = await supabaseAdmin
    .from('action_tasks')
    .select('task_key, status, output')
    .eq('action_id', task.action_id);

  const primitive = getTask(task.task_key);
  const tool = primitive?.tool ? getTool(primitive.tool) : null;
  const sources = await resolveBrandSources(action.brand_id);

  const reason = blockedReason({ task, primitive, tool, sources, siblings: siblings ?? [] });
  console.log(`${task.task_key}: ${reason ? `blocked — ${reason}` : `would run via ${tool.id}`}`);
  process.exit(0);
}

const result = await runTask(taskId);
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'failed' ? 1 : 0);
