import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import type { TeamRole } from '@/components/context/RoleProvider';
import { readBrandAccess } from '@/lib/brandAccess';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  MEMORY_REQUEST_KIND,
  MEMORY_REQUEST_TOOL_KEY,
  sendAccessRequest,
} from '../accessRequestStore';
import type { StepWrite } from '../engineStore';
import { chatAgenticEnabled } from '../flag';
import { firstNameOf } from '../home';
import { planFactsFromOrgRow, type PlanFacts } from '../planFacts';
import { parseTeamRole } from '../precedence';
import {
  MAX_MEMORY_LINE,
  MAX_MEMORY_SCOPE,
  MEMORY_SCOPES,
  MEMORY_UNDO_MS,
  fitMemory,
  memoryBlock,
  memoryRight,
  memoryTextProblem,
  normalizeMemoryText,
  type MemoryLine,
  type MemoryScope,
  type MemorySource,
} from './rules';

/**
 * Chat's memory (CHAT-14; Chat Wave 3 W3-11), in chat_memory_items
 * (00459), behind CHAT_AGENTIC:
 *
 *   - Reading: a run carries the person's Me lines, its brand's and the
 *     workspace's (item 2), while the workspace's switch and the person's
 *     "Use memory" are both on (item 24, both on by default). A scheduled
 *     run is its creator's, on its job's brand, so it gets theirs (item 16).
 *   - Saving: only by a click (item 10): Chat's save_memory card, or the
 *     Memory page. Every save and edit is checked here (rules.ts: the text,
 *     who may change the scope, the 4,000 a scope); a Manager's line for the
 *     workspace becomes a request to the Admins (item 25).
 *   - Deleting: at once, with Undo for 10 seconds (item 23); the minute
 *     tick deletes the row for good after that (purgeDeletedMemory). A
 *     deleted "Call me" line stays as a mark, so the profile doesn't bring
 *     it back.
 *   - "Call me {first name}" comes from the profile (item 4), until the
 *     person edits or deletes it.
 *
 * Every write is the server's (service role), after these checks; members
 * only read the table (00459's RLS). A refusal is a value (#1777), in words
 * Chat and the page say. Server only.
 */

const memoryT = createTranslator({ locale: 'en', messages, namespace: 'chatMemory' });
const stepT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.step' });

// ─── Who is asking ──────────────────────────────────────────────────────────

/** The person a memory change is for: their role, plan and brands. */
export interface MemoryViewer {
  userId: string;
  organizationId: string;
  role: TeamRole;
  plan: PlanFacts;
  brandAccess: 'all' | readonly string[];
}

/** The person's role, plan and brands; null when they aren't in the workspace now. */
export async function readMemoryViewer(actor: {
  userId: string;
  organizationId: string;
}): Promise<MemoryViewer | null> {
  const [profile, org, brandAccess] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('role, organization_id')
      .eq('id', actor.userId)
      .maybeSingle(),
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', actor.organizationId)
      .maybeSingle(),
    // Not a member reads as no brands (lib/brandAccess.ts).
    readBrandAccess(actor.userId, actor.organizationId).then((access) => access ?? []),
  ]);
  for (const read of [profile, org]) {
    if (read.error) throw new Error(`Could not read the memory's facts: ${read.error.message}`);
  }
  const role = parseTeamRole(profile.data?.role);
  if (!role || profile.data?.organization_id !== actor.organizationId || !org.data) return null;
  return {
    userId: actor.userId,
    organizationId: actor.organizationId,
    role,
    plan: planFactsFromOrgRow(org.data),
    brandAccess,
  };
}

const brandAllowed = (viewer: Pick<MemoryViewer, 'brandAccess'>, brandId: string) =>
  viewer.brandAccess === 'all' || viewer.brandAccess.includes(brandId);

/** The workspace's switch (an Admin's) and the person's "Use memory" (item 24). */
export interface MemorySwitches {
  workspace: boolean;
  personal: boolean;
}

