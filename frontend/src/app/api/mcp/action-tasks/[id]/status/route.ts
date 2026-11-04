import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { MCP_TASK_STATUSES, updateTaskStatusFor, type McpTaskStatus } from '@/lib/mcp/data';

/**
 * PATCH /api/mcp/action-tasks/[id]/status
 *
 * REST mirror of the `update_task_status` MCP tool — same data-layer function,
 * same ownership check. Body: `{ "status": "skipped", "skip_reason": "…" }`
 * (status one of in_progress | completed | skipped | failed; skip_reason
 * required for skipped).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  let body: { status?: unknown; skip_reason?: unknown };
  try {
    body = (await req.json()) as { status?: unknown; skip_reason?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const status = body.status;
  if (typeof status !== 'string' || !(MCP_TASK_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json(
      { error: `status is required and must be one of: ${MCP_TASK_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }
  const skipReason = typeof body.skip_reason === 'string' ? body.skip_reason : undefined;
  if (status === 'skipped' && !skipReason?.trim()) {
    return NextResponse.json(
      { error: 'skip_reason is required when status is skipped' },
      { status: 400 },
    );
  }

  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('update_task_status', auth.organizationId, {
      task_id: id,
    });
    if (refused) return refused;
    const updated = await updateTaskStatusFor(auth, id, status as McpTaskStatus, skipReason);
    if (!updated) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
