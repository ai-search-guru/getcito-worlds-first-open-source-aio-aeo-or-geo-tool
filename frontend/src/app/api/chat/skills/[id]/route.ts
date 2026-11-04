import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  enabledBody,
  invalidSkillResponse,
  missingSkillResponse,
  skillIdOf,
  skillRefusalResponse,
  skillViewerFor,
  type SkillParams,
} from '@/lib/chat/skills/api';
import { deleteSkill, setSkillEnabled } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * PATCH /api/chat/skills/{id} `{ enabled }`
 *
 * Turns a workspace skill on or off for everyone (Wave 3 decision 10): an
 * Admin, or the person who made it (an Admin or Manager). Only an approved
 * skill that still matches its checksum comes on (CHAT-13 items 18–19).
 *
 * DELETE /api/chat/skills/{id}
 *
 * Deletes it: an Admin or its creator. Agents that run it pause (skill_off).
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad body, 401, 402 a read-only workspace (before anything else), 403 not
 * theirs to change, 404 a skill they can't see, 409 not approved or changed.
 */
export async function PATCH(req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const body = enabledBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await setSkillEnabled(viewer, id, body.data.enabled);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, skill: result.value });
  } catch (error) {
    console.error('[chat/skills] could not change a skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the skill');
  }
}

export async function DELETE(_req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await deleteSkill(viewer, id);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/skills] could not delete a skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to delete the skill');
  }
}
