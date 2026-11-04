import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { API_BASE_URL } from '@/config/api';
import { isCloud } from '@/config/plans';
import { aiUsageFromApi, type AiUsage, type AiUsageFeature } from '@/lib/billing/aiUsage';
import { canManageMenus, workAreasOf, type WorkAreaId } from '@/lib/menuAccess';
import type { UserRole } from '@/types';

/**
 * Who the key acts as and what the workspace has left of its AI allowance,
 * for the MCP tools get_me and get_ai_usage and their REST mirrors
 * (/api/mcp/whoami, /api/mcp/ai-usage).
 */

/** The person a key acts as: their role and what they work on (menu access, 00374). */
export interface McpMe {
  user_id: string;
  email: string | null;
  organization_id: string | null;
  organization_name: string | null;
  role: UserRole | null;
  /** What they work on, from "What do you work on?" (Settings › Account). */
  work_areas: { id: WorkAreaId; name: string }[];
  /** Admin, or a manager an admin let choose who sees which menu sections. */
  can_manage_menus: boolean;
}

/** A work area's name, as Settings › Menu access shows it. */
function workAreaName(id: WorkAreaId): string {
  return messages.settings.menuAccess.areas[id].title;
}

export async function getMeFor(auth: McpAuthContext): Promise<McpMe> {
  const [{ data: profile, error: profileError }, { data: org, error: orgError }] =
    await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('role, work_areas, can_manage_menus')
        .eq('id', auth.userId)
        .maybeSingle(),
      auth.organizationId
        ? supabaseAdmin
            .from('organizations')
            .select('name')
            .eq('id', auth.organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (profileError) throw new Error(profileError.message);
  if (orgError) throw new Error(orgError.message);
  const role = (profile?.role as UserRole | null | undefined) ?? null;
  return {
    user_id: auth.userId,
    email: auth.email,
    organization_id: auth.organizationId,
    organization_name: (org?.name as string | null | undefined) ?? null,
    role,
    work_areas: workAreasOf((profile?.work_areas as string[] | null | undefined) ?? null).map(
      (id) => ({ id, name: workAreaName(id) }),
    ),
    can_manage_menus: role
      ? canManageMenus({
          role,
          can_manage_menus: (profile?.can_manage_menus as boolean | null | undefined) ?? null,
        })
      : false,
  };
}

/** This period's AI usage, as the Billing page's meter reads it. */
export interface McpAiUsage {
  /** Whether the workspace has an active plan (or free trial) to meter. */
  active_plan: boolean;
  plan: string | null;
  plan_name: string | null;
  /** The free trial's smaller allowance: more comes with paying for the plan. */
  trial: boolean;
  period_start: string | null;
  period_end: string | null;
  /** No allowance to meter (self-hosted, or a plan without one). */
  unlimited: boolean;
  /** Share of the monthly AI allowance used, 0–100 to a tenth; null when unlimited or no plan. */
  percent_used: number | null;
  /** Each feature's share of the allowance, only those that used some. */
  features: { feature: AiUsageFeature; percent: number }[];
}

/** Self-hosted: nothing is metered. */
const SELF_HOSTED: McpAiUsage = {
  active_plan: true,
  plan: 'self_hosted',
  plan_name: null,
  trial: false,
  period_start: null,
  period_end: null,
  unlimited: true,
  percent_used: null,
  features: [],
};

const NO_PLAN: McpAiUsage = {
  active_plan: false,
  plan: null,
  plan_name: null,
  trial: false,
  period_start: null,
  period_end: null,
  unlimited: false,
  percent_used: null,
  features: [],
};

function mcpAiUsage(usage: AiUsage): McpAiUsage {
  return {
    active_plan: true,
    plan: usage.plan,
    plan_name: usage.planName,
    trial: usage.trial === true,
    period_start: usage.periodStart,
    period_end: usage.periodEnd,
    unlimited: usage.unlimited,
    percent_used: usage.percentUsed,
    features: usage.features,
  };
}

/**
 * The org's AI usage this period, from the server's getAiUsage through the
 * CRON_SECRET internal endpoint, so the numbers are the Billing meter's own.
 * A workspace without an active plan has no allowance: active_plan false.
 * Self-hosted meters nothing, so it answers unlimited without asking.
 */
export async function getAiUsageFor(auth: McpAuthContext): Promise<McpAiUsage | null> {
  if (!isCloud()) return SELF_HOSTED;
  if (!auth.organizationId) return null;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw new Error('CRON_SECRET must be configured for MCP AI usage');
  }

  const url = `${API_BASE_URL}/api/internal/ai-usage?orgId=${encodeURIComponent(
    auth.organizationId,
  )}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  const body = (await res.json().catch(() => null)) as {
    usage?: AiUsage;
    error?: string;
    message?: string;
  } | null;

  if (!res.ok) {
    if (res.status === 402 && body?.error === 'plan_limit') return NO_PLAN;
    throw new Error(body?.message ?? `Internal ai-usage endpoint returned ${res.status}`);
  }
  if (!body?.usage) throw new Error('Internal ai-usage endpoint returned no usage');
  return mcpAiUsage(aiUsageFromApi(body.usage));
}
