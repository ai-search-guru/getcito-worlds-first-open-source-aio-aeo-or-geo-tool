import supabaseAdmin from '../config/supabase.js';
import {
  getPlan,
  hasFeature,
  isWithinLimit,
  isCloud,
  isSubscriptionActive,
  TRIAL_AI_BUDGET_USD,
} from '../config/plans.js';
import { anchoredPeriodStart, shiftMonthClamped } from './quotaPeriod.js';
import {
  estimateGenerationsLeft,
  generationCostUsd,
  medianCost,
  searchCostUsd,
  typicalCostUsd,
} from './improveCost.js';
import { logger } from './logger.js';
import { chatAgenticEnabled } from './chatFlag.js';
import { creditRoomUsd, creditsLeftUsd, drawCredits } from './aiCredits.js';
import { RELEVANCE_BUDGET_SHARE } from './suggestionRelevance.js';
import { AUDIT_RUN_TIMEOUT_MS } from './audit/history.js';
import {
  autoAuditEnabled,
  dueRun,
  pendingRuns,
  perRunSlots,
  runSchedule,
} from './audit/autoAudit.js';

export class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.name = 'PlanLimitError';
    this.statusCode = statusCode;
  }
}

/**
 * Enterprise orgs can have per-customer limit overrides stored in
 * organizations.plan_overrides (jsonb) — mirrors web getOrgPlan().
 *
 * The AI budget is the plan's $50 unless GetCito sets a customer's own in
 * `improveMonthlyBudgetUsd` (2026-10-27: $50 or more, set per customer; anything else keeps $50); the
 * contract's value doesn't raise it. `contractMonthlyUsd` is the contract's
 * monthly value, entered when the deal is signed. It sets the relevance
 * budget (VIS-011) to 0.1% of the contract (never below the plan default),
 * rounded down so it never passes the share, unless
 * `relevanceMonthlyBudgetUsd` is set explicitly, which wins.
 */
export function applyPlanOverrides(plan, org) {
  if (
    org?.plan === 'enterprise' &&
    org.plan_overrides &&
    typeof org.plan_overrides === 'object' &&
    !Array.isArray(org.plan_overrides)
  ) {
    const overrides = org.plan_overrides;
    const limits = { ...plan.limits, ...overrides };
    // A budget set by hand is used only as a number of at least the plan's
    // ($50, Enterprise's floor): null or -1 would read as unlimited, 0 or
    // another number below it (-5) would answer every AI call "used up",
    // and "80$" would fail every one. Anything else keeps the plan's.
    const own = overrides.improveMonthlyBudgetUsd;
    const floor = plan.limits.improveMonthlyBudgetUsd;
    if (own !== undefined && !(typeof own === 'number' && Number.isFinite(own) && own >= floor)) {
      limits.improveMonthlyBudgetUsd = floor;
    }
    const usd = Number(overrides.contractMonthlyUsd);
    if (overrides.relevanceMonthlyBudgetUsd === undefined && Number.isFinite(usd) && usd > 0) {
      limits.relevanceMonthlyBudgetUsd = Math.max(
        plan.limits.relevanceMonthlyBudgetUsd ?? 0,
        Math.floor(usd * RELEVANCE_BUDGET_SHARE * 1e6) / 1e6,
      );
    }
    return { ...plan, limits };
  }
  return plan;
}

/**
 * An organization without an active plan, as a read that costs nothing sees
 * it (read-only once the plan has ended, 2026-10-27): the plan it was on (or,
 * never subscribed, the one it would start on) with every allowance 0, marked
 * `noPlan`. Its stored data still comes back, with nothing left to spend; its
 * features stay, naming what that data covers. Lists (features, the allowed
 * scrapers and models) are kept; every other value, a number or one an
 * override set as text, is 0.
 */
function noPlanOf(org) {
  const plan = applyPlanOverrides(getPlan(org.plan), org);
  const limits = Object.fromEntries(
    Object.entries(plan.limits).map(([key, value]) => [key, Array.isArray(value) ? value : 0]),
  );
  return { ...plan, noPlan: true, limits };
}

/** What an answer read from noPlanOf's plan adds: `noPlan: true`, and nothing on a plan. */
const noPlanMark = (plan) => (plan.noPlan ? { noPlan: true } : {});

/**
 * Resolve an organization's plan directly by org id.
 * Self-hosted → returns self_hosted plan (unlimited).
 *
 * Without an active subscription it throws PlanLimitError (402), unless
 * `readOnly`, for a read that costs nothing: then the plan is noPlanOf's.
 */
async function resolveOrgPlanByOrgId(orgId, { readOnly = false } = {}) {
  if (!isCloud()) return getPlan('self_hosted');

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan, subscription_status, plan_overrides')
    .eq('id', orgId)
    .single();

  // Block feature access for orgs without an active or trialing Stripe
  // subscription. Previously this fell back to starter, which silently
  // granted billed features (volume fetch, content generation, etc.) to
  // unsubscribed signups.
  if (!isSubscriptionActive(org?.subscription_status)) {
    // Without the organization's row there is nothing kept to read.
    if (readOnly && org) return noPlanOf(org);
    throw new PlanLimitError(
      'An active subscription or free trial is required. Please choose a plan to continue.',
      402,
    );
  }

  return applyTrialAiBudget(applyPlanOverrides(getPlan(org.plan), org), org);
}

/**
 * The free trial's AI budget: while the subscription is trialing, the plan's
 * AI budget is TRIAL_AI_BUDGET_USD at most, and the plan's own comes once it
 * is paid; `trial` marks the plan so what reads it can say so. Enterprise
 * keeps its own: its trials are a deal's, with its budget.
 */
