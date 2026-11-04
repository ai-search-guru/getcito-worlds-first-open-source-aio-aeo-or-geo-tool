import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { listPromptsFor } from '@/lib/mcp/data';

export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = url.searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  const topicId = url.searchParams.get('topic_id') ?? undefined;
  const isActiveRaw = url.searchParams.get('is_active');
  const limitRaw = url.searchParams.get('limit');

  const isActive = isActiveRaw === 'true' ? true : isActiveRaw === 'false' ? false : undefined;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

  try {
    const prompts = await listPromptsFor(auth, {
      brandId,
      topicId,
      isActive,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (prompts === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ prompts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
