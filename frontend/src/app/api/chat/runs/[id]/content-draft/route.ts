import { NextResponse } from 'next/server';
import { z } from 'zod';
import { answerToDraft } from '@/lib/chat/fileStore';
import { chatActor, runFailure, runIdOf } from '@/lib/chat/runApi';
import { failedCallResponse, writeRefusal } from '@/lib/subscriptionGuard';

type Params = { params: Promise<{ id: string }> };

// guid, not uuid: brand ids made by hand (the demo brand's) aren't RFC 4122 ones.
const body = z.object({ brandId: z.guid().nullable().optional() });

/**
 * POST /api/chat/runs/{id}/content-draft `{ brandId? }`
 *
 * Open in Content Editor on an answer (CHAT-06 item 6): a new Content draft
 * with the answer as its page; answers where to open it. The chat's brand,
 * else the brand the person has open (`brandId`). A read-only workspace and
 * the demo brand are refused as Content's own writes are (402); an answer
 * the person can't open is 404.
 */
export async function POST(req: Request, { params }: Params) {
  try {
    const refused = await writeRefusal();
    if (refused) return refused;
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const runId = runIdOf((await params).id);
    if (!runId) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const input = body.safeParse(await req.json().catch(() => ({})));
    if (!input.success) return runFailure(400, 'failed', 'invalid', 'Invalid brand');
    const made = await answerToDraft(actor, runId, input.data.brandId ?? null);
    if ('failure' in made) {
      return made.failure === 'no_brand'
        ? runFailure(400, 'failed', 'no_brand', 'Pick a brand first')
        : runFailure(404, 'not_found', 'not_found', 'Not found');
    }
    return NextResponse.json(
      { ok: true, href: `/dashboard/content/editor/${made.draftId}` },
      { status: 201 },
    );
  } catch (error) {
    console.error('[chat/runs] could not open an answer in the Content Editor:', error);
    return failedCallResponse(error);
  }
}
