'use client';

import { createContext, useContext } from 'react';
import { PLANS, type PlanId } from '@/config/plans';
import { effectivePlanIdForBrand, isDemoSelected } from '@/lib/demo/demoBrand';
import { useBrandStore } from '@/state/useBrandStore';

interface PlanContextValue {
  /**
   * The plan the brand on screen is shown with: the organization's, or
   * Growth's on the demo brand (effectivePlanIdForBrand), so the demo opens
   * the whole product. What it locks and marks follows this one.
   */
  planId: PlanId;
  /** The organization's own plan, whichever brand is on screen (Billing). */
  ownPlanId: PlanId;
  isCloud: boolean;
  /**
   * Effective API-model allowlist for the org, with Enterprise
   * `plan_overrides` already merged server-side (dashboard layout).
   * `null` means every model is allowed (self-host, or a plan without an
   * `allowedModels` restriction). Consumers must read this instead of the
   * static `PLANS[planId].limits.allowedModels`, which can't see
   * per-customer overrides.
   */
  allowedModelIds: string[] | null;
  /**
   * Whether the org's plan is active (or trialing). When it isn't, the
   * dashboard is read-only: every page opens, and an action opens the
   * upgrade dialog instead of running (useUpgradeGate). Always true
   * self-hosted.
   */
  subscriptionActive: boolean;
  /** Stripe's subscription status, for why it isn't active; null self-hosted. */
  subscriptionStatus: string | null;
  /**
   * When a canceled plan ends: it runs to the end of its paid period (00386),
   * and every page says so. Null when it renews, and self-hosted.
   */
  planEndsAt: string | null;
}

const PlanContext = createContext<PlanContextValue>({
  planId: 'self_hosted',
  ownPlanId: 'self_hosted',
  isCloud: false,
  allowedModelIds: null,
  subscriptionActive: true,
  subscriptionStatus: null,
  planEndsAt: null,
});

export function PlanProvider({
  planId,
  allowedModelIds = null,
  subscriptionActive = true,
  subscriptionStatus = null,
  planEndsAt = null,
  children,
}: {
  planId: PlanId;
  allowedModelIds?: string[] | null;
  subscriptionActive?: boolean;
  subscriptionStatus?: string | null;
  planEndsAt?: string | null;
  children: React.ReactNode;
}) {
  const isCloud = process.env.NEXT_PUBLIC_IS_CLOUD === 'true';
  const effectivePlan: PlanId = isCloud ? planId : 'self_hosted';
  const demoSelected = useBrandStore(isDemoSelected);
  const shownPlan = effectivePlanIdForBrand(effectivePlan, isCloud && demoSelected);
  // The demo's plan brings its own model allow-list; the layout's is the
  // organization's (Enterprise overrides merged).
  const demoModels = PLANS[shownPlan].limits.allowedModels;
  const shownModels =
    shownPlan === effectivePlan ? allowedModelIds : demoModels ? [...demoModels] : null;

  return (
    <PlanContext.Provider
      value={{
        planId: shownPlan,
        ownPlanId: effectivePlan,
        isCloud,
        allowedModelIds: isCloud ? shownModels : null,
        subscriptionActive: isCloud ? subscriptionActive : true,
        subscriptionStatus: isCloud ? subscriptionStatus : null,
        planEndsAt: isCloud ? planEndsAt : null,
      }}
    >
      {children}
    </PlanContext.Provider>
  );
}

export function usePlanContext() {
  return useContext(PlanContext);
}
