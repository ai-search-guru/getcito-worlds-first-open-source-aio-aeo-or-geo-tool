import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAgentAuth } from '@/lib/agent/auth';
import { getPlan, hasFeature, type PlanId } from '@/config/plans';
import { isAgentKeyConfigured } from '@/lib/agent/key';
import { subscriptionActiveFor, subscriptionInactiveResponse } from '@/lib/mcp/subscriptionGate';
import { legacyAgentApiGone } from '@/lib/chat/legacyRoute';

/**
 * GET /api/agent/conversations
 *
 * List the calling user's conversations, newest first. Powers the agent
 * page's sidebar. With the new Chat on for the org, 404 (legacyAgentApiGone).
 */
export async function GET() {
  const auth = await resolveAgentAuth();
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const gone = legacyAgentApiGone(auth.organizationId);
  if (gone) return gone;

  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, title, brand_id, created_at, updated_at')
    .eq('user_id', auth.userId)
    .eq('organization_id', auth.organizationId)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversations: data ?? [] });
}

/**
 * POST /api/agent/conversations
 *
 * Create a new conversation row. Optional `brand_id` pins the chat to a
 * brand so the agent's tool calls have an implicit scope. Returns the row.
 *
 * Plan-gated: the chat endpoint already gates on `ai_agent`, but we gate
 * here too so a non-Growth user clicking "+ New chat" gets the 403
 * immediately rather than after typing a message. Likewise a read-only
 * workspace (Cloud, plan not active) gets 402 subscription_inactive here, as
 * the chat does; reading and deleting conversations stay open. With the new
 * Chat on for the org, 404 (legacyAgentApiGone).
 */
export async function POST(req: Request) {
  const auth = await resolveAgentAuth();
  if (!auth || !auth.organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const organizationId: string = auth.organizationId;
  const gone = legacyAgentApiGone(organizationId);
  if (gone) return gone;
  if (!(await subscriptionActiveFor(organizationId))) return subscriptionInactiveResponse();

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .maybeSingle();
  const plan = getPlan((org?.plan ?? 'starter') as PlanId);
  if (!hasFeature(plan, 'ai_agent')) {
    return NextResponse.json({ error: 'ai_agent is not enabled for this plan' }, { status: 403 });
  }

  // BYOK gate — match the chat endpoint so "+ new chat" can't create a row
  // the user can never send a message to. UI uses the same code to route
  // to the Settings › AI Providers CTA.
  const hasKey = await isAgentKeyConfigured(organizationId);
  if (!hasKey) {
    return NextResponse.json(
      { error: 'AI provider key required', code: 'missing_ai_key' },
      { status: 403 },
    );
  }

  let body: { brandId?: string; title?: string } = {};
  try {
    body = (await req.json()) as { brandId?: string; title?: string };
  } catch {
    // Empty body is fine — the form may not send one.
  }

  let brandId: string | null = null;
  if (body.brandId) {
    const { data: brand, error: brandError } = await supabaseAdmin
      .from('brands')
      .select('id')
      .eq('id', body.brandId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (brandError) {
      return NextResponse.json({ error: brandError.message }, { status: 500 });
    }
    if (!brand) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 400 });
    }

    brandId = brand.id;
  }

  const { data, error } = await supabaseAdmin
    .from('agent_conversations')
    .insert({
      user_id: auth.userId,
      organization_id: auth.organizationId,
      brand_id: brandId,
      title: body.title ?? 'New conversation',
    })
    .select('id, title, brand_id, created_at, updated_at')
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create conversation' },
      { status: 500 },
    );
  }

  return NextResponse.json({ conversation: data }, { status: 201 });
}
