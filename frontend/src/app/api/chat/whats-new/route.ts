import { NextResponse } from 'next/server';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { readWhatsNew } from '@/lib/chat/whats-new/reads';

/**
 * GET /api/chat/whats-new?unread=true&limit=3&days=14
 *
 * What's new for the person's plan (CHAT-11, W4-20): entries their plan
 * shows, newest unread first, each with whether it is read and, for one
 * their plan doesn't include, the plans that do (`onPlans`); `hasUnread`
 * for the What's new chip's dot. Chat Home's New line asks for the newest
 * unread one of the last 14 days (`unread=true&limit=1&days=14`). No
 * brand data, no price.
 *
 * Refusals as values (#1777): 401, 404 while Chat is off; a bad parameter
 * is left out.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const params = new URL(req.url).searchParams;
    const number = (key: string, max: number) => {
      const value = Number(params.get(key));
      return Number.isInteger(value) && value >= 1 && value <= max ? value : undefined;
    };
    const read = await readWhatsNew({
      userId: actor.userId,
      organizationId: actor.organizationId,
      unreadOnly: params.get('unread') === 'true',
      limit: number('limit', 10),
      days: number('days', 365),
    });
    return NextResponse.json({
      ok: true,
      entries: read.items,
      hasUnread: read.hasUnread,
      more: read.more,
    });
  } catch (error) {
    console.error("[chat/whats-new] could not read What's new:", error);
    return runFailure(500, 'failed', 'failed', "Failed to read What's new");
  }
}
