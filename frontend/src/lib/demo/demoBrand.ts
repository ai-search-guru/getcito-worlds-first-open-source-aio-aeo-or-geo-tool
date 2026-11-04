/**
 * The demo brand (00380): a brand in the workspace's own organization whose
 * prompts, answers, content and reports are sample data, written by the
 * server's generator into the real tables. Every page shows it as it shows
 * any brand; anything that would run, write or spend opens the plan dialog
 * instead, with the demo's offer.
 */

import { getPlan, type Plan, type PlanId } from '@/config/plans';
import type { Brand } from '@/types';

/**
 * What the plan dialog offers from the demo brand: a workspace that never
 * had a subscription chooses between the free trial and buying now (the
 * first-month offer); one whose trial or plan ended buys now.
 */
export type DemoOffer = 'trial' | 'first_month';

/** The offer, from whether the organization ever had a Stripe subscription. */
export function demoOffer(everSubscribed: boolean): DemoOffer {
  return everSubscribed ? 'first_month' : 'trial';
}

/** Whether the brand on screen is the demo brand, from the brand store's state (useBrandStore). */
export function isDemoSelected(state: {
  brands: Pick<Brand, 'id' | 'isDemo'>[];
  activeBrandId: string | null;
}): boolean {
  return state.brands.some((b) => b.id === state.activeBrandId && b.isDemo === true);
}

/**
 * The workspace's own brand, from the brand store's state: the one on
 * screen unless that is the demo brand, else the first of its own. Null
 * before it has one.
 */
export function ownBrandOf<B extends Pick<Brand, 'id' | 'isDemo'>>(state: {
  brands: B[];
  activeBrandId: string | null;
}): B | null {
  const own = state.brands.filter((b) => !b.isDemo);
  return own.find((b) => b.id === state.activeBrandId) ?? own[0] ?? null;
}

/**
 * The plan the demo brand is shown with: Growth, the whole product, whatever
 * the workspace's own plan (or none). Only what it reads follows it: its
 * locked tabs, platforms and reports open, and the Growth marks go. Anything
 * that writes, runs or spends still opens the plan dialog on it.
 */
export const DEMO_BRAND_PLAN_ID: PlanId = 'growth';

/**
 * The plan a brand's pages read with: the workspace's own, raised to
 * DEMO_BRAND_PLAN_ID on the demo brand. A plan above it (Enterprise) and
 * self-hosted keep their own. The one rule for the client's plan context and
 * the server actions' reads.
 */
export function effectivePlanIdForBrand(planId: PlanId, isDemo: boolean): PlanId {
  return isDemo && planId === 'starter' ? DEMO_BRAND_PLAN_ID : planId;
}

/** {@link effectivePlanIdForBrand} for a plan read on the server (getOrgPlan). */
export function effectivePlanForBrand(plan: Plan, isDemo: boolean): Plan {
  const planId = effectivePlanIdForBrand(plan.id, isDemo);
  return planId === plan.id ? plan : getPlan(planId);
}

/**
 * What was clicked, from the read-only label a guarded button gives
 * ("Adding prompts needs a plan", readOnly.actions): its doing alone
 * ("Adding prompts"), which the demo's label follows with "works on your own
 * brand". A label written another way is kept whole.
 */
export function demoActionName(label: string): string {
  return label.replace(/\s+needs a plan\.?$/, '');
}
