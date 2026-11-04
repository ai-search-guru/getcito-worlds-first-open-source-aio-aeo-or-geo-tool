import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan, PlanId } from '@/config/plans';
import type { Database } from '@/types/supabase';

/**
 * The Tracked Prompts usage cards (PROMPT-012): a brand's active and paused
 * prompts, and its account's active prompts, brands and active prompt
 * locations against the plan's limit. The counts come from the
 * prompt_usage_counters rows (00139), kept current by triggers on every
 * prompt write, so a page view never counts `prompts` itself.
 */

/** Where the Slots left card sends the user: billing to upgrade, or sales. */
export type PromptUsageCta = 'upgrade_growth' | 'upgrade' | 'contact' | 'choose_plan';

export interface PromptUsageSummary {
  plan: {
    key: PlanId;
    /** "Starter plan", "Enterprise plan"… */
    name: string;
    /** Active prompt locations the plan allows; null = unlimited. */
    locationLimit: number | null;
    /** null on self-hosted, where there is no plan to change. */
    cta: PromptUsageCta | null;
    /** The organization's plan has ended: it's the plan it was on, to choose again. */
    ended?: true;
  };
  brand: { active: number; paused: number; total: number };
  account: { activePrompts: number; brands: number; locationsUsed: number };
  /** When the counts were read. */
  updatedAt: string;
}

const PLAN_CTA: Record<PlanId, PromptUsageCta | null> = {
  self_hosted: null,
  starter: 'upgrade_growth',
  growth: 'upgrade',
  // GetCito sets each Enterprise customer's limit (plan_overrides).
  enterprise: 'contact',
};

/**
 * The plan half of the summary. `plan` is the effective plan (getOrgPlan /
 * planFromOrgRow), so the limit is the one the plan-limit guard enforces,
 * Enterprise overrides included.
 */
export function usagePlan(plan: Plan, ended = false): PromptUsageSummary['plan'] {
  const max = plan.limits.maxPrompts;
  return {
    key: plan.id,
    name: `${plan.name} plan`,
    locationLimit: max === -1 ? null : max,
    cta: ended ? 'choose_plan' : PLAN_CTA[plan.id],
    ...(ended ? { ended: true as const } : {}),
  };
}

/** One row of the prompt_usage_summary RPC. */
export type PromptUsageRow =
  Database['public']['Functions']['prompt_usage_summary']['Returns'][number];

/**
 * The RPC's row for one brand, or null when the brand doesn't exist or the
 * caller can't access it (00390: the RPC answers the server, or a person with
 * access to the brand, and totals the whole Account either way). Takes the
 * session client on the page and the service-role client in the MCP server,
 * which checks the brand's organization itself.
 */
export async function fetchPromptUsageRow(
  client: Pick<SupabaseClient, 'rpc'>,
  brandId: string,
): Promise<PromptUsageRow | null> {
  const { data, error } = await client.rpc('prompt_usage_summary', { p_brand_id: brandId });
  if (error) throw new Error(error.message);
  return ((data as PromptUsageRow[] | null) ?? [])[0] ?? null;
}

export function toPromptUsageSummary(
  row: PromptUsageRow,
  plan: Plan,
  now: Date = new Date(),
  { ended = false }: { ended?: boolean } = {},
): PromptUsageSummary {
  return {
    plan: usagePlan(plan, ended),
    brand: {
      active: row.brand_active,
      paused: row.brand_paused,
      total: row.brand_active + row.brand_paused,
    },
    account: {
      activePrompts: row.account_active,
      brands: row.account_brands,
      locationsUsed: row.account_locations,
    },
    updatedAt: now.toISOString(),
  };
}
