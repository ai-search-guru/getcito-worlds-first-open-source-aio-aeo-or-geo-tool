import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { skillRefusalResponse, skillViewerFor } from '@/lib/chat/skills/api';
import { readGithubSkill } from '@/lib/chat/skills/github';
import { MAX_UPLOAD, parseSkillImport, parseSkillUpload } from '@/lib/chat/skills/import';
import {
  canImportSkill,
  importSkill,
  skillRefusal,
  type ImportedSkill,
} from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/skills/import
 *
 * Imports a skill for review (CHAT-13 items 13–18, W3-09): an upload
 * (multipart `file`: a SKILL.md or a .zip of the skill's folder, at most
 * 5 MB) or a GitHub link (JSON `{ url }`: a public repository, or a folder
 * or a SKILL.md in it, read at one commit). It is read as instructions only
 * (lib/chat/skills/import.ts), then kept off and private, waiting for an
 * Admin's review (`pending_review`), or `blocked` when the scan blocks it.
 * A Manager's import asks the Admins to review it. Admins and Managers, on
 * a paid plan.
 *
 * Answers `{ ok: true, skill: { id, name, title, status, removed,
 * warnings, blocks, requested } }`. Refusals as values (`{ ok: false,
 * failure, code, error, detail? }`, #1777): 400 what can't be imported and
 * why, 401, 402 a read-only workspace (before anything else), 403 role or
 * plan, 409 the name, 413 too large, 429/502 GitHub.
 */
export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    // Role and plan first: a refused import never reads the upload or GitHub.
    const cannot = canImportSkill(viewer);
    if (cannot) return skillRefusalResponse(cannot.refusal);

    const kind = req.headers.get('content-type') ?? '';
    let parsed;
    let source: { url: string | null; commitSha: string | null } = { url: null, commitSha: null };
    if (kind.includes('multipart/form-data')) {
      const form = await req.formData().catch(() => null);
      const file = form?.get('file');
      if (!(file instanceof File)) return invalid('add a SKILL.md or a .zip');
      if (file.size > MAX_UPLOAD) return skillRefusalResponse(skillRefusal('too_large').refusal);
      parsed = parseSkillUpload(file.name, new Uint8Array(await file.arrayBuffer()));
    } else {
      const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
      if (typeof body?.url !== 'string' || body.url.length > 2048) {
        return invalid('add a github.com link');
      }
      const read = await readGithubSkill(body.url);
      if (!read.ok) {
        return skillRefusalResponse(skillRefusal(read.refusal.code, read.refusal.detail).refusal);
      }
      parsed = parseSkillImport(read.value.files);
      source = { url: read.value.sourceUrl, commitSha: read.value.commitSha };
    }
    if (!parsed.ok) {
      return skillRefusalResponse(skillRefusal(parsed.refusal.code, parsed.refusal.detail).refusal);
    }
    const kept = await importSkill(viewer, parsed.value, source);
    if (!kept.ok) return skillRefusalResponse(kept.refusal);
    return NextResponse.json<{ ok: true; skill: ImportedSkill }>({ ok: true, skill: kept.value });
  } catch (error) {
    console.error('[chat/skills] could not import a skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to import the skill');
  }
}

const invalid = (problems: string) =>
  skillRefusalResponse(skillRefusal('invalid', { problems }).refusal);
