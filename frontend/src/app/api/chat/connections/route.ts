import { NextResponse } from 'next/server';
import { readAgentContext } from '@/lib/chat/agents';
import { readConnections } from '@/lib/chat/connections';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { merchantCenterOffered } from '@/lib/mcp/productVisibility';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/chat/connections?brand={brandId}
 *
 * A brand's connections (W4-24, lib/chat/connections.ts): every tool, its
 * status, account, who connected it and when, its access, what uses it,
 * what would stop without it, and up to two Suggested; for the chat menu's
 * Connections row and the Connections page. `canConnect`: the person is an
 * Admin, who alone connects and disconnects from Chat (CHAT-20 §8c).
 * Only a brand the person reaches: read through their own client first
 * (RLS, brand access), else 404. No id, key or token in the answer.
 *
 * Refusals as values (`{ ok: false, failure, code, error }`, #1777): 400 a
 * brand that isn't an id, 401, 404 Chat off or a brand they don't reach.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const brandId = new URL(req.url).searchParams.get('brand');
    if (!brandId || !UUID.test(brandId)) {
      return runFailure(400, 'failed', 'failed', 'Invalid brand');
    }
    const supabase = await createClient();
    const { data: brand, error } = await supabase
      .from('brands')
      .select('id')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand) return runFailure(404, 'not_found', 'not_found', 'Brand not found');
    const [ctx, offered] = await Promise.all([readAgentContext(actor), merchantCenterOffered()]);
    if (!ctx) return runFailure(404, 'not_found', 'not_found', 'Not found');
    const connections = await readConnections({
      organizationId: actor.organizationId,
      brandId,
      viewer: ctx.viewer,
      merchantCenterOffered: offered,
    });
    return NextResponse.json({ ok: true, connections, canConnect: ctx.viewer.role === 'admin' });
  } catch (error) {
    console.error('[chat/connections] could not read connections:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read connections');
  }
}
