import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getPromptPerformanceFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/prompt-performance
 *
 * Parallel REST surface for the `get_prompt_performance` MCP tool — same
 * data-layer function, same ownership guarantee. Query params mirror the
 * MCP args: brand_id (required), date_from, date_to, topic_id, sort_by,
 * order, limit, model, region.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const sortByParam = url.searchParams.get('sort_by') || undefined;
  if (
    sortByParam &&
    !['visibility', 'mentions', 'citations', 'appearances'].includes(sortByParam)
  ) {
    return NextResponse.json(
      { error: 'sort_by must be "visibility", "mentions", "citations", or "appearances"' },
      { status: 400 },
    );
  }

  const orderParam = url.searchParams.get('order') || undefined;
  if (orderParam && !['desc', 'asc'].includes(orderParam)) {
    return NextResponse.json({ error: 'order must be "desc" or "asc"' }, { status: 400 });
  }

  let limit: number | undefined;
  const limitParam = url.searchParams.get('limit');
  if (limitParam !== null) {
    limit = parseInt(limitParam, 10);
    if (isNaN(limit) || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'limit must be a number between 1 and 100' },
        { status: 400 },
      );
    }
  }

  try {
    const result = await getPromptPerformanceFor(auth, {
      brandId,
      dateFrom: url.searchParams.get('date_from') ?? undefined,
      dateTo: url.searchParams.get('date_to') ?? undefined,
      topicId: url.searchParams.get('topic_id') ?? undefined,
      sortBy: sortByParam as 'visibility' | 'mentions' | 'citations' | 'appearances' | undefined,
      order: orderParam as 'desc' | 'asc' | undefined,
      limit,
      model: url.searchParams.get('model') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
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
