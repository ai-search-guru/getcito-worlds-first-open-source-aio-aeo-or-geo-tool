import { z } from 'zod';
import { canAccessBrand } from '@/lib/brandAccess';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { createClient } from '@/lib/supabase/server';
import type { ListDotState } from '@/components/agentic/ListDot';
import { stopChatRun, type ChatActor } from './engine';
import { originPageSchema } from './origin';
import { OPEN_RUN_STATUSES } from './engineStore';
import { maskIds } from './events';
import { startTouchedBrands } from './touchedBrands';
import { chatTrayState } from './runsTray';
import { CHAT_RUN_STEP_SELECT, toClientStep, type ChatRunStepMemberRow } from './steps';

/**
 * Chat's chats as the shell lists, opens and deletes them (CHAT-01 §1–3,
 * 7–8, 26; CHAT-20 §16c). Read as the person, through the chats' policies
 * (00400, 00407): their own and the ones shared with the team, never a
 * deleted one, and asked for by author or by workspace besides. Written by
 * the server (service role), as the rest of a chat is, after checking that
 * the chat is the person's. Server only.
 *
 * What leaves for the browser: a chat's handle for its routes (its id, as in
 * `/dashboard/chat/{id}`), its title, its brand's name, its state and the
 * step it is on in words. Never a person's or brand's id, a tool or a price.
 */

type Reader = Awaited<ReturnType<typeof createClient>>;

/** One row of the chat menu, All chats or the side panel's History. */
export interface ChatListItem {
  /** The chat's handle for its routes (`/dashboard/chat/{id}`, the API). */
  id: string;
  /** Null until Chat names it: the row shows "New chat". */
  title: string | null;
  /** The chat's brand, by name: the row's brand tag. */
  brand: string | null;
  pinned: boolean;
  archived: boolean;
  /** Shared with the team (Share with team). */
  shared: boolean;
  /** The person's own chat; a teammate's shared one is not. */
  mine: boolean;
  /** A teammate's shared chat: its author's initials ("SL"). */
  ownerInitials: string | null;
  /** The newest message, ISO: the order, and the day group. */
  lastMessageAt: string;
  /** An answer finished since the person last opened it: bold. */
  unread: boolean;
  /** The row's dot. */
  state: ListDotState;
  /** The step it is on, in words, while it works or waits; else null. */
  step: string | null;
  /** How far it is: steps done of steps so far, while it works or waits. */
  progress: { done: number; total: number } | null;
  /** When its newest run ended, ISO ("Done · 08:02"); null while it runs or with none. */
  finishedAt: string | null;
}

export interface ChatListResult {
  chats: ChatListItem[];
  /** Every chat the person sees that isn't archived ("Chats 148"). */
  total: number;
  /** Their own archived chats ("Archived · 2"). */
  archived: number;
}

/** Rows a list answers with at most. */
export const CHAT_LIST_MAX = 200;
/** Rows a list answers with when it isn't told. */
export const CHAT_LIST_DEFAULT = 100;

/**
 * How long a deleted chat can be brought back (the toast's Undo, CHAT-23
 * `chat.delete`: 10 s on screen), with room for a slow network. The sweep
 * removes it for good after.
 */
export const DELETED_CHAT_UNDO_MS = 60_000;

const CHAT_COLUMNS =
  'id, user_id, organization_id, brand_id, title, pinned_at, archived_at, shared_at, last_read_at, last_message_at';

interface ChatRow {
  id: string;
  user_id: string;
  organization_id: string;
  brand_id: string | null;
  title: string | null;
  pinned_at: string | null;
  archived_at: string | null;
  shared_at: string | null;
  last_read_at: string | null;
  last_message_at: string;
}

interface RunRow {
  id: string;
  conversation_id: string;
  status: string;
  created_at: string;
  finished_at: string | null;
}

export const listQuery = z.object({
  view: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(CHAT_LIST_MAX).default(CHAT_LIST_DEFAULT),
});
export type ListQuery = z.infer<typeof listQuery>;

