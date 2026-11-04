import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getContentOpportunityFor } from '@/lib/mcp/data';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const resolvedParams = await params;
  const opportunityId = resolvedParams.id;
  if (!opportunityId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const opportunity = await getContentOpportunityFor(auth, opportunityId);
    if (!opportunity) {
      return NextResponse.json({ error: 'Content opportunity not found' }, { status: 404 });
    }
    return NextResponse.json({ opportunity });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
