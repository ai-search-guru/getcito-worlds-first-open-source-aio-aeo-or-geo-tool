import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NextResponse } from 'next/server';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { planFactsFromOrgRow, planGateLock, type OrgPlanRow } from '@/lib/chat/planFacts';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  SUBSCRIPTION_INACTIVE,
  SubscriptionInactiveError,
  failedCallResponse,
  subscriptionInactiveResponse,
} from '@/lib/subscriptionGuard';
import { callOnDemoBrand, demoBrandToolResult } from './demoGate';

/**
 * GetCito Cloud's read-only mode on the API key surface (MCP tools, the
 * /api/mcp REST routes): while a workspace's plan isn't active — its trial
 * ended, or it was canceled — reading stays open and anything that writes,
 * runs or spends answers with the server's 402 body, as the dashboard's
 * upgrade dialog reads it. Self-hosted is never gated. The refusal itself is
 * shared with the web app's own writes (lib/subscriptionGuard.ts).
 *
 * MCP per plan (CHAT-22 feature 3 item 13; DECISIONS S, 2026-10-30): reads
 * work on every plan, the free trial included; writing, running and
 * spending through MCP or the REST routes need Growth or above, paid: the
 * Growth trial reads only, as Starter does. The same lock as the plan
 * card's MCP chip (planGateLock).
 */
export {
  SUBSCRIPTION_INACTIVE,
  SubscriptionInactiveError,
  failedCallResponse,
  subscriptionInactiveResponse,
};

/**
 * The tools that only read: open while read-only. Any other tool — a new one
 * too, until it is named as a read — needs an active plan.
 */
export function isReadTool(name: string): boolean {
  return name.startsWith('list_') || name.startsWith('get_');
}

/** The plan MCP writes need: Growth, past its free trial, or Enterprise. */
export const MCP_WRITE_PLAN = 'growth' as const;

/** A write refused for the plan, as subscription_inactive is for a plan that isn't active. */
export const PLAN_REQUIRED = {
  error: 'plan_limit',
  code: 'plan_required',
  required_plan: MCP_WRITE_PLAN,
  message:
    "On Starter and in the free trial, GetCito's MCP tools and API can read. Changes, runs " +
    'and anything that uses credits need the Growth plan or above: an admin can upgrade in ' +
    'Settings › Billing.',
} as const;

/** The REST routes' answer to a write the plan doesn't include. */
export function planRequiredResponse(): NextResponse {
  return NextResponse.json(PLAN_REQUIRED, { status: 402 });
}

/** Whether a write may go through: yes, its plan isn't active, or its plan doesn't include it. */
export type McpWriteAccess = 'ok' | 'inactive' | 'plan';

/**
 * Whether the organization may write over MCP or the REST routes, from one
 * read of its plan and subscription: always self-hosted, and for a key
 * without an organization. A plan that isn't active is `inactive` first.
 */
export async function mcpWriteAccess(organizationId: string | null): Promise<McpWriteAccess> {
  if (!isCloud() || !organizationId) return 'ok';
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(ORG_PLAN_COLUMNS)
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const facts = planFactsFromOrgRow(data as OrgPlanRow);
  if (!facts.writable) return 'inactive';
  return planGateLock(facts, { minPlan: MCP_WRITE_PLAN }) ? 'plan' : 'ok';
}

/** Whether the organization may write: always self-hosted, and for a key without one. */
export async function subscriptionActiveFor(organizationId: string | null): Promise<boolean> {
  if (!isCloud() || !organizationId) return true;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('subscription_status')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return isSubscriptionActive(data?.subscription_status as string | null | undefined);
}

/**
 * Refuse a costly call (the server's internal endpoints: a brief, a Site
 * Audit, an Improve action) while the workspace is read-only, whoever calls
 * it: an MCP tool, a REST route, the in-product agent, or one added later.
 */
export async function assertSubscriptionActive(organizationId: string | null): Promise<void> {
  if (!(await subscriptionActiveFor(organizationId))) throw new SubscriptionInactiveError();
}

/** A tool's answer to a call while read-only: a tool error carrying the same body. */
export function subscriptionInactiveToolResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(SUBSCRIPTION_INACTIVE, null, 2) }],
    isError: true,
  };
}

/**
 * A write tool's answer on a plan without MCP writes: a tool error with the
 * plan it needs, for the host model to tell the person why. The tool stays
 * listed, so the host can say so instead of not finding it.
 */
export function planRequiredToolResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(PLAN_REQUIRED, null, 2) }],
    isError: true,
  };
}

type AnyToolCallback = (...args: unknown[]) => unknown;
type LooseRegisterTool = (name: string, config: unknown, cb: AnyToolCallback) => unknown;

/**
 * Have every tool registered on `server` from here on, other than a read
 * tool, check the organization's plan before it runs: a call on the demo
 * brand is refused first, whatever the plan (demoGate.ts), then a plan
 * that isn't active (subscription_inactive), then a plan without MCP writes
 * (plan_required). The plan that can't be read refuses the call too
 * (mcpWriteAccess throws). The plan is read once per server, which the MCP
 * route builds per request, and only when a gated tool is called.
 */
export function gateWriteTools(server: McpServer, organizationId: string | null): McpServer {
  let access: Promise<McpWriteAccess> | null = null;
  const register = server.registerTool.bind(server) as unknown as LooseRegisterTool;
  const gated: LooseRegisterTool = (name, config, cb) =>
    register(
      name,
      config,
      isReadTool(name)
        ? cb
        : async (...args: unknown[]) => {
            if (await callOnDemoBrand(name, organizationId, args[0])) return demoBrandToolResult();
            access ??= mcpWriteAccess(organizationId);
            const allowed = await access;
            if (allowed === 'inactive') return subscriptionInactiveToolResult();
            if (allowed === 'plan') return planRequiredToolResult();
            return cb(...args);
          },
    );
  server.registerTool = gated as unknown as McpServer['registerTool'];
  // The SDK's older tool() would register around the gate: refused, so every
  // tool goes through registerTool above.
  server.tool = (() => {
    throw new Error('Register MCP tools with registerTool: the read-only gate wraps it');
  }) as McpServer['tool'];
  return server;
}
