import { createClient } from '@/lib/supabase/server';
import {
  type Feature,
  type Plan,
  type PlanLimits,
  getPlan,
  hasFeature,
  isCloud,
  isWithinLimit,
} from '@/config/plans';
import { planFromOrgRow } from './planRow';

// The row-to-plan reads moved to planRow.ts, which client components can
// import; kept here for the server callers that already read them from here.
export { ORG_PLAN_COLUMNS, planFromOrgRow, usagePlanFromOrgRow } from './planRow';

export async function getOrgPlan(organizationId: string): Promise<Plan> {
  if (!isCloud()) return getPlan('self_hosted');

  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('plan, subscription_status, plan_overrides')
    .eq('id', organizationId)
    .single();

  return planFromOrgRow(data);
}

export class PlanLimitError extends Error {
  public readonly requiredPlan: string;

  constructor(message: string, requiredPlan: string) {
    super(message);
    this.name = 'PlanLimitError';
    this.requiredPlan = requiredPlan;
  }
}

export async function enforceFeature(organizationId: string, feature: Feature): Promise<void> {
  const plan = await getOrgPlan(organizationId);
  if (!hasFeature(plan, feature)) {
    throw new PlanLimitError(`This feature requires a higher plan.`, plan.name);
  }
}

export async function enforceLimit(
  organizationId: string,
  key: keyof Omit<PlanLimits, 'features' | 'allowedScrapers' | 'allowedModels'>,
  currentCount: number,
): Promise<void> {
  const plan = await getOrgPlan(organizationId);
  if (!isWithinLimit(plan, key, currentCount)) {
    const limit = plan.limits[key];
    throw new PlanLimitError(
      `Plan limit reached: maximum ${limit} for ${key}. Upgrade to increase.`,
      plan.name,
    );
  }
}
