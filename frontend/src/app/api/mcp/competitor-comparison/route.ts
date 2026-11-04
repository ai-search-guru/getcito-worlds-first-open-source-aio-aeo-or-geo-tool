import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getCompetitorComparisonFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/competitor-comparison
 *
 * Parallel REST surface for the `get_competitor_comparison` MCP tool — same
 * data-layer function, same ownership guarantee. Query params mirror the MCP
 * tool's args: brand_id (required), date_from, date_to, model, region, topic_id.
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
    const result = await getCompetitorComparisonFor(auth, {
      brandId,
      dateFrom: url.searchParams.get('date_from') ?? undefined,
      dateTo: url.searchParams.get('date_to') ?? undefined,
      model: url.searchParams.get('model') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
      topicId: url.searchParams.get('topic_id') ?? undefined,
    });
    if (!result) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
