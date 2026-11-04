import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { writeRefusal } from '@/lib/subscriptionGuard';
import { encryptApiKey, last4 } from '@/lib/agent/keyEncryption';
import { isKeyFailureClass } from '@/lib/agent/keyErrors';
import { isAiProvider, parseProviderSettings, type AiProvider } from '@/lib/agent/providers';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { ownKeyAccess, type OwnKeyAccess } from '@/lib/chat/key';
import { readProviderKey } from '@/lib/agent/key';
import { resolveOwnKeyNotices, resumeOwnKeyAgents } from '@/lib/chat/keyHealth';
import { readOwnKeyGuard } from '@/lib/chat/ownKeyCap';
import type { OwnKeyGuard } from '@/lib/chat/ownKeyGuard';
import {
  keepKeyCheck,
  keyCheckOf,
  testOwnKey,
  testSavedKey,
  type KeyTestResult,
} from '@/lib/chat/keyTest';
import { getAdmin, getCallerAndOrg } from './_admin';

/**
 * GET / PUT / PATCH / DELETE /api/settings/ai-providers
 *
 * Manages the org-level AI provider keys the in-product agent uses on
 * cloud — one per provider, and the one Chat uses (`active`). We never
 * return the plaintext — GET surfaces only the metadata the Settings UI
 * needs to render each provider (last4, set_at, who saved it, its settings).
 *
 * - GET: the saved providers, whether Chat has one to use, and what own keys
 *   do for the workspace (`access`, lib/chat/key.ts ownKeyAccess).
 * - PUT { provider, apiKey, settings }: saves (or replaces) a provider's key;
 *   the first one saved becomes the one Chat uses.
 * - PATCH { provider }: makes a saved provider the one Chat uses.
 * - DELETE ?provider=: removes a key; when it was Chat's, the most recently
 *   saved other one takes over.
 *
 * While the workspace is read-only (cloud, plan not active), PUT and PATCH
 * answer 402 subscription_inactive; DELETE stays open.
 *
 * With Chat on, own keys are Enterprise's (CHAT-16 item 19): below it, PUT
 * and PATCH answer 403 own_keys_enterprise, except that a key kept from
 * before Chat (item 28) can be replaced or switched to during its 30 days.
 * DELETE stays open.
 *
 * Auth model:
 * - GET: any signed-in org member can see which keys are configured.
 *   The chat endpoint already gates, so leaking "we have a key" is fine.
 * - PUT / PATCH / DELETE: admins only. Same role bar as team management —
 *   adding a payment instrument (which is effectively what a provider key
 *   is) shouldn't be a non-admin action.
 */

/** Under a lock on the org's keys (00188); with onlyIfNone, only while none is Chat's. */
async function setActive(organizationId: string, provider: AiProvider, onlyIfNone = false) {
  return supabaseAdmin.rpc('set_active_ai_provider', {
    p_organization_id: organizationId,
    p_provider: provider,
    p_only_if_none: onlyIfNone,
  });
}

/**
 * The Anthropic key's copy on `organizations` (00010), which only the old
 * settings route wrote: cleared when the key is replaced or removed here, so
 * a removed key doesn't stay stored, or come back on a rollback.
 */
async function clearLegacyAnthropicKey(organizationId: string) {
  return supabaseAdmin
    .from('organizations')
    .update({
      anthropic_api_key_encrypted: null,
      anthropic_api_key_last4: null,
      anthropic_api_key_set_at: null,
      anthropic_api_key_set_by: null,
    })
    .eq('id', organizationId);
}

/**
 * A key saved while Chat is still off for the workspace keeps working for
 * Chat for 30 days once it is on, on any plan but Enterprise, whose plan
 * includes own keys (CHAT-16 item 28; 00405 / 00414 marked the workspaces
 * that had one then). With Chat on, nothing is marked.
 */
async function markLegacyKey(organizationId: string) {
  if (chatAgenticEnabled(organizationId)) return { error: null };
  return supabaseAdmin
    .from('organizations')
    .update({ legacy_key_grandfathered: true })
    .eq('id', organizationId)
    .neq('plan', 'enterprise');
}

/**
 * A key its test turned down (AGENT-OWN-KEY §11 Q8): not saved or switched
 * to. `code` names the class for the page's words; the field is the key.
 */
function keyRefused(result: Extract<KeyTestResult, { outcome: 'failing' }>) {
  return NextResponse.json(
    { error: KEY_REFUSED[result.class], code: `key_${result.class}`, field: 'apiKey' },
    { status: 400 },
  );
}

const KEY_REFUSED: Record<Extract<KeyTestResult, { outcome: 'failing' }>['class'], string> = {
  invalid: 'The provider turned down this key',
  no_credit: "The provider's account is out of credit",
  model: "The provider can't find the model for this key",
  unreadable: "The saved key can't be read any more",
};

/**
 * Keeps a test's result on the key (lib/chat/keyTest.ts keepKeyCheck): what
 * the page says after a save or a switch, and how many paused agents started
 * again. A keep that fails leaves the key unchecked.
 */
