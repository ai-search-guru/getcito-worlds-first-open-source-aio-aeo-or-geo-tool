'use client';

import { usePlanContext } from '@/components/context/PlanProvider';
import {
  type Feature,
  type PlanLimits,
  PLANS,
  hasFeature,
  isWithinLimit,
  getMinimumPlanForFeature,
} from '@/config/plans';

export function useFeatureGate() {
  const { planId, isCloud } = usePlanContext();
  const plan = PLANS[planId] ?? PLANS.starter;

  return {
    planId,
    planName: plan.name,
    isCloud,

    canUse(feature: Feature): boolean {
      return hasFeature(plan, feature);
    },

    withinLimit(
      key: keyof Omit<PlanLimits, 'features' | 'allowedScrapers' | 'allowedModels'>,
      currentCount: number,
    ): boolean {
      return isWithinLimit(plan, key, currentCount);
    },

    getLimit(
      key: keyof Omit<PlanLimits, 'features' | 'allowedScrapers' | 'allowedModels'>,
    ): number {
      return plan.limits[key];
    },

    requiredPlanFor(feature: Feature): string {
      const minPlan = getMinimumPlanForFeature(feature);
      return PLANS[minPlan].name;
    },
  };
}
