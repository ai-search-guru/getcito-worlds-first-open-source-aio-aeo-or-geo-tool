import { NextResponse } from 'next/server';
import { z } from 'zod';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { markWhatsNewRead } from '@/lib/chat/whats-new/reads';

const body = z.object({ slugs: z.array(z.string().max(80)).min(1).max(10) });

/**
 * POST /api/chat/whats-new/read  { slugs: string[] }
 *
 * Marks What's new entries read for the person (CHAT-11 item 18): Try it
 * opened from a card. Slugs of entries that don't exist are ignored.
 * Answers as a value (#1777): `{ ok }`, 400 a body that isn't one, 401,
 * 404 while Chat is off.
 */
export async function POST(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return runFailure(400, 'failed', 'invalid', 'Invalid request');
    const ok = await markWhatsNewRead(actor.userId, parsed.data.slugs);
    return ok
      ? NextResponse.json({ ok: true })
      : runFailure(500, 'failed', 'failed', 'Failed to mark read');
  } catch (error) {
    console.error('[chat/whats-new] could not mark read:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to mark read');
  }
}
