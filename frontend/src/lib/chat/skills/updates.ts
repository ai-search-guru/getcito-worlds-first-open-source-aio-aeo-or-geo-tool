import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '../flag';
import { parseGithubUrl, readGithubSkill, type GithubOptions, type GithubRefusal } from './github';
import { parseSkillImport, type ImportFile, type ImportRefusal } from './import';
import { skillChecksum, type SkillParts } from './skillFile';
import { skillRefusal, type SkillResult, type SkillViewer } from './store';

/**
 * The weekly update check of imported and Library skills (CHAT-13 items
 * 16 and 19, W4-31; 00465's update_checked_at). Once a week each approved
 * skill's source is read at its repository's default branch: when its
 * SKILL.md changed, update_sha keeps the commit and My skills shows
 * "Update available". Nothing changes on its own: an Admin reads the
 * difference and approves it, and the new version goes through the
 * cleanup, the scan and the license check again. A skill whose file no
 * longer matches its checksum is switched off. A source that is gone, or
 * whose license is one we don't take, leaves the skill as it is.
 */

/** Days between two checks of one skill. */
export const UPDATE_CHECK_DAYS = 7;

/** Skills checked in one minute of the window, so a check never holds the tick up. */
export const UPDATES_PER_TICK = 5;

/** The hour (UTC) of the daily window the minute tick checks in. */
export const UPDATE_HOUR_UTC = 3;

const CHECK_COLUMNS =
  'id, organization_id, name, title, description, body, license, compatibility, checksum_sha256, source_url, commit_sha, update_sha, enabled';

export interface CheckRow extends SkillParts {
  id: string;
  organization_id: string;
  checksum_sha256: string;
  source_url: string | null;
  commit_sha: string | null;
  update_sha: string | null;
  enabled: boolean;
}

/** The skill's folder at a ref of its repository (its default branch: HEAD), or null for a link we can't read. */
export function sourceAt(sourceUrl: string, ref: string): string | null {
  const folder = parseGithubUrl(sourceUrl);
  if (!folder) return null;
  const tail = folder.path ? `/${folder.path.split('/').map(encodeURIComponent).join('/')}` : '';
  return `https://github.com/${folder.owner}/${folder.repo}/tree/${ref}${tail}`;
}

type SourceRead =
  | { ok: true; value: { files: ImportFile[]; commitSha: string } }
  | { ok: false; refusal: GithubRefusal };

/** What one check found: a new SKILL.md, nothing new, or a source we can't take. */
export type UpdateDecision =
  | { kind: 'update'; sha: string }
  | { kind: 'same' }
  | { kind: 'source'; code: GithubRefusal['code'] }
  | { kind: 'refused'; code: ImportRefusal['code'] };

/**
 * What the source at its default branch means for the skill: an update
 * when its commit moved and its SKILL.md, cleaned as an import is, isn't
 * the one kept (the skill's own /name stays); else nothing.
 */
export function decideUpdate(row: CheckRow, read: SourceRead): UpdateDecision {
  if (!read.ok) return { kind: 'source', code: read.refusal.code };
  if (read.value.commitSha === row.commit_sha) return { kind: 'same' };
  const parsed = parseSkillImport(read.value.files);
  if (!parsed.ok) return { kind: 'refused', code: parsed.refusal.code };
  const next = skillChecksum({ ...parsed.value.parts, name: row.name });
  return next === row.checksum_sha256
    ? { kind: 'same' }
    : { kind: 'update', sha: read.value.commitSha };
}

export interface UpdateCheck {
  /** Inside the daily window (or asked for by hand). */
  window: boolean;
  checked: number;
  updates: number;
  switchedOff: number;
  /** Sources gone, refused or failing: the skill stays as it is. */
  unreadable: number;
}

/**
 * One minute of the weekly check (the schedules tick, W4-31): in the daily
 * window, the approved imported and Library skills not checked for a
 * week, the oldest first, a few at a time. `force` checks outside the
 * window (by hand in development).
 */
