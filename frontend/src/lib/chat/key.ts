import { supabaseAdmin } from '@/lib/supabase/admin';
import { isCloud } from '@/config/plans';
import { readActiveKey, resolveAgentModelConfig } from '@/lib/agent/key';
import type { AgentModelConfig } from '@/lib/agent/model';
import { isAiProvider, type AiProvider } from '@/lib/agent/providers';
import { chatAgenticEnabled } from './flag';
import { markKeyFailing, ownKeyFailure, type OwnKeyFailure } from './keyHealth';

/**
 * Whose key a Chat step runs on (CHAT-16 item 22, owner decision 11 of the
 * Chat P0 plan): the workspace's own, which its provider bills, or
 * GetCito's, which draws on the workspace's monthly AI budget (CHAT-04 §C,
 * lib/chat/budget.ts). Both write the step's usage row; only GetCito's
 * counts.
 */
export type ChatKeySource = 'own' | 'getcito';

export interface ChatModelKey {
  source: ChatKeySource;
  config: AgentModelConfig;
}

/**
 * The workspace's own key is the one Chat runs on, but its saved envelope
 * can't be decrypted (AGENT-OWN-KEY §5.1 `unreadable`): Chat stops on it
 * rather than move to GetCito's key and the AI limit.
 */
export class OwnKeyUnreadableError extends Error {
  readonly provider: AiProvider;

  constructor(provider: AiProvider) {
    super(`The saved ${provider} key can't be read.`);
    this.name = 'OwnKeyUnreadableError';
    this.provider = provider;
  }
}

/** What decides whether a workspace's own key may run Chat. */
export interface OwnKeyOrg {
  plan: string | null;
  legacy_key_grandfathered: boolean | null;
  /** When a kept key's days end; null until Chat first needs it (00414). */
  legacy_key_until: string | null;
}

/** How long a key saved before Chat went live keeps running it (CHAT-16 item 28). */
export const LEGACY_KEY_DAYS = 30;

/**
 * Own keys come with Enterprise only (CHAT-16 item 19, owner decision
 * 2026-10-30): on Growth they would take the place of AI credit packs.
 * Enterprise trials are a deal's, with its terms.
 */
export function ownKeyInPlan(org: Pick<OwnKeyOrg, 'plan'>): boolean {
  return org.plan === 'enterprise';
}

/**
 * Whether a key saved before Chat went live for the workspace still runs it
 * (CHAT-16 item 28, organizations.legacy_key_grandfathered): for 30 days, on
 * any plan. Not started yet counts as running; they start the first time
 * Chat or Settings › AI Providers needs them (startLegacyKeyDays).
 */
export function legacyKeyRunning(
  org: Pick<OwnKeyOrg, 'legacy_key_grandfathered' | 'legacy_key_until'>,
  now = Date.now(),
): boolean {
  if (org.legacy_key_grandfathered !== true) return false;
  return org.legacy_key_until === null || Date.parse(org.legacy_key_until) > now;
}

/** Whether Chat may run on the workspace's own key: Enterprise, or a kept key's days. */
export function ownKeyAllowed(org: OwnKeyOrg | null | undefined, now = Date.now()): boolean {
  if (!org) return false;
  return ownKeyInPlan(org) || legacyKeyRunning(org, now);
}

/**
 * Starts a kept key's 30 days, once: a start at the same moment can't move
 * the date (the update only fills an empty one). The date they end.
 */
