import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN } from '@/lib/mcp/data';
import { PV_PERIODS, getShoppingShelfFor } from '@/lib/mcp/productVisibility';
import { isShoppingMarket } from '@/lib/shopping/markets';

/** GET /api/mcp/product-visibility/shelf — REST mirror of the `get_shopping_shelf` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const period = PV_PERIODS.find((p) => p === url.searchParams.get('period'));
  const marketParam = url.searchParams.get('market');
  const market = isShoppingMarket(marketParam) ? marketParam : undefined;
  const number = (name: string) => {
    const raw = url.searchParams.get(name);
    const value = raw === null ? undefined : Number.parseInt(raw, 10);
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };

  try {
    const read = await getShoppingShelfFor(auth, {
      brandId,
      period,
      platform: url.searchParams.get('platform')?.slice(0, 64) || undefined,
      market,
      absentOnly: url.searchParams.get('absent_only') === 'true',
      limit: number('limit'),
      offset: number('offset'),
    });
    if (read === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    if (read === NOT_IN_PLAN) return NextResponse.json(SHOPPING_NOT_IN_PLAN, { status: 403 });
    return NextResponse.json(read);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
