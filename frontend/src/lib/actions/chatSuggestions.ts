'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseTeamRole } from '@/lib/chat/precedence';
import { assertWritable, SUBSCRIPTION_INACTIVE } from '@/lib/subscriptionGuard';
import { readAssignees } from '@/lib/action-center/assignees';
import { readEntityCounts } from '@/lib/action-center/entityCounts';
import { ACTION_COLUMNS, actionItemFromRow, type ActionRow } from '@/lib/action-center/rows';
import { actionPages } from '@/lib/content/actionDrafts';
import { pageKey } from '@/lib/content/sources';
import type { ActionItem } from '@/lib/actions/actionCenter';
import {
  SNOOZE_DAYS,
  ZONE_ANSWERS,
  ZONE_DAYS,
  closedStatus,
  dayIn,
  feedsState,
  parseSuggestionSummary,
  roleFeed,
  sendingZone,
  shownSince,
  suggestionPick,
  suggestionStart,
  type DailySuggestion,
  type DailySuggestionsRead,
  type SuggestionPick,
  type SuggestionStart,
} from '@/lib/chat/dailySuggestions';

/**
 * Daily suggestions in Chat's Inbox (CHAT-26 §2.2, §2.4, §5, §6), behind
 * CHAT_AGENTIC. The person reads their own suggestions and feeds through
 * their session (00422's policies: their own, in the workspace they belong
 * to now). Every write is the server's (00422 grants members select only):
 * these write with the service role, each on the person's own rows only,
 * after the plan check, so a read-only workspace keeps its list and changes
 * nothing. Answers as values and never throws (#1777).
 *
 * Seeing a suggestion marks it seen, which is no use of it: only opening one
 * keeps the feed's last_used_at, which the nightly job's 30-day pause counts
 * from. Turning the feeds on or off only changes their status: the job's
 * "first one the next morning" reads the update's time (updated_at).
 *
 * Action Center access (§6) needs no check: it is on every menu (menu
 * access, 00374, ALWAYS_ON_SECTION), which a test in
 * lib/chat/dailySuggestions.test.ts keeps true.
 *
 * A suggestion's page (§2.3, W2-26) reads one suggestion with its action as
 * the Action Center lists it, and its uses (§5: opening, starting it in Chat
 * or the Content Editor, Not now, Remove) each keep the feed used.
 */

export type SuggestionsFailure = 'chat_off' | 'read_only' | 'not_allowed' | 'not_found' | 'failed';

export type SuggestionsReadResult =
  { ok: true; read: DailySuggestionsRead } | { ok: false; failure: 'chat_off' | 'failed' };

export type SuggestionsWriteResult = { ok: true } | { ok: false; failure: SuggestionsFailure };

export type SuggestionsStartResult =
  { ok: true; made: number } | { ok: false; failure: SuggestionsFailure };

/** What a suggestion's page shows (§2.3). */
export interface SuggestionDetail {
  suggestion: DailySuggestion;
  /** The action as the Action Center lists it now. */
  action: ActionItem;
  pick: SuggestionPick;
  /** Where "Content Editor" starts; null when the action has no writing to do. */
  start: SuggestionStart | null;
  /** When its pages were last audited (Site Audit, completed); null when none was. */
  auditedAt: string | null;
  /** The person's today as the job dates sent_on; null when it couldn't be read. */
  today: string | null;
}

export type SuggestionDetailResult =
  | { ok: true; detail: SuggestionDetail }
  | { ok: false; failure: 'chat_off' | 'not_found' | 'failed' };

/**
 * The suggestions a read lists at most, newest first: 7 a week per brand,
 * so 14 brands' worth. The read counts them all, and the Inbox says when
 * it shows fewer.
 */
const LIST_MAX = 100;

/** The brand's latest audits a page's last one is looked for in, as the server's recheck reads them. */
const AUDIT_ROWS = 500;

const DAY_MS = 86_400_000;

const idSchema = z.guid();
const idsSchema = z.array(z.guid()).min(1).max(LIST_MAX);