export async function checkSkillUpdates(
  now: Date,
  {
    force = false,
    limit = UPDATES_PER_TICK,
    github,
  }: {
    force?: boolean;
    limit?: number;
    github?: GithubOptions;
  } = {},
): Promise<UpdateCheck> {
  const done: UpdateCheck = { window: true, checked: 0, updates: 0, switchedOff: 0, unreadable: 0 };
  if (!force && now.getUTCHours() !== UPDATE_HOUR_UTC) return { ...done, window: false };
  const since = new Date(now.getTime() - UPDATE_CHECK_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select(CHECK_COLUMNS)
    .in('source', ['import', 'library'])
    .eq('status', 'approved')
    .not('source_url', 'is', null)
    .not('commit_sha', 'is', null)
    .or(`update_checked_at.is.null,update_checked_at.lt.${since}`)
    .order('update_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(`Could not read the skills to check: ${error.message}`);
  for (const row of (data ?? []) as CheckRow[]) {
    if (!chatAgenticEnabled(row.organization_id)) {
      // Not checked, but marked: else these rows stay the oldest and hold
      // every other workspace's skills out of the queue.
      const { error: skipError } = await supabaseAdmin
        .from('chat_skills')
        .update({ update_checked_at: now.toISOString() })
        .eq('id', row.id);
      if (skipError)
        console.error('[chat/skills] could not mark a skipped check:', skipError.message);
      continue;
    }
    done.checked += 1;
    if (row.enabled && skillChecksum(row) !== row.checksum_sha256) {
      done.switchedOff += 1;
      console.warn(`[chat/skills] skill ${row.id} no longer matches its checksum: switched off`);
      const off = await supabaseAdmin
        .from('chat_skills')
        .update({ enabled: false })
        .eq('id', row.id);
      if (off.error)
        console.error('[chat/skills] could not switch a skill off:', off.error.message);
    }
    const link = row.source_url ? sourceAt(row.source_url, 'HEAD') : null;
    const read: SourceRead = link
      ? await readGithubSkill(link, github)
      : { ok: false, refusal: { code: 'github_url' } };
    const decision = decideUpdate(row, read);
    if (decision.kind === 'update') done.updates += 1;
    if (decision.kind === 'source' || decision.kind === 'refused') done.unreadable += 1;
    const { error: keepError } = await supabaseAdmin
      .from('chat_skills')
      .update({
        update_checked_at: now.toISOString(),
        // The source moved back to the version kept: the update it had is withdrawn.
        ...(decision.kind === 'update' ? { update_sha: decision.sha } : {}),
        ...(decision.kind === 'same' ? { update_sha: null } : {}),
      })
      .eq('id', row.id)
      // An Admin approved an update meanwhile: this check read the old commit.
      .eq('commit_sha', row.commit_sha);
    if (keepError)
      console.error('[chat/skills] could not keep an update check:', keepError.message);
  }
  return done;
}

// ─── The update's review ────────────────────────────────────────────────────

const UPDATE_COLUMNS =
  'id, organization_id, name, title, description, body, license, compatibility, checksum_sha256, source_url, commit_sha, update_sha, created_by';

type UpdateRow = CheckRow & { created_by: string | null };

/** A skill's version as the update screen shows it. */
export interface SkillVersion {
  title: string;
  description: string;
  body: string;
  license: string | null;
}

/** What the update screen shows: the version kept, the new one, and what the checks found. */
export interface SkillUpdate {
  id: string;
  name: string;
  current: SkillVersion;
  next: SkillVersion;
  commitSha: string | null;
  updateSha: string;
  /** The new version's folder, pinned to its commit. */
  sourceUrl: string;
  scan: { blocks: string[]; warns: string[] };
  removed: string[];
  /** An Admin approves it, unless the scan blocks it. */
  can: { approve: boolean };
}

async function readUpdateRow(viewer: SkillViewer, id: string): Promise<UpdateRow | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .select(UPDATE_COLUMNS)
    .eq('id', id)
    .eq('organization_id', viewer.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the skill: ${error.message}`);
  const row = data as UpdateRow | null;
  return row && (viewer.role === 'admin' || row.created_by === viewer.userId) ? row : null;
}

/** The new version at update_sha, cleaned, scanned and its license read, as an import is. */
async function readNewVersion(row: UpdateRow, sha: string, github?: GithubOptions) {
  const link = row.source_url ? sourceAt(row.source_url, sha) : null;
  if (!link) return skillRefusal('github_url');
  const read = await readGithubSkill(link, github);
  if (!read.ok) return skillRefusal(read.refusal.code, read.refusal.detail);
  const parsed = parseSkillImport(read.value.files);
  if (!parsed.ok) return skillRefusal(parsed.refusal.code, parsed.refusal.detail);
  return { ok: true as const, value: { parsed: parsed.value, sourceUrl: read.value.sourceUrl } };
}

/** The update of a skill waiting for an Admin: an Admin's, or its creator's. */
export async function readSkillUpdate(
  viewer: SkillViewer,
  id: string,
  github?: GithubOptions,
): Promise<SkillResult<SkillUpdate>> {
  const row = await readUpdateRow(viewer, id);
  if (!row) return skillRefusal('not_found');
  if (!row.update_sha) return skillRefusal('no_update');
  const next = await readNewVersion(row, row.update_sha, github);
  if (!next.ok) return next;
  const { parsed, sourceUrl } = next.value;
  return {
    ok: true,
    value: {
      id: row.id,
      name: row.name,
      current: {
        title: row.title,
        description: row.description,
        body: row.body,
        license: row.license ?? null,
      },
      next: {
        title: parsed.parts.title,
        description: parsed.parts.description,
        body: parsed.parts.body,
        license: parsed.parts.license,
      },
      commitSha: row.commit_sha,
      updateSha: row.update_sha,
      sourceUrl,
      scan: parsed.scan,
      removed: parsed.removed,
      can: {
        approve: viewer.role === 'admin' && viewer.plan.writable && parsed.status !== 'blocked',
      },
    },
  };
}

/**
 * An Admin's approval of an update (item 16): the new version is read
 * again at the commit they saw, cleaned, scanned and its license checked;
 * kept with its /name, its new checksum and the commit, approved by them.
 * A blocked scan keeps the version in use. Whether it is on stays as it was.
 */
export async function applySkillUpdate(
  viewer: SkillViewer,
  id: string,
  updateSha: string,
  now = new Date(),
  github?: GithubOptions,
): Promise<SkillResult<{ id: string; commitSha: string }>> {
  if (viewer.role !== 'admin') return skillRefusal('role_review');
  if (!viewer.plan.writable) return skillRefusal('read_only');
  const row = await readUpdateRow(viewer, id);
  if (!row) return skillRefusal('not_found');
  if (row.update_sha !== updateSha) return skillRefusal('no_update');
  const next = await readNewVersion(row, updateSha, github);
  if (!next.ok) return next;
  const { parsed, sourceUrl } = next.value;
  if (parsed.status === 'blocked') return skillRefusal('blocked');
  const parts = { ...parsed.parts, name: row.name };
  const { data, error } = await supabaseAdmin
    .from('chat_skills')
    .update({
      title: parts.title,
      description: parts.description,
      body: parts.body,
      compatibility: parts.compatibility ?? null,
      license: parts.license,
      license_text: parsed.licenseText,
      checksum_sha256: skillChecksum(parts),
      scan_json: parsed.scan,
      removed_json: parsed.removed,
      source_url: sourceUrl,
      commit_sha: updateSha,
      update_sha: null,
      approved_by: viewer.userId,
      approved_at: now.toISOString(),
    })
    .eq('id', row.id)
    .eq('organization_id', viewer.organizationId)
    .eq('update_sha', updateSha)
    .select('id');
  if (error) throw new Error(`Could not update the skill: ${error.message}`);
  // Approved meanwhile by another Admin.
  if (!data?.length) return skillRefusal('no_update');
  return { ok: true, value: { id: row.id, commitSha: updateSha } };
}
