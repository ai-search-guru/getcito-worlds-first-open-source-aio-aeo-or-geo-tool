import { NextResponse } from 'next/server';
import { readBrandConnections } from '@/lib/chat/agentConnections';
import { chatActor, runFailure } from '@/lib/chat/runApi';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/chat/skills/connections?brand={brandId}
 *
 * The connections a brand has, by kind (agentConnections.ts: any CMS, any
 * catalog source, Search Console, Analytics), for the Skills page's chips
 * (W3-07): green when connected, grey with Connect when not. Only a brand
 * the person reaches: read through their own client first (RLS), else 404.
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
    const connected = await readBrandConnections(brandId);
    return NextResponse.json({ ok: true, connected: [...connected].sort() });
  } catch (error) {
    console.error('[chat/skills] could not read connections:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read connections');
  }
}