export const createInput = z.object({
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid().optional(),
  origin: z.enum(['page', 'panel']).default('page'),
  /** The app page it started on: a path, never a full address. */
  originPage: originPageSchema.optional(),
});
export type CreateInput = z.infer<typeof createInput>;

/** Whether a run is still under way: working, waiting on the person or paused. */
const isOpen = (status: string) => (OPEN_RUN_STATUSES as readonly string[]).includes(status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A chat id from the path, or null. */
export const chatIdOf = (value: string) => (UUID.test(value) ? value : null);

/** "Sam Lee" → "SL"; one name → its first letter; none → null. */
export function initialsOf(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const letters = parts.length === 1 ? [parts[0][0]] : [parts[0][0], parts[parts.length - 1][0]];
  return letters.join('').toUpperCase();
}

/**
 * A chat's dot from its newest run: working, waiting on the person or paused
 * while the run is open; done or failed while that result is unread; idle
 * once it is read, or with no run.
 */
export function chatState(run: RunRow | null, unread: boolean): ListDotState {
  if (!run) return 'idle';
  const state = chatTrayState(run.status);
  if (state === 'running' || state === 'needsYou' || state === 'paused') return state;
  if (unread && (state === 'done' || state === 'failed')) return state;
  return 'idle';
}

/** Whether the run's result came after the person last opened the chat. */
function unreadOf(chat: ChatRow, run: RunRow | null, mine: boolean): boolean {
  if (!mine || !run?.finished_at) return false;
  if (!chatTrayState(run.status) || isOpen(run.status)) return false;
  if (!chat.last_read_at) return true;
  return Date.parse(run.finished_at) > Date.parse(chat.last_read_at);
}

/** The step a run is on in words, and how far it is; nothing for a run that ended. */
function stepOf(run: RunRow | null, rows: ChatRunStepMemberRow[]) {
  if (!run || !isOpen(run.status)) {
    return { step: null, progress: null };
  }
  const steps = rows
    .map(toClientStep)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.n - b.n);
  if (steps.length === 0) return { step: null, progress: null };
  const current =
    steps.find((s) => s.status === 'waiting') ??
    [...steps].reverse().find((s) => s.status === 'running') ??
    steps[steps.length - 1];
  const done = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  return { step: current.label, progress: { done, total: steps.length } };
}

/**
 * The rows for these chats: each one's brand name, newest run (its dot and
 * step) and, for a teammate's shared chat, the author's initials. Read as the
 * person; a read that fails throws.
 */
