/**
 * Turning selected Improve suggestions into an Action Center action
 * (PROMPT-004).
 *
 * Like an opportunity sent from Content (fromOpportunity.js), this action is
 * created by a person, so it skips the definitions and the candidate queue.
 * Unlike it, the tasks are not library tasks: each is one suggestion exactly
 * as the user edited it, with the platform and the evidence behind it in
 * `details`. The action is measured on its own prompt (validate.js), and the
 * prompt's last 7 days at send time are kept as its baseline for the Outcome
 * card (improveOutcome.js, PROMPT-008).
 */

import supabaseAdmin from '../../config/supabase.js';
import { IMPROVE_PLATFORM_LABELS } from '../promptImprove.js';
import {
  OUTCOME_WINDOW_DAYS,
  compareOutcome,
  outcomeWindow,
  readPlatformStates,
} from './improveOutcome.js';
import { priorityOnCreate } from './priorityData.js';

export const IMPROVE_ACTION_KIND = 'prompt_improve';

/**
 * What a completed Improve action is measured on (basket scope: its prompt).
 * Citations are counted on the basket's pages, so they're measured only when
 * the action names brand pages; otherwise the metric could only ever be null.
 */
export function improveKpiKeys(pages) {
  return pages.length ? ['ai_visibility', 'citations', 'mentions'] : ['ai_visibility', 'mentions'];
}

/** The brand pages the selected suggestions work on: their brand_page sources. */
export function improvePages(suggestions) {
  const pages = suggestions.flatMap((s) =>
    (s.sources ?? []).filter((src) => src?.type === 'brand_page').map((src) => src.ref),
  );
  return [...new Set(pages.filter((ref) => typeof ref === 'string' && ref.trim()))];
}

const GAP_POINTS = { not_mentioned: 3, mentioned_late: 2, not_cited: 1 };

/** 0 unknown or small, 1 medium, 2 high — monthly estimated AI searches. */
export function volumeTier(estAiVolume) {
  const v = Number(estAiVolume);
  if (!Number.isFinite(v) || v < 100) return 0;
  return v >= 1000 ? 2 : 1;
}

/**
 * Impact from the size of the position gap on the platforms the action
 * covers and the prompt's demand. A prompt missing from several answers is
 * worth more than one cited a little late; demand scales either way.
 */
export function improveImpact(platforms, estAiVolume) {
  const gap = platforms.reduce((sum, p) => sum + (GAP_POINTS[p.state] ?? 0), 0);
  const tier = volumeTier(estAiVolume);
  const missing = platforms.some((p) => p.state === 'not_mentioned');
  if ((tier === 2 && gap >= 3) || (missing && tier >= 1 && gap >= 4)) return 'high';
  if (gap <= 1 && tier < 2) return 'low';
  return 'medium';
}

const label = (id) => IMPROVE_PLATFORM_LABELS[id] ?? id;

