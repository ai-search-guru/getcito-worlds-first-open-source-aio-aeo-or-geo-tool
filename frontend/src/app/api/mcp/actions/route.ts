import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listActionsFor } from '@/lib/mcp/data';

const STATUSES = ['new', 'in_progress', 'on_hold', 'completed', 'dismissed'];
const CATEGORIES = ['growth', 'protect', 'recover', 'fix', 'compete'];

/** GET /api/mcp/actions — REST mirror of the `list_actions` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const statusRaw = url.searchParams.get('status');
  const categoryRaw = url.searchParams.get('category');
  const limitRaw = url.searchParams.get('limit');
  const sortRaw = url.searchParams.get('sort');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const actions = await listActionsFor(auth, {
      brandId,
      status: statusRaw && STATUSES.includes(statusRaw) ? statusRaw : undefined,
      category: categoryRaw && CATEGORIES.includes(categoryRaw) ? categoryRaw : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      sort: sortRaw === 'priority' || sortRaw === 'updated' ? sortRaw : undefined,
    });
    if (actions === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ actions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