export function applyTrialAiBudget(plan, org) {
  if (org?.subscription_status !== 'trialing' || org.plan === 'enterprise') return plan;
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return plan;
  return {
    ...plan,
    trial: true,
    limits: { ...plan.limits, improveMonthlyBudgetUsd: Math.min(budget, TRIAL_AI_BUDGET_USD) },
  };
}

/**
 * Resolve the user's organization id, or null if none.
 */
export async function getOrgIdForUser(userId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();
  return profile?.organization_id || null;
}

/**
 * Resolve the user's organization plan from the database.
 * Self-hosted → returns self_hosted plan (unlimited).
 * `readOnly` as resolveOrgPlanByOrgId.
 */
async function resolveOrgPlan(userId, options) {
  if (!isCloud()) return getPlan('self_hosted');

  const orgId = await getOrgIdForUser(userId);
  if (!orgId) {
    throw new PlanLimitError('No organization found for user.', 400);
  }

  return resolveOrgPlanByOrgId(orgId, options);
}

/**
 * Enforce that the user's plan includes a specific feature.
 * Throws PlanLimitError if not. `readOnly` as resolveOrgPlanByOrgId: without
 * an active plan, the features of the plan it was on.
 */
export async function enforceFeature(userId, feature, options) {
  const plan = await resolveOrgPlan(userId, options);
  if (!hasFeature(plan, feature)) {
    throw new PlanLimitError(
      `Your ${plan.name} plan does not include "${feature}". Please upgrade.`,
    );
  }
  return plan;
}

/**
 * Enforce that the user's plan has not exceeded a numeric limit.
 * Throws PlanLimitError if limit reached.
 */
export async function enforceLimit(userId, limitKey, currentCount) {
  const plan = await resolveOrgPlan(userId);
  if (!isWithinLimit(plan, limitKey, currentCount)) {
    const max = plan.limits[limitKey];
    throw new PlanLimitError(
      `Plan limit reached: maximum ${max} ${limitKey} on the ${plan.name} plan. Please upgrade.`,
    );
  }
  return plan;
}

/**
 * Enforce monthly volume analysis quota.
 * Returns { plan, remaining, orgId } on success, throws PlanLimitError if quota exceeded.
 */
export async function enforceVolumeQuota(userId) {
  const plan = await resolveOrgPlan(userId);
  const maxAnalyses = plan.limits.maxVolumeAnalyses;
  if (maxAnalyses === -1) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('organization_id')
      .eq('id', userId)
      .single();
    return { plan, remaining: -1, orgId: profile?.organization_id };
  }

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (!profile?.organization_id) {
    throw new PlanLimitError('No organization found for user.', 400);
  }

  const periodStart = await quotaPeriodStart(profile.organization_id);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', periodStart.toISOString());

  const used = count || 0;
  if (used >= maxAnalyses) {
    throw new PlanLimitError(
      `Monthly volume analysis limit reached (${used}/${maxAnalyses}). Resets when your subscription renews.`,
    );
  }

  return { plan, remaining: maxAnalyses - used, orgId: profile.organization_id };
}

/**
 * Get current volume quota status without enforcing.
 * Returns { used, limit, remaining }. `readOnly`: without an active plan,
 * limit and remaining 0 and `noPlan: true`, rather than a 402.
 */
export async function getVolumeQuotaStatus(userId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlan(userId, { readOnly });
  const maxAnalyses = plan.limits.maxVolumeAnalyses;
  if (maxAnalyses === -1) return { used: 0, limit: -1, remaining: -1 };

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .single();

  if (!profile?.organization_id) return { used: 0, limit: maxAnalyses, remaining: maxAnalyses };

  const periodStart = await quotaPeriodStart(profile.organization_id);

  const { count } = await supabaseAdmin
    .from('volume_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', profile.organization_id)
    .gte('used_at', periodStart.toISOString());

  const used = count || 0;
  if (plan.noPlan) return { used, limit: 0, remaining: 0, noPlan: true };
  return { used, limit: maxAnalyses, remaining: maxAnalyses - used };
}

