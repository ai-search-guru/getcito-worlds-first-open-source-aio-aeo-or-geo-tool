import { NextResponse } from 'next/server';
import { authenticateMcpRequest } from '@/lib/mcpAuth';
import { getContentPlanFor } from '@/lib/mcp/contentPlan';
import { contentUuid } from '@/lib/mcp/contentSchemas';
import { PLAN_CARDS, PLAN_PERIODS, type PlanCard, type PlanPeriod } from '@/lib/content/plan';

/** GET /api/mcp/content-plan — REST mirror of the `get_content_plan` MCP tool. */
export async function GET(req: Request) {
  const auth = await authenticateMcpRequest(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const brandId = contentUuid.safeParse(url.searchParams.get('brand_id'));
  if (!brandId.success) {
    return NextResponse.json({ error: 'brand_id must be a brand UUID' }, { status: 400 });
  }
  const days = Number(url.searchParams.get('days') ?? 30);
  if (!(PLAN_PERIODS as readonly number[]).includes(days)) {
    return NextResponse.json({ error: 'days must be 7, 30 or 90' }, { status: 400 });
  }
  const card = url.searchParams.get('card');
  if (card && !(PLAN_CARDS as readonly string[]).includes(card)) {
    return NextResponse.json(
      { error: 'card must be create, optimize, protect or priority' },
      { status: 400 },
    );
  }

  try {
    const plan = await getContentPlanFor(auth, {
      brandId: brandId.data,
      days: days as PlanPeriod,
      card: (card as PlanCard | null) ?? undefined,
    });
    if (plan === null) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }
    return NextResponse.json({ plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
