import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { dismissTopicSuggestionFor } from '@/lib/mcp/data';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';

/**
 * POST /api/mcp/topic-suggestions/[id]/dismiss
 *
 * Parallel REST surface for the `dismiss_topic_suggestion` MCP tool — same
 * data-layer function, same ownership guarantee. 403 unless the key's user
 * is an admin or a manager.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const resolvedParams = await params;
  const suggestionId = resolvedParams.id;
  if (!suggestionId) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('dismiss_topic_suggestion', auth.organizationId, {
      suggestion_id: suggestionId,
    });
    if (refused) return refused;
    const result = await dismissTopicSuggestionFor(auth, suggestionId);
    if (!result) {
      return NextResponse.json(
        { error: 'Suggestion not found, not pending, or already processed' },
        { status: 404 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return failedCallResponse(err);
  }
}
