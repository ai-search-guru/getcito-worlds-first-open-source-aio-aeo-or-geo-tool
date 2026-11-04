import { NextResponse } from 'next/server';
import { readProviderKey } from '@/lib/agent/key';
import { isAiProvider } from '@/lib/agent/providers';
import { keepKeyCheck, testSavedKey } from '@/lib/chat/keyTest';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { getAdmin } from '../_admin';

/**
 * POST /api/settings/ai-providers/test { provider }
 *
 * Settings › AI Providers' Test (AGENT-OWN-KEY §5.2 item 7): one tiny call on
 * the saved key (lib/chat/keyTest.ts), and what it found kept on the key
 * (00440): when it was checked, and whether it fails. A key Chat uses that
 * works again starts the agents its failure paused (§5.4).
 *
 * Answers { outcome: 'working' | 'failing' | 'unknown', class?, resumed }:
 * `unknown` when the provider didn't answer, nothing kept.
 *
 * Admins only, as the other changes to the keys; while the workspace is
 * read-only, 402 subscription_inactive (nothing runs then anyway).
 */
export async function POST(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const refused = await writeRefusal();
  if (refused) return refused;

  const body = (await req.json().catch(() => ({}))) as { provider?: unknown };
  if (!isAiProvider(body.provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const organizationId = ctx.profile.organization_id;
  try {
    const saved = await readProviderKey(organizationId, body.provider);
    if (saved.state === 'none') {
      return NextResponse.json({ error: 'No key is saved for this provider' }, { status: 404 });
    }
    const result = await testSavedKey(saved);
    const resumed = await keepKeyCheck(organizationId, body.provider, result, {
      active: saved.active,
    });
    return NextResponse.json({
      ok: true,
      outcome: result.outcome,
      ...(result.outcome === 'failing' ? { class: result.class } : {}),
      resumed,
    });
  } catch (err) {
    console.error('[ai-providers] the key test failed:', err);
    return NextResponse.json({ error: 'Failed to test the key' }, { status: 500 });
  }
}
