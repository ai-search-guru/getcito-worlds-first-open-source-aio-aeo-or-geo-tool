import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN, listShoppingCards } from '@/lib/mcp/data';

/**
 * GET /api/mcp/shopping-cards (and /api/v1/shopping-cards)
 *
 * Parallel REST surface for the `list_shopping_cards` MCP tool. 403
 * plan_limit on a plan without shopping analytics (Starter).
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const role = url.searchParams.get('role') || undefined;
  const platform = url.searchParams.get('platform') || undefined;
  const region = url.searchParams.get('region') || undefined;

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  const cursor = url.searchParams.get('cursor') || undefined;

  if (role && !['own', 'competitor', 'other'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  try {
    const result = await listShoppingCards(auth, {
      brandId,
      role: role as 'own' | 'competitor' | 'other' | undefined,
      platform,
      region,
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor,
    });
    if (result === NOT_IN_PLAN) {
      return NextResponse.json(SHOPPING_NOT_IN_PLAN, { status: 403 });
    }
    if (result === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