function startOfCurrentMonth(now = new Date()) {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * Start of the monthly quota window containing `now`, anchored to the
 * subscription's billing day (`subscription_ends_at` = Stripe's
 * current_period_end, kept fresh by the webhook). Quotas renew when the
 * customer's payment renews — not on the 1st of the calendar month, which
 * made a renewal day feel like a limit that never reset (#500).
 *
 * Orgs without an active subscription (free, incomplete, self-host paths
 * that still reach here) fall back to the calendar month. Window math lives
 * in quotaPeriod.js.
 */
export async function quotaPeriodStart(orgId, now = new Date()) {
  if (!isCloud() || !orgId) return startOfCurrentMonth(now);

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('subscription_ends_at, subscription_status')
    .eq('id', orgId)
    .maybeSingle();

  const endsAt = org?.subscription_ends_at ? new Date(org.subscription_ends_at) : null;
  if (!endsAt || Number.isNaN(endsAt.getTime()) || !isSubscriptionActive(org.subscription_status)) {
    return startOfCurrentMonth(now);
  }

  return anchoredPeriodStart(endsAt, now);
}

async function countBriefUsageThisMonth(orgId) {
  const periodStart = await quotaPeriodStart(orgId);
  const { count } = await supabaseAdmin
    .from('brief_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('used_at', periodStart.toISOString());
  return count || 0;
}

/**
 * Enforce the monthly content-brief generation quota for an organization.
 * Org-based (not user-based) so both the dashboard route and the internal
 * MCP route charge the same pool. Returns { plan, remaining } on success,
 * throws PlanLimitError when the quota is exhausted.
 */
export async function enforceBriefQuota(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxBriefGenerations;
  if (max === -1) return { plan, remaining: -1 };

  const used = await countBriefUsageThisMonth(orgId);
  if (used >= max) {
    throw new PlanLimitError(
      `Monthly content brief limit reached (${used}/${max}) on the ${plan.name} plan. Resets when your subscription renews — upgrade for more.`,
    );
  }

  return { plan, remaining: max - used };
}

/**
 * Get current brief quota status without enforcing.
 * Returns { used, limit, remaining }. `readOnly` as resolveOrgPlanByOrgId:
 * without an active plan, limit 0 and `noPlan: true`.
 */
export async function getBriefQuotaStatus(orgId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  const max = plan.limits.maxBriefGenerations;
  if (max === -1) return { used: 0, limit: -1, remaining: -1 };

  const used = await countBriefUsageThisMonth(orgId);
  return { used, limit: max, remaining: Math.max(0, max - used), ...noPlanMark(plan) };
}

/** How many of the org's latest calls its typical cost is the median of. */
const RECENT_CALLS = 20;

/**
 * Chat's model steps on the budget (00405): a Chat run's ('chat'), and the
 * room its agents, scheduled runs and images take. They count in what's
 * spent, but not in what an Improve or Content Editor call typically costs:
 * a step is sized on its own worst case (chatBudget.js).
 */
export const CHAT_AI_FEATURES = ['chat', 'agent', 'schedule', 'image'];

/** Features whose calls aren't sized like an Improve or Content Editor call. */
const NOT_TYPICAL = new Set(['quality', ...CHAT_AI_FEATURES]);

async function improveSpendThisPeriod(orgId) {
  const periodStart = await quotaPeriodStart(orgId);
  const { data } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('cost_usd, feature')
    .eq('organization_id', orgId)
    // A step on the workspace's own key is billed to it, not to the budget.
    .eq('own_key', false)
    .gte('used_at', periodStart.toISOString())
    .order('used_at', { ascending: false })
    .limit(5000);
  const rows = data ?? [];
  const spent = rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
  // Quality's small checks and Chat's steps count in what's spent, not in
  // what a call costs.
  const calls = rows.filter((r) => !NOT_TYPICAL.has(r.feature)).slice(0, RECENT_CALLS);
  return {
    spent,
    since: periodStart.toISOString(),
    typical: medianCost(calls.map((r) => Number(r.cost_usd) || 0)),
  };
}

/**
 * Improve-tab budget (PROMPT-003): a monthly USD budget per organization
 * (plan.limits.improveMonthlyBudgetUsd: Starter $5, Growth $25, Enterprise
 * $50 or a customer's own set by GetCito, the free trial $2), charged with each
 * generation's real token cost so the budget holds for any model. Users see
 * an estimate of generations left, not dollars. -1 is unlimited. `readOnly`
 * as resolveOrgPlanByOrgId: without an active plan, a budget of 0 and
 * `noPlan: true`.
 */
export async function getImproveQuotaStatus(orgId, modelId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { unlimited: true, planName: plan.name };
  const { spent, since, typical } = await improveSpendThisPeriod(orgId);
  // Purchased AI credits (with Chat on) are on the budget too, as reserveAiBudget
  // counts them: what's left is the included budget's and then theirs.
  const remaining = Math.max(0, budget + (await creditRoomUsd(orgId, since)) - spent);
  return {
    unlimited: false,
    planName: plan.name,
    trial: plan.trial === true,
    budgetUsd: budget,
    spentUsd: spent,
    remainingUsd: remaining,
    generationsLeft: estimateGenerationsLeft(remaining, typical ?? typicalCostUsd(modelId)),
    percentLeft: budget > 0 ? Math.min(100, Math.round((remaining / budget) * 100)) : 0,
    ...noPlanMark(plan),
  };
}

/**
 * Holds a call's share of the workspace's AI budget before it runs (00243),
 * so calls running at once can't all pass a nearly spent budget: the
 * period's spend, reservations included, is read and the call's estimated
 * cost written under a per-organization lock. A call runs while the spend
 * is under the budget, as it did when the spend was only read; once it is
 * spent, PlanLimitError (429).
 *
 * Returns the call's meter:
 *   - charge(usage, { searches }): one model attempt at its real token
 *     cost, and the web searches it ran (contentResearch.js) at theirs.
 *     The first turns the reservation into it; any later one (a retry, a
 *     second call) adds its own row. Errors are logged, not thrown: what
 *     the user paid for still goes out.
 *   - release(): when nothing was charged (the call failed before an
 *     answer), the reservation goes. Safe to call more than once; call it
 *     in a finally.
 * An unlimited budget (self-hosted) reserves nothing; charge() still writes
 * the rows, as before. `holdUsd` sets the hold for a call much smaller than
 * the model's typical one (Quality's checks): else the typical cost or the
 * recent calls' median is held.
 *
 * With Chat on, the workspace's purchased AI credits (aiCredits.js, CHAT-18
 * §F) are on the budget too: the hold passes on them once the included
 * budget is spent, and the held row's cost past the included budget is drawn
 * from them when it is charged or kept.
 */
export async function reserveAiBudget(
  orgId,
  { feature, modelId, promptId = null, actionId = null, draftId = null, holdUsd = null },
) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  let reservedId = null;
  let since = null;
  if (budget !== -1) {
    since = (await quotaPeriodStart(orgId)).toISOString();
    const { data, error } = await supabaseAdmin.rpc('reserve_ai_usage', {
      p_organization_id: orgId,
      p_since: since,
      p_budget: budget + (await creditRoomUsd(orgId, since)),
      p_cost: holdUsd ?? (await holdCostUsd(orgId, modelId, since)),
      p_feature: feature,
      p_model: modelId,
      p_prompt_id: promptId,
      p_action_id: actionId,
      p_content_draft_id: draftId,
    });
    if (error) throw new Error(error.message);
    if (!data) throw aiBudgetUsedUp(plan);
    reservedId = data;
  }

  let charged = false;
  return {
    async charge(usage, { searches = 0 } = {}) {
      const cost = {
        model: modelId,
        input_tokens: usage?.inputTokens ?? null,
        output_tokens: usage?.outputTokens ?? null,
        cost_usd: generationCostUsd(modelId, usage) + searchCostUsd(searches),
      };
      const first = reservedId && !charged;
      charged = true;
      const { error } = first
        ? await supabaseAdmin.from('prompt_improve_usage').update(cost).eq('id', reservedId)
        : await supabaseAdmin.from('prompt_improve_usage').insert({
            organization_id: orgId,
            feature,
            prompt_id: promptId,
            action_id: actionId,
            content_draft_id: draftId,
            ...cost,
          });
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] usage write failed');
      // The held row past the included budget draws on the credits.
      else if (first) await drawCredits(orgId, reservedId, { includedUsd: budget, since });
    },
    async release() {
      if (!reservedId || charged) return;
      charged = true;
      const { error } = await supabaseAdmin
        .from('prompt_improve_usage')
        .delete()
        .eq('id', reservedId);
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] release failed');
    },
    /**
     * A call sent and then aborted (the run's Stop): the provider finishes
     * and bills it all the same, so the hold stays as its cost and release()
     * leaves it. With no hold (an unlimited budget), it is written at what a
     * hold would be.
     */
    async keep() {
      if (charged) return;
      charged = true;
      if (reservedId) {
        await drawCredits(orgId, reservedId, { includedUsd: budget, since });
        return;
      }
      const periodStart = (await quotaPeriodStart(orgId)).toISOString();
      const { error } = await supabaseAdmin.from('prompt_improve_usage').insert({
        organization_id: orgId,
        feature,
        prompt_id: promptId,
        action_id: actionId,
        content_draft_id: draftId,
        model: modelId,
        cost_usd: holdUsd ?? (await holdCostUsd(orgId, modelId, periodStart)),
      });
      if (error) logger.error({ err: error, orgId, feature }, '[ai-budget] usage write failed');
    },
  };
}

