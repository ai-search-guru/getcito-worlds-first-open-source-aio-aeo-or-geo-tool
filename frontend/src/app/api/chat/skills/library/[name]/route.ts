import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  enabledBody,
  invalidSkillResponse,
  skillRefusalResponse,
  skillViewerFor,
} from '@/lib/chat/skills/api';
import { setLibrarySkillEnabled } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * PATCH /api/chat/skills/library/{name} `{ enabled }`
 *
 * Turns an GetCito library skill on or off for the whole workspace
 * (chat_settings.disabled_skills, 00458): an Admin's. Off, it leaves the /
 * menu and Chat's list, and agents that run it pause (skill_off).
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad body, 401, 402 a read-only workspace (before anything else), 403 not
 * an Admin, 404 no such library skill.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const body = enabledBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await setLibrarySkillEnabled(viewer, (await params).name, body.data.enabled);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, skill: result.value });
  } catch (error) {
    console.error('[chat/skills] could not change a library skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the skill');
  }
}
