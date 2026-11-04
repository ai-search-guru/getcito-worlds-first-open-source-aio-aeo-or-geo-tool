import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  invalidSkillResponse,
  missingSkillResponse,
  skillIdOf,
  skillRefusalResponse,
  skillViewerFor,
  type SkillParams,
} from '@/lib/chat/skills/api';
import { applySkillUpdate, readSkillUpdate, type SkillUpdate } from '@/lib/chat/skills/updates';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/skills/{id}/update
 *
 * An imported skill's update (CHAT-13 items 16 and 19, W4-31): the version
 * in use and the new one at its source, read again at the commit the
 * weekly check found, cleaned and scanned as an import is, with what was
 * removed and its license. An Admin's, or its creator's.
 *
 * POST /api/chat/skills/{id}/update `{ updateSha }`
 *
 * An Admin approves the update they read (its commit): it is read, cleaned,
 * scanned and its license checked again, then kept in place of the version
 * in use, with its /name. A blocked scan keeps the version in use.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad body or a source we can't take, 401, 402 a read-only workspace
 * (before anything else on a POST), 403 not an Admin, 404 a skill they
 * can't see, 409 no update (approved meanwhile) or blocked, 429/502 GitHub.
 */
export async function GET(_req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await readSkillUpdate(viewer, id);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; update: SkillUpdate }>({ ok: true, update: result.value });
  } catch (error) {
    console.error('[chat/skills] could not read an update:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the update');
  }
}

const approveBody = z.strictObject({ updateSha: z.string().regex(/^[0-9a-f]{40}$/) });

export async function POST(req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const body = approveBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await applySkillUpdate(viewer, id, body.data.updateSha);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, skill: result.value });
  } catch (error) {
    console.error('[chat/skills] could not apply an update:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to update the skill');
  }
}
