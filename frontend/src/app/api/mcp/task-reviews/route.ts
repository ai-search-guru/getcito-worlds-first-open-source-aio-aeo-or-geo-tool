import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';
import { listTaskReviewsFor } from '@/lib/mcp/taskReviews';

/**
 * GET /api/mcp/task-reviews — REST mirror of the `list_task_reviews` MCP tool.
 * 403 role_required unless the key's user is an admin or a manager.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const reviews = await listTaskReviewsFor(auth, {
      brandId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (reviews === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ reviews });
  } catch (err) {
    return failedCallResponse(err);
  }
}
