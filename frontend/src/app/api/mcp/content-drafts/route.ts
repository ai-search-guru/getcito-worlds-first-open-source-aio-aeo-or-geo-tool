import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { demoBrandRefusal } from '@/lib/mcp/demoGate';
import { createContentDraftFor, listContentDraftsFor } from '@/lib/mcp/content';
import { createDraftShape, listDraftsShape } from '@/lib/mcp/contentSchemas';

/**
 * GET /api/mcp/content-drafts?brand_id=…&status=… — REST mirror of the
 * `list_content_drafts` MCP tool.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const parsed = z.object(listDraftsShape).safeParse({
    brand_id: url.searchParams.get('brand_id') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'brand_id is required; status must be a draft status' },
      { status: 400 },
    );
  }
  try {
    const drafts = await listContentDraftsFor(auth, parsed.data.brand_id, parsed.data.status);
    if (!drafts) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/mcp/content-drafts — REST mirror of `create_content_draft`.
 * Body: { brand_id, title, body_html, method?, page_type?, source_url?, prompt_ids? }
 */
export async function POST(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;
  const parsed = z.object(createDraftShape).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;
  try {
    // Nothing written on the demo brand's sample data, as the tool refuses it.
    const refused = await demoBrandRefusal('create_content_draft', auth.organizationId, {
      brand_id: body.brand_id,
    });
    if (refused) return refused;
    const created = await createContentDraftFor(auth, {
      brandId: body.brand_id,
      title: body.title,
      bodyHtml: body.body_html,
      method: body.method,
      pageType: body.page_type,
      sourceUrl: body.source_url,
      promptIds: body.prompt_ids,
    });
    if (created === 'off_domain') {
      return NextResponse.json(
        { error: "source_url must be a page on one of the brand's domains" },
        { status: 422 },
      );
    }
    if (!created) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed' },
      { status: 500 },
    );
  }
}
