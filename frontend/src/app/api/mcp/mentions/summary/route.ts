import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getMentionsSummaryFor, mentionsFiltersFromUrl } from '@/lib/mcp/mentions';

/**
 * GET /api/mcp/mentions/summary — REST mirror of the `get_mentions_summary`
 * MCP tool. Filters: brand_id (required), date_from, date_to, platform,
 * region, topic_id, search; 30 days when date_from is left out.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const filters = mentionsFiltersFromUrl(new URL(req.url));
  if (!filters) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const summary = await getMentionsSummaryFor(auth, filters);
    if (!summary) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
