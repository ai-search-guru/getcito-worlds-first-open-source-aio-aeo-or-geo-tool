import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../../messages/en.json';
import type { TeamRole } from '@/components/context/RoleProvider';
import { requestAccess } from '@/lib/actions/chatAccessRequests';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AgentSkillStates } from '../agentSkills';
import type { ChatSkillItem } from '../composerSetup';
import { chatAgenticEnabled } from '../flag';
import { planFactsFromOrgRow, type PlanFacts } from '../planFacts';
import { parseTeamRole } from '../precedence';
import { SHORTCUT_IDS } from '../shortcuts';
import { MAX_BYTES, MAX_DESCRIPTION, MAX_NAME, checkSkillFile } from './format';
import type { GithubRefusalCode } from './github';
import type { ImportRefusalCode, ParsedImport } from './import';
import { SKILL_LIBRARY, enabledSkills, type SkillFilter } from './library';
import { MAX_TITLE, skillChecksum, skillFileText, type SkillParts } from './skillFile';

/**
 * A workspace's own skills (CHAT-13 items 10, 12, 18–19; Chat Wave 3
 * W3-06), in chat_skills (00458), beside GetCito's library (library.ts):
 *
 *   - Saving: Admins and Managers (CHAT-20 §4) save a skill made in Chat
 *     (`user`). It is checked as a SKILL.md (format.ts: the format and the
 *     scan), may not take an GetCito skill's name, and counts against the
 *     plan's My skills limit. It is approved at once, on, and private to
 *     its creator until it is shared. An import (`import`, W3-09) waits on
 *     an Admin's review; a blocked one can't be approved.
 *   - Using: a person's runs use the library, but for what the workspace
 *     turned off (chat_settings.disabled_skills), and the approved skills
 *     that are on and theirs or shared. A skill's body is read from its row
 *     only when a run loads it, and only while it still matches its
 *     checksum: one that doesn't is switched off (item 19).
 *   - Changing: on or off is workspace-wide (Wave 3 decision 10), by an
 *     Admin or the skill's creator; the library's skills by an Admin. The
 *     creator or an Admin deletes one. Sharing with the workspace is an
 *     Admin's; a Manager asks the Admins (chat_access_requests).
 *
 * Every write is the server's (service role), after these checks; members
 * only read the table (00458's RLS). Server only.
 */

// ─── What a skill is ────────────────────────────────────────────────────────

export const SKILL_STATUSES = ['pending_review', 'approved', 'rejected', 'blocked'] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const SKILL_VISIBILITIES = ['private', 'workspace'] as const;
export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

/** Where a skill comes from: GetCito's library, made in the workspace, or imported. */
export type SkillSource = 'library' | 'user' | 'import';

/** A skill the person may use now, as a run and the / menu see it. */
export interface EnabledSkill {
  /** Its /command. */
  name: string;
  title: string;
  description: string;
  source: SkillSource;
  /**
   * Its instructions: a library skill's always; a workspace skill's once a
   * run loads it (loadSkillBodies), null until then or when it can't be.
   */
  body: string | null;
  /** A workspace skill's row; null for the library's. */
  id: string | null;
  /** Who made a workspace skill, for its step's "You". */
  createdBy: string | null;
  /** An import's source, for its step's repo owner. */
  sourceUrl: string | null;
}

/** The longest title (00458). */
export { MAX_TITLE } from './skillFile';

/** The plan's My skills limit (Wave 3 decision 9): the workspace's own skills, but for rejected ones. */
const SKILL_LIMITS = { trial: 3, starter: 10, growth: 50, enterprise: 200 } as const;

/**
 * How many skills of its own the workspace may keep: the trial's in the
 * trial, whatever its plan; none on self-hosted, which has no plan.
 */
export function skillPlanLimit(plan: PlanFacts): number | null {
  if (plan.selfHosted) return null;
  if (plan.isTrial) return SKILL_LIMITS.trial;
  if (plan.planId === 'enterprise') return SKILL_LIMITS.enterprise;
  return plan.planId === 'growth' ? SKILL_LIMITS.growth : SKILL_LIMITS.starter;
}

/** The library's names: a workspace skill never takes one (its /command would be two). */
const LIBRARY_NAMES: ReadonlySet<string> = new Set(SKILL_LIBRARY.map((skill) => skill.name));

/**
 * The names a workspace skill never takes: the library's, and the / menu's
 * shortcuts' (W2-09), each a hidden library skill under its /command.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set([...LIBRARY_NAMES, ...SHORTCUT_IDS]);

// ─── Who may do what ────────────────────────────────────────────────────────

/** The person a skill change is for: their role and their workspace's plan. */
export interface SkillViewer {
  userId: string;
  organizationId: string;
  role: TeamRole;
  plan: PlanFacts;
}