async function keptCheck(
  organizationId: string,
  provider: AiProvider,
  result: KeyTestResult,
  active: boolean,
) {
  let resumed = 0;
  try {
    resumed = await keepKeyCheck(organizationId, provider, result, { active });
  } catch (err) {
    console.error('[ai-providers] could not keep the key check:', err);
  }
  return { check: keyCheckOf(result), resumed };
}

/** Own keys need Enterprise once Chat is on (CHAT-16 item 19). */
function ownKeysRefused() {
  return NextResponse.json(
    { error: 'Own AI keys come with the Enterprise plan', code: 'own_keys_enterprise' },
    { status: 403 },
  );
}

/**
 * Whether the admin may save `provider`'s key or have Chat use it: always
 * with Chat off or on Enterprise; for a kept key's 30 days, only a provider
 * already saved (replaced or switched to, not added).
 */
async function keyChangeAllowed(organizationId: string, provider: AiProvider): Promise<boolean> {
  const access = await ownKeyAccess(organizationId);
  if (access.state === 'open' || access.state === 'plan') return true;
  if (access.state === 'locked') return false;
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/** The answer refusing a change to `provider`'s key, or null when it may go ahead. */
async function keyChangeRefusal(
  organizationId: string,
  provider: AiProvider,
): Promise<NextResponse | null> {
  try {
    return (await keyChangeAllowed(organizationId, provider)) ? null : ownKeysRefused();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read the plan' },
      { status: 500 },
    );
  }
}

/**
 * The key guard as the Admins' card shows it: dollars at list prices, to
 * Admins only (the owner, 2026-11-01: other roles don't see it at all), and
 * only where Chat runs on own keys (`plan`, or a key `kept` after the plan).
 */
async function guardFor(
  profile: { role: string; organization_id: string },
  access: OwnKeyAccess,
): Promise<{ guard?: OwnKeyGuard | null }> {
  if (profile.role !== 'admin' || (access.state !== 'plan' && access.state !== 'kept')) return {};
  return { guard: await readOwnKeyGuard(profile.organization_id) };
}

