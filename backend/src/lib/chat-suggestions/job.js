/**
 * The daily suggestions job (CHAT-26 §3–§7), behind CHAT_AGENTIC: every
 * hour, for each person whose morning it is, at most one open Action Center
 * action per brand they get suggestions for, chosen by rules.js with no AI
 * call, written to chat_suggestions (00422) for the Inbox. The action itself
 * is never touched.
 *
 * Each run:
 *   1. deletes suggestions older than KEEP_DAYS ("renews every 14 days");
 *   2. reads the brands Chat is on for (not demo brands, 00380, nor paused
 *      ones), and skips read-only workspaces (no active plan): their lists
 *      keep what they have;
 *   3. per workspace, its people by role (ROLE_FEEDS) and their time zones,
 *      and only those whose morning it is go on; which brands each of them
 *      can see is read once (brand access, spec §5.4: brandReaders);
 *   4. per brand, for the people who can see it, in a few batched reads:
 *      their feeds (one made for admins
 *      and managers who have none), the suggestions kept, then, for those due,
 *      the brand's open actions, which of them "Start now" opens and which
 *      wait in "Needs you";
 *   5. pauses the feeds unused for 30 days, writes today's suggestions
 *      (marking a feed whose first since its last use it is), and counts
 *      the suggestions written and feeds paused.
 *      A brand or workspace that fails is counted and the next goes on.
 *
 * Twice in an hour, or on two servers, sends nothing twice: a suggestion is
 * unique per person, brand and day (00422) and a second insert is ignored; a
 * feed is paused only as it was read. With CHAT_AGENTIC off it reads nothing.
 * Logs carry counts and codes only, never a customer's names or texts.
 */

import cron from 'node-cron';
import supabaseAdmin from '../../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { brandReaders } from '../access.js';
import { chatAgenticDeployed, chatAgenticEnabled, chatAgenticOrgs } from '../chatFlag.js';
import { selectInChunks } from '../chunkedIn.js';
import { DRAFT_TASK_KEYS, TASK_DONE } from '../contentPublished.js';
import { logger } from '../logger.js';
import {
  KEEP_DAYS,
  OPEN_STATUSES,
  dueNow,
  firstSinceUse,
  inMorning,
  pickSuggestion,
  resolveZones,
  roleFeed,
  shouldPause,
} from './rules.js';
import { buildSummary } from './summary.js';

const DAY_MS = 86_400_000;
/** Rows a read pages through at a time (PostgREST's default ceiling). */
const PAGE = 1000;

/** Every hour at :07: each person's morning is caught in the hour it starts. */
export const SCHEDULE = '7 * * * *';
/** Open actions read per brand, highest priority first: far more than the lifts can reorder. */
export const MAX_CANDIDATES = 500;
/** A workspace's latest Chat answers read for its people's time zones, and over how many days. */
export const ZONE_ANSWERS = 300;
export const ZONE_DAYS = 30;

/** A failed read or write, by what it was and the database's code: never its values. */
class SuggestionsDbError extends Error {
  constructor(what, error) {
    super(`${what} failed`);
    this.name = 'SuggestionsDbError';
    this.code = error?.code ?? null;
  }
}

