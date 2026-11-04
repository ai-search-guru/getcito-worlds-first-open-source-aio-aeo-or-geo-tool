import { API_BASE_URL } from '@/config/api';
import { CMS_NAMES } from '@/lib/content/cmsNames';
import type { CmsTarget } from '@/lib/content/cmsSendClient';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { autoGoLiveEnabled } from './flag';
import { GO_LIVE_GROUPS } from './goLive';

/**
 * An agent's permission to publish and send on its own (AUTONOMOUS-GO-LIVE
 * §7.2, PR 7): the box on its form, its badge and its last day's go-lives.
 * An Admin gives it, agent by agent, for the version the agent is on (an
 * edit makes a new version, and the permission no longer fits it), with a
 * daily limit of 1 to 20. It is its own request, never part of the agent's
 * save, so a Manager's edit can't carry it. It counts only while the
 * workspace's switch is on in Settings › Chat (CHAT_AUTO_GO_LIVE on). The
 * reads; agentGoLivePermission.ts gives and takes it. Server only.
 */

/** The workspace's switch as the agent pages read it: hidden while the flag is off. */
export type GoLiveSwitch = 'hidden' | 'off' | 'on';

/** The go-live group the box covers in v1 (§7.1): publishing. */
const GROUP = GO_LIVE_GROUPS[0];
/** A day of go-lives, as the agent page lists them. */
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MAX = 20;

/** An agent's permission, as its form and page show it. */
export interface AgentGoLiveView {
  /** Given for the agent's version now. */
  on: boolean;
  /** Given for an earlier version: off since the agent changed. */
  changed: boolean;
  /** The version it was given for. */
  version: number;
  dailyLimit: number;
  /** Who allowed it, by name; null when they've left the workspace or have no name. */
  by: string | null;
  at: string;
}

/** A page the agent took live on its own in the last 24 hours. */
export interface AgentGoLiveStep {
  title: string;
  /** The CMS, by name. */
  target: string;
  at: string;
  takenDown: boolean;
}

/** What the agent's page and form read of it: the switch, the permission, the day's go-lives. */
export interface AgentGoLiveDetail {
  switch: Exclude<GoLiveSwitch, 'hidden'>;
  permission: AgentGoLiveView | null;
  recent: AgentGoLiveStep[];
}

/** A table or column of 00443 the database doesn't have yet: the web ahead of it. */
const beforeMigration = (error: { code?: string } | null) =>
  !!error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '');

/** The workspace's switch: hidden with the flag off, or before 00443. */
export async function readGoLiveSwitch(organizationId: string): Promise<GoLiveSwitch> {
  if (!autoGoLiveEnabled(organizationId)) return 'hidden';
  const { data, error } = await supabaseAdmin
    .from('chat_settings')
    .select('auto_go_live_groups')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    if (beforeMigration(error)) return 'hidden';
    throw new Error(`Could not read the go-live switch: ${error.message}`);
  }
  return (data?.auto_go_live_groups ?? []).includes(GROUP) ? 'on' : 'off';
}

type PermissionRow = {
  agent_id: string;
  version: number;
  daily_limit: number;
  granted_by: string | null;
  granted_at: string;
};

async function permissionRows(organizationId: string, agentIds: string[]) {
  if (agentIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('chat_agent_go_live')
    .select('agent_id, version, daily_limit, granted_by, granted_at')
    .eq('organization_id', organizationId)
    .in('agent_id', agentIds);
  if (error) {
    if (beforeMigration(error)) return [];
    throw new Error(`Could not read the agents' go-live permissions: ${error.message}`);
  }
  return (data ?? []) as PermissionRow[];
}

/** Who gave a permission, by name, while they are in the workspace. */
async function grantorName(organizationId: string, id: string | null) {
  const names = new Map<string, string>();
  if (!id) return names;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('full_name')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`Could not read who allowed the agent: ${error.message}`);
  if (data?.full_name?.trim()) names.set(id, data.full_name.trim());
  return names;
}

