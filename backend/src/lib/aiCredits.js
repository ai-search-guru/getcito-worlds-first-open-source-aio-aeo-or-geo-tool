/**
 * Purchased AI credits on the workspace's one AI budget (CHAT-18 §F items
 * 19–22, 00413), behind CHAT_AGENTIC. A paid AI pack's grant
 * (ai_credit_grants, written only by the web's Stripe webhook) adds its
 * dollars of model cost to the budget for 12 months. A call draws on the
 * period's included budget first and, once that is spent, on the grants:
 * the one ending soonest first, so the oldest pack goes first and the monthly
 * reset never wipes what was bought.
 *
 *   - creditRoomUsd: what the grants add to the budget a hold is checked
 *     against: what is left on the grants still valid, plus what this
 *     period's rows already drew from grants. Those rows are in the spend
 *     the hold sums, so they are added back: a hold then passes while the
 *     included spend plus its cost stays within the included budget plus
 *     the credits left.
 *   - drawCredits: once a call's cost is known, the part of it past the
 *     included budget is taken from the grants and its ledger row split
 *     (prompt_improve_usage.grant_id): the row keeps the included part, and
 *     each grant's part is a row of its own with the grant's id. What the
 *     grants can't cover stays on the row: over, never under.
 *
 * Own-key rows never touch either. With Chat off for the workspace nothing
 * is read: no pack is sold or granted then, and the budget is the plan's.
 * Dollars stay on the server.
 */

import supabaseAdmin from '../config/supabase.js';
import { chatAgenticEnabled } from './chatFlag.js';
import { logger } from './logger.js';

/** Money in millionths of a dollar (cost_usd and the grants are numeric(12, 6)), so sums are exact. */
const micros = (usd) => Math.round((Number(usd) || 0) * 1e6);
const dollars = (m) => m / 1e6;

/** Rows a page of a sum reads (PostgREST's default max-rows). */
const PAGE = 1000;

/** Tries at a grant another draw changed between its read and its update. */
const DRAW_TRIES = 3;

/**
 * The sum of cost_usd over every row a query names, in micros, a page at a
 * time: a busy workspace has more rows in a period than one read returns.
 */
async function sumCostMicros(build) {
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build()
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) total += micros(row.cost_usd);
    if (!data || data.length < PAGE) return total;
  }
}

/** This period's rows that drew on a grant, in micros. */
function grantDrawnMicros(orgId, since) {
  return sumCostMicros(() =>
    supabaseAdmin
      .from('prompt_improve_usage')
      .select('cost_usd')
      .eq('organization_id', orgId)
      .eq('own_key', false)
      .not('grant_id', 'is', null)
      .gte('used_at', since),
  );
}

const leftMicros = (grant) => Math.max(0, micros(grant.usd_total) - micros(grant.usd_used));

/**
 * What the workspace's AI credits add to its budget for a hold over the
 * period from `since`: the credits left on grants still valid, plus this
 * period's draws on grants. 0 with Chat off, without a grant, or when they
 * can't be read (logged): the hold then checks the included budget alone.
 */
export async function creditRoomUsd(orgId, since, now = new Date()) {
  if (!chatAgenticEnabled(orgId) || !since) return 0;
  try {
    // A grant that ended before the period began drew nothing in it.
    const { data: grants, error } = await supabaseAdmin
      .from('ai_credit_grants')
      .select('usd_total, usd_used, expires_at')
      .eq('organization_id', orgId)
      .gt('expires_at', since);
    if (error) throw new Error(error.message);
    if (!grants?.length) return 0;
    const nowMs = now.getTime();
    const left = grants
      .filter((g) => new Date(g.expires_at).getTime() > nowMs)
      .reduce((sum, g) => sum + leftMicros(g), 0);
    return dollars(left + (await grantDrawnMicros(orgId, since)));
  } catch (err) {
    logger.error({ err, orgId }, '[ai-credits] credit room read failed');
    return 0;
  }
}

/**
 * The AI credits left on the workspace's grants still valid, in dollars (for
 * the server only: what a meter says is whether any is left). 0 with Chat
 * off, without a grant, or when they can't be read (logged).
 */
export async function creditsLeftUsd(orgId, now = new Date()) {
  if (!chatAgenticEnabled(orgId)) return 0;
  try {
    const { data: grants, error } = await supabaseAdmin
      .from('ai_credit_grants')
      .select('usd_total, usd_used, expires_at')
      .eq('organization_id', orgId)
      .gt('expires_at', now.toISOString());
    if (error) throw new Error(error.message);
    return dollars((grants ?? []).reduce((sum, g) => sum + leftMicros(g), 0));
  } catch (err) {
    logger.error({ err, orgId }, '[ai-credits] credits left read failed');
    return 0;
  }
}

/**
 * Takes up to `wanted` micros from the grants, soonest ending first. Each
 * take moves usd_used only if no other draw moved it since it was read; one
 * that did is read again and tried again. Returns what each grant gave.
 */
