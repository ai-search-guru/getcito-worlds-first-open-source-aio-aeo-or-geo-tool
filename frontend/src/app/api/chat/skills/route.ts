import { NextResponse } from 'next/server';
import { skillViewerFor } from '@/lib/chat/skills/api';
import { listSkills, type SkillList } from '@/lib/chat/skills/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/skills
 *
 * Chat's skills (CHAT-13 items 8, 10; W3-06): the GetCito library with
 * what the workspace turned off, the workspace's own skills the person sees
 * (an Admin all; anyone else theirs and the approved shared ones), the
 * plan's My skills limit and what the person may do with each. Every role
 * reads; bodies stay on the server.
 *
 * A skill is saved in Chat (save_skill). Its other changes:
 * PATCH /api/chat/skills/{id} `{ enabled }`, DELETE /api/chat/skills/{id},
 * POST /api/chat/skills/{id}/share, and for a library skill
 * PATCH /api/chat/skills/library/{name} `{ enabled }`.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 401 no
 * session, 404 Chat off for the workspace (CHAT_AGENTIC).
 */
export async function GET() {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const viewer = await skillViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const list = await listSkills(viewer);
    return NextResponse.json<{ ok: true } & SkillList>({ ok: true, ...list });
  } catch (error) {
    console.error('[chat/skills] could not list skills:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read skills');
  }
}
