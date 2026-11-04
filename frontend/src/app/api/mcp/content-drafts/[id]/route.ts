import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getContentDraftFor } from '@/lib/mcp/content';
import { contentUuid } from '@/lib/mcp/contentSchemas';

/** GET /api/mcp/content-drafts/[id] — REST mirror of the `get_content_draft` MCP tool. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!contentUuid.safeParse(id).success) {
    return NextResponse.json({ error: 'id must be a draft UUID' }, { status: 400 });
  }
  try {
    const draft = await getContentDraftFor(auth, id);
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(draft);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
