import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getSiteAuditFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/site-audits/[id]
 *
 * Parallel REST surface for the `get_site_audit` MCP tool — same data-layer
 * function, same ownership guarantee. Pure read; no quota consumed.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  try {
    const audit = await getSiteAuditFor(auth, id);
    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }
    return NextResponse.json(audit);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