const viewOf = (row: PermissionRow, version: number, names: Map<string, string>) => ({
  on: row.version === version,
  changed: row.version !== version,
  version: row.version,
  dailyLimit: row.daily_limit,
  by: row.granted_by ? (names.get(row.granted_by) ?? null) : null,
  at: row.granted_at,
});

/**
 * An agent's permission, its switch and its last day's go-lives, or null
 * while the flag is off. `version`: the version the agent is on now.
 */
export async function readAgentGoLive(
  organizationId: string,
  agentId: string,
  version: number,
  now = new Date(),
): Promise<AgentGoLiveDetail | null> {
  const switchNow = await readGoLiveSwitch(organizationId);
  if (switchNow === 'hidden') return null;
  const [rows, events] = await Promise.all([
    permissionRows(organizationId, [agentId]),
    supabaseAdmin
      .from('chat_agent_go_live_events')
      .select(
        'target, status, created_at, content_drafts!chat_agent_go_live_events_content_draft_id_fkey(title)',
      )
      .eq('organization_id', organizationId)
      .eq('agent_id', agentId)
      .in('status', ['done', 'taken_down'])
      .gt('created_at', new Date(now.getTime() - DAY_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(RECENT_MAX),
  ]);
  if (events.error && !beforeMigration(events.error)) {
    throw new Error(`Could not read the agent's go-lives: ${events.error.message}`);
  }
  const row = rows[0] ?? null;
  const names = await grantorName(organizationId, row?.granted_by ?? null);
  const recent = ((events.error ? [] : events.data) ?? []).map((event) => {
    const draft = (
      Array.isArray(event.content_drafts) ? event.content_drafts[0] : event.content_drafts
    ) as { title?: string | null } | null;
    return {
      title: draft?.title?.trim() || '',
      target: Object.hasOwn(CMS_NAMES, event.target)
        ? CMS_NAMES[event.target as CmsTarget]
        : event.target,
      at: event.created_at,
      takenDown: event.status === 'taken_down',
    };
  });
  return {
    switch: switchNow,
    permission: row ? viewOf(row, version, names) : null,
    recent,
  };
}

/**
 * The daily limits of the agents that go live on their own now, by agent:
 * the switch on and a permission for the version each is on. For the
 * agents' cards. Empty while the flag or the switch is off.
 */
export async function readGoLiveLimits(
  organizationId: string,
  agents: { id: string; version: number }[],
): Promise<Map<string, number>> {
  const limits = new Map<string, number>();
  if (agents.length === 0 || (await readGoLiveSwitch(organizationId)) !== 'on') return limits;
  const versions = new Map(agents.map((agent) => [agent.id, agent.version]));
  for (const row of await permissionRows(organizationId, [...versions.keys()])) {
    if (versions.get(row.agent_id) === row.version) limits.set(row.agent_id, row.daily_limit);
  }
  return limits;
}

/** How long the server may take to write the notices and send the e-mails. */
const NOTICE_TIMEOUT_MS = 15_000;

/**
 * An edit made a new version of an agent that was allowed to go live on its
 * own for `version`: the Admin who allowed it and its owner are told, in
 * their Inbox and by e-mail (the server's /api/internal/chat/notices/go-live-off,
 * 00446), but not `editor`, who made the change and saw the box. Nothing
 * while the flag is off, or for an agent that wasn't allowed for that
 * version. Never throws: the agent's page says it either way.
 */
export async function tellGoLiveOff(
  organizationId: string,
  agentId: string,
  version: number,
  editor: string,
): Promise<boolean> {
  try {
    if ((await readGoLiveSwitch(organizationId)) === 'hidden') return false;
    const [given] = await permissionRows(organizationId, [agentId]);
    if (given?.version !== version) return false;
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      console.error('[chat/agents] CRON_SECRET must be configured to tell who allowed an agent');
      return false;
    }
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/notices/go-live-off`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: organizationId, agentId, version, editor }),
      cache: 'no-store',
      signal: AbortSignal.timeout(NOTICE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.error('[chat/agents] could not tell who allowed an agent it changed:', err);
    return false;
  }
}