async function itemsOf(reader: Reader, actor: ChatActor, chats: ChatRow[]) {
  if (chats.length === 0) return [];
  const ids = chats.map((c) => c.id);
  const brandIds = [...new Set(chats.map((c) => c.brand_id).filter((id): id is string => !!id))];
  const ownerIds = [
    ...new Set(chats.filter((c) => c.user_id !== actor.userId).map((c) => c.user_id)),
  ];

  const [runs, brands, owners] = await Promise.all([
    reader
      .from('chat_runs')
      .select('id, conversation_id, status, created_at, finished_at')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(ids.length * 4),
    brandIds.length
      ? reader.from('brands').select('id, name').in('id', brandIds)
      : Promise.resolve({ data: [], error: null }),
    // A person reads only their own profile, so a teammate's name is read by
    // the server, within the workspace; only its initials leave.
    ownerIds.length
      ? supabaseAdmin
          .from('profiles')
          .select('id, full_name')
          .in('id', ownerIds)
          .eq('organization_id', actor.organizationId)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (runs.error) throw new Error(`Could not read the chats' runs: ${runs.error.message}`);
  if (brands.error) throw new Error(`Could not read the chats' brands: ${brands.error.message}`);
  if (owners.error) throw new Error(`Could not read the chats' authors: ${owners.error.message}`);

  // The newest run of each chat: runs come newest first.
  const newest = new Map<string, RunRow>();
  for (const run of (runs.data ?? []) as RunRow[]) {
    if (!newest.has(run.conversation_id)) newest.set(run.conversation_id, run);
  }
  const openRunIds = [...newest.values()].filter((run) => isOpen(run.status)).map((run) => run.id);
  const steps = openRunIds.length
    ? await reader
        .from('chat_run_steps')
        .select(CHAT_RUN_STEP_SELECT)
        .in('run_id', openRunIds)
        .order('position', { ascending: true })
    : { data: [], error: null };
  if (steps.error) throw new Error(`Could not read the chats' steps: ${steps.error.message}`);
  const stepsByRun = new Map<string, ChatRunStepMemberRow[]>();
  for (const row of (steps.data ?? []) as unknown as ChatRunStepMemberRow[]) {
    stepsByRun.set(row.run_id, [...(stepsByRun.get(row.run_id) ?? []), row]);
  }

  const brandName = new Map(
    ((brands.data ?? []) as { id: string; name: string | null }[]).map((b) => [b.id, b.name]),
  );
  const ownerName = new Map(
    ((owners.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  );

  return chats.map((chat): ChatListItem => {
    const mine = chat.user_id === actor.userId;
    const run = newest.get(chat.id) ?? null;
    const unread = unreadOf(chat, run, mine);
    const brand = chat.brand_id ? (brandName.get(chat.brand_id) ?? null) : null;
    return {
      id: chat.id,
      title: chat.title ? maskIds(chat.title) : null,
      brand: brand ? maskIds(brand) : null,
      // Pin and read are the author's: a teammate's shared chat shows neither.
      pinned: mine && chat.pinned_at !== null,
      archived: chat.archived_at !== null,
      shared: chat.shared_at !== null,
      mine,
      ownerInitials: mine ? null : initialsOf(ownerName.get(chat.user_id)),
      lastMessageAt: chat.last_message_at,
      unread,
      state: chatState(run, unread),
      ...stepOf(run, run ? (stepsByRun.get(run.id) ?? []) : []),
      finishedAt: run && !isOpen(run.status) ? run.finished_at : null,
    };
  });
}

/**
 * The person's chats for the menu (`active`: not archived, their own and the
 * team's shared ones) or All chats › Archived (`archived`: their own), newest
 * first, with the counts beside the menu's titles.
 */
export async function listChats(
  reader: Reader,
  actor: ChatActor,
  query: ListQuery,
): Promise<ChatListResult> {
  const own = () =>
    reader
      .from('chat_conversations')
      .select(CHAT_COLUMNS)
      .eq('user_id', actor.userId)
      .eq('organization_id', actor.organizationId)
      .is('deleted_at', null);
  const team = () =>
    reader
      .from('chat_conversations')
      .select(CHAT_COLUMNS)
      .neq('user_id', actor.userId)
      .eq('organization_id', actor.organizationId)
      .not('shared_at', 'is', null)
      .is('deleted_at', null)
      .is('archived_at', null);
  const count = (shared: boolean, archived: boolean) => {
    let q = reader
      .from('chat_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', actor.organizationId)
      .is('deleted_at', null);
    q = shared
      ? q.neq('user_id', actor.userId).not('shared_at', 'is', null)
      : q.eq('user_id', actor.userId);
    return archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  };

  const [mine, theirs, ownActive, teamActive, ownArchived] = await Promise.all([
    query.view === 'archived'
      ? own()
          .not('archived_at', 'is', null)
          .order('last_message_at', { ascending: false })
          .limit(query.limit)
      : own()
          .is('archived_at', null)
          .order('last_message_at', { ascending: false })
          .limit(query.limit),
    query.view === 'archived'
      ? Promise.resolve({ data: [], error: null })
      : team().order('last_message_at', { ascending: false }).limit(query.limit),
    count(false, false),
    count(true, false),
    count(false, true),
  ]);
  for (const read of [mine, theirs, ownActive, teamActive, ownArchived]) {
    if (read.error) throw new Error(`Could not read the chats: ${read.error.message}`);
  }

  const rows = [...((mine.data ?? []) as ChatRow[]), ...((theirs.data ?? []) as ChatRow[])]
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))
    .slice(0, query.limit);
  return {
    chats: await itemsOf(reader, actor, rows),
    total: (ownActive.count ?? 0) + (teamActive.count ?? 0),
    archived: ownArchived.count ?? 0,
  };
}

/** Search answers with this many chats at most. */
export const CHAT_SEARCH_MAX = 50;
/** Messages a search looks through for their chats, newest first. */
const SEARCH_MESSAGES_MAX = 200;

export const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  view: z.enum(['active', 'archived']).default('active'),
  limit: z.coerce.number().int().min(1).max(CHAT_SEARCH_MAX).default(20),
});
export type SearchQuery = z.infer<typeof searchQuery>;

