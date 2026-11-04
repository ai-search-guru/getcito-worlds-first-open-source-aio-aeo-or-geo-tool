import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { createImproveActionFor, type CreateImproveActionInput } from '@/lib/mcp/data';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';

/**
 * POST /api/mcp/prompts/[id]/improve-action
 *
 * REST mirror of the `create_improve_action` MCP tool — same data-layer
 * function, same ownership check. Body:
 * `{ "range": { "preset": "7d", "from": "…", "to": "…", "region": "US" },
 *    "idempotency_key": "…", "suggestions": [{ "id", "platform", "title", "body", "sources" }] }`.
 * The server validates the range and suggestions and checks the plan. 403
 * unless the key's user is an admin or a manager.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  let body: { range?: unknown; idempotency_key?: unknown; suggestions?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const range = body.range as CreateImproveActionInput['range'] | undefined;
  if (!range || typeof range.preset !== 'string' || typeof range.from !== 'string') {
    return NextResponse.json({ error: 'range with preset and from is required' }, { status: 400 });
  }
  if (typeof body.idempotency_key !== 'string') {
    return NextResponse.json({ error: 'idempotency_key is required' }, { status: 400 });
  }
  if (!Array.isArray(body.suggestions) || body.suggestions.length === 0) {
    return NextResponse.json({ error: 'suggestions must be a non-empty array' }, { status: 400 });
  }

  try {
    const result = await createImproveActionFor(auth, {
      promptId: id,
      range,
      idempotencyKey: body.idempotency_key,
      suggestions: body.suggestions as CreateImproveActionInput['suggestions'],
    });
    if (!result) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return failedCallResponse(err);
  }
}
