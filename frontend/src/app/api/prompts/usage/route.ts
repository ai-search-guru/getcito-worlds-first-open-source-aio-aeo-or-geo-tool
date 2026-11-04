import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ORG_PLAN_COLUMNS, usagePlanFromOrgRow } from '@/lib/guards/planGuard';
import { fetchPromptUsageRow, toPromptUsageSummary } from '@/lib/promptUsageSummary';

/**
 * GET /api/prompts/usage?brandId=…
 *
 * The Tracked Prompts usage cards (PROMPT-012): the brand's active and paused
 * prompts, the account's active prompts, brands and active prompt locations,
 * and the plan's limit. A route rather than a server action, so the page can
 * fire it alongside its table load: Next.js runs a client's server actions
 * one at a time, and this request must never hold the table up.
 *
 * Not cached: the counters are rebuilt on every prompt write, and the cards
 * refresh right after the user's own changes.
 */
// Any 8-4-4-4-12 hex id, like the MCP server's relaxedUuid: zod 4's uuid()
// rejects ids without a version digit, such as the seeded demo brands'.
const query = z.object({
  brandId: z
    .string()
    .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/),
});

export async function GET(req: Request) {
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'brandId must be a brand id' }, { status: 400 });
  }
  const { brandId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    // The brand with its organization's plan columns, and the counts, in one
    // round trip. RLS: only a brand of the caller's own organization comes
    // back, and the RPC returns no row for any other.
    const [{ data: brand, error: brandError }, row] = await Promise.all([
      supabase
        .from('brands')
        .select(`organization_id, organizations(${ORG_PLAN_COLUMNS})`)
        .eq('id', brandId)
        .maybeSingle(),
      fetchPromptUsageRow(supabase, brandId),
    ]);
    if (brandError) throw new Error(brandError.message);
    if (!brand || !row) return NextResponse.json({ error: 'Brand not found' }, { status: 404 });

    // An organization whose plan ended counts against the plan it was on.
    const { plan, ended } = usagePlanFromOrgRow(brand.organizations);
    return NextResponse.json(toPromptUsageSummary(row, plan, new Date(), { ended }), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err) {
    console.error('[prompts/usage]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