async function takeFromGrants(grants, wanted) {
  const portions = [];
  let over = wanted;
  for (const grant of grants) {
    if (over <= 0) break;
    let current = grant;
    for (let attempt = 0; attempt < DRAW_TRIES && current; attempt++) {
      const left = leftMicros(current);
      if (left <= 0) break;
      const take = Math.min(left, over);
      const { data, error } = await supabaseAdmin
        .from('ai_credit_grants')
        .update({ usd_used: dollars(micros(current.usd_used) + take) })
        .eq('id', grant.id)
        .eq('usd_used', current.usd_used)
        .select('id');
      if (error) throw new Error(error.message);
      if (data?.length) {
        portions.push({ grantId: grant.id, micros: take });
        over -= take;
        break;
      }
      const reread = await supabaseAdmin
        .from('ai_credit_grants')
        .select('id, usd_total, usd_used')
        .eq('id', grant.id)
        .maybeSingle();
      if (reread.error) throw new Error(reread.error.message);
      current = reread.data;
    }
  }
  return portions;
}

/** The ledger row's columns a split copies onto each grant's part. */
const ROW_COLUMNS =
  'id, organization_id, feature, model, cost_usd, own_key, grant_id, used_at, prompt_id, action_id, content_draft_id, chat_run_id, chat_run_step_id, agent_id, agent_run_id, parent_run_id';

/**
 * The row keeps the included part and each grant's part becomes its own row
 * (00413: a step that crosses from one to the other is written as two rows),
 * with the row's time and its run, agent and agent run, so every part counts
 * in the same period and toward the same agent run's cap. With nothing
 * left on the included budget the row itself becomes the first grant's part.
 * Tokens stay on the row: the parts are dollars only.
 */
async function splitRow(row, costMicros, portions) {
  const drawn = portions.reduce((sum, p) => sum + p.micros, 0);
  const included = costMicros - drawn;
  const part = (p) => ({
    organization_id: row.organization_id,
    feature: row.feature,
    model: row.model,
    prompt_id: row.prompt_id,
    action_id: row.action_id,
    content_draft_id: row.content_draft_id,
    chat_run_id: row.chat_run_id,
    chat_run_step_id: row.chat_run_step_id,
    // An agent run's step stays its run's on the credits (00419): its cap and share count it.
    agent_id: row.agent_id ?? null,
    agent_run_id: row.agent_run_id ?? null,
    parent_run_id: row.parent_run_id ?? null,
    own_key: false,
    used_at: row.used_at,
    cost_usd: dollars(p.micros),
    grant_id: p.grantId,
  });
  const [first, ...rest] = portions;
  const { error } = await supabaseAdmin
    .from('prompt_improve_usage')
    .update(
      included > 0
        ? { cost_usd: dollars(included) }
        : { cost_usd: dollars(first.micros), grant_id: first.grantId },
    )
    .eq('id', row.id);
  if (error) throw new Error(error.message);
  const parts = (included > 0 ? portions : rest).map(part);
  if (parts.length) {
    const { error: insertError } = await supabaseAdmin.from('prompt_improve_usage').insert(parts);
    if (insertError) throw new Error(insertError.message);
  }
}

/**
 * Settles a charged ledger row (`usageId`) on the credits: the part of its
 * cost past the period's included budget (`includedUsd`, over the period
 * from `since`) is drawn from the grants. Holds still in flight count as
 * included spend, so a call that crosses the line draws a little early
 * rather than late; a call whose included spend was already past it (a hold
 * kept at its worst case) carries that part too, up to its own cost. Never
 * throws: a draw that fails is logged and the row stays whole on the
 * included budget.
 */
export async function drawCredits(orgId, usageId, { includedUsd, since, now = new Date() }) {
  if (!chatAgenticEnabled(orgId) || !usageId || includedUsd == null || !since) return;
  try {
    const { data: grants, error } = await supabaseAdmin
      .from('ai_credit_grants')
      .select('id, usd_total, usd_used, expires_at')
      .eq('organization_id', orgId)
      .gt('expires_at', now.toISOString())
      .order('expires_at', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    const open = (grants ?? []).filter((g) => leftMicros(g) > 0);
    if (!open.length) return;

    const { data: row, error: rowError } = await supabaseAdmin
      .from('prompt_improve_usage')
      .select(ROW_COLUMNS)
      .eq('id', usageId)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row || row.own_key || row.grant_id) return;
    const cost = micros(row.cost_usd);
    if (cost <= 0) return;

    // A row held before the period began counted on the period that ended.
    if (new Date(row.used_at).getTime() < new Date(since).getTime()) return;

    // The period's spend (own-key rows left out) less what drew on grants
    // and this row: what the included budget has already paid for.
    const { data: byFeature, error: spendError } = await supabaseAdmin.rpc('ai_usage_by_feature', {
      p_organization_id: orgId,
      p_since: since,
    });
    if (spendError) throw new Error(spendError.message);
    const spent = (byFeature ?? []).reduce((sum, r) => sum + micros(r.cost_usd), 0);
    const includedSpent = spent - (await grantDrawnMicros(orgId, since)) - cost;
    const over = Math.min(cost, cost - Math.max(0, micros(includedUsd) - includedSpent));
    if (over <= 0) return;

    const portions = await takeFromGrants(open, over);
    if (portions.length) await splitRow(row, cost, portions);
  } catch (err) {
    logger.error({ err, orgId, usageId }, '[ai-credits] draw failed');
  }
}
