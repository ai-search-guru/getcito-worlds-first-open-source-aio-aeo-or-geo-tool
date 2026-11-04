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
import { readSkillReview, reviewSkill, type SkillReview } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/skills/{id}/review
 *
 * An imported skill's review (CHAT-13 item 17, W3-09): its cleaned
 * SKILL.md as plain text, what the scan found, what was removed, its
 * source (pinned commit) and license, and whether the person may approve or
 * reject it. An Admin's, or its creator's.
 *
 * POST /api/chat/skills/{id}/review `{ decision: 'approve' | 'reject' }`
 *
 * An Admin's decision (item 18): approved, it is on for its creator,
 * private until it is shared; rejected, it stays off. A blocked skill is
 * only rejected.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad body, 401, 402 a read-only workspace (before anything else on a
 * POST), 403 not an Admin, 404 a skill they can't see, 409 reviewed
 * already, blocked or changed since it was kept.
 */
export async function GET(_req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await readSkillReview(viewer, id);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true; review: SkillReview }>({ ok: true, review: result.value });
  } catch (error) {
    console.error('[chat/skills] could not read a review:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the skill');
  }
}

const decisionBody = z.strictObject({ decision: z.enum(['approve', 'reject']) });

export async function POST(req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const body = decisionBody.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await reviewSkill(viewer, id, body.data.decision);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, skill: result.value });
  } catch (error) {
    console.error('[chat/skills] could not review a skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to review the skill');
  }
}
