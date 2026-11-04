import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { addContentSourceFor, getContentSourcesFor } from '@/lib/mcp/content';
import { addSourceShape, contentUuid, sourceRefError } from '@/lib/mcp/contentSchemas';

/** GET /api/mcp/content-drafts/[id]/sources — REST mirror of `get_content_sources`. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!contentUuid.safeParse(id).success) {
    return NextResponse.json({ error: 'id must be a draft UUID' }, { status: 400 });
  }
  try {
    const sources = await getContentSourcesFor(auth, id);
    if (!sources) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(sources);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/mcp/content-drafts/[id]/sources — REST mirror of
 * `add_content_source`. Body: { kind: prompt | cited_page | gsc_query, ref }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = z.object(addSourceShape).safeParse(await req.json().catch(() => null));
  if (!contentUuid.safeParse(id).success || !parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { kind, ref } = parsed.data;
  const refError = sourceRefError(kind, ref);
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('add_content_source', auth.organizationId, {
      draft_id: id,
    });
    if (refused) return refused;
    const result = await addContentSourceFor(
      auth,
      id,
      kind === 'prompt' ? { kind, promptId: ref } : { kind, ref },
    );
    if (result === 'not_found')
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    if (!result) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