interface Person {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  orgId: string;
  role: ReturnType<typeof parseTeamRole>;
}

/** The signed-in person with the new Chat on for their workspace, or null. */
async function chatPerson(): Promise<Person | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id ?? null;
  if (!orgId || !chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id, orgId, role: parseTeamRole(profile?.role) };
}

/**
 * The person's today as the nightly job dates sent_on (sendingZone): read
 * with the service role, since the workspace's answers aren't all theirs to
 * read; only their zones and authors, and only the day leaves the server.
 * Null, logged, when it can't be read: no row says Today then.
 */
async function personToday(me: Person, now: Date): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select(
      'timezone, chat_conversations!chat_messages_conversation_id_fkey!inner(user_id, organization_id)',
    )
    .eq('chat_conversations.organization_id', me.orgId)
    .eq('role', 'assistant')
    .not('timezone', 'is', null)
    .gte('created_at', new Date(now.getTime() - ZONE_DAYS * DAY_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(ZONE_ANSWERS);
  if (error) {
    logFailure("read the person's time zone", error);
    return null;
  }
  const answers = ((data ?? []) as unknown as AnswerZoneRow[]).map((row) => ({
    userId: row.chat_conversations?.user_id ?? null,
    timezone: row.timezone,
  }));
  return dayIn(now, sendingZone(answers, me.userId));
}

interface AnswerZoneRow {
  timezone: string | null;
  chat_conversations: { user_id: string | null } | null;
}

/** The plan check's refusal as a result: read_only while the workspace is, else failed. */
function refusal(error: unknown): { ok: false; failure: SuggestionsFailure } {
  const code = (error as { code?: unknown } | null)?.code;
  return { ok: false, failure: code === SUBSCRIPTION_INACTIVE.code ? 'read_only' : 'failed' };
}

function logFailure(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  console.error(`[chat-suggestions] could not ${what}:`, message ?? error);
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  action_id: string;
  sent_on: string;
  sent_at: string;
  seen_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  started_via: string | null;
  summary: unknown;
  /** The action, through the person's session: one deleted (or out of reach) drops the row. */
  actions: { status: string | null } | null;
}

function toSuggestion(row: SuggestionRow): DailySuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    actionId: row.action_id,
    sentOn: row.sent_on,
    sentAt: row.sent_at,
    seenAt: row.seen_at,
    openedAt: row.opened_at,
    startedAt: row.started_at,
    startedVia: row.started_via === 'chat' || row.started_via === 'editor' ? row.started_via : null,
    closed: closedStatus(row.actions?.status),
    summary: parseSuggestionSummary(row.summary),
  };
}

/**
 * The person's daily suggestions for the Inbox: their feeds as one state and
 * the last 7 days' suggestions they haven't removed or put off (Not now,
 * until its day), newest first. A suggestion whose action was deleted
 * (deleted_at, which the person's session doesn't read) drops out; one done
 * or dismissed since stays, with that status. An Analyst gets none (§6),
 * and nothing is read for them.
 */
export async function readDailySuggestions(): Promise<SuggestionsReadResult> {
  try {
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    const feed = roleFeed(me.role);
    if (feed === 'never') {
      return {
        ok: true,
        read: { roleFeed: feed, state: 'none', suggestions: [], total: 0, today: null },
      };
    }
    const now = new Date();
    const at = now.toISOString();
    const [feeds, rows, today] = await Promise.all([
      me.client.from('chat_suggestion_feeds').select('status').eq('user_id', me.userId),
      me.client
        .from('chat_suggestions')
        .select(
          'id, brand_id, action_id, sent_on, sent_at, seen_at, opened_at, started_at, started_via, summary, actions!chat_suggestions_action_id_fkey!inner(status)',
          { count: 'exact' },
        )
        .eq('user_id', me.userId)
        .gt('sent_at', shownSince(now))
        .is('removed_at', null)
        .or(`snoozed_until.is.null,snoozed_until.lte."${at}"`)
        .order('sent_at', { ascending: false })
        .limit(LIST_MAX),
      personToday(me, now),
    ]);
    if (feeds.error || rows.error) {
      logFailure('read daily suggestions', feeds.error ?? rows.error);
      return { ok: false, failure: 'failed' };
    }
    const suggestions = ((rows.data ?? []) as unknown as SuggestionRow[]).map(toSuggestion);
    return {
      ok: true,
      read: {
        roleFeed: feed,
        state: feedsState((feeds.data ?? []).map((row) => row.status)),
        suggestions,
        total: Math.max(rows.count ?? 0, suggestions.length),
        today,
      },
    };
  } catch (error) {
    logFailure('read daily suggestions', error);
    return { ok: false, failure: 'failed' };
  }
}

