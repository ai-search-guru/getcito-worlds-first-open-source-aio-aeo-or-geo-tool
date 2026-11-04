/**
 * Carrying out a task automatically (#818, phase 7).
 *
 * Phase 5 marked every task with who could carry it out and whether carrying
 * it out reaches outside GetCito; nothing acted on either. This does, under
 * four rules that are the whole point of the layer:
 *
 *  1. **Nothing reaches outside except through a tool.** The tool registry is
 *     the enumerable surface; a task without a tool is not runnable, and says
 *     so rather than improvising.
 *  2. **Nothing changes outside GetCito without approval.** A tool that
 *     writes to a third-party system is blocked until a person has
 *     authorised that task, and the authorisation is recorded on the task
 *     rather than inferred from whoever happened to trigger the run. Reading
 *     a system the brand connected is not a change and needs no approval —
 *     asking for one before every read teaches people to approve blindly.
 *  3. **Every attempt is recorded** — inputs, tool, result, error. Never the
 *     model's reasoning: that is not evidence, and storing it invites people
 *     to read it as explanation. Recorded twice, for two readers: the audit
 *     table for whoever is debugging the engine, and `action_events` for
 *     whoever owns the action, because a task that completes itself with no
 *     trail is indistinguishable from one a colleague did.
 *  4. **A failed run fails its task, not its action.** A tool that throws
 *     costs one step. The action stays open, the other tasks stay as they
 *     were, and somebody can do that step by hand.
 *
 * `sweepTaskExecution` is the nightly entry point. It is bounded by a ceiling
 * on attempts per night, because both tools read and the cost of a bad night
 * is third-party requests rather than damage — but a detector misfiring across
 * the base should not become a thousand of them before anyone is awake.
 */

import supabaseAdmin from '../../../config/supabase.js';
import { isCloud } from '../../../config/plans.js';
import { ACTIVE_SUBSCRIPTION_STATUSES } from '../../activeSubscriptions.js';
import { logger } from '../../logger.js';
import { APPROVAL_PERMISSIONS, AUTOMATABLE_MODES, getTask } from '../tasks/registry.js';
import { resolveBrandSources } from '../sources.js';
import { getTool } from './tools.js';
import { resolve } from '../../../config/actionEngine.js';

const { noise } = resolve();

const DAY_MS = 86_400_000;

/** A task can only be carried out from the statuses that mean "not done". */
const RUNNABLE_STATUSES = ['todo', 'in_progress', 'waiting_approval'];

async function record(row) {
  const { error } = await supabaseAdmin.from('action_task_runs').insert(row);
  if (error) throw new Error(error.message);
}

/**
 * The trail the user sees.
 *
 * `action_task_runs` is the audit table and has no interface; the drawer's
 * History tab reads `action_events`. Without an entry here, a task carried out
 * automatically looked exactly like one a colleague had done — marked
 * complete, with no trail and nobody to ask. That is worse than not
 * automating it.
 *
 * `actor_id` stays null, which is already how the nightly engine's own events
 * are recorded: null means the product did it, not a person.
 *
 * Only outcomes a user needs: it ran, it failed, it needs their approval. A
 * task blocked because no tool implements it yet, or because it waits on
 * another task, is operational detail — it belongs in the audit table and
 * would be noise in a trail people read to understand their own work.
 */
async function logEvent(actionId, event, data) {
  const { error } = await supabaseAdmin
    .from('action_events')
    .insert({ action_id: actionId, event, data, actor_id: null });
  // The trail is not worth failing a completed run over: the audit row is
  // already written, and the task's own status is the fact that matters.
  if (error) logger.error({ err: error, actionId, event }, '[task-run] could not log the event');
}

/**
 * Why this task cannot be carried out right now, or null.
 *
 * Every answer is a sentence an operator can act on. "blocked" with no reason
 * is the failure mode this function exists to avoid.
 */
export function blockedReason({ task, primitive, tool, sources, siblings }) {
  if (!RUNNABLE_STATUSES.includes(task.status)) {
    return `task is ${task.status}`;
  }
  if (!primitive) return `no task primitive named ${task.task_key}`;
  if (!AUTOMATABLE_MODES.includes(primitive.mode)) {
    return 'task is carried out by a person, not automatically';
  }
  if (!tool) return `no tool implements ${task.task_key} yet`;
  if (!sources.has(tool.source)) return `brand has no ${tool.source} source`;

  // WRITE and EXECUTE need a person's approval, and so does any tool that
  // changes something outside GetCito, whatever the task says (spec §5).
  const permission = task.permission ?? primitive.permission;
  const needsApproval = tool.writesExternally || APPROVAL_PERMISSIONS.includes(permission);
  if (needsApproval && !task.approved_by) {
    return 'changes something outside GetCito and has not been approved';
  }

  const unfinished = (task.depends_on ?? []).filter((key) => {
    const sibling = siblings.find((row) => row.task_key === key);
    return sibling && sibling.status !== 'completed' && sibling.status !== 'skipped';
  });
  if (unfinished.length > 0) return `waits on ${unfinished.join(', ')}`;

  return null;
}