/** The columns the rules read of a skill's row. */
export type SkillRuleRow = {
  created_by: string | null;
  status: string;
  visibility: string;
  enabled: boolean;
};

/** Saving skills (CHAT-13 v2, CHAT-20 §4): Admins and Managers; Analysts and Agency partners don't. */
export const canSaveSkills = (role: TeamRole) => role === 'admin' || role === 'manager';

/**
 * Turning a workspace skill on or off for everyone, and deleting it (Wave
 * 3 decision 10): an Admin, or its creator while they still save skills.
 */
export function canManageSkill(viewer: Pick<SkillViewer, 'userId' | 'role'>, row: SkillRuleRow) {
  if (viewer.role === 'admin') return true;
  return canSaveSkills(viewer.role) && !!row.created_by && row.created_by === viewer.userId;
}

/** Who sees a skill, as 00458's RLS: an Admin all; anyone their own and the approved shared ones. */
export function canSeeSkill(viewer: Pick<SkillViewer, 'userId' | 'role'>, row: SkillRuleRow) {
  return (
    viewer.role === 'admin' ||
    row.created_by === viewer.userId ||
    (row.visibility === 'workspace' && row.status === 'approved')
  );
}

/**
 * Whether the person's runs use it: approved and on, and shared or theirs.
 * A private skill is its creator's own: an Admin sees it, but doesn't run it.
 */
export function skillUsableBy(userId: string, row: SkillRuleRow): boolean {
  return (
    row.status === 'approved' &&
    row.enabled &&
    (row.visibility === 'workspace' || row.created_by === userId)
  );
}

/** How sharing goes for the person: an Admin shares, its creator asks the Admins. */
export function shareWay(
  viewer: Pick<SkillViewer, 'userId' | 'role'>,
  row: SkillRuleRow,
): 'share' | 'request' | null {
  if (row.status !== 'approved' || row.visibility === 'workspace') return null;
  if (viewer.role === 'admin') return 'share';
  return canManageSkill(viewer, row) ? 'request' : null;
}

// ─── The file and its checksum ──────────────────────────────────────────────

// In skillFile.ts, which imports (import.ts) read too without the database.
export { skillChecksum, skillFileText, type SkillParts } from './skillFile';

/** Whether a row still holds the file it was approved as (item 19). */
const matchesChecksum = (row: SkillParts & { checksum_sha256: string }) =>
  skillChecksum(row) === row.checksum_sha256;

// ─── Refusals ───────────────────────────────────────────────────────────────

export type SkillRefusalCode =
  | 'invalid'
  | 'not_found'
  | 'role'
  | 'role_manage'
  | 'role_library'
  | 'read_only'
  | 'library_name'
  | 'name_taken'
  | 'skill_limit'
  | 'not_approved'
  | 'checksum'
  | 'request_limit'
  | 'failed'
  // Imports and their review (W3-09).
  | ImportRefusalCode
  | GithubRefusalCode
  | 'import_plan'
  | 'role_review'
  | 'not_pending'
  | 'blocked'
  // The weekly update check (W4-31).
  | 'no_update';

const REFUSAL_STATUS: Record<SkillRefusalCode, number> = {
  invalid: 400,
  not_found: 404,
  role: 403,
  role_manage: 403,
  role_library: 403,
  read_only: 402,
  library_name: 409,
  name_taken: 409,
  skill_limit: 403,
  not_approved: 409,
  checksum: 409,
  request_limit: 429,
  failed: 500,
  too_large: 413,
  not_zip: 400,
  too_many_files: 400,
  unsafe_path: 400,
  symlink: 400,
  nested_archive: 400,
  binary_file: 400,
  no_skill_file: 400,
  several_skills: 400,
  license: 400,
  github_url: 400,
  github_not_found: 400,
  github_busy: 429,
  github_failed: 502,
  github_redirect: 400,
  import_plan: 403,
  role_review: 403,
  not_pending: 409,
  blocked: 409,
  no_update: 409,
};

export interface SkillRefusal {
  code: SkillRefusalCode;
  status: number;
  /** In words, for the person (and for Chat, which says it). */
  message: string;
  detail?: Record<string, string | number>;
}

/** A refusal is a value (#1777), never a thrown error. */
export type SkillResult<T> = { ok: true; value: T } | { ok: false; refusal: SkillRefusal };

const skillsT = createTranslator({ locale: 'en', messages, namespace: 'chatSkills' });
const stepT = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.step' });

