/**
 * Chat's model steps on the workspace's one AI budget (CHAT-04 §C items
 * 11–14, CHAT-16 items 22, 26, 29–30; DECISIONS P), behind CHAT_AGENTIC. The
 * web's Chat engine runs the models; before each model step it asks for a
 * hold here, and once the step ends it charges it, lets it go or keeps it,
 * through /api/internal/chat/budget (routes/internalChatBudget.js).
 *
 * Every step writes one prompt_improve_usage row, named by its run and step
 * (00405):
 *   - On GetCito's key, the row is a hold of the step's worst case, taken
 *     by reserve_chat_ai_usage under the organization's lock only while the
 *     period's spend, holds in flight included, plus that worst case stays
 *     within the budget: runs at once can't pass it (item 13). Stricter than
 *     reserveAiBudget's, which lets a call start while anything is left.
 *   - On the workspace's own key (ownKey), the row is written without a
 *     check and never counts: the provider bills the workspace (item 26).
 *   - With no budget to hold against (self-hosted), it is written unchecked.
 * The charge then turns the row into the step's real cost: 1x, what the
 * model costs at the price in effect (generationCostUsd: the synced catalog
 * price first, for Chat's steps only, and never a $0 one for a paid model),
 * input read from the prompt cache at its cache-read rate and input written
 * to it at the write premium (CHAT-04 §D items 28–29). The row also keeps
 * the step's cache read and write tokens and how long its call took, for
 * staff. The margin on purchased AI credits (CHAT-16 30a) is never here.
 *
 * The trial's budget is the plan's in its trial (applyTrialAiBudget), over a
 * period that runs the whole trial (aiBudgetOf): it never resets.
 *
 * Purchased AI credits (aiCredits.js, CHAT-18 §F) are on the budget too: a
 * step's hold passes on them once the included budget is spent, and the
 * charged step's cost past the included budget is drawn from them, its row
 * split by grant (prompt_improve_usage.grant_id).
 *
 * An agent's run (CHAT-27 items 19–22, 30) holds each step within its own
 * cap too: the run's max_share of the monthly budget, its spend on either
 * key counted (item 33). A step past it is refused as run_cap, not
 * ai_limit, so the run stops or pauses at its limit rather than the
 * month's. Each charge or release keeps the run's use as a share of the
 * budget (chat_agent_runs.usage_share), for its run card and Runs tab.
 *
 * The run's cap is a share of the plan's included monthly budget (the
 * meter's "monthly AI limit"), never of the credits on top, so a 10% cap
 * means the same with or without a pack. The run's spend is every row of
 * the run, whatever paid it (own key, included budget or credits:
 * reserve_chat_ai_usage sums them by agent_run_id, and a step's credit
 * parts keep its agent run, aiCredits.js splitRow).
 */

import supabaseAdmin from '../config/supabase.js';
import { chatAgenticEnabled } from './chatFlag.js';
import { drawCredits } from './aiCredits.js';
import { cacheSplit, generationCostUsd } from './improveCost.js';
import { CHAT_AI_FEATURES, aiBudgetOf, aiBudgetUsedUp, quotaPeriodStart } from './planGuard.js';
import { logger } from './logger.js';
import { shiftMonthClamped } from './quotaPeriod.js';

/** What a Chat step can be metered as: a run's model step, then agents, scheduled runs, images. */
export const CHAT_BUDGET_FEATURES = CHAT_AI_FEATURES;

/**
 * A request about a step the server can't take (Chat off, a run not the
 * workspace's), or one past its agent run's cap (run_cap, 429).
 */
