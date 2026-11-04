import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getContentDraftPackageFor } from '@/lib/mcp/contentPackage';
import { contentUuid } from '@/lib/mcp/contentSchemas';

// Node, not the edge: the package is read with jsdom.
export const runtime = 'nodejs';

/** GET /api/mcp/content-drafts/[id]/package — REST mirror of `get_content_draft_package`. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  if (!contentUuid.safeParse(id).success) {
    return NextResponse.json({ error: 'id must be a draft UUID' }, { status: 400 });
  }
  try {
    const result = await getContentDraftPackageFor(auth, id);
    if ('error' in result) {
      return NextResponse.json(
        { error: result.message, code: result.error, problem: result.problem ?? null },
        { status: result.error === 'not_found' ? 404 : 409 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
