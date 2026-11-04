import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getPromptUsageFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/prompt-usage?brand_id=…
 *
 * Parallel REST surface for the `get_prompt_usage` MCP tool — the Tracked
 * Prompts usage cards (PROMPT-012): the brand's active and paused prompts, the
 * account's active prompts, brands and prompt locations, and the plan limit.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const brandId = new URL(req.url).searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const usage = await getPromptUsageFor(auth, brandId);
    if (!usage) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(usage);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
