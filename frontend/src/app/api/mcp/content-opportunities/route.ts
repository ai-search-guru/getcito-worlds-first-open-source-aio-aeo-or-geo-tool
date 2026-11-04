import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listContentOpportunitiesFor } from '@/lib/mcp/data';

export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const statusRaw = url.searchParams.get('status');
  const impactRaw = url.searchParams.get('impact');
  const typeRaw = url.searchParams.get('type');
  const limitRaw = url.searchParams.get('limit');

  const status =
    statusRaw === 'new' ||
    statusRaw === 'sent' ||
    statusRaw === 'in_progress' ||
    statusRaw === 'done' ||
    statusRaw === 'dismissed'
      ? statusRaw
      : undefined;

  const impact =
    impactRaw === 'high' || impactRaw === 'medium' || impactRaw === 'low' ? impactRaw : undefined;

  const type = typeRaw === 'owned' || typeRaw === 'earned' ? typeRaw : undefined;

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const opportunities = await listContentOpportunitiesFor(auth, {
      brandId,
      status,
      impact,
      type,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    if (opportunities === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    return NextResponse.json({ opportunities });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
