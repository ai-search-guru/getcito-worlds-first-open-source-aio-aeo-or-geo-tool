import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  missingSkillResponse,
  skillIdOf,
  skillRefusalResponse,
  skillViewerFor,
  type SkillParams,
} from '@/lib/chat/skills/api';
import { shareSkill, type ShareOutcome } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/skills/{id}/share
 *
 * Shares an approved skill with the workspace (CHAT-13 item 10, CHAT-20
 * §4): an Admin shares it (`{ shared: true }`), and the Managers' requests
 * to share it are answered; its creator, a Manager, sends the Admins a
 * request instead (`{ requested: true }`, Settings › Team › Roles & access
 * › Requests). Analysts and Agency partners don't save or share skills.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 401,
 * 402 a read-only workspace (before anything else), 403 not theirs to
 * share, 404 a skill they can't see, 409 not approved, 429 too many
 * requests waiting.
 */
export async function POST(_req: Request, { params }: SkillParams) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const id = skillIdOf((await params).id);
    if (!id) return missingSkillResponse();
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await shareSkill(viewer, id);
    if (!result.ok) return skillRefusalResponse(result.refusal);
    return NextResponse.json<{ ok: true } & ShareOutcome>({ ok: true, ...result.value });
  } catch (error) {
    console.error('[chat/skills] could not share a skill:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to share the skill');
  }
}
