/**
 * Plan definitions — must stay in sync with frontend (aeo/src/config/plans.ts).
 * Self-hosted instances bypass all limits (IS_CLOUD !== "true").
 */

export const PLANS = {
  self_hosted: {
    id: 'self_hosted',
    name: 'Self-Hosted',
    limits: {
      maxBrands: -1,
      maxPrompts: -1,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: -1,
      maxVolumeAnalyses: -1,
      maxBriefGenerations: -1,
      improveMonthlyBudgetUsd: -1,
      relevanceMonthlyBudgetUsd: -1,
      maxOpportunitiesPerMonth: -1,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: -1,
      maxBotEventsPerMonth: -1,
      maxBotRawRecordsPerMonth: -1,
      maxCatalogProducts: -1,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
        'white_label',
      ],
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    limits: {
      maxBrands: 1,
      maxPrompts: 50,
      maxPlatforms: 2,
      maxTeamMembers: -1,
      maxDomainsPerBrand: 3,
      maxVolumeAnalyses: 4,
      maxBriefGenerations: 10,
      // The workspace's one AI budget (Improve, the Content Editor's AI and
      // the Action Center's task writing), in tiers the billing cards show as
      // multiples of Starter's: $5 here (1x), Growth $25 (5x), Enterprise $50
      // or more, set per customer (2026-10-27); the free trial gets
      // TRIAL_AI_BUDGET_USD.
      improveMonthlyBudgetUsd: 5,
      // 0.1% of the $49 price, spent rating suggestions' relevance (VIS-011).
      relevanceMonthlyBudgetUsd: 0.049,
      maxOpportunitiesPerMonth: 10,
      maxOpportunitiesPerRequest: 3,
      maxSiteAudits: 100,
      // AI bot report (AT-010, spec §6.3): verified bot rows stored a month.
      // Starter sees the report locked; Growth 2M, Enterprise 20M (adjustable
      // through plan_overrides); -1 = no cap.
      maxBotEventsPerMonth: 0,
      // Raw log records a month a Vercel drain or Logpush job may send
      // (AT-010, spec §6.3): Growth 20M, Enterprise 200M.
      maxBotRawRecordsPerMonth: 0,
      // Live catalog products a workspace's brands may have across their
      // sources (ECOM-019): Starter 5,000, Growth 50,000, Enterprise per
      // customer through plan_overrides; -1 = no cap. Products past it aren't
      // synced. Decided 2026-10-28.
      maxCatalogProducts: 5_000,
      maxDailyOnDemand: 3,
      onDemandCooldownMinutes: 15,
      allowedScrapers: ['chatgpt-web', 'copilot-web'],
      allowedModels: [],
      features: [
        'basic_insights',
        'advanced_analytics',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'ai_agent',
        'prompt_improve',
      ],
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    limits: {
      maxBrands: 4,
      maxPrompts: 200,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: 10,
      maxVolumeAnalyses: 10,
      maxBriefGenerations: 50,
      // AI usage: 5x Starter's $5 (the billing card's "5x AI usage").
      improveMonthlyBudgetUsd: 25,
      // 0.1% of the $249 price, spent rating suggestions' relevance (VIS-011).
      relevanceMonthlyBudgetUsd: 0.249,
      maxOpportunitiesPerMonth: 50,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: 500,
      maxBotEventsPerMonth: 2_000_000,
      maxBotRawRecordsPerMonth: 20_000_000,
      maxCatalogProducts: 50_000,
      maxDailyOnDemand: 10,
      onDemandCooldownMinutes: 5,
      // API-model tracking (Claude) is not part of Growth — scraper engines
      // only. Enterprise can get it per customer via plan_overrides.
      allowedModels: [],
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'white_label',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
      ],
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    limits: {
      maxBrands: -1,
      maxPrompts: -1,
      maxPlatforms: 8,
      maxTeamMembers: -1,
      maxDomainsPerBrand: -1,
      maxVolumeAnalyses: -1,
      // Per-customer: override via organizations.plan_overrides in the DB.
      maxBriefGenerations: -1,
      // AI usage: $50 at the least, twice Growth's $25. Over that, GetCito
      // sets a customer's own in plan_overrides.improveMonthlyBudgetUsd
      // (2026-10-27); the contract's value doesn't raise it.
      improveMonthlyBudgetUsd: 50,
      // 0.1% of the $499 floor, raised to 0.1% of contractMonthlyUsd; an
      // explicit plan_overrides.relevanceMonthlyBudgetUsd wins.
      relevanceMonthlyBudgetUsd: 0.499,
      maxOpportunitiesPerMonth: -1,
      maxOpportunitiesPerRequest: 5,
      maxSiteAudits: -1,
      maxBotEventsPerMonth: 20_000_000,
      maxBotRawRecordsPerMonth: 200_000_000,
      maxCatalogProducts: -1,
      maxDailyOnDemand: -1,
      onDemandCooldownMinutes: 0,
      // API-model tracking (Claude) is a per-customer opt-in on Enterprise:
      // default off; enable via
      // organizations.plan_overrides = { "allowedModels": ["claude-sonnet-5"] }.
      allowedModels: [],
      features: [
        'basic_insights',
        'prompt_suggestions',
        'topic_suggestions',
        'prompt_volumes',
        'advanced_analytics',
        'daily_monitoring',
        'competitor_tracking',
        'content_optimization',
        'custom_reports',
        'api_access',
        'white_label',
        'sso_saml',
        'ai_agent',
        'shopping_analytics',
        'prompt_improve',
      ],
    },
  },
};

/**
 * The free trial's AI budget, whatever the plan: the plan's own comes once
 * the subscription is paid. See applyTrialAiBudget. $2 since 2026-10-29
 * (was $1), when the Content Editor started writing with Claude Sonnet 5.5.
 */
export const TRIAL_AI_BUDGET_USD = 2;

export function isCloud() {
  return process.env.IS_CLOUD === 'true';
}

/**
 * Whether an organization's Stripe subscription is in a state that grants
 * access to billed features. `trialing` counts — it's a paid plan in its
 * free-trial period. Everything else (incomplete, canceled, past_due,
 * unpaid) does NOT grant access.
 *
 * Self-hosted instances always return true since billing doesn't apply.
 */
export function isSubscriptionActive(status) {
  if (!isCloud()) return true;
  return status === 'active' || status === 'trialing';
}

export function getPlan(planId) {
  if (!isCloud()) return PLANS.self_hosted;
  return PLANS[planId] || PLANS.starter;
}

export function hasFeature(plan, feature) {
  return plan.limits.features.includes(feature);
}

export function isWithinLimit(plan, key, currentCount) {
  const limit = plan.limits[key];
  if (limit === -1) return true;
  return currentCount < limit;
}