export async function GET() {
  const ctx = await getCallerAndOrg();
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error },
      { status: ctx.error === 'Unauthorized' ? 401 : 400 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select(
      'provider, key_last4, settings, active, set_at, set_by, checked_at, failing_since, failure_class, failure_status',
    )
    .eq('organization_id', ctx.profile.organization_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Savers' e-mails, one lookup each — the FK is to `profiles(id)`, which
  // the auth user model mirrors.
  const setters = [...new Set((data ?? []).map((row) => row.set_by).filter(Boolean))];
  const emails = new Map(
    await Promise.all(
      setters.map(async (id) => {
        const { data: setter } = await supabaseAdmin.auth.admin.getUserById(id);
        return [id, setter?.user?.email ?? null] as const;
      }),
    ),
  );

  let access: OwnKeyAccess;
  try {
    access = await ownKeyAccess(ctx.profile.organization_id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read the plan' },
      { status: 500 },
    );
  }

  const rows = (data ?? []).filter((row) => isAiProvider(row.provider));
  return NextResponse.json({
    access,
    // The key guard (AGENT-OWN-KEY §4.3, PR 9): Admins only, where own keys
    // are allowed; null when the server didn't answer.
    ...(await guardFor(ctx.profile, access)),
    // Whether Chat has a key to use — what the sidebar badge and Chat ask.
    configured: rows.some((row) => row.active),
    providers: rows.map((row) => ({
      provider: row.provider,
      last4: row.key_last4,
      settings: row.settings ?? {},
      active: row.active,
      setAt: row.set_at,
      setByEmail: row.set_by ? (emails.get(row.set_by) ?? null) : null,
      // Its health (00440): when it was last tested, and why and since when it fails.
      health: {
        checkedAt: row.checked_at ?? null,
        failingSince: row.failing_since ?? null,
        failureClass: isKeyFailureClass(row.failure_class) ? row.failure_class : null,
      },
    })),
  });
}

export async function PUT(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const refused = await writeRefusal();
  if (refused) return refused;

  const body = (await req.json().catch(() => ({}))) as {
    provider?: unknown;
    apiKey?: unknown;
    settings?: unknown;
  };
  if (!isAiProvider(body.provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const provider = body.provider;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
  }
  // A soft length check rather than each provider's prefix — prefixes have
  // changed before, and the first chat turn surfaces a bad key as a 401
  // immediately anyway.
  if (apiKey.length < 20 || apiKey.length > 300) {
    return NextResponse.json({ error: 'apiKey looks malformed' }, { status: 400 });
  }
  const parsed = parseProviderSettings(provider, body.settings);
  if ('error' in parsed) {
    return NextResponse.json(
      { error: `${parsed.error} is missing or malformed`, field: parsed.error },
      { status: 400 },
    );
  }

  const notAllowed = await keyChangeRefusal(ctx.profile.organization_id, provider);
  if (notAllowed) return notAllowed;

  // With Chat on, the new key is tested before it's kept (AGENT-OWN-KEY §11 Q8).
  const tested = chatAgenticEnabled(ctx.profile.organization_id)
    ? await testOwnKey({ provider, apiKey, settings: parsed.settings })
    : null;
  if (tested?.outcome === 'failing' && keyCheckOf(tested) === 'refused') return keyRefused(tested);

  let encrypted: string;
  try {
    encrypted = encryptApiKey(apiKey);
  } catch (err) {
    // Misconfigured server env — surface a clear 500 instead of writing
    // unrecoverable data.
    console.error('[ai-providers] encryption failed:', err);
    return NextResponse.json({ error: 'Server encryption is not configured' }, { status: 500 });
  }

  const organizationId = ctx.profile.organization_id;
  // `active` is left out: a replaced key keeps whether Chat uses it.
  const { error } = await supabaseAdmin.from('organization_ai_keys').upsert(
    {
      organization_id: organizationId,
      provider,
      key_encrypted: encrypted,
      key_last4: last4(apiKey),
      settings: parsed.settings,
      set_at: new Date().toISOString(),
      set_by: ctx.profile.id,
    },
    { onConflict: 'organization_id,provider' },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // A new key ends the old one's failure (00440's trigger clears it), so the
  // Admins' notices about it close, before this key's own check is kept.
  await resolveOwnKeyNotices(organizationId, provider).catch((err) =>
    console.error("[ai-providers] could not close the key's notices:", err),
  );

  // The first key saved is the one Chat uses: decided under the lock, so a
  // switch at the same time can't be overridden.
  const { error: activeError } = await setActive(organizationId, provider, true);
  if (activeError) {
    return NextResponse.json({ error: activeError.message }, { status: 500 });
  }
  if (provider === 'anthropic') {
    const { error: legacyError } = await clearLegacyAnthropicKey(organizationId);
    if (legacyError) {
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }
  }
  const { error: markError } = await markLegacyKey(organizationId);
  if (markError) {
    return NextResponse.json({ error: markError.message }, { status: 500 });
  }
  if (!tested) return NextResponse.json({ ok: true });
  const saved = await readProviderKey(organizationId, provider).catch(() => null);
  return NextResponse.json({
    ok: true,
    ...(await keptCheck(organizationId, provider, tested, saved?.active === true)),
  });
}

export async function PATCH(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const refused = await writeRefusal();
  if (refused) return refused;

  const body = (await req.json().catch(() => ({}))) as { provider?: unknown };
  if (!isAiProvider(body.provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const notAllowed = await keyChangeRefusal(ctx.profile.organization_id, body.provider);
  if (notAllowed) return notAllowed;
  const organizationId = ctx.profile.organization_id;

  // With Chat on, the key is tested before Chat uses it (AGENT-OWN-KEY §8 item 3).
  let tested: KeyTestResult | null = null;
  if (chatAgenticEnabled(organizationId)) {
    let saved;
    try {
      saved = await readProviderKey(organizationId, body.provider);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to read the key' },
        { status: 500 },
      );
    }
    if (saved.state === 'none') {
      return NextResponse.json({ error: 'No key is saved for this provider' }, { status: 404 });
    }
    tested = await testSavedKey(saved);
    if (tested.outcome === 'failing' && keyCheckOf(tested) === 'refused') {
      // Kept on the key, so the page says why it wasn't switched to.
      await keptCheck(organizationId, body.provider, tested, false);
      return keyRefused(tested);
    }
  }

  const { data, error } = await setActive(organizationId, body.provider);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No key is saved for this provider' }, { status: 404 });
  }
  if (!tested) return NextResponse.json({ ok: true });
  return NextResponse.json({
    ok: true,
    ...(await keptCheck(organizationId, body.provider, tested, true)),
  });
}

/**
 * Open while the workspace is read-only: removing a key takes back what the
 * org gave us, as disconnecting an integration does (lib/subscriptionGuard.ts).
 */
export async function DELETE(req: Request) {
  const ctx = await getAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const provider = new URL(req.url).searchParams.get('provider');
  if (!isAiProvider(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
  }
  const organizationId = ctx.profile.organization_id;
  // Chat's key, whose agents paused when it failed start again once it's gone (§5.4).
  const wasChatKey =
    chatAgenticEnabled(organizationId) &&
    (await readProviderKey(organizationId, provider).catch(() => null))?.active === true;
  // Removed, and when it was Chat's key the most recently saved other one
  // takes over, in one transaction under a lock on the org's keys (00188).
  const { error } = await supabaseAdmin.rpc('remove_ai_provider_key', {
    p_organization_id: organizationId,
    p_provider: provider,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (provider === 'anthropic') {
    const { error: legacyError } = await clearLegacyAnthropicKey(organizationId);
    if (legacyError) {
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }
  }
  if (wasChatKey) {
    await resumeOwnKeyAgents(organizationId).catch((err) =>
      console.error('[ai-providers] could not resume the agents:', err),
    );
  }
  // A removed key fails no more: the Admins' notices about it close (00441).
  await resolveOwnKeyNotices(organizationId, provider).catch((err) =>
    console.error("[ai-providers] could not close the key's notices:", err),
  );
  return NextResponse.json({ ok: true });
}
