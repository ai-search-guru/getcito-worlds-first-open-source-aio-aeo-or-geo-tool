import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { markContentDraftPublishedFor } from '@/lib/mcp/contentDelivery';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';
import { contentUuid } from '@/lib/mcp/contentSchemas';

const body = z.object({ url: z.string().max(2048) });

/**
 * POST /api/mcp/content-drafts/[id]/published — REST mirror of
 * `mark_content_draft_published`. Body: { url }.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!contentUuid.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('mark_content_draft_published', auth.organizationId, {
      draft_id: id,
    });
    if (refused) return refused;
    const result = await markContentDraftPublishedFor(auth, id, parsed.data.url);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: result.error === 'not_found' ? 404 : 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return failedCallResponse(err);
  }
}
