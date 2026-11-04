import { supabaseAdmin } from '@/lib/supabase/admin';
import { MAX_QUEUED_PER_BRAND, RUN_NOW_REPEAT_MS, agentPlanLimits } from './agentRules';
import { idempotencyKey, requestHash, sweepExpiredKeys, withIdempotencyKey } from './idempotency';
import { readActionForRun, type ActionSnapshot } from './agentAction';
import { connectionName, missingRequiredConnection } from './agentConnections';
import {
  agentForAct,
  logAgentChange,
  readTriggerInputs,
  refused,
  runChecks,
  runnableBrands,
  type AgentContext,
  type AgentResult,
  type LoadedAgent,
} from './agents';

/**
 * Run now (CHAT-21 §E Manual, §H, §M): an agent's run asked for by a person,
 * queued, then started when the workspace has room. Each brand of its scope
 * gets its own run (§H item 41); one run at a time per agent and brand, at
 * most 3 waiting (§M item 58: a fourth joins the last); a second click by
 * the same person within a minute is the first (edge case 14): the click
 * claims an idempotency key (agent, brand, person, minute; idempotency.ts),
 * so two at once queue one run, and a run counted past the 3 after its
 * insert (others' clicks at the same moment) goes again. A manual run
 * acts as the person who clicked (§H item 38) and goes before triggered
 * runs (§M item 59, chat_start_next_agent_run).
 *
 * Starting is the database's (chat_start_next_agent_run: the plan's runs at
 * once, in order); running a started run as a Chat run is the agent run
 * driver's (agentDriver.ts, W2-16). Without a driver nothing is started: a
 * run left `running` with no driver would hold its place and a slot for
 * good, so the runs wait queued. Server only.
 */

/**
 * Hands a started agent run to the Chat engine: its conversation and its
 * Chat run (W2-16). Resolves once the run is handed over, not when it ends.
 * `sessionUserId`: the person signed in to the request that started it,
 * null for none (the minute tick, a signal).
 */
export type AgentRunDriver = (run: {
  id: string;
  organizationId: string;
  sessionUserId?: string | null;
}) => Promise<void>;

/**
 * The agent run driver (agentDriver.ts): read when a run starts, so this
 * module and the driver, which starts the next queued run once one ends,
 * don't load each other.
 */
export const AGENT_RUN_DRIVER: AgentRunDriver | null = async (run) =>
  (await import('./agentDriver')).agentRunDriver(run);

/**
 * Starts the workspace's next queued agent runs while it has room
 * (`runsAtOnce`, the plan's) and hands each to the driver. Without a driver
 * nothing starts. A run the driver can't take fails, which frees its place.
 * `sessionUserId`: the person signed in to this request (Run now, Run
 * agent), whichever runs start; null without one. Answers the runs
 * started; never throws.
 */
export async function startQueuedAgentRuns(
  organizationId: string,
  runsAtOnce: number,
  driver: AgentRunDriver | null = AGENT_RUN_DRIVER,
  sessionUserId: string | null = null,
): Promise<string[]> {
  if (!driver) return [];
  const started: string[] = [];
  for (let i = 0; i < runsAtOnce; i++) {
    const { data, error } = await supabaseAdmin.rpc('chat_start_next_agent_run', {
      p_organization_id: organizationId,
      p_workspace_limit: runsAtOnce,
    });
    if (error) {
      console.error('[chat/agents] could not start a queued run:', error);
      break;
    }
    if (!data) break;
    started.push(data);
    try {
      await driver({ id: data, organizationId, sessionUserId });
    } catch (err) {
      console.error('[chat/agents] the driver could not take a run:', err);
      await supabaseAdmin
        .from('chat_agent_runs')
        .update({ status: 'failed', finished_at: new Date().toISOString() })
        .eq('id', data)
        .eq('status', 'running');
    }
  }
  return started;
}

/** What Run now did for a brand: queued (or started), the earlier click's run, or joined the last. */
export interface RunNowItem {
  brand: string;
  status: string;
  /** A click within a minute of the person's last on this brand: that run, not a new one. */
  repeated: boolean;
  /** Three already wait: this one joins the last of them (§M item 58). */
  coalesced: boolean;
}

interface QueuedRow {
  id: string;
  acting_user_id: string | null;
  trigger_kind: string;
  action_id: string | null;
  queued_at: string;
}

