import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getMentionsPerceptionFor, mentionsFiltersFromUrl } from '@/lib/mcp/mentions';

/**
 * GET /api/mcp/mentions/perception — REST mirror of the
 * `get_mentions_perception` MCP tool, with the summary's filters.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const filters = mentionsFiltersFromUrl(new URL(req.url));
  if (!filters) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const perception = await getMentionsPerceptionFor(auth, filters);
    if (!perception) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(perception);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