export function skillRefusal(
  code: SkillRefusalCode,
  detail?: Record<string, string | number>,
): { ok: false; refusal: SkillRefusal } {
  return {
    ok: false,
    refusal: {
      code,
      status: REFUSAL_STATUS[code],
      message: skillsT(`refusal.${code}`, detail as never),
      ...(detail ? { detail } : {}),
    },
  };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/** The person's role and their workspace's plan; null when they aren't in the workspace. */
export async function readSkillViewer(actor: {
  userId: string;
  organizationId: string;
}): Promise<SkillViewer | null> {
  const [profile, org] = await Promise.all([
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
  ]);
  for (const read of [profile, org]) {
    if (read.error) throw new Error(`Could not read the skill's facts: ${read.error.message}`);
  }
  const role = parseTeamRole(profile.data?.role);
  if (!role || profile.data?.organization_id !== actor.organizationId || !org.data) return null;
  return { ...actor, role, plan: planFactsFromOrgRow(org.data) };
}

/** The library skills the workspace turned off (chat_settings.disabled_skills). */
async function disabledLibrary(organizationId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_settings')
    .select('disabled_skills')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the workspace's skills: ${error.message}`);
  return (data as { disabled_skills?: string[] | null } | null)?.disabled_skills ?? [];
}

const LIST_COLUMNS =
  'id, name, title, description, source, source_url, license, status, visibility, enabled, created_by, created_at, updated_at, scan_json, update_sha';
const BODY_COLUMNS =
  'id, name, title, description, body, license, compatibility, checksum_sha256, status, visibility, enabled, created_by';

type ListRow = SkillRuleRow & {
  id: string;
  name: string;
  title: string;
  description: string;
  source: string;
  source_url: string | null;
  license: string | null;
  created_at: string;
  updated_at: string;
  scan_json: unknown;
  update_sha: string | null;
};

type BodyRow = SkillRuleRow &
  SkillParts & {
    id: string;
    checksum_sha256: string;
  };

/**
 * The skills the person may use (CHAT-13 item 3): the library but for what
 * the workspace turned off, then the workspace's approved skills that are
 * on and shared or the person's own, by name. None while the new Chat is
 * off. A workspace skill comes without its body: a run reads it when it
 * loads the skill (loadSkillBodies).
 */
export async function enabledSkillsFor(
  organizationId: string,
  userId: string,
): Promise<EnabledSkill[]> {
  if (!chatAgenticEnabled(organizationId)) return [];
  const library = enabledSkills(organizationId);
  const [off, own] = await Promise.all([
    disabledLibrary(organizationId),
    supabaseAdmin
      .from('chat_skills')
      .select(
        'id, name, title, description, source, source_url, status, visibility, enabled, created_by',
      )
      .eq('organization_id', organizationId)
      .eq('status', 'approved')
      .eq('enabled', true)
      .or(`visibility.eq.workspace,created_by.eq.${userId}`)
      .order('name', { ascending: true }),
  ]);
  if (own.error) throw new Error(`Could not read the workspace's skills: ${own.error.message}`);
  const disabled = new Set(off);
  // A name the library or a shortcut took after the skill was saved: theirs wins.
  const names = new Set([...library.map((skill) => skill.name), ...SHORTCUT_IDS]);
  return [
    ...library
      .filter((skill) => !disabled.has(skill.name))
      .map((skill): EnabledSkill => ({
        name: skill.name,
        title: skill.title,
        description: skill.description,
        source: 'library',
        body: skill.body,
        id: null,
        createdBy: null,
        sourceUrl: null,
      })),
    ...((own.data ?? []) as (ListRow & { source: string })[])
      .filter((row) => !names.has(row.name) && skillUsableBy(userId, row))
      .map((row): EnabledSkill => ({
        name: row.name,
        title: row.title,
        description: row.description,
        source: row.source === 'import' ? 'import' : 'user',
        body: null,
        id: row.id,
        createdBy: row.created_by,
        sourceUrl: row.source_url,
      })),
  ];
}

/**
 * The / menu's Skills group (item 5): each skill the person may use, by
 * its /command and title only. A read that fails gives the library's, so
 * the page still opens: a run reads the skills again for itself.
 */
export async function skillMenuFor(
  organizationId: string,
  userId: string,
): Promise<ChatSkillItem[]> {
  try {
    return (await enabledSkillsFor(organizationId, userId)).map(({ name, title }) => ({
      name,
      title,
    }));
  } catch (err) {
    console.error('[chat/skills] could not read the skills for the / menu:', err);
    return enabledSkills(organizationId).map(({ name, title }) => ({ name, title }));
  }
}

/** Turns off a skill whose file no longer matches its checksum (item 19). */
async function switchOff(row: BodyRow): Promise<void> {
  console.warn(`[chat/skills] skill ${row.id} no longer matches its checksum: switched off`);
  const { error } = await supabaseAdmin
    .from('chat_skills')
    .update({ enabled: false })
    .eq('id', row.id)
    .eq('checksum_sha256', row.checksum_sha256);
  if (error) console.error('[chat/skills] could not switch a skill off:', error.message);
}

/**
 * Reads the bodies of the workspace skills named (a run's loaded ones),
 * into the skills themselves: each only while it is still the person's to
 * use and matches its checksum. One that doesn't match is switched off for
 * the workspace and stays without a body, so it isn't loaded.
 */
export async function loadSkillBodies(
  viewer: { organizationId: string; userId: string },
  skills: readonly EnabledSkill[],
  names: readonly string[],
): Promise<void> {
  const wanted = skills.filter((s) => s.id && s.body === null && names.includes(s.name));
  if (wanted.length === 0) return;
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select(BODY_COLUMNS)
    .eq('organization_id', viewer.organizationId)
    .in(
      'id',
      wanted.map((s) => s.id!),
    );
  if (error) throw new Error(`Could not read a skill: ${error.message}`);
  const rows = new Map(((data ?? []) as BodyRow[]).map((row) => [row.id, row]));
  for (const skill of wanted) {
    const row = rows.get(skill.id!);
    if (!row || !skillUsableBy(viewer.userId, row)) continue;
    if (!matchesChecksum(row)) {
      await switchOff(row);
      continue;
    }
    skill.body = row.body;
  }
}

/** A GitHub source's owner ("anthropics"), or null. */
function repoOwner(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const owner = parsed.pathname.split('/')[1] ?? '';
    return parsed.hostname === 'github.com' && /^[A-Za-z0-9-]{1,39}$/.test(owner) ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Where a skill comes from, under its "Used skill" step (item 4):
 * "GetCito library", "You", "Your workspace", or an import's repo owner.
 */
export function skillSourceWords(
  skill: Pick<EnabledSkill, 'source' | 'createdBy' | 'sourceUrl'>,
  userId: string,
): string {
  if (skill.source === 'library') return stepT('skillFromLibrary');
  if (skill.source === 'user') {
    return skill.createdBy === userId ? stepT('skillFromYou') : stepT('skillFromWorkspace');
  }
  const owner = repoOwner(skill.sourceUrl);
  return owner ? stepT('skillFromRepo', { owner }) : stepT('skillImported');
}

/**
 * What an agent's checks need of its skills (agentSkills.ts
 * offAgentSkill): the library skills the workspace turned off, and for
 * each workspace skill it names whether the person it acts as may run it
 * now (approved, on, theirs or shared, matching its checksum).
 */
export async function agentSkillStates(
  organizationId: string,
  userId: string,
  skillIds: readonly string[],
): Promise<AgentSkillStates> {
  const own = skillIds.filter((id) => !LIBRARY_NAMES.has(id));
  const [disabled, rows] = await Promise.all([
    disabledLibrary(organizationId),
    own.length > 0
      ? supabaseAdmin
          .from('chat_skills')
          .select(BODY_COLUMNS)
          .eq('organization_id', organizationId)
          .in('name', own)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (rows.error) throw new Error(`Could not read the agent's skills: ${rows.error.message}`);
  const workspace = new Map<string, boolean>();
  for (const row of (rows.data ?? []) as BodyRow[]) {
    workspace.set(row.name, skillUsableBy(userId, row) && matchesChecksum(row));
  }
  return { disabled: new Set(disabled), workspace };
}

// ─── The list (/api/chat/skills) ────────────────────────────────────────────

export interface LibrarySkillView {
  name: string;
  title: string;
  description: string;
  /** The Skills page's filter chips it shows under (W3-07). */
  filters: SkillFilter[];
  /** Off when the workspace turned it off. */
  enabled: boolean;
}

export interface WorkspaceSkillView {
  id: string;
  name: string;
  title: string;
  description: string;
  source: 'user' | 'import';
  sourceUrl: string | null;
  license: string | null;
  status: SkillStatus;
  visibility: SkillVisibility;
  enabled: boolean;
  mine: boolean;
  /** What the scan listed for a reviewer (item 17). */
  warnings: string[];
  /** Its source has a new SKILL.md an Admin hasn't approved yet (W4-31). */
  updateAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  can: { toggle: boolean; remove: boolean; share: 'share' | 'request' | null };
}

export interface SkillList {
  library: LibrarySkillView[];
  skills: WorkspaceSkillView[];
  /** The workspace's own skills against the plan's limit; max null: none. */
  limit: { used: number; max: number | null };
  can: { save: boolean; manageLibrary: boolean };
}

const warningsOf = (scan: unknown): string[] => {
  const warns = (scan as { warns?: unknown } | null)?.warns;
  return Array.isArray(warns) ? warns.filter((w): w is string => typeof w === 'string') : [];
};

function viewOf(viewer: SkillViewer, row: ListRow): WorkspaceSkillView {
  const manage = canManageSkill(viewer, row) && viewer.plan.writable;
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    source: row.source === 'import' ? 'import' : 'user',
    sourceUrl: row.source_url,
    license: row.license,
    status: row.status as SkillStatus,
    visibility: row.visibility as SkillVisibility,
    enabled: row.enabled,
    mine: row.created_by === viewer.userId,
    warnings: warningsOf(row.scan_json),
    // The weekly check found a new SKILL.md at its source (W4-31).
    updateAvailable: row.update_sha !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    can: {
      toggle: manage,
      remove: manage,
      share: viewer.plan.writable ? shareWay(viewer, row) : null,
    },
  };
}

/**
 * The workspace's own skills but for rejected ones (an import an Admin
 * turned down): what the plan's limit counts.
 */
async function countSkills(organizationId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('chat_skills')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .neq('status', 'rejected');
  if (error) throw new Error(`Could not count the workspace's skills: ${error.message}`);
  return count ?? 0;
}

/**
 * The Skills list: the library with what is on, the workspace's skills the
 * person sees (an Admin all of them), the plan's limit, and what the person
 * may do. Bodies stay on the server.
 */
export async function listSkills(viewer: SkillViewer): Promise<SkillList> {
  const [off, rows, used] = await Promise.all([
    disabledLibrary(viewer.organizationId),
    supabaseAdmin
      .from('chat_skills')
      .select(LIST_COLUMNS)
      .eq('organization_id', viewer.organizationId)
      .order('name', { ascending: true }),
    countSkills(viewer.organizationId),
  ]);
  if (rows.error) throw new Error(`Could not read the workspace's skills: ${rows.error.message}`);
  const disabled = new Set(off);
  return {
    library: SKILL_LIBRARY.map((skill) => ({
      name: skill.name,
      title: skill.title,
      description: skill.description,
      filters: [...skill.filters],
      enabled: !disabled.has(skill.name),
    })),
    skills: ((rows.data ?? []) as ListRow[])
      .filter((row) => canSeeSkill(viewer, row))
      .map((row) => viewOf(viewer, row)),
    limit: { used, max: skillPlanLimit(viewer.plan) },
    can: {
      save: canSaveSkills(viewer.role) && viewer.plan.writable,
      manageLibrary: viewer.role === 'admin' && viewer.plan.writable,
    },
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

/**
 * A skill made in Chat (save_skill, CHAT-20 §9 row 75), as its card shows
 * it. Loose bounds only: the format's own check (checkSkillFile) says what
 * is wrong with a name or a description in words (CHAT-13's first
 * acceptance criterion).
 */
export const saveSkillInput = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(4 * MAX_NAME),
  title: z.string().trim().min(1).max(MAX_TITLE).optional(),
  description: z
    .string()
    .trim()
    .min(1)
    .max(4 * MAX_DESCRIPTION),
  instructions: z
    .string()
    .trim()
    .min(1)
    .max(4 * MAX_BYTES),
});
export type SaveSkillInput = z.input<typeof saveSkillInput>;

export interface SavedSkill {
  id: string;
  name: string;
  title: string;
  /** What the scan listed without refusing it (item 16): a URL, a long body. */
  warnings: string[];
}

/**
 * Saves a skill made in Chat (item 12): an Admin's or a Manager's, while
 * the workspace isn't read-only, checked as its SKILL.md, under the plan's
 * limit, never with an GetCito skill's name. Approved and on at once,
 * private to its creator.
 */
export async function saveSkill(
  viewer: SkillViewer,
  raw: unknown,
): Promise<SkillResult<SavedSkill>> {
  if (!canSaveSkills(viewer.role)) return skillRefusal('role');
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const parsed = saveSkillInput.safeParse(raw);
  if (!parsed.success) {
    return skillRefusal('invalid', {
      problems: 'it needs a name, a description and instructions',
    });
  }
  const input = parsed.data;
  // metadata.title, else the name with spaces (item 1).
  const parts: SkillParts = {
    name: input.name,
    title: input.title ?? input.name.replace(/-/g, ' '),
    description: input.description,
    body: input.instructions,
  };
  const check = checkSkillFile(parts.name, skillFileText(parts));
  if (check.problems.length > 0) {
    return skillRefusal('invalid', { problems: check.problems.join('; ') });
  }
  if (RESERVED_NAMES.has(parts.name)) return skillRefusal('library_name', { name: parts.name });
  const limit = skillPlanLimit(viewer.plan);
  if (limit !== null && (await countSkills(viewer.organizationId)) >= limit) {
    return skillRefusal('skill_limit', { limit });
  }
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .insert({
      organization_id: viewer.organizationId,
      ...parts,
      source: 'user',
      checksum_sha256: skillChecksum(parts),
      scan_json: { blocks: [], warns: check.warnings },
      status: 'approved',
      visibility: 'private',
      enabled: true,
      created_by: viewer.userId,
    })
    .select('id, name, title')
    .single();
  if (error?.code === '23505') return skillRefusal('name_taken', { name: parts.name });
  if (error || !data) throw new Error(`Could not save the skill: ${error?.message ?? 'no row'}`);
  const saved = data as { id: string; name: string; title: string };
  return {
    ok: true,
    value: { id: saved.id, name: saved.name, title: saved.title, warnings: check.warnings },
  };
}

/** A skill of the workspace the person sees, by its id; null when there's none. */
async function readSkill(viewer: SkillViewer, id: string): Promise<BodyRow | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select(BODY_COLUMNS)
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the skill: ${error.message}`);
  const row = data as BodyRow | null;
  return row && canSeeSkill(viewer, row) ? row : null;
}

/** A skill the person may change: theirs or an Admin's, while the workspace isn't read-only. */
async function skillToChange(
  viewer: SkillViewer,
  id: string,
): Promise<{ ok: true; row: BodyRow } | { ok: false; refusal: SkillRefusal }> {
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const row = await readSkill(viewer, id);
  if (!row) return skillRefusal('not_found');
  if (!canManageSkill(viewer, row)) return skillRefusal('role_manage');
  return { ok: true, row };
}

/**
 * Turns a workspace skill on or off for everyone (Wave 3 decision 10): an
 * Admin or its creator. Only an approved skill that still matches its
 * checksum comes on.
 */
export async function setSkillEnabled(
  viewer: SkillViewer,
  id: string,
  enabled: boolean,
): Promise<SkillResult<{ id: string; enabled: boolean }>> {
  const found = await skillToChange(viewer, id);
  if (!found.ok) return found;
  const { row } = found;
  if (enabled && row.status !== 'approved') return skillRefusal('not_approved');
  if (enabled && !matchesChecksum(row)) return skillRefusal('checksum');
  const { error } = await supabaseAdmin
    .from('chat_skills')
    .update({ enabled })
    .eq('id', row.id)
    .eq('organization_id', viewer.organizationId);
  if (error) throw new Error(`Could not change the skill: ${error.message}`);
  return { ok: true, value: { id: row.id, enabled } };
}

/** Deletes a workspace skill: an Admin or its creator. Agents using it pause (skill_off). */
export async function deleteSkill(
  viewer: SkillViewer,
  id: string,
): Promise<SkillResult<{ id: string }>> {
  const found = await skillToChange(viewer, id);
  if (!found.ok) return found;
  const { error } = await supabaseAdmin
    .from('chat_skills')
    .delete()
    .eq('id', found.row.id)
    .eq('organization_id', viewer.organizationId);
  if (error) throw new Error(`Could not delete the skill: ${error.message}`);
  return { ok: true, value: { id: found.row.id } };
}

/** Turns an GetCito library skill on or off for the workspace: an Admin's (00458). */
export async function setLibrarySkillEnabled(
  viewer: SkillViewer,
  name: string,
  enabled: boolean,
): Promise<SkillResult<{ name: string; enabled: boolean }>> {
  if (!LIBRARY_NAMES.has(name)) return skillRefusal('not_found');
  if (viewer.role !== 'admin') return skillRefusal('role_library');
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const off = await disabledLibrary(viewer.organizationId);
  const next = enabled ? off.filter((n) => n !== name) : [...new Set([...off, name])];
  const { error } = await supabaseAdmin.from('chat_settings').upsert(
    {
      organization_id: viewer.organizationId,
      disabled_skills: next,
      updated_by: viewer.userId,
    },
    { onConflict: 'organization_id' },
  );
  if (error) throw new Error(`Could not change the skill: ${error.message}`);
  return { ok: true, value: { name, enabled } };
}

export type ShareOutcome = { shared: true } | { requested: true };

/**
 * Shares a skill with the workspace (item 10, CHAT-20 §4): an Admin
 * shares it, and the requests for it are answered; its creator, a
 * Manager, asks the Admins instead (chat_access_requests, through their
 * own session). Only an approved skill.
 */
export async function shareSkill(
  viewer: SkillViewer,
  id: string,
  now = new Date(),
): Promise<SkillResult<ShareOutcome>> {
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const row = await readSkill(viewer, id);
  if (!row) return skillRefusal('not_found');
  if (row.status !== 'approved') return skillRefusal('not_approved');
  if (row.visibility === 'workspace') return { ok: true, value: { shared: true } };
  const way = shareWay(viewer, row);
  if (!way) return skillRefusal('role_manage');

  if (way === 'share') {
    const { error } = await supabaseAdmin
      .from('chat_skills')
      .update({ visibility: 'workspace' })
      .eq('id', row.id)
      .eq('organization_id', viewer.organizationId);
    if (error) throw new Error(`Could not share the skill: ${error.message}`);
    // The Managers' requests to share it are answered by this.
    const { error: requestsError } = await supabaseAdmin
      .from('chat_access_requests')
      .update({ status: 'approved', decided_by: viewer.userId, decided_at: now.toISOString() })
      .eq('organization_id', viewer.organizationId)
      .eq('status', 'pending')
      .eq('drafted_change->>skill_id', row.id);
    if (requestsError) {
      console.error('[chat/skills] could not answer the share requests:', requestsError.message);
    }
    return { ok: true, value: { shared: true } };
  }

  const sent = await requestAccess({
    asked: skillsT('share.asked', { name: row.name }),
    ruleKind: 'role',
    ruleDetail: skillsT('share.rule'),
    draftedChange: { kind: 'share_skill', skill_id: row.id, name: row.name },
  });
  // Asked already today: it is on its way all the same.
  if (sent.ok || sent.reason === 'already_today') return { ok: true, value: { requested: true } };
  if (sent.reason === 'too_many' || sent.reason === 'daily_limit') {
    return skillRefusal('request_limit');
  }
  return skillRefusal('failed');
}

// ─── Imports and their review (W3-09) ───────────────────────────────────────

export interface ImportedSkill {
  id: string;
  name: string;
  title: string;
  /** pending_review, or blocked: an Admin sees it, and can't approve it. */
  status: 'pending_review' | 'blocked';
  /** What was removed, and what the scan found. */
  removed: string[];
  warnings: string[];
  blocks: string[];
  /** A Manager's import: their Admins were asked to review it. */
  requested: boolean;
}

/**
 * Who may import a skill (W3-09): an Admin or a Manager, while the
 * workspace isn't read-only, on a paid plan or self-hosted (not in the
 * trial, Wave 3 decision 9). The route asks before it reads the upload or
 * GitHub, so a refused import costs nothing.
 */
export function canImportSkill(
  viewer: Pick<SkillViewer, 'role' | 'plan'>,
): { ok: false; refusal: SkillRefusal } | null {
  if (!canSaveSkills(viewer.role)) return skillRefusal('role');
  if (!viewer.plan.writable) return skillRefusal('read_only');
  if (viewer.plan.isTrial) return skillRefusal('import_plan');
  return null;
}

/**
 * Keeps an imported skill for review (CHAT-13 items 13–18): an Admin's or
 * a Manager's, while the workspace isn't read-only, on a paid plan or
 * self-hosted (not in the trial, Wave 3 decision 9), under the plan's
 * limit, never with an GetCito skill's name. It waits off and private,
 * `pending_review` (or `blocked`); a Manager's asks the Admins to review it
 * (chat_access_requests, through their own session).
 */
export async function importSkill(
  viewer: SkillViewer,
  parsed: ParsedImport,
  source: { url: string | null; commitSha: string | null },
): Promise<SkillResult<ImportedSkill>> {
  const cannot = canImportSkill(viewer);
  if (cannot) return cannot;
  const { parts } = parsed;
  if (RESERVED_NAMES.has(parts.name)) return skillRefusal('library_name', { name: parts.name });
  const limit = skillPlanLimit(viewer.plan);
  if (limit !== null && (await countSkills(viewer.organizationId)) >= limit) {
    return skillRefusal('skill_limit', { limit });
  }
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .insert({
      organization_id: viewer.organizationId,
      name: parts.name,
      title: parts.title,
      description: parts.description,
      body: parts.body,
      compatibility: parts.compatibility ?? null,
      license: parts.license,
      license_text: parsed.licenseText,
      source: 'import',
      source_url: source.url,
      commit_sha: source.url ? source.commitSha : null,
      checksum_sha256: parsed.checksum,
      scan_json: parsed.scan,
      removed_json: parsed.removed,
      status: parsed.status,
      visibility: 'private',
      enabled: false,
      created_by: viewer.userId,
    })
    .select('id, name, title')
    .single();
  if (error?.code === '23505') return skillRefusal('name_taken', { name: parts.name });
  if (error || !data) throw new Error(`Could not keep the skill: ${error?.message ?? 'no row'}`);
  const kept = data as { id: string; name: string; title: string };

  let requested = false;
  if (viewer.role !== 'admin' && parsed.status === 'pending_review') {
    const sent = await requestAccess({
      asked: skillsT('review.asked', { name: kept.name }),
      ruleKind: 'role',
      ruleDetail: skillsT('review.rule'),
      draftedChange: { kind: 'review_skill', skill_id: kept.id, name: kept.name },
    });
    if (sent.ok || sent.reason === 'already_today') requested = true;
    else console.error('[chat/skills] could not ask for a review:', sent.reason);
  }
  return {
    ok: true,
    value: {
      id: kept.id,
      name: kept.name,
      title: kept.title,
      status: parsed.status,
      removed: parsed.removed,
      warnings: parsed.scan.warns,
      blocks: parsed.scan.blocks,
      requested,
    },
  };
}

const REVIEW_COLUMNS =
  'id, name, title, description, body, license, license_text, compatibility, checksum_sha256, source, source_url, commit_sha, scan_json, removed_json, status, visibility, enabled, created_by, created_at, approved_by, approved_at';

type ReviewRow = BodyRow & {
  license_text: string | null;
  source: string;
  source_url: string | null;
  commit_sha: string | null;
  scan_json: unknown;
  removed_json: unknown;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

/** What the review shows (item 17): the cleaned file and everything about where it came from. */
export interface SkillReview {
  id: string;
  name: string;
  title: string;
  description: string;
  /** The cleaned body, plain text: nothing in it runs. */
  body: string;
  compatibility: string | null;
  license: string | null;
  licenseText: string | null;
  source: 'user' | 'import';
  sourceUrl: string | null;
  commitSha: string | null;
  status: SkillStatus;
  scan: { blocks: string[]; warns: string[] };
  removed: string[];
  mine: boolean;
  createdAt: string;
  approvedAt: string | null;
  /** An Admin decides a skill waiting for review; a blocked one can only be rejected. */
  can: { approve: boolean; reject: boolean };
}

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** The review of a skill: an Admin's, or its creator's. */
export async function readSkillReview(
  viewer: SkillViewer,
  id: string,
): Promise<SkillResult<SkillReview>> {
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select(REVIEW_COLUMNS)
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the skill: ${error.message}`);
  const row = data as ReviewRow | null;
  if (!row || (viewer.role !== 'admin' && row.created_by !== viewer.userId)) {
    return skillRefusal('not_found');
  }
  const scan = (row.scan_json ?? {}) as { blocks?: unknown; warns?: unknown };
  const deciding = viewer.role === 'admin' && viewer.plan.writable;
  return {
    ok: true,
    value: {
      id: row.id,
      name: row.name,
      title: row.title,
      description: row.description,
      body: row.body,
      compatibility: row.compatibility ?? null,
      license: row.license ?? null,
      licenseText: row.license_text,
      source: row.source === 'import' ? 'import' : 'user',
      sourceUrl: row.source_url,
      commitSha: row.commit_sha,
      status: row.status as SkillStatus,
      scan: { blocks: stringsOf(scan.blocks), warns: stringsOf(scan.warns) },
      removed: stringsOf(row.removed_json),
      mine: row.created_by === viewer.userId,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      can: {
        approve: deciding && row.status === 'pending_review',
        reject: deciding && (row.status === 'pending_review' || row.status === 'blocked'),
      },
    },
  };
}

export type ReviewDecision = 'approve' | 'reject';

/**
 * An Admin's review (item 18): approved, a skill waiting for review is on
 * for its creator (private until it is shared) while it still matches the
 * checksum it was kept with; rejected, it stays off. A blocked skill is
 * only rejected. The requests to review it are answered.
 */
export async function reviewSkill(
  viewer: SkillViewer,
  id: string,
  decision: ReviewDecision,
  now = new Date(),
): Promise<SkillResult<{ id: string; status: 'approved' | 'rejected' }>> {
  if (viewer.role !== 'admin') return skillRefusal('role_review');
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const row = await readSkill(viewer, id);
  if (!row) return skillRefusal('not_found');
  if (decision === 'approve') {
    if (row.status === 'blocked') return skillRefusal('blocked');
    if (row.status !== 'pending_review') return skillRefusal('not_pending');
    if (!matchesChecksum(row)) return skillRefusal('checksum');
  } else if (row.status !== 'pending_review' && row.status !== 'blocked') {
    return skillRefusal('not_pending');
  }
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const at = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .update(
      decision === 'approve'
        ? { status, enabled: true, approved_by: viewer.userId, approved_at: at }
        : { status, enabled: false },
    )
    .eq('id', row.id)
    .eq('organization_id', viewer.organizationId)
    .eq('status', row.status)
    .select('id');
  if (error) throw new Error(`Could not review the skill: ${error.message}`);
  // Reviewed meanwhile by another Admin.
  if (!data?.length) return skillRefusal('not_pending');
  const { error: requestsError } = await supabaseAdmin
    .from('chat_access_requests')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      decided_by: viewer.userId,
      decided_at: at,
    })
    .eq('organization_id', viewer.organizationId)
    .eq('status', 'pending')
    .eq('drafted_change->>skill_id', row.id)
    .eq('drafted_change->>kind', 'review_skill');
  if (requestsError) {
    console.error('[chat/skills] could not answer the review requests:', requestsError.message);
  }
  return { ok: true, value: { id: row.id, status } };
}