/**
 * Run now on an agent the person may run (§K item 51: Admins and Managers;
 * a Manager's own private agent or any workspace agent), not archived, after
 * the checks before a run (§D item 21) for the person it acts as. `brandId`
 * picks one brand of its scope; without it, every brand of its scope gets a
 * run. Answers each brand's run.
 */
export async function runAgentNow(
  ctx: AgentContext,
  id: string,
  input: { brandId?: string },
  now = new Date(),
  driver: AgentRunDriver | null = AGENT_RUN_DRIVER,
): Promise<AgentResult<{ runs: RunNowItem[] }>> {
  const org = ctx.actor.organizationId;
  const found = await agentForAct(ctx, id, 'run');
  if (!found.ok) return found;
  const { agent } = found;
  const { row, version } = agent;
  if (row.status === 'archived') return refused('archived');
  if (!version) return refused('failed');

  const failing = await runChecks(ctx, agent, ctx.viewer.role, await readTriggerInputs(row.id));
  if (failing) return failing;
  let brands = await runnableBrands(org, version.scope, ctx.viewer.brandAccess);
  if (input.brandId) {
    brands = brands.filter((b) => b.id === input.brandId);
    if (brands.length === 0) return refused('brand_not_found');
  }
  // A brand without a Required connection: refused before anything is queued (§H item 42).
  for (const brand of brands) {
    const missing = await missingRequiredConnection(version, brand.id);
    if (missing) {
      return refused('connection_missing', { name: connectionName(missing), brand: brand.name });
    }
  }

  const runs: RunNowItem[] = [];
  const ours: string[] = [];
  let claimed = false;
  for (const brand of brands) {
    // One click per person, agent and brand a minute (edge case 14): two at once claim one key.
    const minute = String(Math.floor(now.getTime() / RUN_NOW_REPEAT_MS));
    const outcome = await withIdempotencyKey<QueuedOutcome>(
      {
        organizationId: org,
        key: idempotencyKey('agentRunNow', [row.id, brand.id, ctx.actor.userId, minute]),
        requestHash: requestHash('agentRunNow', { agent: row.id, brand: brand.id }),
      },
      async () => ({ result: await queueRun(ctx, row, brand, now), activityId: null }),
    );
    if ((outcome.kind === 'ran' || outcome.kind === 'repeat') && outcome.result.kind !== 'full') {
      claimed ||= outcome.kind === 'ran';
      const { runId, kind } = outcome.result;
      ours.push(runId);
      runs.push({
        brand: brand.name,
        status: 'queued',
        repeated: outcome.kind === 'repeat' || kind === 'repeated',
        coalesced: kind === 'coalesced',
      });
    } else {
      // The first click is still queuing it: this one is that one.
      runs.push({ brand: brand.name, status: 'queued', repeated: true, coalesced: false });
      ours.push('');
    }
  }
  if (claimed) await sweepExpiredKeys(org);

  await startQueuedAgentRuns(org, agentPlanLimits(ctx.plan).runsAtOnce, driver, ctx.actor.userId);
  // What the start made of them: running once a slot took them, else still queued.
  if (ours.some(Boolean)) {
    const { data, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id, status')
      .in('id', ours.filter(Boolean));
    if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
    const status = new Map(
      ((data ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]),
    );
    runs.forEach((run, i) => {
      run.status = status.get(ours[i]) ?? run.status;
    });
  }
  return { ok: true, value: { runs } };
}

/** What Run agent on an action did: Run now's answer, and the run's chat once it started. */
export interface ActionRunItem extends RunNowItem {
  /** The run's chat, the person's own, once it started; null while it waits. */
  chatId: string | null;
  /** Why a run that ended before it started stopped (e.g. action_closed); null otherwise. */
  stopReason: string | null;
}

/**
 * Run agent on an Action Center action (CHAT-21 §F): one run of the agent
 * on the action's brand, scoped to the action (trigger `action`, the action
 * as it is now in its evidence, §F item 28), acting as the person who
 * clicked (§F item 30), after the same checks as Run now. The action has
 * to be open and in the person's brands, and the agent's scope has to
 * cover its brand. A second click by the same person on the same action
 * within a minute is the first (edge case 14). The run starts at once
 * when the workspace has room: then its chat is answered, for the side
 * panel to open.
 */
export async function runAgentOnAction(
  ctx: AgentContext,
  id: string,
  actionId: string,
  now = new Date(),
  driver: AgentRunDriver | null = AGENT_RUN_DRIVER,
): Promise<AgentResult<{ run: ActionRunItem }>> {
  const org = ctx.actor.organizationId;
  const found = await agentForAct(ctx, id, 'run');
  if (!found.ok) return found;
  const { agent } = found;
  const { row, version } = agent;
  if (row.status === 'archived') return refused('archived');
  if (!version) return refused('failed');

  const action = await readActionForRun(ctx, actionId, now);
  if (!action.ok) return action;
  const { snapshot, brand: actionBrand } = action.value;
  const failing = await runChecks(ctx, agent, ctx.viewer.role, await readTriggerInputs(row.id));
  if (failing) return failing;
  const brand = (await runnableBrands(org, version.scope, ctx.viewer.brandAccess)).find(
    (b) => b.id === actionBrand.id,
  );
  if (!brand) return refused('brand_not_found');
  const missing = await missingRequiredConnection(version, brand.id);
  if (missing) {
    return refused('connection_missing', { name: connectionName(missing), brand: brand.name });
  }

  const minute = String(Math.floor(now.getTime() / RUN_NOW_REPEAT_MS));
  const outcome = await withIdempotencyKey<QueuedOutcome>(
    {
      organizationId: org,
      key: idempotencyKey('agentRunAction', [row.id, snapshot.id, ctx.actor.userId, minute]),
      requestHash: requestHash('agentRunAction', { agent: row.id, action: snapshot.id }),
    },
    async () => ({ result: await queueRun(ctx, row, brand, now, snapshot), activityId: null }),
    // A full queue isn't kept: a click once a run has started gets its own.
    { keep: (result) => result.kind !== 'full' },
  );
  if (outcome.kind === 'ran') await sweepExpiredKeys(org);
  const result = outcome.kind === 'ran' || outcome.kind === 'repeat' ? outcome.result : null;
  if (result?.kind === 'full') return refused('queue_full', { count: result.waiting });
  const queued = result;

  await startQueuedAgentRuns(org, agentPlanLimits(ctx.plan).runsAtOnce, driver, ctx.actor.userId);
  const run: ActionRunItem = {
    brand: brand.name,
    status: 'queued',
    repeated: !queued || outcome.kind === 'repeat' || queued.kind === 'repeated',
    coalesced: queued?.kind === 'coalesced',
    chatId: null,
    stopReason: null,
  };
  if (queued) {
    const [state, chat] = await Promise.all([
      supabaseAdmin
        .from('chat_agent_runs')
        .select('status, stop_reason')
        .eq('id', queued.runId)
        .maybeSingle(),
      // The run's chat is the person's it acts as: theirs, once the driver made it.
      supabaseAdmin
        .from('chat_conversations')
        .select('id')
        .eq('agent_run_id', queued.runId)
        .eq('user_id', ctx.actor.userId)
        .maybeSingle(),
    ]);
    if (state.error) throw new Error(`Could not read the agent's run: ${state.error.message}`);
    if (chat.error) throw new Error(`Could not read the run's chat: ${chat.error.message}`);
    const kept = state.data as { status: string; stop_reason: string | null } | null;
    run.status = kept?.status ?? run.status;
    run.stopReason = kept?.stop_reason ?? null;
    run.chatId = (chat.data as { id: string } | null)?.id ?? null;
  }
  return { ok: true, value: { run } };
}

/**
 * What queuing a brand's run came to; kept as the click's result for its
 * repeats. `full`: a click on an action found 3 runs waiting, none on that
 * action (no run id).
 */
type QueuedOutcome =
  | { runId: string; kind: 'queued' | 'repeated' | 'coalesced' }
  | { runId: ''; kind: 'full'; waiting: number };

/**
 * Queues one brand's run, or finds the one this click is: the person's own
 * within the minute (a click in the minute before), or the last of the 3
 * waiting (§M item 58). A run that came in past the 3, beside another
 * request's at the same moment, goes again and joins the last.
 *
 * A Run agent click on an action queues a run scoped to it (trigger
 * `action`, §F item 28), the action as it is now in its evidence. Its
 * repeat is the person's run of the agent on the same action from the last
 * 60 seconds, waiting or under way (edge case 14, whatever minute the two
 * clicks fall in); it joins only a waiting run on the same action, and
 * with 3 waiting on others it is refused (`full`), never added to another
 * action's run.
 */
async function queueRun(
  ctx: AgentContext,
  row: LoadedAgent['row'],
  brand: { id: string; name: string },
  now: Date,
  action: ActionSnapshot | null = null,
): Promise<QueuedOutcome> {
  const kind = action ? 'action' : 'manual';
  if (action) {
    const recent = await recentActionRun(row.id, action.id, ctx.actor.userId, now);
    if (recent) return { runId: recent, kind: 'repeated' };
  }
  const waiting = await waitingRuns(row.id, brand.id);
  const repeat = action
    ? undefined
    : waiting.find(
        (r) =>
          r.trigger_kind === kind &&
          r.acting_user_id === ctx.actor.userId &&
          now.getTime() - Date.parse(r.queued_at) < RUN_NOW_REPEAT_MS,
      );
  if (repeat) return { runId: repeat.id, kind: 'repeated' };
  if (waiting.length >= MAX_QUEUED_PER_BRAND) return joinWaiting(waiting, action);
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .insert({
      organization_id: ctx.actor.organizationId,
      agent_id: row.id,
      agent_version: row.version,
      brand_id: brand.id,
      trigger_kind: kind,
      acting_user_id: ctx.actor.userId,
      status: 'queued',
      max_share: row.max_run_share,
      queued_at: now.toISOString(),
      ...(action
        ? { action_id: action.id, trigger_ref: action.id, evidence_json: { action } }
        : {}),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not queue the agent's run: ${error?.message}`);
  const runId = (data as { id: string }).id;

  // Read again: others' clicks at the same moment may have queued too. Past the 3, this one goes.
  const after = await waitingRuns(row.id, brand.id);
  const place = after.findIndex((r) => r.id === runId);
  if (place >= MAX_QUEUED_PER_BRAND) {
    await supabaseAdmin.from('chat_agent_runs').delete().eq('id', runId).eq('status', 'queued');
    return joinWaiting(after.slice(0, MAX_QUEUED_PER_BRAND), action);
  }
  // An Archive between this click's checks and its insert has already stopped the queue
  // without this run: read the agent again, and stop the run as Archive does. Archive
  // changes the state before it stops the queue, so one of the two always sees the other.
  const { data: current, error: currentError } = await supabaseAdmin
    .from('chat_agents')
    .select('status')
    .eq('id', row.id)
    .maybeSingle();
  if (currentError) throw new Error(`Could not read the agent: ${currentError.message}`);
  if (!current || (current as { status: string }).status === 'archived') {
    const { error: stopError } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ status: 'stopped', stop_reason: 'user', finished_at: now.toISOString() })
      .eq('id', runId)
      .eq('status', 'queued');
    if (stopError) throw new Error(`Could not stop the agent's run: ${stopError.message}`);
    return { runId, kind: 'queued' };
  }
  await logAgentChange(ctx, row, action ? 'agentRunOnAction' : 'agentRunQueued', {
    params: action ? { action: String(action.no) } : { brand: brand.name },
    brandId: brand.id,
    agentRunId: runId,
  });
  return { runId, kind: 'queued' };
}

/**
 * A click past the 3 waiting joins the last of them (§M item 58); one on an
 * action, only the last waiting on that same action, else it is refused.
 */
function joinWaiting(waiting: QueuedRow[], action: ActionSnapshot | null): QueuedOutcome {
  const join = action
    ? waiting.filter((r) => r.action_id === action.id).at(-1)
    : waiting[waiting.length - 1];
  return join
    ? { runId: join.id, kind: 'coalesced' }
    : { runId: '', kind: 'full', waiting: waiting.length };
}

/**
 * The person's run of the agent on the action from the last 60 seconds,
 * waiting or under way (edge case 14): a second click is that one.
 */
async function recentActionRun(
  agentId: string,
  actionId: string,
  userId: string,
  now: Date,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id')
    .eq('agent_id', agentId)
    .eq('action_id', actionId)
    .eq('acting_user_id', userId)
    .in('status', ['queued', 'running', 'needs_you'])
    .gte('queued_at', new Date(now.getTime() - RUN_NOW_REPEAT_MS).toISOString())
    .order('queued_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

/** An agent's waiting runs on a brand, in the order they start (fire order, then id). */
async function waitingRuns(agentId: string, brandId: string): Promise<QueuedRow[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id, acting_user_id, trigger_kind, action_id, queued_at')
    .eq('agent_id', agentId)
    .eq('brand_id', brandId)
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw new Error(`Could not read the agent's queue: ${error.message}`);
  return (data ?? []) as QueuedRow[];
}
