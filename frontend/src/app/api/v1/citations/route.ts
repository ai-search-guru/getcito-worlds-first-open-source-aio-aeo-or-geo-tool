import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import {
  listCitationsFor,
  CITATION_SOURCE_FILTERS,
  type CitationSourceFilter,
} from '@/lib/mcp/data';

/**
 * GET /api/v1/citations
 *
 * Citations overview for the Public Metrics API — the domains and URLs AI
 * engines cite alongside a brand, classified by source type. Same data-layer
 * function the MCP `list_citations` tool uses, same ownership guarantee.
 * Query params: brand_id (required), date_from, date_to, model, region,
 * topic_id, limit (1-200), source_filter (all|owned|competitor|external).
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const sourceFilterParam = url.searchParams.get('source_filter') || undefined;
  if (
    sourceFilterParam &&
    !CITATION_SOURCE_FILTERS.includes(sourceFilterParam as CitationSourceFilter)
  ) {
    return NextResponse.json(
      { error: `source_filter must be one of: ${CITATION_SOURCE_FILTERS.join(', ')}` },
      { status: 400 },
    );
  }

  let limit: number | undefined;
  const limitParam = url.searchParams.get('limit');
  if (limitParam !== null) {
    limit = Number.parseInt(limitParam, 10);
    if (Number.isNaN(limit) || limit < 1 || limit > 200) {
      return NextResponse.json(
        { error: 'limit must be a number between 1 and 200' },
        { status: 400 },
      );
    }
  }

  try {
    const result = await listCitationsFor(auth, {
      brandId,
      dateFrom: url.searchParams.get('date_from') ?? undefined,
      dateTo: url.searchParams.get('date_to') ?? undefined,
      model: url.searchParams.get('model') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
      topicId: url.searchParams.get('topic_id') ?? undefined,
      limit,
      sourceFilter: sourceFilterParam as CitationSourceFilter | undefined,
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