export class ChatBudgetError extends Error {
  /**
   * @param {'chat_off' | 'not_found' | 'run_cap'} code
   * @param {number} statusCode
   */
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'ChatBudgetError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * A step's worst case (item 13): its prompt at the input price in effect and
 * every token it may write at the output price. The pre-step estimate
 * assumes no prompt-cache hit (§D item 29), so a cache miss can't pass it.
 */
export function stepWorstCaseUsd(modelId, { inputTokens, maxOutputTokens }) {
  return generationCostUsd(
    modelId,
    { inputTokens, outputTokens: maxOutputTokens },
    { synced: true },
  );
}

function assertChatOn(orgId) {
  if (!chatAgenticEnabled(orgId)) {
    throw new ChatBudgetError('chat_off', 403, 'Chat is off for this workspace.');
  }
}

/** What an agent run has spent so far, holds in flight and own-key steps included. */
async function agentRunSpentUsd(agentRunId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('cost_usd')
    .eq('agent_run_id', agentRunId);
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
}

/**
 * An agent run's cap in dollars (CHAT-27 item 21): its max_share of the
 * plan's included monthly budget (`includedUsd`, credits left out), worked
 * out here so no dollar leaves the server. Null without a budget to share
 * (self-hosted: no cap). ChatBudgetError 404 when the run isn't the
 * workspace's.
 */
async function agentRunCapUsd(orgId, agentRunId, includedUsd) {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('max_share')
    .eq('id', agentRunId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ChatBudgetError('not_found', 404, 'Agent run not found.');
  if (includedUsd === null || !(includedUsd > 0)) return null;
  return (Number(data.max_share) || 0) * includedUsd;
}

/**
 * Holds a step's worst case on the budget and writes its row; returns the
 * row's id, for the charge or the release. PlanLimitError 429 when the
 * budget can't cover the step (the step doesn't start), 402 without an
 * active plan; ChatBudgetError 404 when the run isn't the workspace's, or the
 * step the run's. With `agentRunId` (the chat's agent run), the step is held
 * within that run's cap too: ChatBudgetError run_cap 429 past it. With
 * `scheduleId` (the chat's scheduled job, CHAT-12 item 14) the database
 * checks it is the chat's; the row is named with the chat's job either way.
 * `holdUsd` holds a set amount instead of the model's worst case, for a call
 * much smaller than a Chat step (Content Quality's reads).
 */
export async function reserveChatStep(
  orgId,
  {
    feature = 'chat',
    modelId,
    inputTokens,
    maxOutputTokens,
    runId,
    stepId = null,
    ownKey = false,
    agentRunId = null,
    scheduleId = null,
    holdUsd = null,
  },
) {
  assertChatOn(orgId);
  const { plan, budgetUsd, includedUsd, since } = await aiBudgetOf(orgId);
  const cost = holdUsd ?? stepWorstCaseUsd(modelId, { inputTokens, maxOutputTokens });
  const runCap = agentRunId ? await agentRunCapUsd(orgId, agentRunId, includedUsd) : null;
  const { data, error } = await supabaseAdmin.rpc('reserve_chat_ai_usage', {
    p_organization_id: orgId,
    p_chat_run_id: runId,
    p_chat_run_step_id: stepId,
    p_feature: feature,
    p_model: modelId,
    p_cost: cost,
    p_own_key: ownKey,
    p_since: since,
    p_budget: budgetUsd,
    ...(agentRunId ? { p_agent_run_id: agentRunId, p_run_cap: runCap } : {}),
    ...(scheduleId ? { p_schedule_id: scheduleId } : {}),
  });
  if (error) {
    if (error.code === 'P0002') {
      throw new ChatBudgetError('not_found', 404, 'Chat run not found.');
    }
    throw new Error(error.message);
  }
  if (!data) {
    // Refused: the run's own cap when its spend can't take the step, else the month's budget.
    if (runCap !== null && (await agentRunSpentUsd(agentRunId)) + Math.max(cost, 0) > runCap) {
      throw new ChatBudgetError('run_cap', 429, 'This run reached its limit.');
    }
    throw aiBudgetUsedUp(plan);
  }
  return data;
}

/** The most like parts one check sizes (fitChatUnits): a batch past it is checked as this many. */
export const MAX_FIT_UNITS = 100;

/**
 * What the period's Chat and other AI calls spent so far, holds in flight
 * included and own-key steps left out (ai_usage_by_feature, 00405): the sum
 * reserve_chat_ai_usage checks a hold against.
 */
async function periodSpentUsd(orgId, since) {
  const { data, error } = await supabaseAdmin.rpc('ai_usage_by_feature', {
    p_organization_id: orgId,
    p_since: since,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
}

/**
 * How many of `units` like parts of one job (drafts, tasks, pages) the AI
 * budget left covers, each sized as one model step's worst case (`perUnit`:
 * its prompt and its max output, stepWorstCaseUsd), before the job starts
 * (CHAT-04 item 17a). What is left is the budget, purchased credits
 * included, less the period's spend and holds; for an agent run's chat
 * (`agentRunId`), also what its own cap leaves (CHAT-27 item 21). A count,
 * never dollars: the web asks the person what to do when it is under
 * `units`, and pauses at the cap when it is 0. `limit` says which limit
 * binds: 'run' when the agent run's own cap leaves no more than the month
 * does, so the web pauses the run at its cap, not the agent at the month's. Every part fits on the
 * workspace's own key (ownKey: the provider bills it), without a budget to
 * hold against (self-hosted), and for a model priced at nothing. Only a
 * check: each step is still held on its own (reserveChatStep).
 */
export async function fitChatUnits(
  orgId,
  { modelId, perUnit, units, ownKey = false, agentRunId = null },
) {
  assertChatOn(orgId);
  const count = Math.max(0, Math.min(MAX_FIT_UNITS, Math.floor(units)));
  const unitUsd = stepWorstCaseUsd(modelId, perUnit);
  if (ownKey || !(unitUsd > 0)) return { fits: count, limit: 'month' };
  const { budgetUsd, includedUsd, since } = await aiBudgetOf(orgId);
  let room = Infinity;
  if (budgetUsd !== null) room = budgetUsd - (await periodSpentUsd(orgId, since));
  let limit = 'month';
  if (agentRunId) {
    const cap = await agentRunCapUsd(orgId, agentRunId, includedUsd);
    if (cap !== null) {
      const runRoom = cap - (await agentRunSpentUsd(agentRunId));
      // Its own cap binds when it leaves no more than the month, as reserveChatStep's run_cap.
      if (runRoom <= room) limit = 'run';
      room = Math.min(room, runRoom);
    }
  }
  return { fits: room === Infinity ? count : fitsIn(room, unitUsd, count), limit };
}

/** The parts of `unitUsd` each that `roomUsd` holds, at most `count`; float noise doesn't take one. */
const fitsIn = (roomUsd, unitUsd, count) =>
  Math.max(0, Math.min(count, Math.floor(roomUsd / unitUsd + 1e-9)));

/**
 * A meter for Content Quality's reads made for an agent run (the go-live
 * gate, AUTONOMOUS-GO-LIVE §6.2): the same { charge, release, keep } as
 * plan-guard's reserveAiBudget, so the reads take it in its place, but
 * drawn as the run's own steps (feature `agent`, within the run's cap and
 * the month's budget). `reserve({ modelId, holdUsd })` holds the read;
 * past the run's cap, ChatBudgetError run_cap; past the budget,
 * PlanLimitError. A read that calls the model again is held and charged as
 * a second step.
 */
export function agentRunReserve(orgId, { runId, agentRunId }) {
  return async ({ modelId, holdUsd = null }) => {
    const hold = () =>
      reserveChatStep(orgId, { feature: 'agent', modelId, runId, agentRunId, holdUsd });
    let usageId = await hold();
    let settled = false;
    return {
      // As reserveAiBudget's: a write that fails is logged, never thrown.
      async charge(usage) {
        try {
          if (settled) usageId = await hold();
          settled = true;
          await chargeChatStep(orgId, usageId, { modelId, usage });
        } catch (err) {
          logger.error({ err, orgId, agentRunId }, '[chat-budget] a read for the run not charged');
        }
      },
      async release() {
        if (settled) return;
        settled = true;
        try {
          await releaseChatStep(orgId, usageId);
        } catch (err) {
          logger.error({ err, orgId, agentRunId }, '[chat-budget] a read’s hold not released');
        }
      },
      // A call sent and then cut off is billed all the same: the hold stays as its cost.
      async keep() {
        settled = true;
      },
    };
  };
}

/**
 * Keeps an agent run's use (chat_agent_runs.usage_share, CHAT-27 items
 * 25–26) as its spend over the plan's included monthly budget, own-key and
 * credit parts included (the cap's measure): after each charge or release
 * of one of its steps. Never dollars. Without a budget (self-hosted) there
 * is no share. A failure is logged: the step is settled all the same.
 */
export async function refreshAgentRunShare(orgId, agentRunId) {
  try {
    const { includedUsd } = await aiBudgetOf(orgId, { credits: false });
    if (includedUsd === null || !(includedUsd > 0)) return;
    const spent = await agentRunSpentUsd(agentRunId);
    // numeric(7, 4): a share to 0.01%, at most 999.9999.
    const share = Math.min(999.9999, Math.round((spent / includedUsd) * 10_000) / 10_000);
    const { error } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ usage_share: share })
      .eq('id', agentRunId)
      .eq('organization_id', orgId);
    if (error) throw new Error(error.message);
  } catch (err) {
    logger.error({ err, orgId, agentRunId }, '[chat-budget] could not keep an agent run’s use');
  }
}

/**
 * Keeps a scheduled job's run's use (chat_schedule_runs.usage_share,
 * CHAT-12 item 24: "0.6%" in its run history) as its Chat run's spend on
 * GetCito's key over the plan's included monthly budget: after each charge
 * or release of one of its steps. Own-key steps don't draw on the limit,
 * so they don't count. Never dollars. Without a budget (self-hosted) there
 * is no share. A failure is logged: the step is settled all the same.
 */
export async function refreshScheduleRunShare(orgId, chatRunId) {
  if (!chatRunId) return;
  try {
    const { includedUsd } = await aiBudgetOf(orgId, { credits: false });
    if (includedUsd === null || !(includedUsd > 0)) return;
    const { data, error } = await supabaseAdmin
      .from('prompt_improve_usage')
      .select('cost_usd')
      .eq('organization_id', orgId)
      .eq('chat_run_id', chatRunId)
      .eq('own_key', false);
    if (error) throw new Error(error.message);
    const spent = (data ?? []).reduce((sum, row) => sum + (Number(row.cost_usd) || 0), 0);
    // numeric(7, 4): a share to 0.01%, at most 999.9999.
    const share = Math.min(999.9999, Math.round((spent / includedUsd) * 10_000) / 10_000);
    const { error: keepError } = await supabaseAdmin
      .from('chat_schedule_runs')
      .update({ usage_share: share })
      .eq('run_id', chatRunId);
    if (keepError) throw new Error(keepError.message);
  } catch (err) {
    logger.error({ err, orgId, chatRunId }, '[chat-budget] could not keep a scheduled run’s use');
  }
}

/**
 * The step's real cost in place of its hold: what its model used, priced 1x
 * (generationCostUsd), its prompt cache's reads at the cache-read rate and
 * writes at the write premium. Only the workspace's own Chat rows:
 * ChatBudgetError 404 when the row is gone (released) or isn't one. A step
 * that called the model more than once (a retry) is charged its total
 * usage. A provider that didn't report both its input and its output leaves
 * the hold as the step's cost: over, never under. `latencyMs`, how long the
 * call took, is kept for staff. The cost past the included budget is then
 * drawn from the credits.
 */
export async function chargeChatStep(orgId, usageId, { modelId, usage, latencyMs }) {
  const reported = usage?.inputTokens != null && usage?.outputTokens != null;
  const latency = latencyMs != null ? { latency_ms: latencyMs } : {};
  let charged = { model: modelId, ...latency };
  if (reported) {
    const { read, written } = cacheSplit(usage);
    charged = {
      ...charged,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens != null ? read : null,
      cache_write_tokens: usage.cacheWriteTokens != null ? written : null,
      cost_usd: generationCostUsd(modelId, usage, { synced: true }),
    };
  }
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .update(charged)
    .eq('id', usageId)
    .eq('organization_id', orgId)
    .in('feature', CHAT_BUDGET_FEATURES)
    .select('id, agent_run_id, schedule_id, chat_run_id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new ChatBudgetError('not_found', 404, 'Chat step usage not found.');
  await drawOnCredits(orgId, usageId);
  // After the draw: the run's use counts the step's credit parts too.
  if (data[0].agent_run_id) await refreshAgentRunShare(orgId, data[0].agent_run_id);
  if (data[0].schedule_id) await refreshScheduleRunShare(orgId, data[0].chat_run_id);
}

/**
 * The charged step's cost past the included budget, drawn from the
 * workspace's AI credits. Only with Chat on (drawCredits reads nothing
 * otherwise); a budget that can't be read (no active plan any more) leaves
 * the row on the included budget, logged: the charge itself stands.
 */
async function drawOnCredits(orgId, usageId) {
  if (!chatAgenticEnabled(orgId)) return;
  try {
    const { includedUsd, since } = await aiBudgetOf(orgId, { credits: false });
    await drawCredits(orgId, usageId, { includedUsd, since });
  } catch (err) {
    logger.error({ err, orgId, usageId }, '[chat-budget] credit draw skipped');
  }
}

/**
 * A step that billed nothing (it failed before an answer): its hold goes.
 * Safe to ask more than once. A step a Stop aborted isn't released: the
 * provider bills it all the same, so its hold stays as its cost (the web's
 * keep()). Charging and releasing settle a hold already taken, so they work
 * whether or not Chat is still on.
 */
export async function releaseChatStep(orgId, usageId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .delete()
    .eq('id', usageId)
    .eq('organization_id', orgId)
    .in('feature', CHAT_BUDGET_FEATURES)
    .select('agent_run_id, schedule_id, chat_run_id');
  if (error) throw new Error(error.message);
  const released = (data ?? [])[0];
  if (released?.agent_run_id) await refreshAgentRunShare(orgId, released.agent_run_id);
  if (released?.schedule_id) await refreshScheduleRunShare(orgId, released.chat_run_id);
}

/**
 * Each agent's share of the AI limit (CHAT-27 items 24–30), for the web's
 * Agents list and agent detail: what its runs spent on the budget and on the
 * workspace's own key, over the budget, and how many runs spent anything
 * (chat_agent_usage_shares, 00419). Since the period's start (the meter's,
 * aiBudgetOf), or over the last `days` days against the same budget. The
 * budget is the plan's included one, credits left out, as each run's cap
 * and use are (usage_share): a pack bought doesn't shrink the shares.
 * Shares only: the budget stays here. No budget to share (self-hosted):
 * unlimited, no rows.
 */
export async function agentUsageShares(orgId, { days = null } = {}) {
  assertChatOn(orgId);
  const { includedUsd: budgetUsd, since } = await aiBudgetOf(orgId, { credits: false });
  if (budgetUsd === null || !(budgetUsd > 0)) return { unlimited: true, since: null, shares: [] };
  const from = days ? new Date(Date.now() - days * 86_400_000).toISOString() : since;
  const { data, error } = await supabaseAdmin.rpc('chat_agent_usage_shares', {
    p_organization_id: orgId,
    p_since: from,
    p_budget: budgetUsd,
  });
  if (error) throw new Error(error.message);
  return {
    unlimited: false,
    since: from,
    shares: (data ?? []).map((row) => ({
      agentId: row.agent_id ?? null,
      share: Number(row.share) || 0,
      ownKeyShare: Number(row.own_key_share) || 0,
      runs: Number(row.runs) || 0,
    })),
  };
}

/** How many of the last days a run estimate reads, and how many of their rows. */
const ESTIMATE_DAYS = 30;
const ESTIMATE_ROWS = 5000;

/**
 * About how much of the AI limit one Chat run uses (the schedule card's
 * "≈ 2% of monthly AI usage per run", CHAT-12 item 7): the workspace's
 * Chat and scheduled runs over the last 30 days, each run's spend summed,
 * averaged, over the plan's included budget (credits left out, as agent
 * shares are). On GetCito's key only: own-key rows are the workspace's.
 * Null with no run to go on. Shares only: no dollars leave the server.
 * No budget (self-hosted): unlimited.
 */
export async function chatRunEstimate(orgId) {
  assertChatOn(orgId);
  const { includedUsd } = await aiBudgetOf(orgId, { credits: false });
  if (includedUsd === null || !(includedUsd > 0)) return { unlimited: true, share: null, runs: 0 };
  const since = new Date(Date.now() - ESTIMATE_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .select('chat_run_id, cost_usd')
    .eq('organization_id', orgId)
    .in('feature', ['chat', 'schedule'])
    .eq('own_key', false)
    .gte('used_at', since)
    .not('chat_run_id', 'is', null)
    .order('used_at', { ascending: false })
    .limit(ESTIMATE_ROWS);
  if (error) throw new Error(error.message);
  const byRun = new Map();
  for (const row of data ?? []) {
    byRun.set(row.chat_run_id, (byRun.get(row.chat_run_id) ?? 0) + (Number(row.cost_usd) || 0));
  }
  if (byRun.size === 0) return { unlimited: false, share: null, runs: 0 };
  const average = [...byRun.values()].reduce((sum, usd) => sum + usd, 0) / byRun.size;
  // numeric(7, 4) as the run rows keep it: to 0.01%.
  const share = Math.min(999.9999, Math.round((average / includedUsd) * 10_000) / 10_000);
  return { unlimited: false, share, runs: byRun.size };
}

/**
 * The agents' monthly limit on the workspace's own key when no Admin set it
 * (AGENT-OWN-KEY D5, 00442's default).
 */
export const OWN_KEY_AGENT_CAP_DEFAULT_USD = 250;

/**
 * The key guard (AGENT-OWN-KEY §4.2): what all agents' runs spent on the
 * workspace's own key this AI period (the meter's, so it renews with it),
 * at the price each step was charged, holds in flight at their worst case,
 * against the Admin's monthly limit (chat_settings.own_key_agent_month_usd,
 * $250 without a row). `reached` at or past it: the agents pause
 * (own_key_cap) and Run now is refused until the period renews or an Admin
 * raises it. Dollars only for the Admins' settings card; the agent checks
 * read `reached` alone. Interactive Chat isn't counted (§4.4).
 */
export async function ownKeyAgentSpend(orgId, now = new Date()) {
  assertChatOn(orgId);
  const periodStart = await quotaPeriodStart(orgId, now);
  const since = periodStart.toISOString();
  const [{ data: settings, error: settingsError }, { data: spent, error }] = await Promise.all([
    supabaseAdmin
      .from('chat_settings')
      .select('own_key_agent_month_usd')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin.rpc('chat_own_key_agent_spend', {
      p_organization_id: orgId,
      p_since: since,
    }),
  ]);
  if (settingsError) throw new Error(settingsError.message);
  if (error) throw new Error(error.message);
  const capUsd = Number(settings?.own_key_agent_month_usd ?? OWN_KEY_AGENT_CAP_DEFAULT_USD);
  const usedUsd = Number(spent) || 0;
  return {
    reached: usedUsd >= capUsd,
    // To the cent: an estimate at list prices.
    usedUsd: Math.round(usedUsd * 100) / 100,
    capUsd,
    since,
    renewsAt: shiftMonthClamped(periodStart, 1).toISOString(),
  };
}