/**
 * The workspace's AI budget is spent (429): in the free trial (`trial`),
 * more comes with starting the plan.
 */
export function aiBudgetUsedUp(plan) {
  const err = new PlanLimitError(
    plan.trial
      ? "The free trial's AI usage is used up. Starting the plan gives its full monthly allowance."
      : `This month's suggestion budget on the ${plan.name} plan is used up. It resets when your subscription renews.`,
    429,
  );
  err.trial = plan.trial === true;
  return err;
}

/**
 * The workspace's AI budget as a hold is taken on it: the plan (402 without
 * an active one, as reserveAiBudget), its budget in USD and the period's
 * start, from which the spend counts; both null when the budget is
 * unlimited (self-hosted). In the free trial the period runs over the whole
 * trial (quotaPeriodStart, from the trial's end): its budget never resets.
 * `includedUsd` is the plan's own; `budgetUsd` adds what the workspace's
 * purchased AI credits add for a hold (creditRoomUsd: nothing with Chat
 * off), unless `credits` is false.
 */
export async function aiBudgetOf(orgId, { credits = true } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { plan, budgetUsd: null, includedUsd: null, since: null };
  const since = (await quotaPeriodStart(orgId)).toISOString();
  const room = credits ? await creditRoomUsd(orgId, since) : 0;
  return { plan, budgetUsd: budget + room, includedUsd: budget, since };
}

/**
 * What a call holds before it runs: the org's median cost over its last
 * RECENT_CALLS calls this period, never less than the model's typical one.
 * Calls average about twice the typical estimate and reach five times it (a
 * whole page, a long draft), so holding only the estimate let each call in
 * flight pass the budget by the difference. Holds in flight count at their
 * own size, so they don't raise the median. A read that fails holds the
 * typical cost.
 */
async function holdCostUsd(orgId, modelId, since) {
  const typical = typicalCostUsd(modelId);
  // Quality's small checks hold their own (holdUsd), and Chat's steps their
  // worst case: left out, they don't pull the median under what the larger
  // calls cost. Steps on a workspace's own key never count.
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('cost_usd')
    .eq('organization_id', orgId)
    .eq('own_key', false)
    .or(`feature.is.null,feature.not.in.(${[...NOT_TYPICAL].join(',')})`)
    .gte('used_at', since)
    .order('used_at', { ascending: false })
    .limit(RECENT_CALLS);
  if (error) {
    logger.error({ err: error, orgId }, '[ai-budget] recent costs read failed');
    return typical;
  }
  const recent = medianCost((data ?? []).map((r) => Number(r.cost_usd) || 0));
  return Math.max(typical, recent ?? 0);
}

/**
 * The meter's rows, in order, and what the workspace's AI budget spent on
 * each, as prompt_improve_usage.feature says (00242): the Content Editor's
 * quality checks ('quality', 00264) are its AI too, so they count in its
 * row. Chat's model steps have theirs (00405), with Chat on: Chat's runs,
 * then its agents, scheduled runs and images, as they come. 'other' is spend
 * whose feature isn't known.
 */
export const AI_USAGE_FEATURES = {
  improve: ['improve'],
  content: ['content', 'quality'],
  action_center: ['action_center'],
  chat: ['chat'],
  agent: ['agent'],
  schedule: ['schedule'],
  image: ['image'],
  other: ['other'],
};

