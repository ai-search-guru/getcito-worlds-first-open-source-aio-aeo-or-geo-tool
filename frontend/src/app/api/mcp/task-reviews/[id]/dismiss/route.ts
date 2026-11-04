import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';
import { TASK_REVIEW_ERROR_STATUS, dismissTaskReviewFor } from '@/lib/mcp/taskReviews';

/** POST /api/mcp/task-reviews/[id]/dismiss — REST mirror of the `dismiss_task_review` MCP tool. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('dismiss_task_review', auth.organizationId, {
      review_id: id,
    });
    if (refused) return refused;
    const result = await dismissTaskReviewFor(auth, id);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: TASK_REVIEW_ERROR_STATUS[result.error] },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return failedCallResponse(err);
  }
}
