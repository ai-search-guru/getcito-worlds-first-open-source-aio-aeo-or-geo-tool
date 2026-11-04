/**
 * Action generation (Action Center, prioritization layer).
 *
 * Consolidates a brand's OPEN signals into a handful of actions — many
 * signals → one action, deterministically. A definition names the signal
 * kinds that constitute one outcome; if a brand has six open page
 * opportunities they become ONE "capture AI traffic" action with six linked
 * signals, never six rows. The count of actions therefore follows what the
 * detectors actually found: four important things yield four actions, per
 * the quality-over-quantity rule.
 *
 * This module is the matching engine and knows no definition by name. What
 * exists, what it needs, and what it puts in its payload is each definition's
 * own business — see definitions/index.js. The engine's job is the part every
 * definition shares: match, decide whether a new cycle may open, and write.
 *
 * Lifecycle across nights, mirroring signals:
 *  - an ACTIVE action keeps its scope. Newly detected signals are linked to
 *    it as evidence, but its payload is not rewritten: it is a work package
 *    someone may already be executing against, and silently changing what it
 *    covers is worse than leaving a new problem for the next cycle;
 *  - a CLOSED action — completed or dismissed — is finished. It is never
 *    written to again and never resurrected; it is the historical record of
 *    one execution cycle;
 *  - closing frees the definition's slot. Once the rest window has passed, a
 *    still firing condition opens a NEW action beside the old one, with its
 *    own baseline, tasks and outcome.
 *
 * Two questions, answered in that order (#818 phase 6). *What did we find?*
 * writes a candidate for every definition that matched, every night, whether
 * or not anything can be done about it. *What should we act on?* promotes
 * from that queue. Keeping them apart is what stopped findings disappearing:
 * a condition detected while the slot was busy used to be linked as evidence
 * and then forgotten, because the next cycle was built from whatever happened
 * to be open on the night the slot freed up.
 *
 * Three things stop a candidate being promoted, and they are counted
 * separately so a quiet night is legible: the brand lacks the data the
 * definition needs (`ineligible`), the last cycle closed too recently
 * (`resting`), or the brand has already had its day's worth (`capped`). None
 * of them loses the finding — it stays in the queue, and its wait is what
 * lifts it up the order.
 *
 * `baseline` snapshots the linked signals' measured values at creation —
 * the "before" half of the validation comparison (#818, phase 2).
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { resolve } from '../../config/actionEngine.js';
import { isEligible, loadDefinitions } from './definitions/index.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';
import { orderByPriority, scoreCandidate } from './candidates.js';
import { priorityColumns, promptIdsOf, scorePriority } from './priority.js';
import { kindTrackOrNone, loadPromptDemand } from './priorityData.js';

const DAY_MS = 86_400_000;

// Thresholds live in config/actionEngine.js (#818 phase 2.5).
const { noise } = resolve();

const IMPACT_RANK = { high: 3, medium: 2, low: 1 };

function buildBaseline(signals) {
  return {
    capturedAt: new Date().toISOString(),
    signals: signals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      previousValue: signal.previous_value,
      currentValue: signal.current_value,
      changeValue: signal.change_value,
    })),
  };
}

function groupByKind(signals) {
  const byKind = new Map();
  for (const signal of signals) {
    byKind.set(signal.kind, [...(byKind.get(signal.kind) ?? []), signal]);
  }
  return byKind;
}

async function logEvent(actionId, event, data = {}) {
  const { error } = await supabaseAdmin
    .from('action_events')
    .insert({ action_id: actionId, event, data });
  if (error) throw new Error(error.message);
}

/**
 * Takes signals as an action's evidence (AC-007). Each becomes the action's
 * (`signals.action_id`, the signal's current action), and the link is kept
 * in `action_signals` for good: the action still lists the signal after it
 * moves on to a later cycle, and the signal lists every action it was used
 * by. The rows in hand are updated too, so the rest of the night sees them
 * as taken.
 */