const tenths = (n) => Math.round(n * 10) / 10;

/**
 * This period's AI usage, for the Billing page's meter: how much of the
 * workspace's AI budget (plan.limits.improveMonthlyBudgetUsd, the one
 * Improve, the Content Editor's AI and the Action Center's task writer all
 * charge) is used, by feature, and when it renews. Shares of the budget, in
 * percent to a tenth; dollars stay on the server, as the Improve tab's quota
 * does. Spend past the budget (calls already running when it ran out) reads
 * as 100%, its features scaled to fit. Rows whose feature isn't known (from
 * before 00242, their item deleted) count as 'other'. Only what used some is
 * listed (an Action Center whose task writer is off has no row), so a row
 * can read 0 when its share is under a twentieth of a percent: the page
 * reads that as "<0.1%". Unlimited plans (self-hosted) show no meter.
 * `chatMetered`: Chat draws on the budget too (CHAT_AGENTIC on for the
 * workspace); off, it runs on the workspace's own key only, as the page says.
 * Steps on a workspace's own key never count (ai_usage_by_feature, 00405).
 * `estimates` (aiEstimates.js aiEstimateCosts) are typical costs in USD of
 * work a page asks about before it runs: each comes back as its share of the
 * budget, to a tenth (Write this, customer priorities item 9).
 */
export async function getAiUsage(orgId, { estimates = {} } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const periodStart = await quotaPeriodStart(orgId);
  const base = {
    plan: plan.id,
    planName: plan.name,
    // The free trial's smaller budget: getting more means starting the plan.
    trial: plan.trial === true,
    periodStart: periodStart.toISOString(),
    periodEnd: shiftMonthClamped(periodStart, 1).toISOString(),
    chatMetered: chatAgenticEnabled(orgId),
  };
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { ...base, unlimited: true, percentUsed: null, features: [] };

  const { data, error } = await supabaseAdmin.rpc('ai_usage_by_feature', {
    p_organization_id: orgId,
    p_since: base.periodStart,
  });
  if (error) throw new Error(error.message);
  const spentOn = new Map((data ?? []).map((r) => [r.feature, Number(r.cost_usd) || 0]));
  const spent = [...spentOn.values()].reduce((a, b) => a + b, 0);
  const scale = budget > 0 && spent > budget ? budget / spent : 1;
  const percentOf = (usd) => (budget > 0 ? tenths((usd * scale * 100) / budget) : 0);
  const shares = Object.entries(estimates).map(([key, usd]) => [
    key,
    budget > 0 ? tenths((usd * 100) / budget) : 0,
  ]);
  const features = Object.entries(AI_USAGE_FEATURES)
    .map(([feature, from]) => [feature, from.reduce((usd, f) => usd + (spentOn.get(f) ?? 0), 0)])
    .filter(([, usd]) => usd > 0)
    .map(([feature, usd]) => ({ feature, percent: percentOf(usd) }));
  return {
    ...base,
    unlimited: false,
    // Purchased AI credits left (with Chat on): calls still run on them once
    // the plan's share reads 100, so the pages don't say "used up". Whether,
    // never how much: dollars stay on the server.
    creditsLeft: (await creditsLeftUsd(orgId)) > 0,
    // 100 only once it's spent, as reserveAiBudget stops there (a budget of
    // 0 included); just under reads as 99.9, never rounded up to "used up".
    percentUsed:
      budget <= 0 || spent >= budget ? 100 : Math.min(99.9, tenths((spent * 100) / budget)),
    features,
    ...(shares.length ? { estimates: Object.fromEntries(shares) } : {}),
  };
}

/**
 * A Content Editor page's AI usage this period, for the editor meter's "This
 * page so far" (AI usage spec §3.1): what the page's AI calls cost (the rows
 * its brief, Content Agent and writer charged, prompt_improve_usage.
 * content_draft_id, holds included), as a share of the workspace's budget,
 * in percent to a tenth, read over the same period as getAiUsage so the page
 * is a part of the month's figure: spend past the budget is scaled to fit,
 * as its features are, and a page that used any reads at least 0.1. Only
 * the organization's own rows count: another workspace's page reads 0.
 * Unlimited plans (self-hosted) show none.
 */
export async function getDraftAiUsage(orgId, draftId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.improveMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { unlimited: true, percent: null };

  const since = (await quotaPeriodStart(orgId)).toISOString();
  const [page, total] = await Promise.all([
    supabaseAdmin
      .from('prompt_improve_usage')
      .select('cost_usd')
      .eq('organization_id', orgId)
      .eq('content_draft_id', draftId)
      .eq('own_key', false)
      .gte('used_at', since),
    supabaseAdmin.rpc('ai_usage_by_feature', { p_organization_id: orgId, p_since: since }),
  ]);
  if (page.error) throw new Error(page.error.message);
  if (total.error) throw new Error(total.error.message);
  const sum = (rows) => (rows ?? []).reduce((usd, r) => usd + (Number(r.cost_usd) || 0), 0);
  const spent = sum(page.data);
  if (budget <= 0 || spent <= 0) return { unlimited: false, percent: 0 };
  const spentAll = sum(total.data);
  const scale = spentAll > budget ? budget / spentAll : 1;
  return { unlimited: false, percent: Math.max(0.1, tenths((spent * scale * 100) / budget)) };
}

