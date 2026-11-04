import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';
import {
  TASK_REVIEW_ERROR_STATUS,
  approveTaskReviewFor,
  taskReviewEditShape,
} from '@/lib/mcp/taskReviews';

/**
 * POST /api/mcp/task-reviews/[id]/approve — REST mirror of the
 * `approve_task_review` MCP tool, its fields in the JSON body.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  // No body approves the task as written; a body it can't read approves nothing.
  const text = await req.text();
  let json: unknown = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }
  const body = z.object(taskReviewEditShape).safeParse(json);
  if (!body.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('approve_task_review', auth.organizationId, {
      review_id: id,
    });
    if (refused) return refused;
    const result = await approveTaskReviewFor(auth, id, body.data);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error },
        { status: TASK_REVIEW_ERROR_STATUS[result.error] },
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return failedCallResponse(err);
  }
}