/**
 * What the person typed as a full-text query over the search columns
 * (00407: the 'simple' configuration, any language): each space-separated
 * word as a quoted prefix ("citat" finds "citations"), all of them
 * required. Quoted, Postgres splits a word the way it split the text, so
 * "nike.com", "4.5" or an email address — one token in the text — is found
 * whole, and lowercases it itself ("İstanbul"). A quote is doubled and a
 * backslash dropped, so the person's own operators never reach Postgres as
 * operators. Null when no word has a letter or digit.
 */
export function searchTermsOf(text: string): string | null {
  const words = text
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, 8);
  return words.length
    ? words.map((word) => `'${word.replace(/\\/g, ' ').replace(/'/g, "''")}':*`).join(' & ')
    : null;
}

/**
 * Search chats and the Ctrl K palette (CHAT-01 item 6; CHAT-23 G2,
 * `chatMenu.searchChats`, `allChats.search`): the chats whose title or any
 * message has every word typed, newest first. `active`: the person's own
 * and the team's shared chats that aren't archived (an archived chat is out
 * of search, as it is out of Chats); `archived`: their own archived ones,
 * for All chats › Archived. Read as the person, so the chats' policies hold.
 */
export async function searchChats(
  reader: Reader,
  actor: ChatActor,
  query: SearchQuery,
): Promise<ChatListItem[]> {
  const terms = searchTermsOf(query.q);
  if (!terms) return [];
  const archived = query.view === 'archived';
  const chats = () => {
    const q = reader
      .from('chat_conversations')
      .select(CHAT_COLUMNS)
      .eq('organization_id', actor.organizationId)
      .is('deleted_at', null);
    return archived ? q.not('archived_at', 'is', null) : q.is('archived_at', null);
  };

  const [byTitle, byMessage] = await Promise.all([
    chats()
      .textSearch('search_tsv', terms, { config: 'simple' })
      .order('last_message_at', { ascending: false })
      .limit(query.limit),
    reader
      .from('chat_messages')
      .select('conversation_id')
      .textSearch('search_tsv', terms, { config: 'simple' })
      .order('created_at', { ascending: false })
      .limit(SEARCH_MESSAGES_MAX),
  ]);
  if (byTitle.error) throw new Error(`Could not search the chats: ${byTitle.error.message}`);
  if (byMessage.error) throw new Error(`Could not search the messages: ${byMessage.error.message}`);

  const titled = (byTitle.data ?? []) as ChatRow[];
  const found = new Set(titled.map((c) => c.id));
  const others = [
    ...new Set(
      ((byMessage.data ?? []) as { conversation_id: string }[])
        .map((m) => m.conversation_id)
        .filter((id) => !found.has(id)),
    ),
  ];
  const messaged = others.length ? await chats().in('id', others) : { data: [], error: null };
  if (messaged.error) throw new Error(`Could not search the chats: ${messaged.error.message}`);

  const rows = [...titled, ...((messaged.data ?? []) as ChatRow[])]
    // Belt and braces over the policies: their own, or (not archived) shared with the team.
    .filter((c) =>
      archived ? c.user_id === actor.userId : c.user_id === actor.userId || c.shared_at !== null,
    )
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))
    .slice(0, query.limit);
  return itemsOf(reader, actor, rows);
}