async function linkSignals(actionId, signals, linkedAt) {
  if (signals.length === 0) return 0;
  const ids = signals.map((signal) => signal.id);
  // The link first: if pointing the signals at the action then fails, they
  // are not taken yet and the next night links them again. The other way
  // round, a signal could be taken with no link, and missing from the action.
  const { error: linkErr } = await supabaseAdmin.from('action_signals').upsert(
    ids.map((signalId) => ({ action_id: actionId, signal_id: signalId, linked_at: linkedAt })),
    { onConflict: 'action_id,signal_id', ignoreDuplicates: true },
  );
  if (linkErr) throw new Error(linkErr.message);
  const { error } = await supabaseAdmin
    .from('signals')
    .update({ action_id: actionId })
    .in('id', ids);
  if (error) throw new Error(error.message);
  for (const signal of signals) signal.action_id = actionId;
  return signals.length;
}

function startOfUtcDay(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

async function openCycle({
  brandId,
  definition,
  signals,
  impact,
  available,
  payload,
  priority,
  now,
}) {
  const { data: inserted, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: definition.category,
      kind: definition.id,
      definition_version: definition.version,
      impact,
      payload,
      kpi_keys: [...new Set(signals.flatMap((signal) => signal.kpi_keys ?? []))],
      baseline: buildBaseline(signals),
      dedup_key: definition.id,
      ...priorityColumns(priority, now),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  // The plan follows from what this brand has and what this action is about
  // — not from the kind alone (#818 phase 5). Two brands with the same
  // problem and different integrations get different lists here.
  const plan = planTasks(definition, { sources: available, payload });
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: inserted.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await logEvent(inserted.id, 'created', {
    impact,
    signalCount: signals.length,
    definitionVersion: definition.version,
    taskCount: plan.length,
  });
  await linkSignals(inserted.id, signals, now.toISOString());
  return inserted.id;
}

export async function generateActionsForBrand(brandId, { now = new Date(), sources } = {}) {
  const definitions = await loadDefinitions();
  const available = sources ?? (await resolveBrandSources(brandId));

  const { data: openSignals, error: signalsErr } = await supabaseAdmin
    .from('signals')
    .select(
      'id, kind, impact, kpi_keys, payload, previous_value, current_value, change_value, action_id, source, detected_at',
    )
    .eq('brand_id', brandId)
    .in('status', ['new', 'acknowledged'])
    .limit(1000);
  if (signalsErr) throw new Error(signalsErr.message);

  // Only the active ones. A completed or dismissed action is a finished
  // cycle: it neither blocks a new one nor is ever written to again, so it
  // has no bearing on what happens tonight beyond the rest window below.
  const { data: activeRows, error: actionsErr } = await supabaseAdmin
    .from('actions')
    .select('id, dedup_key, status, created_at, kind, category, impact, payload, baseline')
    .eq('brand_id', brandId)
    .not('status', 'in', '("completed","dismissed")')
    .limit(1000);
  if (actionsErr) throw new Error(actionsErr.message);
  const active = new Map((activeRows ?? []).map((row) => [row.dedup_key, row]));
  // A signal is taken while an active action holds it. One whose action has
  // closed is free again: if it is still open, the condition is still firing,
  // and it is evidence for the definition's next cycle (AC-007). Before,
  // `action_id` was written once and such a signal could never start one.
  const activeIds = new Set((activeRows ?? []).map((row) => row.id));
  const taken = (signal) => Boolean(signal.action_id) && activeIds.has(signal.action_id);
  // What active actions cover: the signals each was created from. A signal
  // linked to one later is its evidence, not its scope, so it is still what
  // the next cycle is for (#818 phase 6).
  const inScope = new Set(
    (activeRows ?? []).flatMap((row) => (row.baseline?.signals ?? []).map((s) => s.id)),
  );

  // How recently each definition was closed, so a condition that is still
  // firing does not reopen as a fresh action the very next night.
  const { data: closedRows, error: closedErr } = await supabaseAdmin
    .from('actions')
    .select('dedup_key, completed_at, updated_at, created_at')
    .eq('brand_id', brandId)
    .in('status', ['completed', 'dismissed'])
    .order('created_at', { ascending: false })
    .limit(1000);
  if (closedErr) throw new Error(closedErr.message);
  const lastClosedAt = new Map();
  for (const row of closedRows ?? []) {
    const closed = Date.parse(row.completed_at ?? row.updated_at ?? '') || 0;
    if (closed > (lastClosedAt.get(row.dedup_key) ?? 0)) {
      lastClosedAt.set(row.dedup_key, closed);
    }
  }

  // The day's budget, counted from rows already fetched rather than asked
  // for separately. An action raised this morning and dismissed by lunch
  // still spent its slot: the brand was told about it.
  const dayStart = startOfUtcDay(now);
  const createdToday = [...(activeRows ?? []), ...(closedRows ?? [])].filter(
    (row) => (Date.parse(row.created_at ?? '') || 0) >= dayStart,
  ).length;

  const nowIso = now.toISOString();

  // What the queue already holds. `first_seen_at` is the only thing here that
  // cannot be recomputed — it is how long a finding has been waiting, which
  // is the term that stops a low-impact one starving behind a brand with a
  // steady stream of urgent ones.
  const { data: waitingRows, error: waitingErr } = await supabaseAdmin
    .from('action_candidates')
    .select('id, definition_id, first_seen_at, signal_ids')
    .eq('brand_id', brandId)
    .eq('status', 'waiting')
    .limit(1000);
  if (waitingErr) throw new Error(waitingErr.message);
  const waiting = new Map((waitingRows ?? []).map((row) => [row.definition_id, row]));

  // The demand and intent of every prompt the evidence names, read once for
  // the night's priority scores. Without it the scores are still worked out,
  // with demand and intent unknown: a slower read is no reason to skip them.
  let demand = new Map();
  try {
    demand = await loadPromptDemand(
      promptIdsOf([
        ...(openSignals ?? []).map((signal) => signal.payload),
        ...(activeRows ?? []).map((row) => row.payload),
      ]),
    );
  } catch (err) {
    logger.warn({ brandId, err: err.message }, '[actions] prompt demand unavailable');
  }
  // How each kind did here before (learning B4), read once for the night.
  const track = await kindTrackOrNone(brandId, now);
  const ready = [];
  const seen = new Set();
  let refreshed = 0;
  let resting = 0;
  let ineligible = 0;
  let queued = 0;

  for (const definition of definitions) {
    // Registered but switched off — the specification's slot exists, the data
    // behind it does not yet. Nothing to queue and nothing to raise.
    if (definition.enabled === false) continue;
    const matched = (openSignals ?? []).filter((signal) =>
      definition.signalKinds.includes(signal.kind),
    );
    if (matched.length === 0) continue;

    const current = active.get(definition.id);
    if (current) {
      // An active action keeps the scope it was created with. Signals that
      // arrived since are linked as evidence — they are why this action
      // exists — but `payload` is the work package someone may already be
      // executing against, and rewriting it nightly turned a recovery for six
      // prompts into a recovery for a different nine without telling anyone.
      //
      // Those newcomers are not dropped either: outside its scope, they stay
      // in the queue below and are what the next cycle covers.
      const linked = await linkSignals(
        current.id,
        matched.filter((signal) => !taken(signal)),
        nowIso,
      );
      if (linked > 0) {
        await supabaseAdmin.from('actions').update({ updated_at: nowIso }).eq('id', current.id);
        await logEvent(current.id, 'signals_linked', { count: linked });
      }
      refreshed += 1;
    }

    // A candidate covers exactly the matched signals no active action was
    // created from. Recomputed rather than accumulated: a signal that resolved
    // leaves the queue by itself, and one in an active action's scope is
    // already accounted for. The queue therefore cannot drift out of step
    // with what is actually true tonight — and a newcomer stays in it on the
    // nights after it was linked, not only the first.
    const unclaimed = matched.filter((signal) => !inScope.has(signal.id));
    if (unclaimed.length === 0) continue;

    const impact = unclaimed
      .map((signal) => signal.impact)
      .sort((a, b) => IMPACT_RANK[b] - IMPACT_RANK[a])[0];
    const payload = {
      signalCount: unclaimed.length,
      ...definition.payload(groupByKind(unclaimed)),
    };

    const existing = waiting.get(definition.id);
    const firstSeenAt = existing?.first_seen_at ?? nowIso;
    // The priority its action would carry (AC-006): the queue is ordered by
    // the same number the Actions list is.
    const priority = scorePriority(
      {
        action: { kind: definition.id, category: definition.category, impact, payload },
        signals: unclaimed,
        prompts: demand,
        track,
      },
      now,
    );
    const score = scoreCandidate({ priorityScore: priority.score, firstSeenAt }, now);
    const row = {
      brand_id: brandId,
      definition_id: definition.id,
      status: 'waiting',
      signal_ids: unclaimed.map((signal) => signal.id),
      impact,
      payload,
      priority: score,
      first_seen_at: firstSeenAt,
      last_seen_at: nowIso,
      updated_at: nowIso,
    };

    let candidateId = existing?.id;
    if (candidateId) {
      const { error } = await supabaseAdmin
        .from('action_candidates')
        .update(row)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from('action_candidates')
        .insert(row)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      candidateId = inserted.id;
      queued += 1;
    }
    seen.add(definition.id);

    // Whether it can be promoted tonight is a separate question from whether
    // it is real, and it is asked after the queue is written — so a finding
    // that cannot be acted on now is still recorded as found.
    if (current) continue;

    if (!isEligible(definition, available)) {
      ineligible += 1;
      continue;
    }

    const closedAt = lastClosedAt.get(definition.id) ?? 0;
    if (closedAt && now.getTime() - closedAt < noise.restAfterCloseDays * DAY_MS) {
      resting += 1;
      continue;
    }

    ready.push({
      candidateId,
      definitionId: definition.id,
      definition,
      signals: unclaimed,
      impact,
      payload,
      priority,
      // What the queue's order reads, beside the time waited.
      priorityScore: priority.score,
      firstSeenAt,
    });
  }

  // A candidate nothing detected tonight no longer describes anything true.
  // Stale rather than deleted: it is the record of something the engine once
  // found, and re-detection brings it back as a new waiting row with a fresh
  // clock — the same lifecycle a signal has.
  const gone = (waitingRows ?? []).filter((row) => !seen.has(row.definition_id));
  if (gone.length > 0) {
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({ status: 'stale', updated_at: nowIso })
      .in(
        'id',
        gone.map((row) => row.id),
      );
    if (error) throw new Error(error.message);
  }

  const room = Math.max(0, noise.maxNewActionsPerDay - createdToday);
  const ordered = orderByPriority(ready, now);
  const opening = ordered.slice(0, room);

  for (const candidate of opening) {
    const actionId = await openCycle({ brandId, available, now, ...candidate });
    const { error } = await supabaseAdmin
      .from('action_candidates')
      .update({
        status: 'promoted',
        promoted_at: nowIso,
        promoted_action_id: actionId,
        updated_at: nowIso,
      })
      .eq('id', candidate.candidateId);
    if (error) throw new Error(error.message);
  }

  // Every active action's priority, worked out again from tonight's evidence:
  // its open signals, how recent they are, the demand behind them. Actions
  // opened tonight were scored as they were written. Best effort: a score
  // that cannot be written is logged, never a reason to fail the night.
  let rescored = 0;
  for (const row of activeRows ?? []) {
    // Including the signals linked to it tonight: the rows in hand say so.
    const evidence = (openSignals ?? []).filter((signal) => signal.action_id === row.id);
    const priority = scorePriority({ action: row, signals: evidence, prompts: demand, track }, now);
    const { error } = await supabaseAdmin
      .from('actions')
      .update(priorityColumns(priority, now))
      .eq('id', row.id);
    if (error) {
      logger.warn(
        { brandId, actionId: row.id, err: error.message },
        '[actions] priority not saved',
      );
      continue;
    }
    rescored += 1;
  }

  const summary = {
    created: opening.length,
    rescored,
    refreshed,
    resting,
    ineligible,
    capped: ordered.length - opening.length,
    queued,
    waiting: (waitingRows ?? []).length - gone.length + queued - opening.length,
    stale: gone.length,
  };
  logger.info({ brandId, ...summary }, '[actions] generated');
  return summary;
}
