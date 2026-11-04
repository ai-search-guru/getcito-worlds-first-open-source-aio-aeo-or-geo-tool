import { NextResponse } from 'next/server';
import { PLANS } from '@/config/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AgentFormSetup } from './agentForm';
import { readGoLiveSwitch } from './agentGoLive';
import { AGENT_ENGINES, enginesDenial, modeDenial } from './agentRules';
import { readAgent, readAgentContext, type AgentContext, type AgentDetail } from './agents';
import { OwnKeyUnreadableError, resolveChatModelKey } from './key';
import { chatActor } from './runApi';

/**
 * What the create and edit pages of an agent (CHAT-21 §D) know before the
 * form opens, read on the server for the signed-in person: their live role,
 * the brands and topics a scope may name, the plan's engines, whether Full
 * auto is open, locked by the plan or turned off in Settings › Chat, the
 * workspace's Max per run and sharing rule, the names already taken and
 * whose key Chat runs on. Never a price or a dollar: shares and names only.
 * Server only.
 */

/** Topics a scope lists at most. */
const TOPICS_MAX = 500;

export async function agentFormSetupFor(ctx: AgentContext): Promise<AgentFormSetup> {
  const org = ctx.actor.organizationId;
  const [brands, agents, ownKeyProvider, goLive] = await Promise.all([
    supabaseAdmin.from('brands').select('id, name, is_demo').eq('organization_id', org),
    supabaseAdmin
      .from('chat_agents')
      .select('name, visibility, owner_id')
      .eq('organization_id', org),
    resolveChatModelKey(org)
      .then((resolved) => (resolved?.source === 'own' ? resolved.config.provider : null))
      .catch((err) => {
        // A saved key that can't be read is still the one agents run on.
        if (err instanceof OwnKeyUnreadableError) return err.provider;
        console.error('[chat/agents] could not read whose key Chat runs on:', err);
        return null;
      }),
    readGoLiveSwitch(org),
  ]);
  if (brands.error) throw new Error(`Could not read the brands: ${brands.error.message}`);
  if (agents.error) throw new Error(`Could not read the agents' names: ${agents.error.message}`);

  const access = ctx.viewer.brandAccess;
  // The demo brand runs nothing (00380); an Agency partner names only their shared brands.
  const usable = ((brands.data ?? []) as { id: string; name: string; is_demo: boolean }[])
    .filter((b) => !b.is_demo && (access === 'all' || access.includes(b.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ id, name }) => ({ id, name }));

  let topics: AgentFormSetup['topics'] = [];
  if (usable.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('topics')
      .select('id, name, brand_id, is_active')
      .in(
        'brand_id',
        usable.map((b) => b.id),
      )
      .limit(TOPICS_MAX);
    if (error) throw new Error(`Could not read the topics: ${error.message}`);
    topics = ((data ?? []) as { id: string; name: string; brand_id: string; is_active: boolean }[])
      .filter((topic) => topic.is_active !== false)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((topic) => ({ id: topic.id, name: topic.name, brandId: topic.brand_id }));
  }

  const fullAutoDenial = modeDenial('full_auto', ctx.plan, ctx.settings, ctx.viewer.role);
  const needs =
    fullAutoDenial?.denial.code === 'plan_locked' ? fullAutoDenial.denial.needs : 'growth';
  const me = ctx.actor.userId;
  const admin = ctx.viewer.role === 'admin';
  const seen = ((agents.data ?? []) as { name: string; visibility: string; owner_id: string }[])
    // Admins see every agent; others theirs and the workspace's (§K item 51).
    .filter((a) => admin || a.visibility === 'workspace' || a.owner_id === me)
    .map((a) => a.name);

  return {
    role: ctx.viewer.role,
    brands: usable,
    topics,
    engines: AGENT_ENGINES.filter((id) => enginesDenial(ctx.plan, [id]) === null),
    fullAuto: !fullAutoDenial
      ? 'open'
      : fullAutoDenial.denial.code === 'plan_locked'
        ? 'plan'
        : 'policy',
    planName: ctx.plan.planName,
    fullAutoPlan: PLANS[needs].name,
    workspaceAgentsAdminsOnly: ctx.settings.workspaceAgentsAdminsOnly,
    runShareDefault: ctx.settings.runShareDefault,
    takenNames: seen,
    ownKeyProvider,
    goLive,
  };
}

/** The person's agent context, or null when Chat is off for them or they can't act in the workspace. */
async function contextNow(): Promise<AgentContext | null> {
  const actor = await chatActor();
  if (actor instanceof NextResponse) return null;
  return readAgentContext(actor);
}

/** The new-agent page's setup, or null (the page is then not found). */
export async function readAgentFormSetup(): Promise<AgentFormSetup | null> {
  const ctx = await contextNow();
  return ctx ? agentFormSetupFor(ctx) : null;
}

/** The edit page's setup and agent, or null when the person can't see the agent. */
export async function readAgentEdit(
  id: string,
): Promise<{ setup: AgentFormSetup; agent: AgentDetail } | null> {
  const ctx = await contextNow();
  if (!ctx) return null;
  const agent = await readAgent(ctx, id);
  return agent ? { setup: await agentFormSetupFor(ctx), agent } : null;
}
