import { API_BASE_URL } from '@/config/api';

/**
 * Each agent's share of the monthly AI limit (CHAT-27 items 24–30), from the
 * server (GET /api/internal/chat/budget/agent-shares: chat_agent_usage_shares
 * against the budget it keeps). Shares only: the budget, in dollars, never
 * leaves the server, and nothing here has one. One grouped read per
 * workspace and window, kept for 5 minutes (item 30). Never throws: a read
 * that fails is null, and the Agents pages show no figure rather than none
 * of their rows. Server only (CRON_SECRET).
 */

export interface AgentShare {
  /** What its runs spent on the budget, as a share of it (0.032: 3.2%). */
  share: number;
  /** What they spent on the workspace's own key, over the same budget ("on your own key"). */
  ownKeyShare: number;
  /** Runs that spent anything. */
  runs: number;
}

export interface AgentShares {
  /** No budget to share (self-hosted): no figures. */
  unlimited: boolean;
  /** By agent id. */
  byAgent: ReadonlyMap<string, AgentShare>;
}

/** This billing period's (the detail's header), or the last 30 days' (the list's column). */
export type AgentShareWindow = 'period' | 'days30';

/** How long a read is kept (item 30). */
export const AGENT_SHARES_TTL_MS = 5 * 60_000;
/** How long the server may take: a list waits on it. */
export const AGENT_SHARES_TIMEOUT_MS = 3_000;

const cache = new Map<string, { at: number; value: AgentShares }>();

/** Forget what was read (tests). */
export function clearAgentShares(): void {
  cache.clear();
}

interface ServerShares {
  unlimited?: unknown;
  shares?: { agentId?: unknown; share?: unknown; ownKeyShare?: unknown; runs?: unknown }[];
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The workspace's agents' shares in a window, or null when the server didn't answer. */
export async function readAgentShares(
  organizationId: string,
  window: AgentShareWindow,
): Promise<AgentShares | null> {
  const key = `${organizationId}:${window}`;
  const kept = cache.get(key);
  if (kept && Date.now() - kept.at < AGENT_SHARES_TTL_MS) return kept.value;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/agents] CRON_SECRET must be configured for agent shares');
    return null;
  }
  const query = new URLSearchParams({ orgId: organizationId });
  if (window === 'days30') query.set('days', '30');
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/budget/agent-shares?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(AGENT_SHARES_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as ServerShares | null;
    if (!body) return null;
    const byAgent = new Map<string, AgentShare>();
    for (const row of body.shares ?? []) {
      // A deleted agent's runs come back together, without an agent: no row of the list.
      if (typeof row.agentId !== 'string') continue;
      byAgent.set(row.agentId, {
        share: num(row.share),
        ownKeyShare: num(row.ownKeyShare),
        runs: num(row.runs),
      });
    }
    const value: AgentShares = { unlimited: body.unlimited === true, byAgent };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    console.error('[chat/agents] agent shares got no answer:', (err as Error)?.name ?? err);
    return null;
  }
}