/** One chat's row, as the person reads it; null when it isn't theirs to read or is gone. */
export async function readChat(
  reader: Reader,
  actor: ChatActor,
  chatId: string,
): Promise<ChatListItem | null> {
  const { data, error } = await reader
    .from('chat_conversations')
    .select(CHAT_COLUMNS)
    .eq('id', chatId)
    .eq('organization_id', actor.organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  const chat = data as ChatRow | null;
  if (!chat) return null;
  // Belt and braces over the policies: the person's own, or shared with the team.
  if (chat.user_id !== actor.userId && chat.shared_at === null) return null;
  const [item] = await itemsOf(reader, actor, [chat]);
  return item ?? null;
}

export type ChatWriteResult = { ok: true } | { ok: false; reason: 'not_found' | 'expired' };

/**
 * A change from a chat's ⋯ menu (CHAT-01 row menu; CHAT-23 G9): Pin or
 * Unpin, Rename, Share with team or Stop sharing, Archive or Unarchive. At
 * least one; a title is trimmed, 1 to 200 characters.
 */
export const updateInput = z
  .object({
    pinned: z.boolean().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    shared: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
export type UpdateInput = z.infer<typeof updateInput>;

/**
 * A new, empty chat (the side panel's New chat, CHAT-01 item 23; the full
 * page makes one on the first message instead). Its brand must be the
 * workspace's, and one the person may use (BRAND-ACCESS). Untitled until
 * Chat names it. It keeps the brands it touches from the start (00436).
 */
export async function createChat(
  reader: Reader,
  actor: ChatActor,
  input: CreateInput,
): Promise<ChatListItem | null> {
  if (input.brandId && !(await canAccessBrand(actor.userId, input.brandId, actor.organizationId))) {
    return null;
  }
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .insert({
      organization_id: actor.organizationId,
      user_id: actor.userId,
      brand_id: input.brandId ?? null,
      origin: input.origin,
      origin_page: input.originPage ?? (input.origin === 'page' ? '/dashboard/chat' : null),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Could not start a chat: ${error?.message ?? 'no row'}`);
  const id = (data as { id: string }).id;
  await startTouchedBrands(id);
  return readChat(reader, actor, id);
}

/** The chat as the server reads it (service role), not deleted; null when missing. */
async function ownedChat(actor: ChatActor, chatId: string) {
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, user_id, organization_id, shared_at, deleted_at')
    .eq('id', chatId)
    .eq('organization_id', actor.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  return data as {
    id: string;
    user_id: string;
    organization_id: string;
    shared_at: string | null;
    deleted_at: string | null;
  } | null;
}

/** Whether the person is an Admin of their workspace. */
async function isAdmin(actor: ChatActor): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role, organization_id')
    .eq('id', actor.userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the role: ${error.message}`);
  const row = data as { role: string | null; organization_id: string | null } | null;
  return row?.role === 'admin' && row.organization_id === actor.organizationId;
}

/**
 * Pin, Rename, Share with team and Archive, and their reverses (CHAT-23
 * `chat.pin`, `chat.rename`, `chat.share`, `chat.archive`): the author's
 * own chat only. Answers the chat's new row; null when it isn't theirs.
 */
export async function updateChat(
  reader: Reader,
  actor: ChatActor,
  chatId: string,
  patch: UpdateInput,
  now = new Date(),
): Promise<ChatListItem | null> {
  const chat = await ownedChat(actor, chatId);
  if (!chat || chat.deleted_at !== null || chat.user_id !== actor.userId) return null;
  const at = now.toISOString();
  const row: Record<string, string | null> = {};
  if (patch.pinned !== undefined) row.pinned_at = patch.pinned ? at : null;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.shared !== undefined) row.shared_at = patch.shared ? at : null;
  if (patch.archived !== undefined) row.archived_at = patch.archived ? at : null;
  const { error } = await supabaseAdmin
    .from('chat_conversations')
    .update(row)
    .eq('id', chatId)
    .eq('user_id', actor.userId)
    .is('deleted_at', null);
  if (error) throw new Error(`Could not change the chat: ${error.message}`);
  return readChat(reader, actor, chatId);
}

/**
 * Delete (CHAT-01 row menu; CHAT-23 `chat.delete`): the author, or an Admin
 * for a chat shared with the team. A running agent is stopped first; then
 * the chat is gone for every member at once (deleted_at), its files stay in
 * Files, and Undo can bring it back for DELETED_CHAT_UNDO_MS.
 */
export async function deleteChat(actor: ChatActor, chatId: string): Promise<ChatWriteResult> {
  const chat = await ownedChat(actor, chatId);
  if (!chat || chat.deleted_at !== null) return { ok: false, reason: 'not_found' };
  const mine = chat.user_id === actor.userId;
  if (!mine && !(chat.shared_at !== null && (await isAdmin(actor)))) {
    return { ok: false, reason: 'not_found' };
  }

  const { data: open, error: runsError } = await supabaseAdmin
    .from('chat_runs')
    .select('id')
    .eq('conversation_id', chatId)
    .in('status', [...OPEN_RUN_STATUSES]);
  if (runsError) throw new Error(`Could not read the chat's runs: ${runsError.message}`);
  // A run is its author's: stopped as them, whoever deletes the chat.
  const author: ChatActor = {
    userId: chat.user_id,
    email: null,
    organizationId: chat.organization_id,
  };
  for (const run of (open ?? []) as { id: string }[]) {
    await stopChatRun(author, run.id);
  }

  const { error } = await supabaseAdmin
    .from('chat_conversations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', chatId)
    .is('deleted_at', null);
  if (error) throw new Error(`Could not delete the chat: ${error.message}`);
  return { ok: true };
}

/** Undo after Delete: the chat comes back as it was, within DELETED_CHAT_UNDO_MS. */
export async function restoreChat(
  actor: ChatActor,
  chatId: string,
  now = Date.now(),
): Promise<ChatWriteResult> {
  const chat = await ownedChat(actor, chatId);
  if (!chat || chat.deleted_at === null) return { ok: false, reason: 'not_found' };
  const mine = chat.user_id === actor.userId;
  if (!mine && !(chat.shared_at !== null && (await isAdmin(actor)))) {
    return { ok: false, reason: 'not_found' };
  }
  if (now - Date.parse(chat.deleted_at) > DELETED_CHAT_UNDO_MS) {
    return { ok: false, reason: 'expired' };
  }
  const { error } = await supabaseAdmin
    .from('chat_conversations')
    .update({ deleted_at: null })
    .eq('id', chatId);
  if (error) throw new Error(`Could not restore the chat: ${error.message}`);
  return { ok: true };
}

/**
 * The author opened the chat's newest answer: its result is read, so the
 * chat leaves Agents at work and isn't bold any more. Another person's
 * shared chat stays as its author left it.
 */
export async function markChatRead(
  actor: ChatActor,
  chatId: string,
  now = new Date(),
): Promise<ChatWriteResult> {
  const chat = await ownedChat(actor, chatId);
  if (!chat || chat.deleted_at !== null) return { ok: false, reason: 'not_found' };
  if (chat.user_id !== actor.userId) {
    return chat.shared_at !== null ? { ok: true } : { ok: false, reason: 'not_found' };
  }
  const { error } = await supabaseAdmin
    .from('chat_conversations')
    .update({ last_read_at: now.toISOString() })
    .eq('id', chatId)
    .eq('user_id', actor.userId);
  if (error) throw new Error(`Could not mark the chat read: ${error.message}`);
  return { ok: true };
}

/**
 * Removes for good the chats deleted longer ago than their Undo (CHAT-20
 * §16c: a hard delete after Undo), their messages, runs and steps with them;
 * Activity log rows stay. For a scheduled job (wired later); safe to run at
 * any time, and twice. Answers how many it removed.
 */
export async function sweepDeletedChats(now = Date.now()): Promise<number> {
  const before = new Date(now - DELETED_CHAT_UNDO_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_conversations')
    .delete()
    .lt('deleted_at', before)
    .select('id');
  if (error) throw new Error(`Could not sweep deleted chats: ${error.message}`);
  return ((data ?? []) as unknown[]).length;
}
