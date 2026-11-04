import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getSiteAuditQuotaFor } from '@/lib/mcp/data';

/**
 * GET /api/mcp/site-audits/quota
 *
 * Parallel REST surface for the `get_site_audit_quota` MCP tool — the org's
 * monthly Site Audit allowance ({ used, limit, remaining }). Pure read; no
 * quota consumed. The static `quota` segment takes precedence over the
 * dynamic `[id]` route, so this is matched before site-audits/[id].
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  try {
    const quota = await getSiteAuditQuotaFor(auth);
    if (!quota) {
      return NextResponse.json(
        { error: 'No organization found for this API key' },
        { status: 404 },
      );
    }
    return NextResponse.json(quota);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
