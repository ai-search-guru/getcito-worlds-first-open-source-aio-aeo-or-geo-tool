import { NextResponse } from 'next/server';
import { chatIdOf, markChatRead } from '@/lib/chat/conversations';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * POST /api/chat/conversations/{id}/read
 *
 * The person opened the chat: its newest result is read (it leaves Agents
 * at work and isn't bold any more, CHAT-01 agentic update). A teammate's
 * shared chat answers ok and stays as its author left it. 404 for a chat the
 * person can't open. Refusals as values (#1777).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const id = chatIdOf((await params).id);
    if (!id) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const read = await markChatRead(actor, id);
    if (!read.ok) return runFailure(404, 'not_found', 'not_found', 'Not found');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[chat/conversations] could not mark a chat read:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to mark the chat read');
  }
}