function joinLabels(ids) {
  const names = ids.map(label);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * "Why", written from the platform states at send time:
 * "Not mentioned on Perplexity; mentioned late (avg #3.4) on ChatGPT; …".
 */
export function improveWhy(platforms) {
  const parts = [];
  const byState = (state) => platforms.filter((p) => p.state === state);
  const missing = byState('not_mentioned');
  if (missing.length) parts.push(`Not mentioned on ${joinLabels(missing.map((p) => p.id))}`);
  for (const p of byState('mentioned_late')) {
    parts.push(
      p.mentionPosition
        ? `mentioned late (avg #${p.mentionPosition}) on ${label(p.id)}`
        : `mentioned late on ${label(p.id)}`,
    );
  }
  const uncited = byState('not_cited');
  if (uncited.length) {
    parts.push(`mentioned early but not cited on ${joinLabels(uncited.map((p) => p.id))}`);
  }
  if (!parts.length) return 'Suggestions sent from the Improve tab.';
  const text = parts.join('; ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

export function improveGoal(promptText, platforms) {
  return `Get the brand mentioned early and cited for "${promptText}" on ${joinLabels(
    platforms.map((p) => p.id),
  )}.`;
}

/**
 * The prompt's last 7 days at send time, per platform the action covers
 * (PROMPT-008). Written once, at creation; nothing updates it.
 */
export function improveBaseline(snapshots, capturedAt, window) {
  return { capturedAt, window, platforms: snapshots };
}

/** Earlier Improve rounds on a prompt the next generation is shown (learning B5). */
export const IMPROVE_PAST_ROUNDS = 2;

/** Suggestions of one earlier round the next generation is shown, in task order. */
export const IMPROVE_ROUND_TASKS = 12;

const DAY_MS = 86_400_000;

/** How the next generation reads a task's status: done, skipped by the team, or neither. */
function suggestionStatus(status) {
  if (status === 'completed') return 'done';
  if (status === 'skipped') return 'skipped';
  return 'not_done';
}

/**
 * One earlier Improve round on a prompt, as the next generation reads it
 * (learning B5): when it was sent and how many days before `now`, whether
 * it's still open, how each of its platforms moved since (final a month
 * after it was completed), and the suggestions it carried, each with whether
 * it was done or skipped.
 *
 * Until its read is OUTCOME_WINDOW_DAYS past the send, the read's days still
 * overlap the baseline's (on the day it's sent, every platform is
 * "unchanged"), so its platforms are `too_early` rather than a verdict.
 *
 * @param {{ created_at?: string, status: string, position_outcome?: object | null }} action
 * @param {Array<{ title?: string | null, status: string, details?: { platform?: string } | null }>} tasks
 * @param {Date} [now]
 */
export function improveRound(action, tasks, now = new Date()) {
  const outcome = action.position_outcome ?? {};
  const sentMs = typeof action.created_at === 'string' ? Date.parse(action.created_at) : NaN;
  const sent = Number.isFinite(sentMs);
  const readMs = Date.parse(outcome.measuredAt);
  const tooEarly =
    sent && (!Number.isFinite(readMs) || readMs - sentMs < OUTCOME_WINDOW_DAYS * DAY_MS);
  return {
    sent: sent ? action.created_at.slice(0, 10) : null,
    daysAgo: sent ? Math.max(0, Math.floor((now.getTime() - sentMs) / DAY_MS)) : null,
    open: action.status !== 'completed',
    final: outcome.final === true,
    platforms: (Array.isArray(outcome.platforms) ? outcome.platforms : [])
      .filter((p) => typeof p?.platform === 'string')
      .map((p) => ({
        id: p.platform,
        verdict: tooEarly ? 'too_early' : (p.verdict ?? 'not_enough_data'),
      })),
    suggestions: tasks
      .filter((task) => typeof task.title === 'string' && task.title.trim())
      .slice(0, IMPROVE_ROUND_TASKS)
      .map((task) => ({
        platform: task.details?.platform ?? null,
        // One line in the prompt, however the title was edited.
        title: task.title.replace(/\s+/g, ' ').trim(),
        status: suggestionStatus(task.status),
      })),
  };
}

/**
 * The brand's last Improve rounds on a prompt, newest first: sent and not
 * dismissed, nor deleted. The brand's own actions only, sent from a set of
 * the same region (an Improve set is kept per region): '' or null is all
 * regions, which is how an action sent without a region is measured.
 *
 * @returns {Promise<ReturnType<typeof improveRound>[]>}
 */
export async function loadImproveRounds({
  promptId,
  brandId,
  region = null,
  limit = IMPROVE_PAST_ROUNDS,
  now = new Date(),
}) {
  let q = supabaseAdmin
    .from('actions')
    .select('id, status, created_at, position_outcome')
    .eq('brand_id', brandId)
    .eq('kind', IMPROVE_ACTION_KIND)
    .eq('payload->>promptId', promptId);
  q = region ? q.eq('payload->>region', region) : q.is('payload->>region', null);
  const { data: actions, error } = await q
    .neq('status', 'dismissed')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`earlier Improve rounds read failed: ${error.message}`);
  if (!actions?.length) return [];
  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('action_tasks')
    .select('action_id, position, title, status, details')
    .in(
      'action_id',
      actions.map((action) => action.id),
    )
    .order('position');
  if (tasksError)
    throw new Error(`earlier Improve rounds' tasks read failed: ${tasksError.message}`);
  return actions.map((action) =>
    improveRound(
      action,
      (tasks ?? []).filter((task) => task.action_id === action.id),
      now,
    ),
  );
}

/** One task row per selected suggestion, in the order they were shown. */
export function improveTaskRows(actionId, suggestions) {
  return suggestions.map((s, i) => ({
    action_id: actionId,
    position: i + 1,
    task_key: null,
    title: s.title,
    status: 'todo',
    mode: 'human',
    permission: 'read',
    details: {
      body: s.body ?? '',
      platform: s.platform,
      platformLabel: label(s.platform),
      sources: s.sources ?? [],
    },
  }));
}

/**
 * Creates the action, or returns the one this send already created: the
 * idempotency key makes a double click (or a retried request) a no-op.
 *
 * @param {object} p
 * @param {object} p.prompt - { id, text }
 * @param {string} p.brandId
 * @param {object} p.set - the prompt_improve_suggestions row the suggestions came from
 * @param {Array} p.suggestions - selected, as edited: { id, platform, title, body, sources }
 * @param {string} p.idempotencyKey
 * @param {string} p.panelLink - the Positions panel deep link, for the action's source line
 * @param {string} p.userId
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendImproveToActionCenter({
  prompt,
  brandId,
  set,
  suggestions,
  idempotencyKey,
  panelLink,
  userId,
}) {
  const dedupKey = `prompt_improve:${prompt.id}:${idempotencyKey}`;
  const { data: existing } = await supabaseAdmin
    .from('actions')
    .select('id, action_no')
    .eq('brand_id', brandId)
    .eq('dedup_key', dedupKey)
    .maybeSingle();
  if (existing) return { actionId: existing.id, actionNo: existing.action_no, created: false };

  const covered = new Set(suggestions.map((s) => s.platform));
  const platforms = (set.platform_states ?? []).filter((p) => covered.has(p.id));

  const { data: volumeRow } = await supabaseAdmin
    .from('prompt_volumes')
    .select('est_ai_volume')
    .eq('prompt_id', prompt.id)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const sentAt = new Date();
  const now = sentAt.toISOString();
  const pages = improvePages(suggestions);
  const window = outcomeWindow(sentAt);
  const snapshots = await readPlatformStates({
    promptId: prompt.id,
    brandId,
    region: set.region || null,
    platforms: platforms.map((p) => p.id),
    window,
  });
  const payload = {
    source: IMPROVE_ACTION_KIND,
    title: `Improve position: "${prompt.text}"`,
    promptId: prompt.id,
    promptText: prompt.text,
    // Measured on this prompt alone, and on the brand pages the suggestions
    // name for citations (validate.js basket scope).
    promptIds: [prompt.id],
    pages,
    rangeKey: set.range_key,
    region: set.region || null,
    platforms: platforms.map((p) => ({ id: p.id, label: label(p.id), state: p.state })),
    why: improveWhy(platforms),
    goal: improveGoal(prompt.text, platforms),
    panelLink,
    targetEntity: 'platforms',
    targetCount: platforms.length,
  };

  const impact = improveImpact(platforms, volumeRow?.est_ai_volume);
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: 'compete',
      kind: IMPROVE_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: improveKpiKeys(pages),
      baseline: improveBaseline(snapshots, now, window),
      // The first read is the baseline itself; the daily sweep moves it on.
      position_outcome: {
        measuredAt: now,
        window,
        final: false,
        ...compareOutcome(snapshots, snapshots),
      },
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        brand_id: brandId,
        kind: IMPROVE_ACTION_KIND,
        category: 'compete',
        impact,
        payload,
      })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two requests for the same send can race past the lookup; the partial
    // unique index on (brand_id, dedup_key) lets only one insert win.
    if (error.code === '23505') {
      const { data: winner } = await supabaseAdmin
        .from('actions')
        .select('id, action_no')
        .eq('brand_id', brandId)
        .eq('dedup_key', dedupKey)
        .maybeSingle();
      if (winner) return { actionId: winner.id, actionNo: winner.action_no, created: false };
    }
    throw new Error(error.message);
  }

  const { error: tasksErr } = await supabaseAdmin
    .from('action_tasks')
    .insert(improveTaskRows(action.id, suggestions));
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: {
      source: IMPROVE_ACTION_KIND,
      promptId: prompt.id,
      taskCount: suggestions.length,
      platforms: platforms.map((p) => p.id),
    },
  });

  return { actionId: action.id, actionNo: action.action_no, created: true };
}

/**
 * The newest send of the current set whose action is still there and not
 * dismissed — what decides "Open in Actions" over "Send Actions" — plus the
 * ids of the suggestions any live send of this set carried ("Already sent").
 */
export async function liveImproveSends(set) {
  const sends = (set.sent_actions ?? []).filter((s) => s.setGeneratedAt === set.generated_at);
  if (!sends.length) return { latest: null, sentSuggestionIds: [] };
  const { data: actions } = await supabaseAdmin
    .from('actions')
    .select('id, status')
    .in(
      'id',
      sends.map((s) => s.actionId),
    );
  const live = new Set((actions ?? []).filter((a) => a.status !== 'dismissed').map((a) => a.id));
  const liveSends = sends.filter((s) => live.has(s.actionId));
  return {
    latest: liveSends.length ? liveSends[liveSends.length - 1] : null,
    sentSuggestionIds: [...new Set(liveSends.flatMap((s) => s.suggestionIds ?? []))],
  };
}
