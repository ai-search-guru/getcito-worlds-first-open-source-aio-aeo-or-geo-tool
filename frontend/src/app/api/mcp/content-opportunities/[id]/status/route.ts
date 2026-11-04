import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import {
  CONTENT_OPPORTUNITY_STATUSES,
  updateOpportunityStatusFor,
  type ContentOpportunityStatus,
} from '@/lib/mcp/data';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';

/**
 * PATCH /api/mcp/content-opportunities/[id]/status
 *
 * Parallel REST surface for the `update_opportunity_status` MCP tool —
 * same data-layer function, same ownership guarantee, same enum validation.
 * Body: `{ "status": "in_progress" }` (one of new | sent | in_progress | done | dismissed).
 * Dismissing one, or moving a dismissed one back, answers 403 unless the
 * key's user is an admin or a manager.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const resolvedParams = await params;
  const opportunityId = resolvedParams.id;
  if (!opportunityId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  let body: { status?: unknown };
  try {
    body = (await req.json()) as { status?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = body.status;
  if (
    typeof status !== 'string' ||
    !(CONTENT_OPPORTUNITY_STATUSES as readonly string[]).includes(status)
  ) {
    return NextResponse.json(
      {
        error: `status is required and must be one of: ${CONTENT_OPPORTUNITY_STATUSES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('update_opportunity_status', auth.organizationId, {
      opportunity_id: opportunityId,
    });
    if (refused) return refused;
    const updated = await updateOpportunityStatusFor(
      auth,
      opportunityId,
      status as ContentOpportunityStatus,
    );
    if (!updated) {
      return NextResponse.json({ error: 'Content opportunity not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    return failedCallResponse(err);
  }
}
