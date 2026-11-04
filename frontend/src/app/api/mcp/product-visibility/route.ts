import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { NOT_IN_PLAN, SHOPPING_NOT_IN_PLAN, getProductVisibility } from '@/lib/mcp/data';

/**
 * GET /api/mcp/product-visibility
 *
 * Parallel REST surface for the `get_product_visibility` MCP tool. 403
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

  const productTitle = url.searchParams.get('product_title');
  if (!productTitle) {
    return NextResponse.json({ error: 'product_title is required' }, { status: 400 });
  }

  try {
    const result = await getProductVisibility(auth, {
      brandId,
      productTitle,
    });
    if (result === NOT_IN_PLAN) {
      return NextResponse.json(SHOPPING_NOT_IN_PLAN, { status: 403 });
    }
    if (result === null) {
      return NextResponse.json({ error: 'Product or Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ visibility: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
