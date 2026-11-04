import { NextResponse } from 'next/server';
import {
  invalidMemoryResponse,
  memoryRefusalResponse,
  memoryViewerFor,
} from '@/lib/chat/memory/api';
import { memorySwitchesPatch, setMemorySwitches } from '@/lib/chat/memory/store';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * PATCH /api/chat/memory/settings `{ personal?, workspace? }`
 *
 * Turns memory on or off (CHAT-14 item 24): `personal` is the person's own
 * "Use memory" (every role); `workspace` the workspace's switch, an
 * Admin's, which hides Memory for everyone. Answers with both switches.
 * "Use memory" stays open while the workspace is read-only (the person's
 * own data, KVKK/GDPR); the store answers 402 for the workspace's switch.
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400,
 * 401, 402 a read-only workspace, 403 the workspace's switch for a
 * non-Admin, 404 Chat off.
 */
export async function PATCH(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const body = memorySwitchesPatch.safeParse(await req.json().catch(() => null));
    if (!body.success) return invalidMemoryResponse();
    const viewer = await memoryViewerFor(actor);
    if (viewer instanceof NextResponse) return viewer;
    const result = await setMemorySwitches(viewer, body.data);
    if (!result.ok) return memoryRefusalResponse(result.refusal);
    return NextResponse.json({ ok: true, switches: result.value });
  } catch (error) {
    console.error('[chat/memory] could not change the memory switches:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to change the memory settings');
  }
}
