import { NextResponse } from 'next/server';
import { writeRefusal } from '@/lib/subscriptionGuard';
import {
  invalidMemoryResponse,
  memoryIdOf,
  memoryRefusalResponse,
  memoryViewerFor,
} from '@/lib/chat/memory/api';
import { listMemory, saveMemory, type MemoryList } from '@/lib/chat/memory/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/memory?brand_id=
 *
 * What Chat remembers (CHAT-14 items 21–25; W3-11): the person's Me lines,
 * the brand's (one they may use; none without brand_id) and the
 * workspace's, the switches, what they may do in each scope and how full
 * each is. With the workspace's switch off only an Admin gets the lines.
 * Every role reads.
 *
 * POST /api/chat/memory `{ scope, text, brandId? }`
 *
 * Adds a line from the Memory page (source `page`), checked as Chat's are:
 * the text (item 12), the scope's rights (item 25), the limits (item 19).
 * A Manager's Workspace line goes to the Admins as a request
 * (`{ ok: true, requested: true }`).
 *
 * Changes: PATCH and DELETE /api/chat/memory/{id}, POST
 * /api/chat/memory/{id}/restore (Undo), PATCH /api/chat/memory/settings.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * bad body or a line memory can't keep, 401, 402 a read-only workspace, 403
 * a scope they only read, 404 Chat off for the workspace (CHAT_AGENTIC),
 * 409 memory off or full.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const brandId = memoryIdOf(new URL(req.url).searchParams.get('brand_id'));
    const list = await listMemory(viewer, brandId);
    return NextResponse.json<{ ok: true } & MemoryList>({ ok: true, ...list });
  } catch (error) {
    console.error('[chat/memory] could not list the memory:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the memory');
  }
}

export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const refusal = await writeRefusal();
    if (refusal) return refusal;
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return invalidMemoryResponse();
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await saveMemory(viewer, body, 'page');
    if (!result.ok) return memoryRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, ...result.value });
  } catch (error) {
    console.error('[chat/memory] could not save the memory:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to save the memory');
  }
}
