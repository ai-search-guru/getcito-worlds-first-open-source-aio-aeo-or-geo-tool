import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { setContentDraftReadyFor } from '@/lib/mcp/content';
import { contentUuid } from '@/lib/mcp/contentSchemas';

/** POST /api/mcp/content-drafts/[id]/ready — REST mirror of `set_content_draft_ready`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!contentUuid.safeParse(id).success) {
    return NextResponse.json({ error: 'id must be a draft UUID' }, { status: 400 });
  }
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('set_content_draft_ready', auth.organizationId, {
      draft_id: id,
    });
    if (refused) return refused;
    const result = await setContentDraftReadyFor(auth, id);
    if (result === 'in_review') {
      return NextResponse.json(
        { error: 'The draft is in review: a person marks it ready in the editor' },
        { status: 409 },
      );
    }
    if (!result) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