interface DetailRow extends Omit<SuggestionRow, 'actions'> {
  actions: (ActionRow & { brand_id: string }) | null;
}

/**
 * One of the person's suggestions for its page (§2.3): not removed, its
 * action not deleted, read through their session; with the action as the
 * Action Center lists it now (its title's counts, assignee and task count),
 * the writing task "Content Editor" opens, its pages' last Site Audit and
 * the person's today. An Analyst has none.
 */
export async function readDailySuggestion(id: string): Promise<SuggestionDetailResult> {
  try {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, failure: 'not_found' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (roleFeed(me.role) === 'never') return { ok: false, failure: 'not_found' };
    const { data, error } = await me.client
      .from('chat_suggestions')
      .select(
        `id, brand_id, action_id, sent_on, sent_at, seen_at, opened_at, started_at, started_via, summary, actions!chat_suggestions_action_id_fkey!inner(brand_id, ${ACTION_COLUMNS})`,
      )
      .eq('id', parsed.data)
      .eq('user_id', me.userId)
      .is('removed_at', null)
      .maybeSingle();
    if (error) {
      logFailure('read a suggestion', error);
      return { ok: false, failure: 'failed' };
    }
    const row = data as unknown as DetailRow | null;
    if (!row?.actions) return { ok: false, failure: 'not_found' };
    const action = row.actions;
    const pages = actionPages(action.payload ?? {});
    const now = new Date();
    const [tasks, assignees, counts, audit, today] = await Promise.all([
      me.client
        .from('action_tasks')
        .select('id, task_key, status')
        .eq('action_id', action.id)
        .order('position'),
      readAssignees(me.client, row.brand_id, action.assignee_id ? [action.assignee_id] : []),
      readEntityCounts(me.client, [action.id]),
      pages.length > 0
        ? me.client
            .from('site_audits')
            .select('url, final_url, completed_at')
            .eq('brand_id', row.brand_id)
            .eq('status', 'completed')
            .order('completed_at', { ascending: false })
            .limit(AUDIT_ROWS)
        : Promise.resolve({ data: [], error: null }),
      personToday(me, now),
    ]);
    if (tasks.error || audit.error) {
      logFailure('read a suggestion', tasks.error ?? audit.error);
      return { ok: false, failure: 'failed' };
    }
    const taskRows = (tasks.data ?? []) as {
      id: string;
      task_key: string | null;
      status: string;
    }[];
    const item = actionItemFromRow(action, {
      assignee: action.assignee_id ? (assignees.get(action.assignee_id) ?? null) : null,
      taskTotal: taskRows.length,
      taskCompleted: taskRows.filter((task) => task.status === 'completed').length,
      signalCount: 0,
      entityCounts: counts.get(action.id),
    });
    // Its pages' latest audit, by the address asked for or ended at, each as
    // one page whatever its scheme, www or trailing slash (pageKey).
    const pageKeys = new Set(pages.map((page) => pageKey(page) ?? page));
    const auditedAt = (
      (audit.data ?? []) as { url: string; final_url: string | null; completed_at: string | null }[]
    ).find((done) =>
      [done.url, done.final_url].some((url) => url && pageKeys.has(pageKey(url) ?? url)),
    )?.completed_at;
    return {
      ok: true,
      detail: {
        suggestion: toSuggestion({ ...row, actions: { status: action.status } }),
        action: item,
        pick: suggestionPick(row.summary),
        start: suggestionStart(
          taskRows.map((task) => ({ id: task.id, taskKey: task.task_key, status: task.status })),
          item.payload,
        ),
        auditedAt: auditedAt ?? null,
        today,
      },
    };
  } catch (error) {
    logFailure('read a suggestion', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * Marks the suggestions the Inbox showed as seen: the person's own, not seen
 * before. Seeing isn't using: the feed is left alone.
 */
export async function markDailySuggestionsSeen(ids: string[]): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) return { ok: false, failure: 'not_found' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    const { error } = await supabaseAdmin
      .from('chat_suggestions')
      .update({ seen_at: new Date().toISOString() })
      .in('id', [...new Set(parsed.data)])
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .is('seen_at', null);
    if (error) {
      logFailure('mark suggestions seen', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    logFailure('mark suggestions seen', error);
    return { ok: false, failure: 'failed' };
  }
}

/** What a use reads of the suggestion before it writes. */
interface UseRow {
  id: string;
  brand_id: string;
  seen_at: string | null;
  opened_at: string | null;
  started_at: string | null;
}

/**
 * A use of one of the person's suggestions (§5): `change` written to it,
 * when it gives one, then its feed's last_used_at, which the nightly job's
 * 30-day pause counts from. `unless` names a stamp the change only fills,
 * never moves. Not one removed, or whose action was deleted: nothing to
 * use, and no use of the feed. Its callers check the plan first.
 */
async function recordUse(
  id: string,
  what: string,
  change: (
    row: UseRow,
    at: string,
  ) => { values: Record<string, string>; unless?: 'opened_at' | 'started_at' } | null,
): Promise<SuggestionsWriteResult> {
  try {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, failure: 'not_found' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    // Read through the person's session (their own, in a brand they can
    // see), and not one removed or whose action was deleted: nothing to use,
    // and no use of the feed.
    const { data: row, error: readError } = await me.client
      .from('chat_suggestions')
      .select(
        'id, brand_id, seen_at, opened_at, started_at, actions!chat_suggestions_action_id_fkey!inner(deleted_at)',
      )
      .eq('id', parsed.data)
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .is('removed_at', null)
      .is('actions.deleted_at', null)
      .maybeSingle();
    if (readError) {
      logFailure('read a suggestion', readError);
      return { ok: false, failure: 'failed' };
    }
    if (!row) return { ok: false, failure: 'not_found' };
    const at = new Date().toISOString();
    const write = change(row as UseRow, at);
    if (write) {
      let update = supabaseAdmin
        .from('chat_suggestions')
        .update(write.values)
        .eq('id', row.id)
        .eq('user_id', me.userId);
      if (write.unless) update = update.is(write.unless, null);
      const { error } = await update;
      if (error) {
        logFailure(what, error);
        return { ok: false, failure: 'failed' };
      }
    }
    const { error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .update({ last_used_at: at })
      .eq('user_id', me.userId)
      .eq('brand_id', row.brand_id);
    if (error) {
      logFailure('keep the feed used', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    logFailure(what, error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * The person opened a suggestion (§5: a use): its opened_at the first time
 * (and seen_at, when the Inbox hadn't marked it yet), and its feed's
 * last_used_at each time.
 */
export async function openDailySuggestion(id: string): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  return recordUse(id, 'mark a suggestion opened', (row, at) => {
    if (row.opened_at) return null;
    const values: Record<string, string> = { opened_at: at };
    if (!row.seen_at) values.seen_at = at;
    return { values, unless: 'opened_at' };
  });
}

/**
 * Not now (§2.3): off the Inbox for a week; the nightly job doesn't pick
 * its action again meanwhile, and it shows again then if its action is
 * still open.
 */
export async function snoozeDailySuggestion(id: string): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  return recordUse(id, 'put a suggestion off', (_row, at) => ({
    values: {
      snoozed_until: new Date(Date.parse(at) + SNOOZE_DAYS * DAY_MS).toISOString(),
    },
  }));
}

/** Remove this suggestion (§2.3, §4): gone from the Inbox at once; the action stays. */
export async function removeDailySuggestion(id: string): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  return recordUse(id, 'remove a suggestion', (_row, at) => ({ values: { removed_at: at } }));
}

/**
 * The person started it (§5): in Chat (Do it with Chat, or a message from
 * its page) or in the Content Editor. The first start is kept, with where.
 */
export async function startedDailySuggestion(
  id: string,
  via: 'chat' | 'editor',
): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  if (via !== 'chat' && via !== 'editor') return { ok: false, failure: 'not_allowed' };
  return recordUse(id, 'mark a suggestion started', (row, at) =>
    row.started_at ? null : { values: { started_at: at, started_via: via }, unless: 'started_at' },
  );
}

/**
 * The workspace's brands that get the person's suggestions: active, not the
 * demo brand (§6), and read through their session, so only the brands they
 * can see (brands: member select, which brand access narrows).
 */
async function suggestionBrands(me: Person): Promise<string[] | null> {
  const { data, error } = await me.client
    .from('brands')
    .select('id')
    .eq('organization_id', me.orgId)
    .eq('is_active', true)
    .eq('is_demo', false);
  if (error) {
    logFailure('read the brands', error);
    return null;
  }
  return ((data ?? []) as { id: string }[]).map((brand) => brand.id);
}

/**
 * Pause daily suggestions (off), or turn them back on (§2.4, §5): every one
 * of the person's feeds, a brand without one included, so the job doesn't
 * make an Admin's new feed on after a pause. Off is the person's own choice;
 * a feed the job paused comes back on only this way. The first suggestion
 * after turning them on comes the next morning (the job reads updated_at).
 */
export async function setDailySuggestions(on: boolean): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    if (typeof on !== 'boolean') return { ok: false, failure: 'not_allowed' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (roleFeed(me.role) === 'never') return { ok: false, failure: 'not_allowed' };
    const status = on ? 'on' : 'off';
    const { error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .update({ status, paused_at: null })
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .neq('status', status);
    if (error) {
      logFailure(`turn daily suggestions ${status}`, error);
      return { ok: false, failure: 'failed' };
    }
    const brands = await suggestionBrands(me);
    if (!brands) return { ok: false, failure: 'failed' };
    if (brands.length) {
      const { error: insertError } = await supabaseAdmin.from('chat_suggestion_feeds').upsert(
        brands.map((brandId) => ({
          user_id: me.userId,
          brand_id: brandId,
          organization_id: me.orgId,
          status,
        })),
        { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
      );
      if (insertError) {
        logFailure(`turn daily suggestions ${status}`, insertError);
        return { ok: false, failure: 'failed' };
      }
    }
    return { ok: true };
  } catch (error) {
    logFailure('turn daily suggestions on or off', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * An Agency partner's first Inbox (§6, DECISIONS V: "members" get them on
 * when they first open the Inbox): their feeds are made, on, for the
 * workspace's brands. Only while they have none: one they paused or turned
 * off stays so. Admins' and Managers' feeds are the nightly job's to make;
 * an Analyst gets none.
 */
export async function startDailySuggestions(): Promise<SuggestionsStartResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (roleFeed(me.role) !== 'opt_in') return { ok: false, failure: 'not_allowed' };
    const { data: feeds, error: readError } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .select('brand_id')
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .limit(1);
    if (readError) {
      logFailure('read the feeds', readError);
      return { ok: false, failure: 'failed' };
    }
    if ((feeds ?? []).length) return { ok: true, made: 0 };
    const brands = await suggestionBrands(me);
    if (!brands) return { ok: false, failure: 'failed' };
    if (!brands.length) return { ok: true, made: 0 };
    const { data: made, error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .upsert(
        brands.map((brandId) => ({
          user_id: me.userId,
          brand_id: brandId,
          organization_id: me.orgId,
          status: 'on',
        })),
        { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
      )
      .select('brand_id');
    if (error) {
      logFailure('start daily suggestions', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true, made: (made ?? []).length };
  } catch (error) {
    logFailure('start daily suggestions', error);
    return { ok: false, failure: 'failed' };
  }
}
