import supabaseAdmin from '../config/supabase.js';
import { logger } from './logger.js';

/**
 * The Content Agent's runs, step by step (Content Editor v1.1, CE-027 and
 * CE-035; content_agent_runs, 00249): each run says its steps as it reaches
 * them, named by the data they use, so the editor shows real progress; and a
 * person can Stop it, which drops whatever the run had and changes nothing.
 *
 * A step written here is shown, never relied on: a failed write is logged
 * and the run goes on. Stop is the run's own business: the request that
 * stops it aborts the model call when the run is on this server, and the
 * run checks the stopped mark before it keeps anything.
 */

/** Thrown when a run was stopped: nothing it had is kept. */
export class RunStoppedError extends Error {
  constructor() {
    super('The run was stopped');
    this.status = 409;
    this.code = 'stopped';
  }
}

/**
 * How long a run may be under way: the longest model call (three minutes,
 * contentWriter.js) and a margin. One older was left by a server that
 * stopped: never shown, stopped or waited on (agentRuns.ts RUN_STALE_MS).
 */
export const RUN_STALE_MS = 10 * 60_000;

/** The runs on this server, by id: Stop aborts their model call. */
const live = new Map();

/** A write a run's progress may do without: logged when it fails, never thrown. */
async function shown(what, runId, write) {
  try {
    const { data, error } = await write();
    if (error) throw error;
    return data;
  } catch (err) {
    logger.warn({ err, runId }, `[content-runs] ${what} not written`);
    return null;
  }
}

/**
 * Whether one of the agent's fixes (Fix open rules, Quality's hand-off) is
 * under way on the draft, and not one a stopped server left nor one Stop
 * ended (its batch is dropped, stopIfStopped): a second would make a model
 * call of its own, charged, and its batch would hide the first's (another
 * tab, or a person's beside the editor's own hand-off).
 */
