import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getPromptLocationsFor } from '@/lib/mcp/promptLocations';

/**
 * GET /api/mcp/prompt-locations — REST mirror of the `get_prompt_locations`
 * MCP tool. `locations` is a comma-separated list of codes.
 */
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
  const days = number('days');
  if (days !== undefined && ![7, 30, 90].includes(days)) {
    return NextResponse.json({ error: 'days must be 7, 30 or 90' }, { status: 400 });
  }
  const date = (name: string) => {
    const value = url.searchParams.get(name) ?? undefined;
    return value !== undefined && !Number.isFinite(Date.parse(value)) ? null : value;
  };
  const from = date('date_from');
  const to = date('date_to');
  if (from === null || to === null) {
    return NextResponse.json({ error: 'date_from and date_to must be dates' }, { status: 400 });
  }

  try {
    const view = await getPromptLocationsFor(auth, {
      brandId,
      locations: url.searchParams.get('locations')?.split(','),
      days,
      from,
      to,
      limit: number('limit'),
      offset: number('offset'),
    });
    if (view === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(view);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
