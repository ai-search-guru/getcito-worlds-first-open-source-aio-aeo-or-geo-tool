import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getMentionCompetitorsFor, mentionsFiltersFromUrl } from '@/lib/mcp/mentions';

/**
 * GET /api/mcp/mentions/competitors — REST mirror of the
 * `get_mention_competitors` MCP tool, with the summary's filters.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const filters = mentionsFiltersFromUrl(new URL(req.url));
  if (!filters) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const competitors = await getMentionCompetitorsFor(auth, filters);
    if (!competitors) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(competitors);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
