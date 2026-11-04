import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { suggestContentChangesFor } from '@/lib/mcp/content';
import { contentUuid, suggestionsShape } from '@/lib/mcp/contentSchemas';

/**
 * POST /api/mcp/content-drafts/[id]/suggestions — REST mirror of the
 * `suggest_content_changes` MCP tool. Body: { suggestions: [...] }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = z.object(suggestionsShape).safeParse(await req.json().catch(() => null));
  if (!contentUuid.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('suggest_content_changes', auth.organizationId, {
      draft_id: id,
    });
    if (refused) return refused;
    const result = await suggestContentChangesFor(auth, id, parsed.data.suggestions);
    if (result === 'published') {
      return NextResponse.json(
        { error: 'The draft is published; suggest on a new draft' },
        { status: 409 },
      );
    }
    if (result === 'open_suggestions') {
      return NextResponse.json(
        {
          error:
            'A person still has open suggestions on this draft to accept or reject; suggest again once the draft lists none',
        },
        { status: 409 },
      );
    }
    if (result === 'writing') {
      return NextResponse.json(
        { error: 'The Content Agent is writing this draft; suggest again once it has finished' },
        { status: 409 },
      );
    }
    if (!result) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(result, { status: result.kept ? 201 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
