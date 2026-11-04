import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listActionHistoryFor } from '@/lib/mcp/data';

/** GET /api/mcp/action-history — REST mirror of the `list_action_history` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const history = await listActionHistoryFor(auth, {
      brandId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (history === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ actions: history });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