/**
 * Suggestion-relevance allowance (VIS-011): a monthly USD budget per
 * organization, 0.1% of the plan price (plan.limits.relevanceMonthlyBudgetUsd),
 * separate from Improve's. Reserves a refresh's worst case (`costUsd`)
 * before it rates, atomically per organization
 * (reserve_suggestion_relevance), so concurrent refreshes can't overshoot.
 * Returns { unlimited, id }: id is the usage row to settle once the model
 * answers (settleRelevanceUsage), or null when what's left can't cover it.
 */
export async function reserveRelevanceAllowance(orgId, { brandId, modelId, costUsd }) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const budget = plan.limits.relevanceMonthlyBudgetUsd ?? -1;
  if (budget === -1) return { unlimited: true, id: null };

  const { data, error } = await supabaseAdmin.rpc('reserve_suggestion_relevance', {
    p_organization_id: orgId,
    p_brand_id: brandId,
    p_model: modelId,
    p_since: (await quotaPeriodStart(orgId)).toISOString(),
    p_budget: budget,
    p_cost: costUsd,
  });
  if (error) throw new Error(error.message);
  return { unlimited: false, id: data ?? null };
}

/**
 * Lowers a reservation to what the refresh's attempts cost, with the call's
 * own tokens to check the estimate against. A failed update leaves the
 * worst case charged: the budget errs high, never low.
 */
