import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { decryptApiKey } from '@/lib/agent/keyEncryption';
import type { AgentModelConfig } from '@/lib/agent/model';
import { isAiProvider, type AiProvider, type AiProviderSettings } from '@/lib/agent/providers';

/**
 * The organization's active key in Settings › AI Providers (cloud): none
 * saved, saved but unreadable (its envelope can't be decrypted: the master
 * key rotated without a re-save, a malformed row), or ready with its
 * provider's settings. Never logs the plaintext.
 */
export type ActiveKeyRead =
  | { state: 'none' }
  | { state: 'unreadable'; provider: AiProvider }
  | { state: 'ready'; config: AgentModelConfig };

export async function readActiveKey(organizationId: string): Promise<ActiveKeyRead> {
  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted, settings')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return keyReadOf(data);
}

/** A provider's saved key, as readActiveKey reads the active one, and whether Chat uses it. */
export async function readProviderKey(
  organizationId: string,
  provider: AiProvider,
): Promise<ActiveKeyRead & { active: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted, settings, active')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(`Could not read the AI key: ${error.message}`);
  return { ...keyReadOf(data), active: data?.active === true };
}

function keyReadOf(
  data: { provider: unknown; key_encrypted: string | null; settings: unknown } | null,
): ActiveKeyRead {
  if (!data?.key_encrypted || !isAiProvider(data.provider)) return { state: 'none' };
  const apiKey = decryptApiKey(data.key_encrypted);
  if (!apiKey) return { state: 'unreadable', provider: data.provider };
  return {
    state: 'ready',
    config: {
      provider: data.provider,
      apiKey,
      settings: (data.settings ?? {}) as AiProviderSettings,
    },
  };
}

/**
 * Resolve the provider and API key that the agent should use for this org.
 *
 * - **Self-host** (`isCloud() === false`): falls back to the operator's
 *   own `ANTHROPIC_API_KEY` env var. The org's keys are ignored — self-host
 *   instances belong to one customer who configures the model centrally.
 * - **Cloud**: the org's active key (readActiveKey). Returns `null` if the
 *   org hasn't set a key yet or if it can't be decrypted — callers turn that
 *   into a 403 + "set a key in Settings" CTA. Chat tells the two apart
 *   (lib/chat/key.ts): a key that can't be read stops it.
 *
 * Never returns the env key on cloud (avoid the footgun of one customer
 * falling back to GetCito's own quota).
 */
export async function resolveAgentModelConfig(
  organizationId: string,
): Promise<AgentModelConfig | null> {
  if (!isCloud()) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    return apiKey ? { provider: 'anthropic', apiKey, settings: {} } : null;
  }
  const key = await readActiveKey(organizationId);
  return key.state === 'ready' ? key.config : null;
}

/**
 * Lightweight "is a key configured?" check that avoids decrypt — handy for
 * page-load gating where we only need to know whether to render the chat
 * UI vs the "set a key" empty state.
 */
export async function isAgentKeyConfigured(organizationId: string): Promise<boolean> {
  if (!isCloud()) {
    return !!process.env.ANTHROPIC_API_KEY;
  }
  const { data } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return !!data;
}
