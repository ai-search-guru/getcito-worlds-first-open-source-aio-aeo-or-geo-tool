import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listSignalsFor } from '@/lib/mcp/data';

const STATUSES = ['new', 'acknowledged', 'resolved', 'dismissed'];

/** GET /api/mcp/signals — REST mirror of the `list_signals` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const statusRaw = url.searchParams.get('status');
  const kind = url.searchParams.get('kind') || undefined;
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const signals = await listSignalsFor(auth, {
      brandId,
      status: statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined,
      kind,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (signals === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ signals });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
