import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { runSiteAuditFor, listSiteAuditsFor } from '@/lib/mcp/data';
import { failedCallResponse } from '@/lib/mcp/subscriptionGate';

/**
 * GET /api/mcp/site-audits?brand_id=…
 *
 * Parallel REST surface for the `list_site_audits` MCP tool. Pure read; no
 * quota consumed.
 */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const brandId = new URL(req.url).searchParams.get('brand_id');
  if (!brandId) {
    return NextResponse.json({ error: 'brand_id is required' }, { status: 400 });
  }

  try {
    const audits = await listSiteAuditsFor(auth, brandId);
    if (!audits) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json(audits);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/mcp/site-audits  { brand_id, url, force? }
 *
 * Parallel REST surface for the `run_site_audit` MCP tool — same data-layer
 * function, same ownership guarantee. Charges the monthly Site Audit quota and
 * returns the new audit id + "running" status (poll GET /api/mcp/site-audits/[id]),
 * or the page's audit already running. A page audited in the last minutes
 * answers 200 with status "recently_audited" and that audit's id, unless
 * `force`.
 */
export async function POST(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  let body: { brand_id?: string; url?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const brandId = body.brand_id;
  const url = body.url;
  if (!brandId || !url) {
    return NextResponse.json({ error: 'brand_id and url are required' }, { status: 400 });
  }

  try {
    const result = await runSiteAuditFor(auth, brandId, url, { force: body.force === true });
    if (!result) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    // Audited in the last minutes: nothing started, the recent audit said back.
    return NextResponse.json(result, {
      status: result.status === 'recently_audited' ? 200 : 202,
    });
  } catch (err) {
    return failedCallResponse(err);
  }
}
