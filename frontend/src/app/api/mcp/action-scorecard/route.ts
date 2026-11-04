import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getActionScorecardFor } from '@/lib/mcp/learning';

/** GET /api/mcp/action-scorecard — REST mirror of the `get_action_scorecard` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const since = url.searchParams.get('date_from') ?? undefined;
  if (since !== undefined && !Number.isFinite(Date.parse(since))) {
    return NextResponse.json({ error: 'date_from is not a date' }, { status: 400 });
  }

  try {
    const scorecard = await getActionScorecardFor(auth, { brandId, since });
    if (scorecard === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ scorecard });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
