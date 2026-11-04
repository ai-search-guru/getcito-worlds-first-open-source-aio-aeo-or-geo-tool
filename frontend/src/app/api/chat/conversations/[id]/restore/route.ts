import { NextResponse } from 'next/server';
import { chatIdOf, restoreChat } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/conversations/{id}/restore
 *
 * Undo after Delete (CHAT-23 `toast.undo`): the chat comes back as it was,
 * for a minute after it was deleted. 404 for a chat that isn't deleted or
 * isn't the person's to restore; 410 once its Undo is over. Refusals as
 * values (#1777).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const restored = await restoreChat(actor, id);
    if (!restored.ok) {
      return restored.reason === 'expired'
        ? runFailure(410, 'failed', 'expired', 'Too late to undo')
        : runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/conversations] could not restore a chat:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to restore the chat');
  }
}