/**
 * What a tool is given: the action's own payload, and the structured output
 * of the tasks this one waits on.
 *
 * Upstream outputs travel by task key so a tool reads `inputs.coverage_gaps`
 * rather than positionally — a plan that drops a task (phase 5) must not
 * shift what the next one reads.
 */
function buildInput({ action, siblings, dependsOn }) {
  const inputs = {};
  for (const key of dependsOn ?? []) {
    const sibling = siblings.find((row) => row.task_key === key);
    if (sibling?.output) inputs[key] = sibling.output;
  }
  return { payload: action.payload ?? {}, inputs };
}

/**
 * Carry out one task.
 *
 * Never throws for an ordinary refusal — a blocked task is an outcome, not an
 * error, and callers running a list of them should not stop at the first one
 * that is waiting on something.
 *
 * @param {string} taskId
 * @param {{ now?: Date, sources?: Set<string> }} [options]
 */
export async function runTask(taskId, { now = new Date(), sources } = {}) {
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, task_key, status, depends_on, approved_by, permission')
    .eq('id', taskId)
    .single();
  if (taskErr) throw new Error(taskErr.message);

  const { data: action, error: actionErr } = await supabaseAdmin
    .from('actions')
    .select('id, brand_id, payload')
    .eq('id', task.action_id)
    .single();
  if (actionErr) throw new Error(actionErr.message);

  const { data: siblings, error: siblingErr } = await supabaseAdmin
    .from('action_tasks')
    .select('task_key, status, output')
    .eq('action_id', task.action_id);
  if (siblingErr) throw new Error(siblingErr.message);

  const primitive = getTask(task.task_key);
  const tool = primitive?.tool ? getTool(primitive.tool) : null;
  const available = sources ?? (await resolveBrandSources(action.brand_id));

  const refusal = blockedReason({
    task,
    primitive,
    tool,
    sources: available,
    siblings: siblings ?? [],
  });
  if (refusal) {
    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool?.id ?? null,
      tool_version: tool?.version ?? null,
      status: 'blocked',
      error: refusal,
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
    });
    // A task held for approval says so in its own status, so the person who
    // has to decide can find it without reading the run log.
    const heldForApproval = refusal.includes('not been approved');
    if (heldForApproval && task.status !== 'waiting_approval') {
      await supabaseAdmin
        .from('action_tasks')
        .update({ status: 'waiting_approval', updated_at: now.toISOString() })
        .eq('id', task.id);
      await logEvent(action.id, 'task_awaiting_approval', {
        task: task.task_key,
        tool: tool.id,
      });
    }
    logger.info({ taskId, reason: refusal }, '[task-run] blocked');
    return { status: 'blocked', reason: refusal };
  }

  const input = buildInput({ action, siblings: siblings ?? [], dependsOn: task.depends_on });
  const startedAt = new Date();

  try {
    const output = await tool.run({ brandId: action.brand_id, payload: input.payload, input, now });

    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool.id,
      tool_version: tool.version,
      status: 'succeeded',
      input,
      output,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
    });

    const { error } = await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'completed', output, updated_at: new Date().toISOString() })
      .eq('id', task.id);
    if (error) throw new Error(error.message);

    await logEvent(action.id, 'task_ran', { task: task.task_key, tool: tool.id });
    logger.info({ taskId, tool: tool.id }, '[task-run] completed');
    return { status: 'succeeded', output };
  } catch (err) {
    // A tool that can't go on (learning C1) leaves the task as it was: its
    // reads for the day spent, for the next night; or nothing found to work
    // on, the task a person's, with why as its output, and the nightly sweep
    // passing it over for `retryDays`.
    if (err?.retryLater) {
      const retryAfter =
        err.retryDays > 0 ? new Date(now.getTime() + err.retryDays * DAY_MS).toISOString() : null;
      await record({
        task_id: task.id,
        action_id: action.id,
        brand_id: action.brand_id,
        tool_id: tool.id,
        tool_version: tool.version,
        status: 'blocked',
        input,
        output: err.output ?? null,
        error: err.message,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
      });
      if (err.output || retryAfter) {
        const { error } = await supabaseAdmin
          .from('action_tasks')
          .update({
            output: { ...(err.output ?? {}), ...(retryAfter ? { retryAfter } : {}) },
            updated_at: new Date().toISOString(),
          })
          .eq('id', task.id);
        if (error) logger.error({ err: error, taskId }, '[task-run] could not keep why');
      }
      logger.info({ taskId, tool: tool.id, reason: err.message, retryAfter }, '[task-run] later');
      return { status: 'blocked', reason: err.message, ...(retryAfter ? { retryAfter } : {}) };
    }
    // The action is deliberately untouched. One step failing is one step to
    // do by hand, not a recovery plan cancelled.
    await record({
      task_id: task.id,
      action_id: action.id,
      brand_id: action.brand_id,
      tool_id: tool.id,
      tool_version: tool.version,
      status: 'failed',
      input,
      error: err.message,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
    });

    await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', task.id);

    await logEvent(action.id, 'task_run_failed', { task: task.task_key, tool: tool.id });
    logger.error({ err, taskId, tool: tool.id }, '[task-run] failed');
    return { status: 'failed', error: err.message };
  }
}

