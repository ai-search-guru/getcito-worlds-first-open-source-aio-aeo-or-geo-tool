import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listTopicSuggestionsFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/topic-suggestions?brand_id=...
 *
 * Parallel REST surface for the `list_topic_suggestions` MCP tool — same
 * data-layer function, same ownership guarantee.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const suggestions = await listTopicSuggestionsFor(auth, brandId);
    if (suggestions === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