export async function settleRelevanceUsage(id, { attempts, costUsd, usage }) {
  const { error } = await supabaseAdmin
    .from('suggestion_relevance_usage')
    .update({
      attempts,
      cost_usd: costUsd,
      input_tokens: usage?.inputTokens ?? null,
      output_tokens: usage?.outputTokens ?? null,
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

async function countOpportunityUsage(orgId, since) {
  const { count } = await supabaseAdmin
    .from('opportunity_usage')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('used_at', since.toISOString());
  return count || 0;
}

/**
 * Get the monthly content opportunity quota without enforcing (CONTENT-001).
 * Returns { used, limit, remaining }; limit -1 is unlimited. `readOnly` as
 * resolveOrgPlanByOrgId: without an active plan, limit 0 and `noPlan: true`.
 */
export async function getOpportunityQuotaStatus(orgId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  const max = plan.limits.maxOpportunitiesPerMonth ?? -1;
  if (max === -1) return { used: 0, limit: -1, remaining: -1 };

  const used = await countOpportunityUsage(orgId, await quotaPeriodStart(orgId));
  return { used, limit: max, remaining: Math.max(0, max - used), ...noPlanMark(plan) };
}

/**
 * Claim up to `count` of this period's opportunity slots before generating.
 * Atomic per organization (claim_opportunity_usage), so concurrent runs can't
 * overshoot. Returns { unlimited, ids }: link each id to the opportunity it
 * becomes (linkOpportunitySlots) and hand back the rest (releaseOpportunitySlots).
 */
export async function claimOpportunitySlots(orgId, count) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const max = plan.limits.maxOpportunitiesPerMonth ?? -1;
  if (max === -1) return { unlimited: true, ids: [] };
  if (count <= 0) return { unlimited: false, ids: [] };

  const { data, error } = await supabaseAdmin.rpc('claim_opportunity_usage', {
    p_organization_id: orgId,
    p_since: (await quotaPeriodStart(orgId)).toISOString(),
    p_limit: max,
    p_count: count,
  });
  if (error) throw new Error(error.message);
  // A setof uuid comes back as bare ids or as one-key rows, by client version.
  const ids = (data ?? []).map((r) => (typeof r === 'string' ? r : Object.values(r)[0]));
  return { unlimited: false, ids };
}

/**
 * What one "+ New" request may ask for (CONTENT-003): the plan's per-request
 * cap and what is left of the month, with the period's end for the message
 * when nothing is. remaining -1 means unlimited.
 */
export async function getOpportunityRequestAllowance(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  const quota = await getOpportunityQuotaStatus(orgId);
  const perRequest = plan.limits.maxOpportunitiesPerRequest ?? 5;
  const periodEnd = shiftMonthClamped(await quotaPeriodStart(orgId), 1).toISOString();
  return {
    planId: plan.id,
    perRequest,
    remaining: quota.remaining,
    max: quota.remaining === -1 ? perRequest : Math.min(perRequest, quota.remaining),
    periodEnd,
  };
}

/** Point each claimed slot at the opportunity it was used for. */
export async function linkOpportunitySlots(pairs) {
  for (const { usageId, opportunityId } of pairs) {
    const { error } = await supabaseAdmin
      .from('opportunity_usage')
      .update({ opportunity_id: opportunityId })
      .eq('id', usageId);
    if (error) throw new Error(error.message);
  }
}

/** Hand back slots that were claimed but not used (merged, skipped or failed). */
export async function releaseOpportunitySlots(ids) {
  if (!ids.length) return;
  const { error } = await supabaseAdmin.from('opportunity_usage').delete().in('id', ids);
  if (error) throw new Error(error.message);
}

/**
 * Both monthly content counters with the period they belong to, for the
 * Content page and GET /content/usage (CONTENT-001). Opportunities and briefs
 * are separate pools that renew together with the subscription. `readOnly`
 * as resolveOrgPlanByOrgId: without an active plan, every count's limit 0
 * and `noPlan: true`.
 */
export async function getContentUsage(orgId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  const periodStart = await quotaPeriodStart(orgId);
  const [opportunities, briefs] = await Promise.all([
    getOpportunityQuotaStatus(orgId, { readOnly }),
    getBriefQuotaStatus(orgId, { readOnly }),
  ]);
  return {
    plan: plan.id,
    planName: plan.name,
    ...noPlanMark(plan),
    periodStart: periodStart.toISOString(),
    periodEnd: shiftMonthClamped(periodStart, 1).toISOString(),
    opportunities: {
      ...opportunities,
      // What one "+ New" request may ask for (CONTENT-003).
      perRequest: plan.limits.maxOpportunitiesPerRequest ?? 5,
    },
    briefs,
  };
}

/** Audits charged this period, and those of them auto-audit runs started. */
async function countSiteAuditUsage(orgId, periodStart) {
  const since = periodStart.toISOString();
  const count = (source) => {
    let query = supabaseAdmin
      .from('site_audit_usage')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('used_at', since);
    if (source) query = query.eq('source', source);
    return query;
  };
  const [all, auto] = await Promise.all([count(null), count('auto')]);
  if (all.error) throw new Error(all.error.message);
  if (auto.error) throw new Error(auto.error.message);
  return { used: all.count || 0, autoUsed: auto.count || 0 };
}

// How long a running audit holds a quota slot (AUDIT_RUN_TIMEOUT_MS): one
// older than that was cut short by a restart and will never complete.
const SITE_AUDIT_IN_FLIGHT_MS = AUDIT_RUN_TIMEOUT_MS;

/**
 * Audits of the org's brands still running (only `source`'s, when given).
 * They're charged when they complete, so each holds a slot until then:
 * otherwise a run started while others are in flight could take the quota
 * past its limit.
 */
async function countRunningSiteAudits(orgId, source) {
  const since = new Date(Date.now() - SITE_AUDIT_IN_FLIGHT_MS).toISOString();
  let query = supabaseAdmin
    .from('site_audits')
    .select('id, brands!inner(organization_id)', { count: 'exact', head: true })
    .eq('status', 'running')
    .eq('brands.organization_id', orgId)
    .gte('created_at', since);
  if (source) query = query.eq('source', source);
  const { count } = await query;
  return count || 0;
}

/**
 * The org's Site Audit settings (SA-006). No row is the defaults: auto-audit
 * as the plan has it (null), no e-mail.
 */
async function readSiteAuditSettings(orgId) {
  const { data, error } = await supabaseAdmin
    .from('site_audit_settings')
    .select('auto_audit, email_after_run')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { autoAudit: data?.auto_audit ?? null, emailAfterRun: data?.email_after_run ?? false };
}

/**
 * Where the org's auto-audit stands this period (SA-006): whether it runs,
 * each run's share, the five runs and which are recorded, the share the runs
 * still to come keep out of the user's pool, and the run whose turn it is.
 */
async function siteAuditAutoStatus(orgId, limit, periodStart, now, { noPlan = false } = {}) {
  const [settings, { data: runRows, error }] = await Promise.all([
    readSiteAuditSettings(orgId),
    supabaseAdmin
      .from('site_audit_auto_runs')
      .select('run_day')
      .eq('organization_id', orgId)
      .eq('period_start', periodStart.toISOString()),
  ]);
  if (error) throw new Error(error.message);

  // No plan, no runs: the morning sweep skips an organization without one.
  const enabled = !noPlan && autoAuditEnabled(settings.autoAudit, limit);
  const perRun = perRunSlots(limit);
  const periodEnd = shiftMonthClamped(periodStart, 1);
  const schedule = runSchedule(periodStart, periodEnd);
  const recorded = (runRows ?? []).map((r) => r.run_day);
  const pending = enabled ? pendingRuns(schedule, recorded, now) : [];
  const due = enabled ? dueRun(schedule, now) : null;
  const next = pending[0] ?? null;

  return {
    enabled,
    // The org's own choice; null follows the plan.
    setting: settings.autoAudit,
    emailAfterRun: settings.emailAfterRun,
    perRun,
    // A plan without a monthly limit keeps nothing back.
    reserved: limit === -1 ? 0 : perRun * pending.length,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    runs: schedule.map((run) => ({
      day: run.day,
      at: run.at.toISOString(),
      done: recorded.includes(run.day),
    })),
    nextRun: next
      ? { day: next.day, at: new Date(Math.max(next.at.getTime(), now.getTime())).toISOString() }
      : null,
    // The run to start now: its turn, not recorded yet.
    due: due && !recorded.includes(due.day) ? { day: due.day } : null,
  };
}

/**
 * The org's Site Audit quota this period: completed and running audits
 * against plan.limits.maxSiteAudits (Starter 100, Growth 500,
 * Enterprise/Self-hosted unlimited), and the auto-audit share. `readOnly` as
 * resolveOrgPlanByOrgId: without an active plan, a limit of 0 and no runs.
 */
async function siteAuditQuota(orgId, now, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  const limit = plan.limits.maxSiteAudits;
  const periodStart = await quotaPeriodStart(orgId, now);
  const [{ used, autoUsed }, running, autoRunning, auto] = await Promise.all([
    limit === -1 ? { used: 0, autoUsed: 0 } : countSiteAuditUsage(orgId, periodStart),
    limit === -1 ? 0 : countRunningSiteAudits(orgId),
    limit === -1 ? 0 : countRunningSiteAudits(orgId, 'auto'),
    siteAuditAutoStatus(orgId, limit, periodStart, now, { noPlan: plan.noPlan === true }),
  ]);
  // The quota card tells the runs' audits (done and running) from the user's.
  return { plan, limit, used, running, auto: { ...auto, used: autoUsed, running: autoRunning } };
}

/**
 * Enforce the monthly Site Audit quota for an organization before starting
 * `count` audits. Counts completed audits this billing period, plus the ones
 * still running, against plan.limits.maxSiteAudits (Starter 100, Growth 500,
 * Enterprise/Self-hosted unlimited). A user's audits also leave the slots of
 * the auto-audit runs still to come (SA-006); a run's own audits use them.
 * Throws PlanLimitError (429) when the audits don't fit, starting none;
 * returns { plan, remaining } otherwise.
 *
 * @param {string} orgId
 * @param {number} [count]
 * @param {{ source?: 'user'|'auto', now?: Date }} [options]
 */
export async function enforceSiteAuditQuota(
  orgId,
  count = 1,
  { source = 'user', now = new Date() } = {},
) {
  const { plan, limit, used, running, auto } = await siteAuditQuota(orgId, now);
  if (limit === -1) return { plan, remaining: -1 };

  const reserved = source === 'auto' ? 0 : auto.reserved;
  const remaining = limit - used - running - reserved;
  const inFlight = running > 0 ? `, ${running} still running` : '';
  if (remaining <= 0 && reserved > 0) {
    // The spec's empty-pool message: the user's share is used, the runs' isn't.
    throw new PlanLimitError(
      `You've used your ${limit - reserved} Site Audits this month on the ${plan.name} plan${running > 0 ? ` (${running} still running)` : ''}. ${reserved} auto audits are still scheduled. Turn off auto-audit in Site Audit settings to use them now, or upgrade.`,
      429,
    );
  }
  if (remaining <= 0) {
    throw new PlanLimitError(
      `Monthly Site Audit limit reached (${used + running}/${limit}${inFlight}) on the ${plan.name} plan. Resets when your subscription renews — upgrade for more.`,
      429,
    );
  }
  if (count > remaining) {
    const kept = reserved > 0 ? ` (${reserved} more are kept for auto-audits)` : '';
    throw new PlanLimitError(
      `These ${count} audits need more than the ${remaining} left this month on the ${plan.name} plan${kept}. Select up to ${remaining}.`,
      429,
    );
  }

  return { plan, remaining };
}

/**
 * Get current Site Audit quota status without enforcing.
 * Returns { used, running, limit, remaining, auto }: remaining is the user's
 * pool, with running audits and the auto-audit runs still to come taken out;
 * auto is where auto-audit stands (siteAuditAutoStatus, plus what its runs
 * used this period and have running). `readOnly` as siteAuditQuota, with
 * `noPlan: true`.
 */
export async function getSiteAuditQuotaStatus(orgId, { now = new Date(), readOnly = false } = {}) {
  const { plan, limit, used, running, auto } = await siteAuditQuota(orgId, now, { readOnly });
  if (limit === -1) return { used: 0, running: 0, limit: -1, remaining: -1, auto };
  return {
    used,
    running,
    limit,
    remaining: Math.max(0, limit - used - running - auto.reserved),
    auto,
    ...noPlanMark(plan),
  };
}

/**
 * Verified AI-bot rows an organization may store a month (AT-010, spec
 * §6.3): -1 = no cap, 0 = the bot report is locked (Starter). Throws
 * PlanLimitError (402) without an active subscription, like every billed
 * feature.
 */
export async function getBotEventCap(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  return plan.limits.maxBotEventsPerMonth ?? 0;
}

/**
 * Raw log records a month an organization's Vercel drains and Logpush jobs
 * may send before the server stops reading them (AT-010, spec §6.3).
 */
export async function getBotRawCap(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  return plan.limits.maxBotRawRecordsPerMonth ?? 0;
}

/**
 * Both AI-bot caps, from one plan read, for the connections page:
 * { cap, rawCap } as getBotEventCap and getBotRawCap. `readOnly` as
 * resolveOrgPlanByOrgId: without an active plan, 0 and 0 with `noPlan: true`,
 * so the connections and this month's use still come back.
 */
export async function getBotCaps(orgId, { readOnly = false } = {}) {
  const plan = await resolveOrgPlanByOrgId(orgId, { readOnly });
  return {
    cap: plan.limits.maxBotEventsPerMonth ?? 0,
    rawCap: plan.limits.maxBotRawRecordsPerMonth ?? 0,
    ...noPlanMark(plan),
  };
}

/**
 * Live catalog products an organization's brands may have across their
 * sources (ECOM-019): -1 = no cap. Throws PlanLimitError (402) without an
 * active subscription, like every billed feature.
 */
export async function getCatalogProductCap(orgId) {
  const plan = await resolveOrgPlanByOrgId(orgId);
  return plan.limits.maxCatalogProducts ?? -1;
}

/**
 * Express middleware that attaches req.plan from the authenticated user.
 * Must run after auth middleware (req.user must exist).
 */
export function attachPlan() {
  return async (req, res, next) => {
    try {
      req.plan = await resolveOrgPlan(req.user.id);
      next();
    } catch (err) {
      if (err instanceof PlanLimitError) {
        return res.status(err.statusCode).json({
          success: false,
          error: 'plan_limit',
          message: err.message,
        });
      }
      next(err);
    }
  };
}

/**
 * Express middleware factory — blocks the request if the plan lacks a feature.
 * Usage: router.post('/suggest', requireFeature('prompt_suggestions'), handler)
 *
 * `readOnly`, named route by route (as the middleware's open routes are, so
 * none is let through by its method alone): a route that only reads what is
 * kept. An organization without an active plan is then checked against the
 * features of the plan it was on (read-only once the plan has ended,
 * 2026-10-27), so what it stored still comes back; without it, a 402.
 */
export function requireFeature(feature, { readOnly = false } = {}) {
  return async (req, res, next) => {
    try {
      await enforceFeature(req.user.id, feature, { readOnly });
      next();
    } catch (err) {
      if (err instanceof PlanLimitError) {
        return res.status(err.statusCode).json({
          success: false,
          error: 'plan_limit',
          message: err.message,
        });
      }
      next(err);
    }
  };
}