/**
 * Carry out the tasks that can be carried out, once, across every brand.
 *
 * Only tasks on actions that are still open, only those a tool implements, and
 * only as many as the nightly ceiling allows. Ordered oldest first so a brand
 * with a long-standing action is not permanently behind one whose actions
 * churn.
 *
 * Every refusal is already recorded by `runTask`, and one brand's failure
 * cannot stop the sweep: the whole point of the layer is that a step failing
 * costs a step.
 */
export async function sweepTaskExecution({ now = new Date() } = {}) {
  const { maxTaskRunsPerNight } = noise;

  // Candidate tasks: not finished, on an action nobody has closed. The tool
  // and dependency checks belong to `runTask`, which records what it refused.
  // On the cloud, only for organizations still on a plan: a tool reads
  // outside services on the organization's behalf. Filtered in the query, so
  // the old tasks of an organization whose plan ended can't fill the read.
  // Never a demo brand's (00380): its tasks are sample data.
  // `retry_after`: a tool that found nothing to work on asked to be passed
  // over until then (runTask).
  let query = supabaseAdmin.from('action_tasks');
  query = isCloud()
    ? query
        .select(
          'id, task_key, action_id, retry_after:output->>retryAfter, actions!inner(status, brands!inner(is_demo, organizations!inner(subscription_status)))',
        )
        .in('actions.brands.organizations.subscription_status', ACTIVE_SUBSCRIPTION_STATUSES)
    : query.select(
        'id, task_key, action_id, retry_after:output->>retryAfter, actions!inner(status, brands!inner(is_demo))',
      );
  const { data: rows, error } = await query
    .eq('actions.brands.is_demo', false)
    .in('status', RUNNABLE_STATUSES)
    .not('actions.status', 'in', '("completed","dismissed")')
    .order('created_at', { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);

  // Filter here rather than in the query: which tasks a tool implements is
  // code, not a column, and duplicating it into SQL is how the two drift.
  // One waiting to be tried again doesn't take a place under the ceiling.
  const withTool = (rows ?? []).filter((row) => getTask(row.task_key)?.tool);
  const waiting = (row) => row.retry_after && Date.parse(row.retry_after) > now.getTime();
  const runnable = withTool.filter((row) => !waiting(row));
  const attempts = runnable.slice(0, maxTaskRunsPerNight);

  const summary = {
    succeeded: 0,
    failed: 0,
    blocked: 0,
    waitingToRetry: withTool.length - runnable.length,
    skippedForCeiling: runnable.length - attempts.length,
  };

  for (const row of attempts) {
    try {
      const result = await runTask(row.id, { now });
      summary[result.status === 'succeeded' ? 'succeeded' : result.status] += 1;
    } catch (err) {
      // An unexpected throw — a task row that vanished mid-sweep, a database
      // error. One task's problem, not the sweep's.
      logger.error({ err, taskId: row.id }, '[task-run] sweep could not attempt a task');
      summary.failed += 1;
    }
  }

  if (summary.skippedForCeiling > 0) {
    logger.warn(
      { ...summary, ceiling: maxTaskRunsPerNight },
      '[task-run] sweep hit its nightly ceiling — more tasks were runnable than allowed',
    );
  }
  logger.info(summary, '[task-run] sweep completed');
  return summary;
}
