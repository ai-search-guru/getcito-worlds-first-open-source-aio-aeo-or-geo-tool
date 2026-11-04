import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getContentImpactFor } from '@/lib/mcp/content';
import { contentUuid, impactDays } from '@/lib/mcp/contentSchemas';

/**
 * GET /api/mcp/content-drafts/[id]/impact?days=30 — REST mirror of the
 * `get_content_impact` MCP tool (days: 7, 30, 90 or 365).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const raw = new URL(req.url).searchParams.get('days');
  const days = impactDays.safeParse(raw === null ? undefined : Number(raw));
  if (!contentUuid.safeParse(id).success || !days.success) {
    return NextResponse.json(
      { error: 'id must be a draft UUID; days 7, 30, 90 or 365' },
      { status: 400 },
    );
  }
  try {
    const impact = await getContentImpactFor(auth, id, days.data);
    if (impact === 'no_page') {
      return NextResponse.json({ error: 'This draft has no live address yet' }, { status: 409 });
    }
    if (!impact) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json(impact);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