/** Every row a query gives, PAGE at a time; `build` makes the query afresh for each page. */
async function readAll(what, build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new SuggestionsDbError(what, error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** A chunked read's rows, or a thrown SuggestionsDbError. */
async function readChunks(what, ids, build) {
  const { data, error } = await selectInChunks(ids, build);
  if (error) throw new SuggestionsDbError(what, error);
  return data ?? [];
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  }
  return groups;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The brands Chat is on for: active, not demo, in CHAT_AGENTIC_ORGS when it lists any. */
async function loadBrands(db) {
  const orgs = chatAgenticOrgs();
  const brands = await readAll('brands read', () => {
    let query = db
      .from('brands')
      .select('id, organization_id')
      .eq('is_active', true)
      .eq('is_demo', false)
      .order('id');
    if (orgs.length) query = query.in('organization_id', orgs);
    return query;
  });
  return brands.filter((brand) => chatAgenticEnabled(brand.organization_id));
}

/** The workspaces with an active plan or trial: the others are read-only. Every one off the cloud. */
async function loadActiveWorkspaces(db, orgIds) {
  if (!isCloud()) return new Set(orgIds);
  const rows = await readChunks('organizations read', orgIds, (chunk) =>
    db.from('organizations').select('id, subscription_status').in('id', chunk),
  );
  return new Set(
    rows.filter((org) => isSubscriptionActive(org.subscription_status)).map((org) => org.id),
  );
}

/** The workspace's people who get suggestions at all (not analysts). */
async function loadPeople(db, orgId) {
  const people = await readAll('profiles read', () =>
    db.from('profiles').select('id, role').eq('organization_id', orgId).order('id'),
  );
  return people.filter((person) => roleFeed(person.role) !== 'never');
}

/** The workspace's latest Chat answers' time zones, newest first (resolveZones). */
async function loadAnswerZones(db, orgId, now) {
  const { data, error } = await db
    .from('chat_messages')
    .select(
      'timezone, created_at, chat_conversations!chat_messages_conversation_id_fkey!inner(user_id, organization_id)',
    )
    .eq('chat_conversations.organization_id', orgId)
    .eq('role', 'assistant')
    .not('timezone', 'is', null)
    .gte('created_at', new Date(now.getTime() - ZONE_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(ZONE_ANSWERS);
  if (error) throw new SuggestionsDbError('time zones read', error);
  return (data ?? []).map((row) => ({
    userId: row.chat_conversations?.user_id ?? null,
    timezone: row.timezone,
  }));
}

/**
 * The brand's open actions the people due may get, highest priority first:
 * the unassigned ones and those assigned to one of them, MAX_CANDIDATES of
 * each, so actions assigned to someone else never take the places. Their
 * payloads and reasons are read for the picked ones only (loadPicked).
 */
async function loadCandidates(db, brandId, userIds) {
  const open = () =>
    db
      .from('actions')
      .select(
        'id, action_no, kind, category, impact, status, priority_score, created_at, assignee_id',
      )
      .eq('brand_id', brandId)
      .in('status', OPEN_STATUSES)
      .is('deleted_at', null);
  const ranked = (query) =>
    query
      .order('priority_score', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: true })
      .limit(MAX_CANDIDATES);
  const [unassigned, assigned] = await Promise.all([
    ranked(open().is('assignee_id', null)),
    readChunks('assigned actions read', userIds, (chunk) =>
      ranked(open().in('assignee_id', chunk)),
    ),
  ]);
  if (unassigned.error) throw new SuggestionsDbError('actions read', unassigned.error);
  return [...(unassigned.data ?? []), ...assigned];
}

const WRITING_TASKS = [...DRAFT_TASK_KEYS.create, ...DRAFT_TASK_KEYS.optimize];

/**
 * The actions "Start now" opens in the Content Editor: those with a writing
 * task still to do (CE-022's Create content / Optimize page), and the draft
 * it opens, a new page first.
 *
 * @returns {Promise<Map<string, 'create' | 'optimize'>>}
 */
async function loadStartNow(db, actionIds) {
  const tasks = await readChunks('writing tasks read', actionIds, (chunk) =>
    db
      .from('action_tasks')
      .select('action_id, task_key, status')
      .in('action_id', chunk)
      .in('task_key', WRITING_TASKS),
  );
  const methods = new Map();
  for (const task of tasks) {
    if (TASK_DONE.includes(task.status)) continue;
    const method = DRAFT_TASK_KEYS.create.includes(task.task_key) ? 'create' : 'optimize';
    if (method === 'create' || !methods.has(task.action_id)) methods.set(task.action_id, method);
  }
  return methods;
}

/**
 * The actions waiting on someone in Chat's "Needs you": an agent's run on
 * the action that needs someone (chat_agent_runs), or a chat on one of its
 * tasks whose run waits on a question or an approval (chat_task_state).
 *
 * @returns {Promise<Set<string>>}
 */
async function loadNeedsYou(db, actionIds) {
  const [agentRuns, taskRuns] = await Promise.all([
    readChunks('agent runs read', actionIds, (chunk) =>
      db
        .from('chat_agent_runs')
        .select('action_id')
        .in('action_id', chunk)
        .eq('status', 'needs_you'),
    ),
    readChunks('task chats read', actionIds, (chunk) =>
      db
        .from('chat_task_state')
        .select(
          'action_tasks!chat_task_state_action_task_id_fkey!inner(action_id), chat_runs!chat_task_state_run_id_fkey!inner(status)',
        )
        .in('action_tasks.action_id', chunk)
        .eq('chat_runs.status', 'waiting'),
    ),
  ]);
  return new Set([
    ...agentRuns.map((run) => run.action_id),
    ...taskRuns.map((row) => row.action_tasks?.action_id),
  ]);
}

/** The picked actions' payloads and priority reasons, by id. */
async function loadPicked(db, actionIds) {
  const rows = await readChunks('picked actions read', actionIds, (chunk) =>
    db.from('actions').select('id, payload, priority_level, priority_reason').in('id', chunk),
  );
  return new Map(rows.map((row) => [row.id, row]));
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/** Deletes suggestions sent over KEEP_DAYS ago; says how many. */
async function deleteExpired(db, now) {
  const { count, error } = await db
    .from('chat_suggestions')
    .delete({ count: 'exact' })
    .lt('sent_at', new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString());
  if (error) throw new SuggestionsDbError('expired suggestions delete', error);
  return count ?? 0;
}

/** Pauses a feed, only as it was read (a use since keeps it on); whether it was. */
async function pauseFeed(db, { userId, brandId, feed, now }) {
  let query = db
    .from('chat_suggestion_feeds')
    .update({ status: 'paused', paused_at: now.toISOString() })
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .eq('status', 'on');
  if (feed.updated_at) query = query.eq('updated_at', feed.updated_at);
  const { data, error } = await query.select('user_id');
  if (error) throw new SuggestionsDbError('feed pause', error);
  return (data ?? []).length > 0;
}

// ─── The run ────────────────────────────────────────────────────────────────

/**
 * Marks the feeds whose suggestion just sent was the first since their last
 * use (firstSinceUse): an update that changes nothing but updated_at (the
 * table's trigger), where the 30 days before a pause count from. A mark
 * that fails is logged and the run goes on: the count then starts at the
 * use itself.
 */
async function markFirstSinceUse(db, { brandId, userIds }) {
  if (userIds.length === 0) return;
  const { error } = await db
    .from('chat_suggestion_feeds')
    .update({ status: 'on' })
    .eq('brand_id', brandId)
    .in('user_id', userIds)
    .eq('status', 'on');
  if (error) logger.warn({ code: error.code ?? null }, '[chat-suggestions] feeds not marked');
}

/**
 * One brand's feeds for the people whose morning it is: made, paused, and
 * today's suggestions written. Counts go to `tally` as they happen, so a
 * failure later in the brand keeps what was done before it.
 */
async function runBrand(db, { orgId, brandId, people, zones, now, tally }) {
  const at = now.toISOString();

  const feeds = await readAll('feeds read', () =>
    db
      .from('chat_suggestion_feeds')
      .select('user_id, status, created_at, updated_at, last_used_at')
      .eq('brand_id', brandId)
      .order('user_id'),
  );
  const feedOf = new Map(feeds.map((feed) => [feed.user_id, feed]));
  const toMake = [];
  const active = [];
  for (const person of people) {
    let feed = feedOf.get(person.id);
    if (!feed) {
      if (roleFeed(person.role) !== 'default_on') continue;
      feed = { user_id: person.id, status: 'on', created_at: at, updated_at: null };
      toMake.push({ user_id: person.id, brand_id: brandId, organization_id: orgId, status: 'on' });
    }
    if (feed.status === 'on') active.push({ person, feed });
  }
  if (toMake.length) {
    const { data, error } = await db
      .from('chat_suggestion_feeds')
      .upsert(toMake, { onConflict: 'user_id,brand_id', ignoreDuplicates: true })
      .select('user_id');
    if (error) throw new SuggestionsDbError('feeds insert', error);
    tally.feedsMade += (data ?? []).length;
  }
  if (active.length === 0) return;

  const kept = await readAll('suggestions read', () =>
    db
      .from('chat_suggestions')
      .select(
        'id, user_id, action_id, sent_on, sent_at, opened_at, started_at, snoozed_until, removed_at, category:summary->action->>category',
      )
      .eq('brand_id', brandId)
      .gte('sent_at', new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString())
      .order('id'),
  );
  const keptOf = groupBy(kept, 'user_id');

  const due = [];
  for (const { person, feed } of active) {
    const rows = keptOf.get(person.id) ?? [];
    if (shouldPause({ feed, rows, now })) {
      if (await pauseFeed(db, { userId: person.id, brandId, feed, now })) {
        tally.paused++;
      }
      continue;
    }
    const when = dueNow({ now, zone: zones.ofPerson(person.id), rows, feed });
    if (when.due) {
      due.push({ person, day: when.day, rows, first: firstSinceUse({ feed, rows }) });
    }
  }
  if (due.length === 0) return;

  const actions = await loadCandidates(
    db,
    brandId,
    due.map((entry) => entry.person.id),
  );
  if (actions.length === 0) return;
  const ids = actions.map((action) => action.id);
  const [startNow, needsYou] = await Promise.all([loadStartNow(db, ids), loadNeedsYou(db, ids)]);

  const picks = due
    .map((entry) => ({
      ...entry,
      pick: pickSuggestion({
        actions,
        userId: entry.person.id,
        rows: entry.rows,
        needsYou,
        startNow,
        now,
      }),
    }))
    .filter((entry) => entry.pick);
  if (picks.length === 0) return;

  const picked = await loadPicked(db, [...new Set(picks.map((entry) => entry.pick.action.id))]);
  const pickOf = new Map();
  const rows = picks.map((entry) => {
    const { person, day, pick } = entry;
    const more = picked.get(pick.action.id) ?? {};
    const action = { ...pick.action, ...more };
    pickOf.set(person.id, entry);
    return {
      user_id: person.id,
      organization_id: orgId,
      brand_id: brandId,
      action_id: pick.action.id,
      sent_on: day,
      sent_at: at,
      summary: buildSummary({ action, payload: more.payload ?? {}, pick }),
    };
  });
  const { data: sent, error } = await db
    .from('chat_suggestions')
    .upsert(rows, { onConflict: 'user_id,brand_id,sent_on', ignoreDuplicates: true })
    .select('user_id');
  if (error) throw new SuggestionsDbError('suggestions insert', error);

  const firsts = [];
  for (const row of sent ?? []) {
    const entry = pickOf.get(row.user_id);
    if (!entry) continue;
    if (entry.first) firsts.push(row.user_id);
    tally.sent++;
  }
  await markFirstSinceUse(db, { brandId, userIds: firsts });
}

/**
 * One workspace: its people whose morning it is, brand by brand, each brand
 * for the people who can see it (brand access, spec §5.4), read once for
 * all its brands. Someone who can't see a brand gets no feed or suggestion
 * there, and a feed of theirs is left as it was: neither used nor paused,
 * ready again if they're given the brand back. A brand that fails is
 * counted and logged, and the next one goes on; the people's access unread
 * fails the workspace, and nothing is written for it this hour.
 */
async function runWorkspace(db, { orgId, brands, now, tally }) {
  const people = await loadPeople(db, orgId);
  if (people.length === 0) return;
  const zones = resolveZones(await loadAnswerZones(db, orgId, now));
  const morning = people.filter((person) => inMorning(now, zones.ofPerson(person.id)));
  if (morning.length === 0) return;
  const readers = await brandReaders(
    orgId,
    brands.map((brand) => brand.id),
  );

  for (const brand of brands) {
    const seeing = morning.filter((person) => readers.get(person.id)?.has(brand.id));
    if (seeing.length === 0) continue;
    try {
      await runBrand(db, { orgId, brandId: brand.id, people: seeing, zones, now, tally });
    } catch (err) {
      tally.failed++;
      logger.error(
        { err: { name: err?.name, code: err?.code ?? null } },
        '[chat-suggestions] brand failed',
      );
    }
  }
}

/**
 * One run of the job (the hourly tick). Never throws: a workspace or brand
 * that fails is counted and logged, and the next one goes on.
 *
 * @param {{ db?: object, now?: Date }} [options]
 * @returns {Promise<{ workspaces: number, feedsMade: number, sent: number, paused: number,
 *   deleted: number, failed: number }>}
 */
export async function runDailySuggestions({ db = supabaseAdmin, now = new Date() } = {}) {
  const tally = {
    workspaces: 0,
    feedsMade: 0,
    sent: 0,
    paused: 0,
    deleted: 0,
    failed: 0,
  };
  if (!chatAgenticDeployed()) return tally;

  try {
    // Its own step: a failed delete is tried again next hour and sends on.
    try {
      tally.deleted = await deleteExpired(db, now);
    } catch (err) {
      tally.failed++;
      logger.error(
        { err: { name: err?.name, code: err?.code ?? null } },
        '[chat-suggestions] delete failed',
      );
    }

    const brands = await loadBrands(db);
    const byOrg = groupBy(brands, 'organization_id');
    const active = await loadActiveWorkspaces(db, [...byOrg.keys()]);

    for (const [orgId, orgBrands] of byOrg) {
      if (!active.has(orgId)) continue;
      try {
        await runWorkspace(db, { orgId, brands: orgBrands, now, tally });
        tally.workspaces++;
      } catch (err) {
        tally.failed++;
        logger.error(
          { err: { name: err?.name, code: err?.code ?? null } },
          '[chat-suggestions] workspace failed',
        );
      }
    }
  } catch (err) {
    tally.failed++;
    logger.error(
      { err: { name: err?.name, code: err?.code ?? null } },
      '[chat-suggestions] run failed',
    );
  }
  logger.info(tally, '[chat-suggestions] run done');
  return tally;
}

/**
 * Started with the server while CHAT_AGENTIC is on (server.js): the run
 * every hour at SCHEDULE. A run still going when the next hour comes is
 * left to finish; that hour's is skipped.
 */
export function startDailySuggestions({ schedule = SCHEDULE, run = runDailySuggestions } = {}) {
  let running = false;
  cron.schedule(schedule, async () => {
    if (running) return;
    running = true;
    try {
      await run();
    } catch (err) {
      logger.error({ err: { name: err?.name } }, '[chat-suggestions] run crashed');
    } finally {
      running = false;
    }
  });
  logger.info({ schedule }, '[chat-suggestions] hourly picker scheduled');
}
