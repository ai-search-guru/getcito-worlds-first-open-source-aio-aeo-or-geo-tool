import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import {
  isMentionSentiment,
  isMentionSort,
  listMentionsFor,
  mentionsFiltersFromUrl,
} from '@/lib/mcp/mentions';

/**
 * GET /api/mcp/mentions — REST mirror of the `list_mentions` MCP tool: the
 * summary's filters plus sentiment, competitor_id (`none` for responses
 * naming no competitor), sort (newest | oldest | co_mentions | negative) and
 * page (100 rows a page).
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const filters = mentionsFiltersFromUrl(url);
  if (!filters) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const sentiment = url.searchParams.get('sentiment');
  const sort = url.searchParams.get('sort');
  const page = Number.parseInt(url.searchParams.get('page') ?? '', 10);

  try {
    const list = await listMentionsFor(auth, {
      ...filters,
      sentiment: isMentionSentiment(sentiment) ? sentiment : undefined,
      competitorId: url.searchParams.get('competitor_id') ?? undefined,
      sort: isMentionSort(sort) ? sort : undefined,
      page: Number.isFinite(page) ? page : undefined,
    });
    if (!list) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(list);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
