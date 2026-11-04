import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listCatalogProductsFor } from '@/lib/mcp/catalog';

/** GET /api/mcp/catalog/products — REST mirror of the `list_catalog_products` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const number = (name: string) => {
    const raw = url.searchParams.get(name);
    const value = raw === null ? undefined : Number.parseInt(raw, 10);
    return value !== undefined && Number.isFinite(value) ? value : undefined;
  };

  try {
    const page = await listCatalogProductsFor(auth, {
      brandId,
      search: url.searchParams.get('search')?.slice(0, 200) ?? undefined,
      limit: number('limit'),
      offset: number('offset'),
    });
    if (page === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
