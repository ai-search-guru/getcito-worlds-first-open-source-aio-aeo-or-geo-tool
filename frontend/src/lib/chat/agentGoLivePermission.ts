import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAgentGoLive, readGoLiveSwitch, type AgentGoLiveDetail } from './agentGoLive';
import { modeDenial } from './agentRules';
import {
  agentForAct,
  denied,
  logAgentChange,
  refused,
  type AgentContext,
  type Refused,
} from './agents';

/**
 * Gives an agent the permission for the version it is on, with its daily
 * limit (`dailyLimit`), or takes it away (null). Admins only (§7.2: a
 * Manager owner asks). Giving it needs the flag and the workspace's switch
 * on, Full auto open to agents on the plan, and the agent in Full auto.
 * Taking it away always works. Logged with the agent. Answers the agent's
 * permission after it.
 */
export async function setAgentGoLive(
  ctx: AgentContext,
  id: string,
  dailyLimit: number | null,
): Promise<{ ok: true; detail: AgentGoLiveDetail | null } | Refused> {
  if (ctx.viewer.role !== 'admin') {
    return denied(ctx, {
      denial: { code: 'forbidden_role', role: ctx.viewer.role, roles: ['admin'] },
      asked: 'goLive',
    });
  }
  const found = await agentForAct(ctx, id, 'edit');
  if (!found.ok) return found;
  const { row, version } = found.agent;
  const org = ctx.actor.organizationId;

  if (dailyLimit === null) {
    const { error } = await supabaseAdmin
      .from('chat_agent_go_live')
      .delete()
      .eq('agent_id', row.id)
      .eq('organization_id', org);
    if (error) throw new Error(`Could not take the go-live permission away: ${error.message}`);
    await logAgentChange(ctx, row, 'agentGoLiveOff');
    return { ok: true, detail: await readAgentGoLive(org, row.id, row.version) };
  }

  if (row.status === 'archived') return refused('archived');
  if ((await readGoLiveSwitch(org)) !== 'on') return refused('go_live_off');
  const mode = modeDenial('full_auto', ctx.plan, ctx.settings, ctx.viewer.role);
  if (mode) return denied(ctx, { ...mode, asked: 'goLive' });
  if (version?.mode !== 'full_auto') return refused('go_live_mode');
  const { error } = await supabaseAdmin.from('chat_agent_go_live').upsert(
    {
      agent_id: row.id,
      organization_id: org,
      version: row.version,
      daily_limit: dailyLimit,
      // GetCito's own skills carry none; Library skills' copies aren't built (§8).
      skill_checksums: {},
      granted_by: ctx.actor.userId,
      granted_at: new Date().toISOString(),
    },
    { onConflict: 'agent_id' },
  );
  if (error) throw new Error(`Could not give the go-live permission: ${error.message}`);
  await logAgentChange(ctx, row, 'agentGoLiveOn', { params: { limit: String(dailyLimit) } });
  // Allowed again: the notices that it no longer was are over (00446).
  const { error: closeError } = await supabaseAdmin
    .from('chat_notices')
    .update({ resolved_at: new Date().toISOString() })
    .eq('organization_id', org)
    .eq('kind', 'agent_go_live_off')
    .eq('payload->>agentId', row.id)
    .is('resolved_at', null);
  if (closeError) console.error('[chat/agents] could not close the go-live notices:', closeError);
  return { ok: true, detail: await readAgentGoLive(org, row.id, row.version) };
}
