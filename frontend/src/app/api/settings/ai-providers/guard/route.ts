import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ownKeyAccess } from '@/lib/chat/key';
import { forgetOwnKeyCap, readOwnKeyGuard } from '@/lib/chat/ownKeyCap';
import { OWN_KEY_GUARD_MAX_USD, OWN_KEY_GUARD_MIN_USD } from '@/lib/chat/ownKeyGuard';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { getAdmin } from '../_admin';

/**
 * PUT /api/settings/ai-providers/guard { capUsd }
 *
 * Settings › AI Providers' Agents on your key (AGENT-OWN-KEY §4.3, PR 9):
 * the most all agents may spend on the workspace's own key a month, $10 to
 * $10,000 to the cent (00442 chat_settings.own_key_agent_month_usd). Agents
 * paused at it start again on the next minute's sweep once it is raised.
 *
 * Answers { ok, guard }: the guard read again, null when the server didn't
 * answer. 400 out of range, 404 where own keys aren't allowed, 503
 * `unavailable` before 00442. Admins only; while the workspace is
 * read-only, 402 subscription_inactive.
 */
export async function PUT(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const refused = await writeRefusal();
  if (refused) return refused;

  const body = (await req.json().catch(() => ({}))) as { capUsd?: unknown };
  const capUsd = typeof body.capUsd === 'number' ? Math.round(body.capUsd * 100) / 100 : NaN;
  if (
    !Number.isFinite(capUsd) ||
    capUsd < OWN_KEY_GUARD_MIN_USD ||
    capUsd > OWN_KEY_GUARD_MAX_USD
  ) {
    return NextResponse.json(
      { error: `Set a limit from $${OWN_KEY_GUARD_MIN_USD} to $${OWN_KEY_GUARD_MAX_USD}` },
      { status: 400 },
    );
  }
  const organizationId = ctx.profile.organization_id;
  try {
    const access = await ownKeyAccess(organizationId);
    if (access.state !== 'plan' && access.state !== 'kept') {
      return NextResponse.json({ error: 'Own AI keys are not on' }, { status: 404 });
    }
    const { error } = await supabaseAdmin.from('chat_settings').upsert(
      {
        organization_id: organizationId,
        own_key_agent_month_usd: capUsd,
        updated_by: ctx.user.id,
      },
      { onConflict: 'organization_id' },
    );
    if (error) {
      // The web ahead of 00442: nothing to keep it in yet.
      if (
        (error.code === '42703' || error.code === 'PGRST204') &&
        (error.message ?? '').includes('own_key_agent_month_usd')
      ) {
        return NextResponse.json(
          { error: 'Not available yet', code: 'unavailable' },
          { status: 503 },
        );
      }
      throw new Error(error.message);
    }
    forgetOwnKeyCap(organizationId);
    return NextResponse.json({ ok: true, guard: await readOwnKeyGuard(organizationId) });
  } catch (err) {
    console.error('[ai-providers] the key guard could not be saved:', err);
    return NextResponse.json({ error: 'Failed to save the limit' }, { status: 500 });
  }
}
