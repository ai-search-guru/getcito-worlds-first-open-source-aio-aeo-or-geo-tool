import { type Plan, getPlan, isCloud, isSubscriptionActive } from '@/config/plans';

/**
 * Reading an organization row's plan, with no database client: planGuard.ts
 * imports the server's Supabase client (next/headers), so client components
 * that need a row's plan (Settings › Roles & access through lib/chat) read it
 * from here.
 */

/** The organization columns {@link planFromOrgRow} reads. */
export const ORG_PLAN_COLUMNS = 'plan, subscription_status, plan_overrides';

/**
 * The plan an organization row is entitled to, for callers that read the row
 * themselves (the MCP server has no user session, so it reads with the
 * service role).
 */
export function planFromOrgRow(
  data: { plan?: unknown; subscription_status?: unknown; plan_overrides?: unknown } | null,
): Plan {
  if (!isCloud()) return getPlan('self_hosted');

  // `trialing` is a paid plan in its trial window — treat it as active so
  // trial customers get their actual plan's limits (seats, brands, prompts…)
  // instead of being silently dropped to starter.
  if (!isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return getPlan('starter');
  }

  return ownPlan(data);
}

/** The plan the organization's row names, Enterprise's overrides merged. */
function ownPlan(data: { plan?: unknown; plan_overrides?: unknown } | null): Plan {
  const plan = getPlan(data?.plan as string | null | undefined);

  // Enterprise orgs can have custom limit overrides
  if (data?.plan === 'enterprise' && data.plan_overrides) {
    const overrides = data.plan_overrides as Record<string, unknown>;
    return {
      ...plan,
      limits: { ...plan.limits, ...overrides } as typeof plan.limits,
    };
  }

  return plan;
}

/**
 * The plan to show an organization's usage against: while its subscription
 * is active, the one it's entitled to; once it has ended (read-only, the
 * Choose a plan step), the plan it was on, marked ended, not Starter's,
 * which it never chose. What choosing a plan again gives it back.
 */
export function usagePlanFromOrgRow(
  data: { plan?: unknown; subscription_status?: unknown; plan_overrides?: unknown } | null,
): { plan: Plan; ended: boolean } {
  if (isCloud() && !isSubscriptionActive(data?.subscription_status as string | null | undefined)) {
    return { plan: ownPlan(data), ended: true };
  }
  return { plan: planFromOrgRow(data), ended: false };
}
