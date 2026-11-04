import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { generateBriefFor } from '@/lib/mcp/data';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';

/**
 * POST /api/mcp/content-opportunities/[id]/brief
 *
 * Parallel REST surface for the `generate_content_brief` MCP tool — same
 * data-layer function, same ownership guarantee. Always re-generates;
 * cached reads belong on GET /api/mcp/content-opportunities/[id]. 403
 * unless the key's user is an admin or a manager.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const resolvedParams = await params;
  const opportunityId = resolvedParams.id;
  if (!opportunityId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const result = await generateBriefFor(auth, opportunityId);
    if (!result) {
      return NextResponse.json({ error: 'Content opportunity not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return failedCallResponse(err);
  }
}
