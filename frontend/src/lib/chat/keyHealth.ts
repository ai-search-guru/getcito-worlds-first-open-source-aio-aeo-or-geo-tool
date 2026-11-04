import { isAiProvider, type AiProvider } from '@/lib/agent/providers';
import { isKeyFailureClass, type KeyFailureClass } from '@/lib/agent/keyErrors';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from './flag';
import { notifyOwnKeyFailure } from './keyNotice';

/**
 * An own AI key's health (AGENT-OWN-KEY §5.2, §5.4; 00440): when the
 * workspace's key fails, its row keeps why and since when, the agents on it
 * pause `own_key`, and once it works again they start by themselves.
 */

/** Why and since when the workspace's active own key fails. */
export interface OwnKeyFailure {
  provider: AiProvider;
  class: KeyFailureClass;
  /** The provider's HTTP status, when it answered. */
  status: number | null;
  /** When this failure episode began. */
  since: string;
}

/** A failing own key as the browser is told it: its class and provider, no dates. */
export type FailingKey = Pick<OwnKeyFailure, 'class' | 'provider'>;

/**
 * The workspace's active own key, if it is marked failing, read without
 * decrypting it. Null when there is no active key or it works. Whether the
 * workspace runs on its own key at all is the caller's (ownKeyAccess).
 */
export async function ownKeyFailure(organizationId: string): Promise<OwnKeyFailure | null> {
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, failing_since, failure_class, failure_status')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(`Could not read the AI key's health: ${error.message}`);
  if (!data?.failing_since || !isAiProvider(data.provider)) return null;
  if (!isKeyFailureClass(data.failure_class)) return null;
  return {
    provider: data.provider,
    class: data.failure_class,
    status: data.failure_status ?? null,
    since: data.failing_since,
  };
}

/**
 * ownKeyFailure for the browser, where Chat already runs on the own key
 * (chatRunsOnOwnKey): its class and provider, or null. A read that fails is
 * null: a run meets the key anyway.
 */
export async function failingKeyFor(organizationId: string): Promise<FailingKey | null> {
  const failure = await ownKeyFailure(organizationId).catch((err) => {
    console.error("[chat/key-health] could not read the AI key's health:", err);
    return null;
  });
  return failure ? { class: failure.class, provider: failure.provider } : null;
}

/**
 * Marks the workspace's key for a provider as failing. Only the first
 * failure of an episode sets `failing_since` (a conditional update), so runs
 * that fail at once start one episode; a later failure in it keeps the
 * episode and records its class (invalid → no_credit). `started` is true for
 * the failure that began the episode: it tells the Admins (00441), whose
 * notice a class that changes later doesn't send again.
 */
export async function markKeyFailing(
  organizationId: string,
  provider: AiProvider,
  failure: { class: KeyFailureClass; status: number | null },
  now = new Date(),
): Promise<{ started: boolean; since: string | null }> {
  const since = now.toISOString();
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .update({
      failing_since: since,
      failure_class: failure.class,
      failure_status: failure.status,
    })
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .is('failing_since', null)
    .select('failing_since');
  if (error) throw new Error(`Could not mark the AI key failing: ${error.message}`);
  if ((data ?? []).length > 0) {
    // The Admins are told while Chat is on for the workspace: its agents run on the key.
    if (chatAgenticEnabled(organizationId)) {
      await notifyOwnKeyFailure(organizationId, provider, since);
    }
    return { started: true, since };
  }

  const { data: kept, error: keepError } = await supabaseAdmin
    .from('organization_ai_keys')
    .update({ failure_class: failure.class, failure_status: failure.status })
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .not('failing_since', 'is', null)
    .select('failing_since');
  if (keepError) throw new Error(`Could not mark the AI key failing: ${keepError.message}`);
  return { started: false, since: (kept ?? [])[0]?.failing_since ?? null };
}

/**
 * The workspace's agents paused because its own key failed start again
 * (AGENT-OWN-KEY §5.4): the key works, or it went out of use (removed, or
 * the plan no longer includes own keys). Agents paused for another reason
 * stay paused; missed slots aren't made up. The number resumed.
 */
export async function resumeOwnKeyAgents(
  organizationId: string,
  now = new Date(),
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .update({ status: 'active', paused_reason: null, activated_at: now.toISOString() })
    .eq('organization_id', organizationId)
    .eq('status', 'paused')
    .eq('paused_reason', 'own_key')
    .select('id');
  if (error) throw new Error(`Could not resume the agents: ${error.message}`);
  return (data ?? []).length;
}

/** A test of the key ran (Settings › AI Providers' Test, Save, Use for Chat): when. */
export async function markKeyChecked(
  organizationId: string,
  provider: AiProvider,
  now = new Date(),
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('organization_ai_keys')
    .update({ checked_at: now.toISOString() })
    .eq('organization_id', organizationId)
    .eq('provider', provider);
  if (error) throw new Error(`Could not keep when the AI key was checked: ${error.message}`);
}

/**
 * The Admins' notices that the key fails (00441) close once it works again
 * or is removed: their Inbox row goes with them.
 */
export async function resolveOwnKeyNotices(
  organizationId: string,
  provider: AiProvider,
  now = new Date(),
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_notices')
    .update({ resolved_at: now.toISOString() })
    .eq('organization_id', organizationId)
    .eq('kind', 'own_key_failed')
    .eq('payload->>provider', provider)
    .is('resolved_at', null);
  if (error) throw new Error(`Could not close the AI key's notices: ${error.message}`);
}

/**
 * The key works again (a passing test, or any successful call on it): clears
 * the episode and resumes the agents it paused. Writes only when the key was
 * marked failing, so a working key costs no write. `resume: false` for a key
 * Chat doesn't use: its agents paused for the active key's failure.
 */
export async function markKeyWorking(
  organizationId: string,
  provider: AiProvider,
  now = new Date(),
  { resume = true }: { resume?: boolean } = {},
): Promise<{ cleared: boolean; resumed: number }> {
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .update({
      failing_since: null,
      failure_class: null,
      failure_status: null,
      notified_at: null,
    })
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .not('failing_since', 'is', null)
    .select('provider');
  if (error) throw new Error(`Could not mark the AI key working: ${error.message}`);
  if ((data ?? []).length === 0) return { cleared: false, resumed: 0 };
  // The notices close even when they can't: the key works, the agents restart.
  await resolveOwnKeyNotices(organizationId, provider, now).catch((err) =>
    console.error("[chat/key] could not close the AI key's notices:", err),
  );
  return { cleared: true, resumed: resume ? await resumeOwnKeyAgents(organizationId, now) : 0 };
}
