'use client';

import { useTranslations } from 'next-intl';
import { useAiUsage } from '@/components/context/AiUsageProvider';
import { useChatAgentic } from '@/components/context/ChatAgenticProvider';
import { PLANS, type PlanId } from '@/config/plans';

export interface PlanFeature {
  text: string;
  /** A longer word on it, shown on hover. */
  hint?: string;
}

/** A plan's monthly AI allowance as a multiple of Starter's; null when either has none. */
export function aiUsageMultiple(planId: PlanId): number | null {
  const starterAi = PLANS.starter.limits.improveMonthlyBudgetUsd;
  const planAi = PLANS[planId].limits.improveMonthlyBudgetUsd;
  return starterAi > 0 && planAi > 0 ? Math.round(planAi / starterAi) : null;
}

/**
 * Whether the plan cards speak of the new Chat (chatMetered): as the AI
 * usage read says, and where none is read, with no plan active yet
 * (onboarding's plan step, Choose a plan once one ended, the demo's and the
 * trial's offers), as the workspace's CHAT_AGENTIC flag does: the flag the
 * server's chatMetered follows.
 */
export function usePlanCardsChatMetered(): boolean {
  const chatAgentic = useChatAgentic();
  return useAiUsage().usage?.chatMetered ?? chatAgentic;
}

/**
 * A plan card's list, as the pricing page puts it: brands, seats, prompts,
 * the answer engines it tracks, content briefs and site audits a month,
 * AI usage as a multiple of Starter's, then what the plan adds. Billing's
 * cards and the plan dialog show the same list. With the new Chat on
 * (chatMetered), AI usage's hint says Chat and agents draw on it, own keys
 * are Enterprise's (ownKeyAllowed), and the plan's Chat points (Full auto
 * from Growth up) come before what else it adds.
 */
export function usePlanFeatures(): (planId: PlanId) => PlanFeature[] {
  const tCards = useTranslations('settings.planCards');
  const chatMetered = usePlanCardsChatMetered();
  return (planId) => {
    const { limits } = PLANS[planId];
    const aiUsage = aiUsageMultiple(planId);
    const items = [
      limits.maxBrands === -1
        ? tCards('unlimitedBrands')
        : tCards('brands', { count: limits.maxBrands }),
      limits.maxTeamMembers === -1
        ? tCards('unlimitedSeats')
        : tCards('seats', { count: limits.maxTeamMembers }),
      tCards('prompts', { count: limits.maxPrompts }),
      tCards(`${planId}.engines`),
      tCards('briefs', { count: limits.maxBriefGenerations }),
      tCards('audits', { count: limits.maxSiteAudits }),
    ].map((text) => ({ text }));
    return [
      ...items,
      ...(aiUsage
        ? [
            {
              text: tCards('aiUsage', { count: aiUsage }),
              hint: tCards(chatMetered ? 'aiUsageHintChat' : 'aiUsageHint'),
            },
          ]
        : []),
      ...(chatMetered ? (tCards.raw(`${planId}.extrasChat`) as string[]) : []).map((text) => ({
        text,
      })),
      ...(tCards.raw(`${planId}.extras`) as string[]).map((text) => ({ text })),
    ];
  };
}
