import {
  PLANS,
  PLAN_ORDER,
  getMinimumPlanForFeature,
  getPlan,
  isCloud,
  isSubscriptionActive,
  type Feature,
  type PlanId,
  type PlanLimits,
} from '@/config/plans';
import { planFromOrgRow } from '@/lib/guards/planRow';
import type { PlanGate } from './registry/defineTool';

/**
 * What Chat knows about the workspace's plan (CHAT-20 §7, §20), from one
 * place: config/plans.ts through the organization's row, as the rest of the
 * app reads it (planFromOrgRow: a plan that isn't active gets Starter's
 * limits, Enterprise its overrides). The approval precedence takes its plan
 * gates from here and the denial its plan wording. Self-hosted has no plan
 * gates: every feature, Full auto, never read-only.
 *
 * Server only: the limits hold the AI budgets in dollars, which never reach
 * a browser (DECISIONS R).
 */

/** The step up from the current plan, for a plan gate's "With … you'd also get" (§7a). */
export interface NextPlan {
  id: PlanId;
  name: string;
  /** Its monthly price in dollars; null when set per contract (Enterprise). */
  priceMonthly: number | null;
  /** What it costs a month more than the current plan; null when either price isn't listed. */
  priceDiff: number | null;
  /** On the trial: paying for the trial's own plan is the next step ("After your trial"). */
  afterTrial: boolean;
}

export interface PlanFacts {
  /** The plan the workspace's row names; `self_hosted` off the cloud. */
  planId: PlanId;
  planName: string;
  selfHosted: boolean;
  /** In the free trial. An Enterprise trial is a deal's and keeps its plan, as the server's AI budget has it. */
  isTrial: boolean;
  /** False while the plan isn't active (trial ended, canceled, payment failed): the read-only workspace. */
  writable: boolean;
  /** What the workspace is entitled to: while not active, Starter's. */
  features: readonly Feature[];
  limits: PlanLimits;
  /** Full auto and "Don't ask again" (§7): Growth and up, paid, active. */
  fullAuto: boolean;
  /** Null on Enterprise and self-hosted: no upsell (§7a). */
  nextPlan: NextPlan | null;
}

/** The organization columns the facts read (plan-row's ORG_PLAN_COLUMNS). */
export type OrgPlanRow = {
  plan?: unknown;
  subscription_status?: unknown;
  plan_overrides?: unknown;
} | null;

const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);

function nextPlanOf(id: PlanId, isTrial: boolean): NextPlan | null {
  const own = PLANS[id];
  if (isTrial) {
    return {
      id,
      name: own.name,
      priceMonthly: own.pricing?.monthly ?? null,
      priceDiff: null,
      afterTrial: true,
    };
  }
  const nextId = PLAN_ORDER[rank(id) + 1];
  if (rank(id) < 0 || !nextId) return null;
  const next = PLANS[nextId];
  const ownPrice = own.pricing?.monthly;
  const nextPrice = next.pricing?.monthly;
  return {
    id: nextId,
    name: next.name,
    priceMonthly: nextPrice ?? null,
    priceDiff: ownPrice !== undefined && nextPrice !== undefined ? nextPrice - ownPrice : null,
    afterTrial: false,
  };
}

/** The facts for an organization row with its plan columns (plan-row's ORG_PLAN_COLUMNS). */
export function planFactsFromOrgRow(row: OrgPlanRow): PlanFacts {
  if (!isCloud()) {
    const plan = PLANS.self_hosted;
    return {
      planId: plan.id,
      planName: plan.name,
      selfHosted: true,
      isTrial: false,
      writable: true,
      features: plan.limits.features,
      limits: plan.limits,
      fullAuto: true,
      nextPlan: null,
    };
  }
  const status = row?.subscription_status as string | null | undefined;
  const own = getPlan(row?.plan as string | null | undefined);
  const entitled = planFromOrgRow(row);
  const writable = isSubscriptionActive(status);
  const isTrial = status === 'trialing' && own.id !== 'enterprise';
  return {
    planId: own.id,
    planName: own.name,
    selfHosted: false,
    isTrial,
    writable,
    features: entitled.limits.features,
    limits: entitled.limits,
    fullAuto: writable && !isTrial && rank(own.id) >= rank('growth'),
    nextPlan: nextPlanOf(own.id, isTrial),
  };
}

/**
 * The plan a tool's gate needs that the workspace doesn't have, or null when
 * it passes. A feature gate follows the entitled plan's features (the trial
 * has its plan's); a plan-ranked gate needs that plan paid, so the trial
 * doesn't open it (§7: Full auto, own keys, MCP and Open pull request are
 * locked in the trial). A platforms gate is open on every plan: the data
 * covers the plan's platforms.
 */
export function planGateLock(facts: PlanFacts, gate: PlanGate | null): PlanId | null {
  if (!gate || facts.selfHosted) return null;
  if (gate.feature && !facts.features.includes(gate.feature)) {
    return getMinimumPlanForFeature(gate.feature);
  }
  if (gate.minPlan && (facts.isTrial || rank(facts.planId) < rank(gate.minPlan))) {
    return gate.minPlan;
  }
  return null;
}