/** Both switches; a missing row is on (00459's defaults, Wave 3 decision 1). */
export async function readMemorySwitches(
  organizationId: string,
  userId: string,
): Promise<MemorySwitches> {
  const [workspace, personal] = await Promise.all([
    supabaseAdmin
      .from('chat_settings')
      .select('memory_enabled')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_user_prefs')
      .select('memory_enabled')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  for (const read of [workspace, personal]) {
    if (read.error) throw new Error(`Could not read the memory switches: ${read.error.message}`);
  }
  return {
    workspace: (workspace.data as { memory_enabled?: boolean } | null)?.memory_enabled ?? true,
    personal: (personal.data as { memory_enabled?: boolean } | null)?.memory_enabled ?? true,
  };
}

// ─── Refusals ───────────────────────────────────────────────────────────────

export type MemoryRefusalCode =
  | 'invalid'
  | 'too_long'
  | 'blocked'
  | 'rules'
  | 'full'
  | 'off'
  | 'workspace_off'
  | 'role_brand'
  | 'role_workspace'
  | 'role_switch'
  | 'no_brand'
  | 'not_found'
  | 'undo_expired'
  | 'read_only'
  | 'request_limit'
  | 'requester'
  | 'failed';

const REFUSAL_STATUS: Record<MemoryRefusalCode, number> = {
  invalid: 400,
  too_long: 400,
  blocked: 400,
  rules: 400,
  full: 409,
  off: 409,
  workspace_off: 409,
  role_brand: 403,
  role_workspace: 403,
  role_switch: 403,
  no_brand: 400,
  not_found: 404,
  undo_expired: 409,
  read_only: 402,
  request_limit: 429,
  requester: 403,
  failed: 500,
};

export interface MemoryRefusal {
  code: MemoryRefusalCode;
  status: number;
  /** In words, for the person (and for Chat, which says it). */
  message: string;
}

/** A refusal is a value (#1777), never a thrown error. */
export type MemoryResult<T> = { ok: true; value: T } | { ok: false; refusal: MemoryRefusal };

export function memoryRefusal(code: MemoryRefusalCode): { ok: false; refusal: MemoryRefusal } {
  return {
    ok: false,
    refusal: {
      code,
      status: REFUSAL_STATUS[code],
      message: memoryT(`refusal.${code}`, { line: MAX_MEMORY_LINE }),
    },
  };
}

/**
 * A refusal as Chat's engine reads a change's answer: `{ ok: false, reason,
 * message }`, reason one of its §11a codes (engine.ts SAID_FAILURES), so
 * the step shows the words and the model says them.
 */
export function saidRefusal(refusal: MemoryRefusal) {
  const reason =
    refusal.code === 'role_brand' ||
    refusal.code === 'role_workspace' ||
    refusal.code === 'role_switch'
      ? 'forbidden_role'
      : refusal.code === 'not_found' || refusal.code === 'undo_expired'
        ? 'not_found'
        : refusal.code === 'full'
          ? 'quota_exceeded'
          : refusal.code === 'off' ||
              refusal.code === 'workspace_off' ||
              refusal.code === 'request_limit' ||
              refusal.code === 'read_only' ||
              refusal.code === 'failed'
            ? 'conflict'
            : 'invalid';
  return { ok: false as const, reason, message: refusal.message };
}

/** A line's problem as its refusal (item 12: one line for secrets and personal data). */
function textRefusal(text: string): { ok: false; refusal: MemoryRefusal } | null {
  const problem = memoryTextProblem(text);
  if (!problem) return null;
  if (problem === 'empty') return memoryRefusal('invalid');
  if (problem === 'too_long') return memoryRefusal('too_long');
  return memoryRefusal(problem === 'rules' ? 'rules' : 'blocked');
}

/** Who may change a scope, as a refusal when they may not. */
const roleRefusal = (scope: MemoryScope) =>
  memoryRefusal(scope === 'workspace' ? 'role_workspace' : 'role_brand');

// ─── Rows ───────────────────────────────────────────────────────────────────

const COLUMNS =
  'id, organization_id, scope, user_id, brand_id, text, source, edited, created_by, created_at, updated_at, deleted_at';

interface ItemRow {
  id: string;
  organization_id: string;
  scope: string;
  user_id: string | null;
  brand_id: string | null;
  text: string;
  source: string;
  edited: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

const scopeOf = (row: Pick<ItemRow, 'scope'>): MemoryScope =>
  MEMORY_SCOPES.find((scope) => scope === row.scope) ?? 'workspace';
const sourceOf = (row: Pick<ItemRow, 'source'>): MemorySource =>
  row.source === 'profile' || row.source === 'page' ? row.source : 'chat';

/** Where a scope's lines are: a person's Me, a brand's, the workspace's. */
type ScopeKey =
  { scope: 'user'; userId: string } | { scope: 'brand'; brandId: string } | { scope: 'workspace' };

/** A scope's live lines, oldest first. */
async function scopeRows(organizationId: string, key: ScopeKey): Promise<ItemRow[]> {
  let query = supabaseAdmin
    .from('chat_memory_items')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('scope', key.scope)
    .is('deleted_at', null);
  if (key.scope === 'user') query = query.eq('user_id', key.userId);
  if (key.scope === 'brand') query = query.eq('brand_id', key.brandId);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read the memory: ${error.message}`);
  return (data ?? []) as ItemRow[];
}

const usedBy = (rows: readonly Pick<ItemRow, 'text'>[]) =>
  rows.reduce((sum, row) => sum + row.text.length, 0);

/** A line's scope as a key. */
function keyOf(row: ItemRow): ScopeKey {
  const scope = scopeOf(row);
  if (scope === 'user') return { scope, userId: row.user_id ?? '' };
  if (scope === 'brand') return { scope, brandId: row.brand_id ?? '' };
  return { scope };
}

/** A brand of the workspace the person may use, with its name; null otherwise. */
async function readBrand(
  viewer: Pick<MemoryViewer, 'organizationId' | 'brandAccess'>,
  brandId: string,
): Promise<{ id: string; name: string } | null> {
  if (!brandAllowed(viewer, brandId)) return null;
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .eq('organization_id', viewer.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the brand: ${error.message}`);
  const brand = data as { id: string; name: string } | null;
  return brand ? { id: brand.id, name: brand.name } : null;
}

/**
 * A line the person sees (00459's RLS): their own Me line, a line of a
 * brand they may use, or the workspace's. `deleted`: a line deleted while
 * its Undo is open, for Undo only.
 */
async function readVisible(
  viewer: MemoryViewer,
  id: string,
  { deleted = false }: { deleted?: boolean } = {},
): Promise<ItemRow | null> {
  let query = supabaseAdmin
    .from('chat_memory_items')
    .select(COLUMNS)
    .eq('id', id)
    .eq('organization_id', viewer.organizationId);
  query = deleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read the memory: ${error.message}`);
  const row = data as ItemRow | null;
  if (!row) return null;
  const scope = scopeOf(row);
  if (scope === 'user' && row.user_id !== viewer.userId) return null;
  if (scope === 'brand' && (!row.brand_id || !brandAllowed(viewer, row.brand_id))) return null;
  return row;
}

/** The trigger's own refusal: the scope would pass 4,000 characters (00459). */
const isFull = (error: { code?: string } | null) => error?.code === '23514';

// ─── "Call me {first name}" ─────────────────────────────────────────────────

/** The profile's line for a first name. */
export const profileLineText = (firstName: string) => `Call me ${firstName}`;

/**
 * Keeps the person's "Call me {first name}" in step with their profile
 * (item 4): added once, renamed with the profile, and left alone once they
 * edited or deleted it. Never throws: a run goes on without it.
 */
export async function syncProfileLine(userId: string, organizationId: string): Promise<void> {
  try {
    const [profile, rows] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('full_name, organization_id')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('chat_memory_items')
        .select('id, text, edited, deleted_at')
        .eq('organization_id', organizationId)
        .eq('user_id', userId)
        .eq('source', 'profile'),
    ]);
    if (profile.error) throw new Error(profile.error.message);
    if (rows.error) throw new Error(rows.error.message);
    const person = profile.data as { full_name: string | null; organization_id: string } | null;
    if (person?.organization_id !== organizationId) return;
    const first = firstNameOf(person.full_name);
    const text = first ? profileLineText(first) : null;
    if (!text || memoryTextProblem(text)) return;
    const lines = (rows.data ?? []) as Pick<ItemRow, 'id' | 'text' | 'edited' | 'deleted_at'>[];
    const live = lines.find((line) => !line.deleted_at);
    if (!live) {
      // Deleted by the person: it stays deleted.
      if (lines.length > 0) return;
      const { error } = await supabaseAdmin.from('chat_memory_items').insert({
        organization_id: organizationId,
        scope: 'user',
        user_id: userId,
        text,
        source: 'profile',
        source_ref: 'profile.full_name',
        created_by: userId,
      });
      // Another request added it first (one a person), or Me is full.
      if (error && error.code !== '23505' && !isFull(error)) throw new Error(error.message);
      return;
    }
    if (live.edited || live.text === text) return;
    const { error } = await supabaseAdmin
      .from('chat_memory_items')
      .update({ text })
      .eq('id', live.id)
      .eq('edited', false);
    if (error && !isFull(error)) throw new Error(error.message);
  } catch (err) {
    console.error('[chat/memory] could not sync the profile line:', err);
  }
}

// ─── A run's memory ─────────────────────────────────────────────────────────

/** What a run carries: its lines, and the prompt's block of them (null: none). */
export interface RunMemory {
  lines: MemoryLine[];
  block: string | null;
}

export const NO_MEMORY: RunMemory = { lines: [], block: null };

const lineOf = (row: ItemRow): MemoryLine => ({
  id: row.id,
  scope: scopeOf(row),
  text: row.text,
  source: sourceOf(row),
});

/**
 * The memory a run of the person carries (items 2, 14, 16, 19): their Me
 * lines, the chat's brand's (a brand they may use) and the workspace's,
 * within 12,000 characters, and its block. None while the new Chat or
 * either switch is off. Never throws: a read that fails leaves memory out
 * of the run, which goes on.
 */
export async function runMemory(
  actor: { userId: string; organizationId: string },
  brand: { id: string; name: string } | null,
): Promise<RunMemory> {
  try {
    return await readRunMemory(actor, brand);
  } catch (err) {
    console.error('[chat/memory] could not read the memory for a run:', err);
    return NO_MEMORY;
  }
}

async function readRunMemory(
  actor: { userId: string; organizationId: string },
  brand: { id: string; name: string } | null,
): Promise<RunMemory> {
  if (!chatAgenticEnabled(actor.organizationId)) return NO_MEMORY;
  const switches = await readMemorySwitches(actor.organizationId, actor.userId);
  if (!switches.workspace || !switches.personal) return NO_MEMORY;
  await syncProfileLine(actor.userId, actor.organizationId);
  const access = brand
    ? ((await readBrandAccess(actor.userId, actor.organizationId)) ?? [])
    : 'all';
  const withBrand = brand && (access === 'all' || access.includes(brand.id)) ? brand : null;
  const [me, ofBrand, workspace] = await Promise.all([
    scopeRows(actor.organizationId, { scope: 'user', userId: actor.userId }),
    withBrand
      ? scopeRows(actor.organizationId, { scope: 'brand', brandId: withBrand.id })
      : Promise.resolve([]),
    scopeRows(actor.organizationId, { scope: 'workspace' }),
  ]);
  const lines = fitMemory([...me, ...ofBrand, ...workspace].map(lineOf));
  return { lines, block: memoryBlock(lines, withBrand?.name ?? null) };
}

/** The tool name a memory step is kept under (staff only, CHAT-03 item 22). */
export const MEMORY_STEP_TOOL = 'read_memory';

/**
 * The "Used memory" step (CHAT-03, CHAT-14 item 17): a read of its lines,
 * counted in items ("Memory · 3 items"). The lines themselves stay in its
 * debug, for staff only: a step is seen by everyone a chat is shared with,
 * and a Me line is its person's alone. `subject` is its Data used chip.
 */
export function memoryStep(lines: readonly MemoryLine[]): {
  subject: string;
  write: Omit<StepWrite, 'position'>;
} {
  const subject = stepT('memorySubject');
  return {
    subject,
    write: {
      kind: 'read',
      status: 'done',
      label: stepT('usedMemory'),
      detail: null,
      scope: { subject, unit: 'items' },
      rowCount: lines.length,
      tool: MEMORY_STEP_TOOL,
      debug: {
        memory: lines.map((line) => ({ id: line.id, scope: line.scope, text: line.text })),
      },
    },
  };
}

// ─── The list (/api/chat/memory) ────────────────────────────────────────────

export interface MemoryItemView {
  id: string;
  scope: MemoryScope;
  text: string;
  source: MemorySource;
  updatedAt: string;
  can: { edit: boolean; remove: boolean };
}

export interface MemoryList {
  switches: MemorySwitches;
  /** The person may turn the workspace's switch: an Admin. */
  canSwitchWorkspace: boolean;
  /** The brand the Brand tab is about; null when none was asked for or it isn't theirs. */
  brand: { id: string; name: string } | null;
  items: Record<MemoryScope, MemoryItemView[]>;
  /** Characters used a scope, against MAX_MEMORY_SCOPE. */
  used: Record<MemoryScope, number>;
  /** What the person may do in each scope: edit, ask the Admins, or only read. */
  rights: Record<MemoryScope, 'edit' | 'request' | null>;
  limits: { line: number; scope: number };
}

/**
 * The Memory page's lines (items 21–25): the person's Me, a brand's (one
 * they may use) and the workspace's, with what they may do with each.
 * With the workspace's switch off only an Admin sees them (item 24).
 */
export async function listMemory(
  viewer: MemoryViewer,
  brandId: string | null,
): Promise<MemoryList> {
  const [switches, brand] = await Promise.all([
    readMemorySwitches(viewer.organizationId, viewer.userId),
    brandId ? readBrand(viewer, brandId) : Promise.resolve(null),
  ]);
  const rights: MemoryList['rights'] = {
    user: memoryRight(viewer.role, 'user'),
    brand: brand ? memoryRight(viewer.role, 'brand') : null,
    workspace: memoryRight(viewer.role, 'workspace'),
  };
  const writable = viewer.plan.writable;
  const shown = switches.workspace || viewer.role === 'admin';
  if (shown) await syncProfileLine(viewer.userId, viewer.organizationId);
  const [me, ofBrand, workspace] = shown
    ? await Promise.all([
        scopeRows(viewer.organizationId, { scope: 'user', userId: viewer.userId }),
        brand
          ? scopeRows(viewer.organizationId, { scope: 'brand', brandId: brand.id })
          : Promise.resolve([]),
        scopeRows(viewer.organizationId, { scope: 'workspace' }),
      ])
    : [[], [], []];
  const view = (row: ItemRow): MemoryItemView => {
    const scope = scopeOf(row);
    const may = rights[scope] === 'edit';
    return {
      id: row.id,
      scope,
      text: row.text,
      source: sourceOf(row),
      updatedAt: row.updated_at,
      // A person's own Me line can be deleted while the workspace is read-only.
      can: { edit: may && writable, remove: may && (writable || scope === 'user') },
    };
  };
  return {
    switches,
    canSwitchWorkspace: viewer.role === 'admin' && writable,
    brand,
    items: { user: me.map(view), brand: ofBrand.map(view), workspace: workspace.map(view) },
    used: { user: usedBy(me), brand: usedBy(ofBrand), workspace: usedBy(workspace) },
    rights,
    limits: { line: MAX_MEMORY_LINE, scope: MAX_MEMORY_SCOPE },
  };
}

// ─── Saving ─────────────────────────────────────────────────────────────────

const UUID = z.guid();

/** A line to save (save_memory's card, the Memory page). Loose bounds: the rules say what's wrong. */
export const saveMemoryInput = z.object({
  scope: z.enum(MEMORY_SCOPES),
  text: z
    .string()
    .max(4 * MAX_MEMORY_LINE)
    .transform(normalizeMemoryText),
  /** The brand of a Brand line (the chat's brand chip, item 2). */
  brandId: UUID.nullish(),
  /** The line it replaces in the same scope ("Replaces: {old}", item 7). */
  replaces: UUID.nullish(),
});
export type SaveMemoryInput = z.input<typeof saveMemoryInput>;

/** What a save did: a line kept (new, or its old one replaced), or a request sent to the Admins. */
export type SavedMemory =
  | {
      saved: true;
      id: string;
      scope: MemoryScope;
      text: string;
      replaced: boolean;
      /** A Brand line's brand, for its step ("Brand: Northwind"). */
      brandName: string | null;
    }
  | { requested: true };

/** A save as the checks found it. */
interface CheckedSave {
  scope: MemoryScope;
  text: string;
  key: ScopeKey;
  brand: { id: string; name: string } | null;
  replaced: ItemRow | null;
  right: 'edit' | 'request';
}

/**
 * Every check a save passes before anything is written (items 10, 12, 19,
 * 24, 25): the workspace isn't read-only, memory is on, the line is one
 * memory may keep, the person may change the scope, a Brand line's brand
 * is theirs, what it replaces is a line of the same scope, and the scope
 * has room. Also what save_memory's card checks first (its precheck). With
 * "Use memory" off Chat saves nothing (item 24); the Memory page still does,
 * and so does an Admin's approval of a Manager's line (`approval`): the
 * Admin's own switch is about their chats, not the Manager's line.
 */
export async function checkMemorySave(
  viewer: MemoryViewer,
  raw: unknown,
  source: 'chat' | 'page' | 'approval' = 'chat',
): Promise<{ ok: true; value: CheckedSave } | { ok: false; refusal: MemoryRefusal }> {
  if (!viewer.plan.writable) return memoryRefusal('read_only');
  const parsed = saveMemoryInput.safeParse(raw);
  if (!parsed.success) return memoryRefusal('invalid');
  const { scope, text, brandId, replaces } = parsed.data;
  const switches = await readMemorySwitches(viewer.organizationId, viewer.userId);
  if (!switches.workspace) return memoryRefusal('workspace_off');
  if (!switches.personal && source === 'chat') return memoryRefusal('off');
  const refused = textRefusal(text);
  if (refused) return refused;
  const right = memoryRight(viewer.role, scope);
  if (!right) return roleRefusal(scope);

  let key: ScopeKey;
  let brand: { id: string; name: string } | null = null;
  if (scope === 'brand') {
    if (!brandId) return memoryRefusal('no_brand');
    brand = await readBrand(viewer, brandId);
    if (!brand) return memoryRefusal('no_brand');
    key = { scope, brandId: brand.id };
  } else {
    key = scope === 'user' ? { scope, userId: viewer.userId } : { scope };
  }

  const rows = await scopeRows(viewer.organizationId, key);
  const replaced = replaces ? (rows.find((row) => row.id === replaces) ?? null) : null;
  if (replaces && !replaced) return memoryRefusal('not_found');
  const used = usedBy(rows) - (replaced?.text.length ?? 0);
  if (used + text.length > MAX_MEMORY_SCOPE) return memoryRefusal('full');
  return { ok: true, value: { scope, text, key, brand, replaced, right } };
}

/**
 * Saves a line (items 7–8, 22): checked first (checkMemorySave); a line it
 * replaces gets the new words, else a new line is added. A Manager's line
 * for the workspace goes to the Admins as a request instead (item 25),
 * which an Admin's approval saves (applyMemoryRequest). `createdBy`: whose
 * line it is, when an Admin approves another's (`approval`).
 */
export async function saveMemory(
  viewer: MemoryViewer,
  raw: unknown,
  source: 'chat' | 'page',
  { createdBy = viewer.userId, approval = false }: { createdBy?: string; approval?: boolean } = {},
): Promise<MemoryResult<SavedMemory>> {
  const checked = await checkMemorySave(viewer, raw, approval ? 'approval' : source);
  if (!checked.ok) return checked;
  const { scope, text, key, brand, replaced, right } = checked.value;
  const brandName = brand?.name ?? null;

  if (right === 'request') {
    // The server's own request: the browser's can't carry a drafted line (requestAccess).
    const sent = await sendAccessRequest(viewer, {
      asked: memoryT('request.asked', { text }),
      ruleKind: 'role',
      ruleDetail: memoryT('request.rule'),
      toolKey: MEMORY_REQUEST_TOOL_KEY,
      draftedChange: { kind: MEMORY_REQUEST_KIND, scope, text },
    });
    if (sent.ok || sent.reason === 'already_today') return { ok: true, value: { requested: true } };
    if (sent.reason === 'too_many' || sent.reason === 'daily_limit') {
      return memoryRefusal('request_limit');
    }
    return memoryRefusal('failed');
  }

  if (replaced) {
    const { data, error } = await supabaseAdmin
      .from('chat_memory_items')
      .update({ text, edited: true })
      .eq('id', replaced.id)
      .eq('organization_id', viewer.organizationId)
      .is('deleted_at', null)
      .select('id');
    if (isFull(error)) return memoryRefusal('full');
    if (error) throw new Error(`Could not save the memory: ${error.message}`);
    if ((data ?? []).length === 0) return memoryRefusal('not_found');
    return {
      ok: true,
      value: { saved: true, id: replaced.id, scope, text, replaced: true, brandName },
    };
  }

  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .insert({
      organization_id: viewer.organizationId,
      scope,
      user_id: key.scope === 'user' ? key.userId : null,
      brand_id: key.scope === 'brand' ? key.brandId : null,
      text,
      source,
      created_by: createdBy,
    })
    .select('id')
    .single();
  if (isFull(error)) return memoryRefusal('full');
  if (error || !data) throw new Error(`Could not save the memory: ${error?.message ?? 'no row'}`);
  return {
    ok: true,
    value: {
      saved: true,
      id: (data as { id: string }).id,
      scope,
      text,
      replaced: false,
      brandName,
    },
  };
}

/**
 * An Admin's approval of a Manager's request for a Workspace line (item
 * 25, chat_access_requests' drafted change): saved as the Admin, checked
 * again now, in the Manager's name. Only the memory store's own request
 * (its tool key) from someone who is still a Manager of the workspace;
 * null when the request isn't one.
 */
export async function applyMemoryRequest(
  admin: { userId: string; organizationId: string },
  request: { requester_id: string; tool_key: string | null; drafted_change: unknown },
): Promise<MemoryResult<SavedMemory> | null> {
  const drafted = request.drafted_change as {
    kind?: unknown;
    scope?: unknown;
    text?: unknown;
  } | null;
  if (request.tool_key !== MEMORY_REQUEST_TOOL_KEY || drafted?.kind !== MEMORY_REQUEST_KIND) {
    return null;
  }
  if (drafted.scope !== 'workspace' || typeof drafted.text !== 'string') {
    return memoryRefusal('invalid');
  }
  const [viewer, requester] = await Promise.all([
    readMemoryViewer(admin),
    readMemoryViewer({ userId: request.requester_id, organizationId: admin.organizationId }),
  ]);
  if (!viewer || viewer.role !== 'admin') return memoryRefusal('role_workspace');
  if (!requester || requester.role !== 'manager') return memoryRefusal('requester');
  return saveMemory(viewer, { scope: 'workspace', text: drafted.text }, 'chat', {
    createdBy: request.requester_id,
    approval: true,
  });
}

// ─── Changing and deleting ──────────────────────────────────────────────────

/**
 * A line the person may change: one they see, in a scope they edit, while
 * memory is on for them and the workspace isn't read-only. `ownWhileReadOnly`:
 * their own Me line may still be deleted (and brought back) while it is,
 * their right over their personal data (KVKK/GDPR; owner decision
 * 2026-11-02); adding, editing and Brand or Workspace lines stay closed.
 */
async function lineToChange(
  viewer: MemoryViewer,
  id: string,
  options: { deleted?: boolean; ownWhileReadOnly?: boolean } = {},
): Promise<{ ok: true; row: ItemRow } | { ok: false; refusal: MemoryRefusal }> {
  if (!viewer.plan.writable && !options.ownWhileReadOnly) return memoryRefusal('read_only');
  const row = await readVisible(viewer, id, options);
  if (!row) return memoryRefusal('not_found');
  if (!viewer.plan.writable && scopeOf(row) !== 'user') return memoryRefusal('read_only');
  if (memoryRight(viewer.role, scopeOf(row)) !== 'edit') return roleRefusal(scopeOf(row));
  if (viewer.role !== 'admin') {
    const switches = await readMemorySwitches(viewer.organizationId, viewer.userId);
    if (!switches.workspace) return memoryRefusal('workspace_off');
  }
  return { ok: true, row };
}

/**
 * Edits a line's words on the Memory page (item 22): the rules of items 12
 * and 19 again. An edited "Call me" line no longer follows the profile.
 */
export async function updateMemory(
  viewer: MemoryViewer,
  id: string,
  raw: string,
): Promise<MemoryResult<{ id: string; text: string }>> {
  const found = await lineToChange(viewer, id);
  if (!found.ok) return found;
  const text = normalizeMemoryText(raw);
  const refused = textRefusal(text);
  if (refused) return refused;
  const rows = await scopeRows(viewer.organizationId, keyOf(found.row));
  const used = usedBy(rows.filter((row) => row.id !== id));
  if (used + text.length > MAX_MEMORY_SCOPE) return memoryRefusal('full');
  const { error } = await supabaseAdmin
    .from('chat_memory_items')
    .update({ text, edited: true })
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .is('deleted_at', null);
  if (isFull(error)) return memoryRefusal('full');
  if (error) throw new Error(`Could not change the memory: ${error.message}`);
  return { ok: true, value: { id, text } };
}

/**
 * Deletes a line at once (item 23, forget_memory, the Memory page): it
 * leaves every prompt now, and Undo can bring it back for 10 seconds.
 */
export async function deleteMemory(
  viewer: MemoryViewer,
  id: string,
  now = new Date(),
): Promise<MemoryResult<{ id: string; scope: MemoryScope; text: string; undoUntil: string }>> {
  const found = await lineToChange(viewer, id, { ownWhileReadOnly: true });
  if (!found.ok) return found;
  const { error } = await supabaseAdmin
    .from('chat_memory_items')
    .update({ deleted_at: now.toISOString() })
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .is('deleted_at', null);
  if (error) throw new Error(`Could not delete the memory: ${error.message}`);
  return {
    ok: true,
    value: {
      id,
      scope: scopeOf(found.row),
      text: found.row.text,
      undoUntil: new Date(now.getTime() + MEMORY_UNDO_MS).toISOString(),
    },
  };
}

/** A little longer than the toast, for the click's trip (item 23). */
const UNDO_GRACE_MS = 5_000;

/** Brings a deleted line back while its Undo is open (item 23). */
export async function restoreMemory(
  viewer: MemoryViewer,
  id: string,
  now = new Date(),
): Promise<MemoryResult<{ id: string }>> {
  const found = await lineToChange(viewer, id, { deleted: true, ownWhileReadOnly: true });
  if (!found.ok) return found;
  const deletedAt = Date.parse(found.row.deleted_at ?? '');
  if (!(now.getTime() - deletedAt <= MEMORY_UNDO_MS + UNDO_GRACE_MS)) {
    return memoryRefusal('undo_expired');
  }
  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .update({ deleted_at: null })
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .not('deleted_at', 'is', null)
    .select('id');
  if (isFull(error)) return memoryRefusal('full');
  // A new "Call me" line since: one a person.
  if (error?.code === '23505') return memoryRefusal('undo_expired');
  if (error) throw new Error(`Could not bring the memory back: ${error.message}`);
  if ((data ?? []).length === 0) return memoryRefusal('not_found');
  return { ok: true, value: { id } };
}

/**
 * Deletes for good the lines deleted longer ago than Undo stays open (item
 * 23), from the minute tick. A deleted "Call me" line stays as a mark (no
 * one reads it), so the profile doesn't bring it back.
 */
export async function purgeDeletedMemory(now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - MEMORY_UNDO_MS - UNDO_GRACE_MS).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .delete()
    .lt('deleted_at', before)
    .neq('source', 'profile')
    .select('id');
  if (error) throw new Error(`Could not delete the old memory: ${error.message}`);
  return (data ?? []).length;
}

// ─── The switches ───────────────────────────────────────────────────────────

/** A change to the switches: the person's "Use memory", the workspace's (an Admin's). */
export const memorySwitchesPatch = z
  .strictObject({ personal: z.boolean().optional(), workspace: z.boolean().optional() })
  .refine((patch) => patch.personal !== undefined || patch.workspace !== undefined);

/**
 * Turns memory on or off (item 24): "Use memory" for the person, the
 * workspace's switch for everyone (an Admin's, Settings › Chat). A
 * read-only workspace keeps "Use memory" open (the person's own data,
 * KVKK/GDPR); the workspace's switch waits for a plan.
 */
export async function setMemorySwitches(
  viewer: MemoryViewer,
  patch: z.infer<typeof memorySwitchesPatch>,
): Promise<MemoryResult<MemorySwitches>> {
  if (!viewer.plan.writable && patch.workspace !== undefined) return memoryRefusal('read_only');
  if (patch.workspace !== undefined && viewer.role !== 'admin') return memoryRefusal('role_switch');
  if (patch.workspace !== undefined) {
    const { error } = await supabaseAdmin.from('chat_settings').upsert(
      {
        organization_id: viewer.organizationId,
        memory_enabled: patch.workspace,
        updated_by: viewer.userId,
      },
      { onConflict: 'organization_id' },
    );
    if (error) throw new Error(`Could not change the memory switch: ${error.message}`);
  }
  if (patch.personal !== undefined) {
    const { error } = await supabaseAdmin
      .from('chat_user_prefs')
      .upsert(
        { user_id: viewer.userId, memory_enabled: patch.personal },
        { onConflict: 'user_id' },
      );
    if (error) throw new Error(`Could not change "Use memory": ${error.message}`);
  }
  return { ok: true, value: await readMemorySwitches(viewer.organizationId, viewer.userId) };
}

// ─── Words for a card ───────────────────────────────────────────────────────

/** A scope in the person's words: "Me", "Brand: Acme", "Workspace" (item 1). */
export function scopeWords(scope: MemoryScope, brandName?: string | null): string {
  if (scope === 'brand') {
    return brandName ? memoryT('scope.brandNamed', { brand: brandName }) : memoryT('scope.brand');
  }
  return memoryT(scope === 'user' ? 'scope.user' : 'scope.workspace');
}

/** A live line the person sees (Me: only their own), by its id; null when there's none. */
export async function visibleMemoryLine(
  viewer: MemoryViewer,
  id: string,
): Promise<{ id: string; scope: MemoryScope; text: string } | null> {
  const row = await readVisible(viewer, id);
  return row ? { id: row.id, scope: scopeOf(row), text: row.text } : null;
}

/** A brand of the workspace's name, for a card's words; null when there's none. */
export async function brandNameOf(organizationId: string, brandId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('name')
    .eq('id', brandId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the brand: ${error.message}`);
  return (data as { name: string } | null)?.name ?? null;
}

/** A live line of the workspace by its id, for a card's words; null when there's none. */
export async function readMemoryLine(
  organizationId: string,
  id: string,
): Promise<{ id: string; scope: MemoryScope; text: string; brandName: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .select('id, scope, text, brand_id')
    .eq('id', id)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`Could not read the memory: ${error.message}`);
  const row = data as { id: string; scope: string; text: string; brand_id: string | null } | null;
  if (!row) return null;
  const brandName = row.brand_id ? await brandNameOf(organizationId, row.brand_id) : null;
  return { id: row.id, scope: scopeOf(row), text: row.text, brandName };
}
