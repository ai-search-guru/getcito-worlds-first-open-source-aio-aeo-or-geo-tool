/**
 * Stale actions: New for a long time with nobody touching them.
 *
 * Candidates go stale when nothing detects them any more (generate.js); an
 * action had no such rule, so a list could hold months-old actions still
 * "New", side by side with last night's. Each night an action that is still
 * New and has had no one's event (an assignment, an edit, a task's status, a
 * send) for staleAfterDays is marked stale (`stale_at`, 00432). It is not
 * closed or dismissed: the list shows it as Stale, and Still relevant clears
 * it and starts the clock again (its History line is the event that does).
 * An action that left New, or that someone touched since, is no longer stale.
 *
 * Never on a demo brand (00380): people can't change its sample data, so
 * Still relevant is refused there and a mark could never be cleared.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { chunkIds, selectInChunks } from '../chunkedIn.js';

/**
 * Rows one brand's nightly pass reads for each question (which actions to
 * mark, which to clear), oldest first. Each night's answers leave the set
 * (a marked action is no longer a candidate, a cleared one is no longer
 * marked), so a backlog bigger than this is worked through over the
 * following nights.
 */
export const STALE_CHECKS_PER_BRAND = 500;

const DAY_MS = 86_400_000;

const COLUMNS = 'id, status, created_at, stale_at';

/**
 * Which actions to mark stale and which to clear.
 *
 * @param {{ id: string, status: string, created_at: string, stale_at: string | null }[]} actions
 * @param {Set<string>} touched - actions someone had an event on since `since`
 * @param {Date} since - now minus staleAfterDays
 * @returns {{ mark: string[], clear: string[] }}
 */
export function staleChanges(actions, touched, since) {
  const mark = [];
  const clear = [];
  for (const a of actions) {
    const quiet =
      a.status === 'new' && !touched.has(a.id) && Date.parse(a.created_at) < since.getTime();
    if (quiet && !a.stale_at) mark.push(a.id);
    else if (!quiet && a.stale_at) clear.push(a.id);
  }
  return { mark, clear };
}

/**
 * New actions old enough to go stale and not marked yet. The ones already
 * marked are left out: they would fill the window night after night, and a
 * newer quiet action past it would never be marked.
 */
async function markCandidates(brandId, since) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .is('deleted_at', null)
    .eq('status', 'new')
    .is('stale_at', null)
    .lt('created_at', since.toISOString())
    .order('created_at', { ascending: true })
    .limit(STALE_CHECKS_PER_BRAND);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Marked actions that have left New (the engine closed them, say). */
async function markedNotNew(brandId) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .is('deleted_at', null)
    .not('stale_at', 'is', null)
    .neq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(STALE_CHECKS_PER_BRAND);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Marked actions someone has had an event on since `since`, found from the
 * events rather than from every marked action. The web app clears the mark
 * as it logs a change; this catches the events the server logs itself.
 */
async function markedAndTouched(brandId, since) {
  const { data, error } = await supabaseAdmin
    .from('action_events')
    .select('action_id, actions!inner(id, brand_id, status, created_at, stale_at, deleted_at)')
    .eq('actions.brand_id', brandId)
    .is('actions.deleted_at', null)
    .not('actions.stale_at', 'is', null)
    .not('actor_id', 'is', null)
    .gte('created_at', since.toISOString())
    .limit(STALE_CHECKS_PER_BRAND);
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => e.actions);
}

/**
 * One update per IN_FILTER_CHUNK ids: the ids go in the request's URL, and
 * a few hundred of them (~20 kB) can be refused before reaching PostgREST.
 */
async function updateInChunks(ids, buildUpdate) {
  for (const chunk of chunkIds(ids)) {
    const { error } = await buildUpdate(chunk);
    if (error) throw new Error(error.message);
  }
}

/**
 * Marks the brand's quiet New actions stale and clears the ones that no
 * longer are. Part of the nightly pass (signals/pass.js).
 *
 * @returns {Promise<{ marked: number, cleared: number, skipped?: 'demo_brand' }>}
 */
export async function sweepStaleActions(
  brandId,
  { now = new Date(), thresholds = resolve() } = {},
) {
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('is_demo')
    .eq('id', brandId)
    .maybeSingle();
  if (brandError) throw new Error(brandError.message);
  if (brand?.is_demo) return { marked: 0, cleared: 0, skipped: 'demo_brand' };

  const since = new Date(now.getTime() - thresholds.noise.staleAfterDays * DAY_MS);
  const [candidates, notNew, touchedMarked] = await Promise.all([
    markCandidates(brandId, since),
    markedNotNew(brandId),
    markedAndTouched(brandId, since),
  ]);

  // Someone's event: what a person did, as the History shows it. The engine's
  // own lines (new signals linked, a result measured) carry no actor.
  const { data: events, error: eventsError } = await selectInChunks(
    candidates.map((a) => a.id),
    (chunk) =>
      supabaseAdmin
        .from('action_events')
        .select('action_id')
        .in('action_id', chunk)
        .not('actor_id', 'is', null)
        .gte('created_at', since.toISOString()),
  );
  if (eventsError) throw new Error(eventsError.message);

  const touched = new Set([
    ...(events ?? []).map((e) => e.action_id),
    ...touchedMarked.map((a) => a.id),
  ]);
  const actions = new Map([...candidates, ...notNew, ...touchedMarked].map((a) => [a.id, a]));
  const { mark, clear } = staleChanges([...actions.values()], touched, since);

  await updateInChunks(mark, (chunk) =>
    supabaseAdmin
      .from('actions')
      .update({ stale_at: now.toISOString() })
      .in('id', chunk)
      .eq('status', 'new')
      .is('stale_at', null),
  );
  await updateInChunks(clear, (chunk) =>
    supabaseAdmin.from('actions').update({ stale_at: null }).in('id', chunk),
  );
  return { marked: mark.length, cleared: clear.length };
}
