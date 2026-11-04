import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getMentionFor } from '@/lib/mcp/mentions';

/** GET /api/mcp/mentions/[id] — REST mirror of the `get_mention` MCP tool. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const mention = await getMentionFor(auth, id);
    if (!mention) {
      return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
    }
    return NextResponse.json(mention);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