export async function fixUnderWay(draftId) {
  const { data, error } = await supabaseAdmin
    .from('content_agent_runs')
    .select('id')
    .eq('draft_id', draftId)
    .in('kind', ['fix', 'handoff'])
    .is('finished_at', null)
    .is('stopped_at', null)
    .gt('started_at', new Date(Date.now() - RUN_STALE_MS).toISOString())
    .limit(1);
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

/**
 * A run's steps by kind, each a short name for the work the server does
 * then, with the counts the run gives (CE-027/035): the rules it writes to,
 * the sources it gathers (numbered, so a number it adds can be checked), the
 * model call, and the check of what it wrote (a number needs a source, a
 * link must be allowed, a locked passage stays as it is).
 */
export function runSteps(kind, counts = {}) {
  const n = (value) => (Number.isInteger(value) ? value : null);
  switch (kind) {
    case 'fix':
      return [
        { key: 'read_rules', count: n(counts.rules) },
        { key: 'gather_sources', count: n(counts.sources) },
        { key: 'write_changes', count: null },
        { key: 'check_sources', count: null },
      ];
    case 'rewrite':
      return [
        { key: 'read_rules', count: n(counts.rules) },
        { key: 'gather_sources', count: n(counts.sources) },
        { key: 'rewrite_page', count: null },
        { key: 'check_sources', count: null },
      ];
    case 'handoff':
      // Quality's hand-off (CE-051): the page's checks instead of its rules.
      return [
        { key: 'read_checks', count: n(counts.checks) },
        { key: 'gather_sources', count: n(counts.sources) },
        { key: 'write_changes', count: null },
        { key: 'check_sources', count: null },
      ];
    case 'brief':
      return [
        { key: 'gather_sources', count: n(counts.sources) },
        { key: 'write_outline', count: null },
        { key: 'match_fanouts', count: null },
      ];
    default:
      return [
        { key: 'read_rules', count: n(counts.rules) },
        { key: 'gather_sources', count: n(counts.sources) },
        { key: 'write_page', count: null },
        { key: 'check_sources', count: null },
      ];
  }
}

/**
 * Starts a run on a draft: written, with its Stop signal (callSignal adds a
 * call's timeout). Runs a stopped server left on the draft are closed first,
 * so the latest is this one. A run that can't be written still runs, with no
 * steps shown and Stop by its signal only. `claimedAt` is the claim a Start
 * or Rewrite holds on the draft (its agent_state_at): a Stop lets go of that
 * claim only, never another run's.
 *
 * `origin` says who started it: a person, or the editor on its own (auto,
 * Quality's hand-off, CE-051). A run that must be written (`strict`) throws
 * instead of running unshown: an automatic hand-off is one a draft, and its
 * row is the claim (a second one is 409 `already`).
 */
export async function startRun({
  draftId,
  kind,
  counts,
  claimedAt = null,
  origin = 'person',
  strict = false,
}) {
  const steps = runSteps(kind, counts);
  const controller = new AbortController();
  // Runs a stopped server left on the draft are closed: only those older
  // than any run still going, so a run another tab started goes on, with its
  // steps and its Stop.
  await shown('earlier runs', null, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({ finished_at: new Date().toISOString(), outcome: 'failed' })
      .eq('draft_id', draftId)
      .is('finished_at', null)
      .lt('started_at', new Date(Date.now() - RUN_STALE_MS).toISOString()),
  );
  // A person's is the column's default: a database before 00275 takes it.
  const row = {
    draft_id: draftId,
    kind,
    steps,
    claimed_at: claimedAt,
    ...(origin === 'person' ? {} : { origin }),
  };
  let data;
  if (strict) {
    const { data: written, error } = await supabaseAdmin
      .from('content_agent_runs')
      .insert(row)
      .select('id')
      .single();
    if (error?.code === '23505') {
      throw Object.assign(new Error('The draft was handed off already'), {
        status: 409,
        code: 'already',
      });
    }
    if (error) throw error;
    data = written;
  } else {
    data = await shown('run', null, () =>
      supabaseAdmin.from('content_agent_runs').insert(row).select('id').single(),
    );
  }
  const id = data?.id ?? null;
  if (id) live.set(id, controller);
  return { id, steps, signal: controller.signal };
}

/** A model call's signal: the run's Stop, or the call's own timeout. */
export function callSignal(run, timeoutMs) {
  return AbortSignal.any([run.signal, AbortSignal.timeout(timeoutMs)]);
}

/**
 * A run's model call: it isn't sent once the run is stopped, and goes with
 * the run's Stop and its own timeout (callSignal). A call a Stop aborted was
 * sent already, and the provider bills it all the same, so its hold on the
 * AI budget stays as its cost (`budget.keep()`), never let go.
 */
export async function runCall(run, budget, timeoutMs, call) {
  await stopIfStopped(run);
  // Stopped since: never sent, so nothing is billed.
  if (run.signal?.aborted) throw new RunStoppedError();
  try {
    return await call(callSignal(run, timeoutMs));
  } catch (err) {
    if (isStop(err, run)) {
      // Never in the way of the stop it follows: a failed write is logged.
      await budget
        .keep()
        .catch((keepErr) =>
          logger.warn({ err: keepErr, runId: run.id }, '[content-runs] stopped call not kept'),
        );
    }
    throw err;
  }
}

/** Moves a run on to `step`, with counts learned on the way ({ index: count }). */
export async function advanceRun(run, step, counts = {}) {
  if (!run?.id) return;
  for (const [i, count] of Object.entries(counts)) {
    if (run.steps[i]) run.steps[i] = { ...run.steps[i], count };
  }
  await shown('step', run.id, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({ step, steps: run.steps })
      .eq('id', run.id)
      .is('finished_at', null),
  );
}

/** Whether the run was stopped (here, or by a request on another server). */
export async function wasStopped(run) {
  if (!run?.id) return false;
  if (live.get(run.id)?.signal.aborted) return true;
  const data = await shown('stop read', run.id, () =>
    supabaseAdmin.from('content_agent_runs').select('stopped_at').eq('id', run.id).maybeSingle(),
  );
  return Boolean(data?.stopped_at);
}

/** Throws RunStoppedError when the run was stopped: before anything is kept. */
export async function stopIfStopped(run) {
  if (await wasStopped(run)) throw new RunStoppedError();
}

/** Ends a run: done (every step), stopped, or failed. */
export async function finishRun(run, outcome, counts = {}) {
  if (!run?.id) return;
  live.delete(run.id);
  for (const [i, count] of Object.entries(counts)) {
    if (run.steps[i]) run.steps[i] = { ...run.steps[i], count };
  }
  await shown('end', run.id, () =>
    supabaseAdmin
      .from('content_agent_runs')
      .update({
        finished_at: new Date().toISOString(),
        outcome,
        steps: run.steps,
        ...(outcome === 'done' ? { step: run.steps.length } : {}),
      })
      .eq('id', run.id)
      .is('finished_at', null),
  );
}

/**
 * Stops a draft's run under way (with `runId`, that run only): marks it
 * stopped and aborts its model call when it runs here. Answers the runs it
 * stopped, each with the claim it holds on the draft (claimed_at: a Start's
 * or a rewrite's, a live page's Start among them though it runs as a Fix;
 * null for Fix open rules, Quality's hand-off and the brief, which hold
 * none): none when none was under way.
 */
export async function stopDraftRun(draftId, runId = null) {
  let query = supabaseAdmin
    .from('content_agent_runs')
    .update({ stopped_at: new Date().toISOString() })
    .eq('draft_id', draftId)
    .is('finished_at', null)
    .is('stopped_at', null)
    .gt('started_at', new Date(Date.now() - RUN_STALE_MS).toISOString());
  // The run the editor shows: another tab's on the same draft goes on.
  if (runId) query = query.eq('id', runId);
  const { data, error } = await query.select('id, claimed_at');
  if (error) throw error;
  for (const { id } of data ?? []) live.get(id)?.abort();
  return data ?? [];
}

/**
 * Whether a run ended by its Stop: the stopped mark, or its model call
 * aborted by one (whatever error the provider wraps the abort in). Read
 * before finishRun, which forgets the run.
 */
export function isStop(err, run) {
  return (
    err instanceof RunStoppedError ||
    (Boolean(run?.id) && live.get(run.id)?.signal.aborted === true)
  );
}

/**
 * Takes a run's row back, as if it never started: an automatic hand-off the
 * AI budget stopped before it began is tried again once the budget renews
 * (its row is the one-a-draft claim). Logged, never thrown.
 */
export async function dropRun(run) {
  if (!run?.id) return;
  live.delete(run.id);
  const dropped = await shown('dropped run', run.id, async () => {
    const { error } = await supabaseAdmin.from('content_agent_runs').delete().eq('id', run.id);
    return { data: !error, error };
  });
  // Not taken back: at least not left under way.
  if (!dropped) await finishRun(run, 'failed');
}
