import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { isMentionSentiment, overrideMentionSentimentFor } from '@/lib/mcp/mentions';

const STATUS = { forbidden: 403, invalid: 400, missing: 404 } as const;

/**
 * POST /api/mcp/mentions/[id]/sentiment-override
 *
 * REST mirror of the `override_mention_sentiment` MCP tool ("Sentiment is
 * wrong"). Body: `{ "sentiment": "positive" | "neutral" | "negative",
 * "note"?: string }`. The API key's owner must be an admin or manager of the
 * brand's organization.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  let body: { sentiment?: unknown; note?: unknown };
  try {
    body = (await req.json()) as { sentiment?: unknown; note?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!isMentionSentiment(body.sentiment)) {
    return NextResponse.json(
      { error: 'sentiment is required and must be one of: positive, neutral, negative' },
      { status: 400 },
    );
  }
  if (body.note !== undefined && typeof body.note !== 'string') {
    return NextResponse.json({ error: 'note must be a string' }, { status: 400 });
  }

  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('override_mention_sentiment', auth.organizationId, {
      id,
    });
    if (refused) return refused;
    const result = await overrideMentionSentimentFor(auth, id, body.sentiment, body.note);
    if ('error' in result) {
      return NextResponse.json({ error: result.message }, { status: STATUS[result.error] });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