export async function startLegacyKeyDays(organizationId: string): Promise<string | null> {
  const until = new Date(Date.now() + LEGACY_KEY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .update({ legacy_key_until: until })
    .eq('id', organizationId)
    .eq('legacy_key_grandfathered', true)
    .is('legacy_key_until', null)
    .select('legacy_key_until')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data.legacy_key_until;
  const { data: org, error: readError } = await supabaseAdmin
    .from('organizations')
    .select('legacy_key_until')
    .eq('id', organizationId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  return org?.legacy_key_until ?? null;
}

/**
 * What a workspace's own keys do, for Chat and Settings › AI Providers:
 * - `open`: Chat is off for it (today's Agent Chat, which runs on its own
 *   key on any plan) or self-hosted.
 * - `plan`: its plan includes own keys (Enterprise).
 * - `kept`: a key saved before Chat went live runs it until `until`.
 * - `locked`: Chat runs on the plan's AI limit; own keys need Enterprise.
 */
export type OwnKeyAccess =
  { state: 'open' | 'plan' | 'locked' } | { state: 'kept'; until: string | null };

export async function ownKeyAccess(organizationId: string): Promise<OwnKeyAccess> {
  if (!isCloud() || !chatAgenticEnabled(organizationId)) return { state: 'open' };
  const { data: org, error } = await supabaseAdmin
    .from('organizations')
    .select('plan, legacy_key_grandfathered, legacy_key_until')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) return { state: 'locked' };
  if (ownKeyInPlan(org)) return { state: 'plan' };
  if (org.legacy_key_grandfathered && org.legacy_key_until === null) {
    org.legacy_key_until = await startLegacyKeyDays(organizationId);
  }
  return legacyKeyRunning(org)
    ? { state: 'kept', until: org.legacy_key_until }
    : { state: 'locked' };
}

/**
 * The key a Chat step runs on, in order:
 *   1. The workspace's own (its active key in Settings › AI Providers), on
 *      Enterprise or for a kept key's 30 days (ownKeyAccess): the provider
 *      bills the workspace, and the usage percent doesn't move. One that
 *      can't be decrypted throws OwnKeyUnreadableError and is marked
 *      failing (lib/chat/keyHealth.ts): never GetCito's key in its place.
 *   2. GetCito's (ANTHROPIC_API_KEY; Auto is Anthropic first-party): the
 *      step draws on the workspace's AI budget.
 * Null when neither is there. Self-hosted, the operator's own key is
 * GetCito's here, with no budget to draw on (the server meters nothing).
 *
 * Only with CHAT_AGENTIC on for the workspace. Off, it is today's Agent
 * Chat: on the cloud the workspace's own key or nothing, never GetCito's
 * (resolveAgentModelConfig), and nothing is metered; it reads as 'own'.
 */
export async function resolveChatModelKey(organizationId: string): Promise<ChatModelKey | null> {
  if (!chatAgenticEnabled(organizationId)) {
    const config = await resolveAgentModelConfig(organizationId);
    return config ? { source: 'own', config } : null;
  }

  const access = await ownKeyAccess(organizationId);
  if (access.state === 'plan' || access.state === 'kept') {
    const own = await readActiveKey(organizationId);
    if (own.state === 'ready') return { source: 'own', config: own.config };
    if (own.state === 'unreadable') {
      await markKeyFailing(organizationId, own.provider, {
        class: 'unreadable',
        status: null,
      }).catch((err) => console.error('[chat/key] could not mark the key failing:', err));
      throw new OwnKeyUnreadableError(own.provider);
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  return apiKey
    ? { source: 'getcito', config: { provider: 'anthropic', apiKey, settings: {} } }
    : null;
}

/**
 * Whether the workspace's Chat runs on its own key, as resolveChatModelKey
 * would pick it, without decrypting the key: ownKeyAccess allows own keys and
 * Settings › AI Providers has an active one. One that can't be decrypted
 * counts too: Chat stops on it rather than move to the AI limit. Such steps never draw on the AI
 * budget (reserve_chat_ai_usage writes them unchecked), so the composer
 * stays on at the cap. False with Chat off or self-hosted, where nothing is
 * metered, and when it can't be read: the server's hold still decides a run.
 */
export async function chatRunsOnOwnKey(organizationId: string): Promise<boolean> {
  return (await ownChatKeyProvider(organizationId)) !== null;
}

/**
 * The provider of the own key the workspace's Chat runs on, as
 * chatRunsOnOwnKey decides it; null when Chat runs on GetCito's key. The
 * model menu marks that provider's models "Your key" (W4-01).
 */
export async function ownChatKeyProvider(organizationId: string): Promise<AiProvider | null> {
  if (!isCloud() || !chatAgenticEnabled(organizationId)) return null;
  // Same rule as resolveChatModelKey: Enterprise, or a kept key's 30 days.
  const access = await ownKeyAccess(organizationId).catch(() => null);
  if (access?.state !== 'plan' && access?.state !== 'kept') return null;
  const { data: key } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('provider, key_encrypted')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .maybeSingle();
  return key?.key_encrypted && isAiProvider(key.provider) ? key.provider : null;
}

/**
 * The workspace's own key, when Chat runs on it and it is marked failing
 * (AGENT-OWN-KEY §5.2 items 4–6): agents are refused until it works, and
 * Agent Center and the composer say so. Null otherwise, and when it can't be
 * read: a run that starts meets the key anyway.
 */
export async function failingOwnKey(organizationId: string): Promise<OwnKeyFailure | null> {
  try {
    if (!(await chatRunsOnOwnKey(organizationId))) return null;
    return await ownKeyFailure(organizationId);
  } catch (err) {
    console.error("[chat/key] could not read the AI key's health:", err);
    return null;
  }
}
