import { z } from 'zod';
import { readBrandAccess } from '@/lib/brandAccess';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';
import type { Json } from '@/types/supabase';
import {
  agentPlanLimits,
  agentTriggerSchema,
  versionFromRow,
  type AgentPlanLimits,
  type AgentTriggerInput,
  type AgentVersionData,
} from './agentRules';
import { startQueuedAgentRuns, type AgentRunDriver } from './agentRuns';
import { readAgentShares } from './agentShares';
import { nextScheduleFire } from './agentSchedule';
import { pauseAgentForSystem, runnableBrands } from './agents';
import { chatAgenticEnabled } from './flag';
import { ownKeyCapReached } from './ownKeyCap';
import { planFactsFromOrgRow, type OrgPlanRow, type PlanFacts } from './planFacts';

/**
 * What starts an agent by itself (CHAT-21 §E): its Schedule triggers, fired
 * by the server's minute cron through the web's internal endpoint, and its
 * Signal triggers, fired when Action Center's signal pass finds new signals
 * (the server's hook). A fire queues one run per brand of the agent's scope
 * that the fire is about, acting as the agent's owner (§H item 38), with
 * what fired it as the run's evidence (§E item 23); the agent run driver
 * then starts it when the workspace has room (§M). No model is called here.
 *
 * Noise control (§E item 24, approved as written, DECISIONS N.4), per agent
 * and brand:
 *   - a fire within 15 minutes of a triggered run still waiting joins it
 *     (its evidence is added), or, once that run started, is kept as
 *     skipped · coalesced;
 *   - an event (Signal) fires at most once per 6 hours: later fires are kept
 *     as skipped · cooldown;
 *   - an agent has at most the plan's event-triggered runs a day (UTC):
 *     more are kept as skipped · daily_limit;
 *   - at most 3 runs wait (§M item 58): more join the last.
 * Skipped fires since the agent's last run on the brand are listed in its
 * next run's evidence ("added to the next run").
 *
 * Only active agents fire, only in a workspace where Chat is on
 * (CHAT_AGENTIC) and that isn't read-only; an agent whose monthly cap is
 * used pauses (cap) instead. KPI and watch-rule triggers have no source to
 * read yet (Wave 2 cut, CHAT-22): they never fire. Server only.
 */

// ─── Rules ───────────────────────────────────────────────────────────────────

/** Fires this close to a waiting run join it (§E item 24). */
export const COALESCE_MS = 15 * 60_000;
/** An event trigger fires once per agent and brand in this time (§E item 24). */
export const COOLDOWN_MS = 6 * 60 * 60_000;
/**
 * A schedule's slot is fired up to this late (a minute the cron missed);
 * older ones are passed over: no catch-up (§G item 33).
 */
export const SCHEDULE_GRACE_MS = 60 * 60_000;
/** How far back the noise rules look at an agent's runs. */
const RECENT_MS = 24 * 60 * 60_000;
/** An agent's newest runs on a brand the noise rules read: far past 3 waiting and 50 kept fires. */
const RECENT_ROWS = 500;
/** Ids an `.in()` takes at once, and (agent, version) pairs an `.or()`: short URLs, under 1000 rows. */
const IN_CHUNK = 100;
const PAIR_CHUNK = 50;
/** Most fires one run's evidence lists, and most earlier fires. */
const MAX_FIRES = 50;
/** Most runs on a brand at once waiting to start (§M item 58). */
const MAX_WAITING = 3;

/** Triggers that start a run by themselves: they act as the agent's owner (§H item 38). */
const TRIGGERED_KINDS = ['schedule', 'signal', 'kpi', 'watch_rule'] as const;
/** Triggers that count toward the daily limit and the cooldown (§E item 24). */
const EVENT_KINDS = ['signal', 'kpi', 'watch_rule'] as const;

/** Whether a run's trigger started it by itself, not a person (Run now, Run agent). */
export const isTriggered = (kind: string) => (TRIGGERED_KINDS as readonly string[]).includes(kind);
const isEvent = (kind: string) => (EVENT_KINDS as readonly string[]).includes(kind);

// ─── Evidence ────────────────────────────────────────────────────────────────

/** One fire, as a run's evidence lists it (chat_agent_runs.evidence_json). */
const fireSchema = z.object({
  kind: z.enum(['schedule', 'signal', 'kpi', 'watch_rule']),
  /** What fired: a signal's id, a schedule's slot. */
  ref: z.string().max(200),
  at: z.string(),
  /** A signal's kind and its Action Center definitions. */
  signalKind: z.string().max(100).optional(),
  definitions: z.array(z.string().max(100)).max(20).optional(),
  /** A schedule's clock. */
  timezone: z.string().max(64).optional(),
  /** Why an earlier fire didn't run then. */
  skipped: z.enum(['coalesced', 'cooldown', 'daily_limit']).optional(),
});
export type AgentFire = z.infer<typeof fireSchema>;

const evidenceSchema = z.object({
  fires: z.array(fireSchema).max(MAX_FIRES).catch([]).default([]),
  earlier: z.array(fireSchema).max(MAX_FIRES).catch([]).default([]),
});
export type AgentEvidence = z.infer<typeof evidenceSchema>;

/** A run's evidence as stored, read defensively: what doesn't read is left out. */
export function evidenceOf(json: unknown): AgentEvidence {
  const parsed = evidenceSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : { fires: [], earlier: [] };
}

// ─── Workspaces ──────────────────────────────────────────────────────────────

export interface ArmedOrg {
  plan: PlanFacts;
  limits: AgentPlanLimits;
}

/**
 * The workspaces whose agents may run now: Chat on for them (CHAT_AGENTIC,
 * CHAT_AGENTIC_ORGS) and a plan that isn't read-only (read-only after the
 * trial: nothing runs). By organization id.
 */
export async function readArmedOrgs(orgIds: readonly string[]): Promise<Map<string, ArmedOrg>> {
  const armed = new Map<string, ArmedOrg>();
  const wanted = [...new Set(orgIds)].filter((id) => chatAgenticEnabled(id));
  if (wanted.length === 0) return armed;
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select(`id, ${ORG_PLAN_COLUMNS}`)
    .in('id', wanted);
  if (error) throw new Error(`Could not read the workspaces' plans: ${error.message}`);
  for (const row of (data ?? []) as unknown as ({ id: string } & NonNullable<OrgPlanRow>)[]) {
    const plan = planFactsFromOrgRow(row);
    if (plan.writable) armed.set(row.id, { plan, limits: agentPlanLimits(plan) });
  }
  return armed;
}

// ─── Agents a trigger may fire ───────────────────────────────────────────────

interface TriggerRow {
  id: string;
  agent_id: string;
  kind: string;
  config_json: Json;
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
}

/** An active agent, with what a fire needs: its owner, version and caps. */
export interface FiringAgent {
  id: string;
  organizationId: string;
  ownerId: string | null;
  version: number;
  maxRunShare: number;
  maxMonthShare: number | null;
  activatedAt: string | null;
  data: AgentVersionData;
}

/** A list in slices of `size`. */
function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type VersionRow = Parameters<typeof versionFromRow>[0] & { agent_id: string; version: number };

/**
 * The active agents among `ids`, with their current versions; by id. Read
 * in slices, and only each agent's current version (its (agent, version)
 * pair), so no read passes PostgREST's 1000 rows however many agents or
 * versions there are.
 */
async function activeAgents(ids: readonly string[]): Promise<Map<string, FiringAgent>> {
  const agents = new Map<string, FiringAgent>();
  const rows: {
    id: string;
    organization_id: string;
    owner_id: string | null;
    version: number;
    max_run_share: number;
    max_month_share: number | null;
    activated_at: string | null;
  }[] = [];
  for (const slice of chunks([...new Set(ids)], IN_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('chat_agents')
      .select(
        'id, organization_id, owner_id, version, max_run_share, max_month_share, activated_at',
      )
      .in('id', slice)
      .eq('status', 'active');
    if (error) throw new Error(`Could not read the agents: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
  }
  const byKey = new Map<string, VersionRow>();
  for (const slice of chunks(rows, PAIR_CHUNK)) {
    const { data, error } = await supabaseAdmin
      .from('chat_agent_versions')
      .select(
        'agent_id, version, skill_ids, instructions, mode, connections, model, effort, scope, notify_user_ids, followup_days',
      )
      .or(slice.map((r) => `and(agent_id.eq.${r.id},version.eq.${r.version})`).join(','));
    if (error) throw new Error(`Could not read the agents: ${error.message}`);
    for (const v of (data ?? []) as VersionRow[]) byKey.set(`${v.agent_id}:${v.version}`, v);
  }
  for (const row of rows) {
    const version = byKey.get(`${row.id}:${row.version}`);
    if (!version) continue;
    agents.set(row.id, {
      id: row.id,
      organizationId: row.organization_id,
      ownerId: row.owner_id,
      version: row.version,
      maxRunShare: Number(row.max_run_share),
      maxMonthShare: row.max_month_share === null ? null : Number(row.max_month_share),
      activatedAt: row.activated_at,
      data: versionFromRow(version),
    });
  }
  return agents;
}

/**
 * Enabled triggers of a kind, every one (in pages of PostgREST's 1000, by
 * id; the agents named in slices), read as their inputs: a row that
 * doesn't read is left out.
 */
async function enabledTriggers(
  kind: 'schedule' | 'signal',
  agentIds?: readonly string[],
): Promise<(TriggerRow & { input: AgentTriggerInput })[]> {
  const page = (slice: string[] | null) =>
    readAllRpcRows<TriggerRow>((from, to) => {
      let query = supabaseAdmin
        .from('chat_agent_triggers')
        .select('id, agent_id, kind, config_json, enabled, last_fired_at, created_at')
        .eq('kind', kind)
        .eq('enabled', true);
      if (slice) query = query.in('agent_id', slice);
      return query.order('id', { ascending: true }).range(from, to) as unknown as PromiseLike<{
        data: TriggerRow[] | null;
        error: { message: string } | null;
      }>;
    });
  let rows: TriggerRow[];
  try {
    rows = agentIds
      ? (await Promise.all(chunks([...new Set(agentIds)], IN_CHUNK).map(page))).flat()
      : await page(null);
  } catch (err) {
    throw new Error(`Could not read the agents' triggers: ${(err as Error).message}`);
  }
  return rows.flatMap((row) => {
    const parsed = agentTriggerSchema.safeParse({
      kind: row.kind,
      config: row.config_json,
      enabled: row.enabled,
    });
    return parsed.success ? [{ ...row, input: parsed.data }] : [];
  });
}

/**
 * Whether all agents reached the month's limit on the workspace's own key
 * (AGENT-OWN-KEY §4.2): the firing agent pauses (own_key_cap) and its runs
 * aren't queued; it starts again by itself once the period renews or an
 * Admin raises the limit (the sweep). A guard that can't be read lets it
 * fire: each run stays within its own cap.
 */
async function keyCapUsed(agent: FiringAgent): Promise<boolean> {
  if (!(await ownKeyCapReached(agent.organizationId))) return false;
  await pauseAgentForSystem(agent.organizationId, agent.id, 'own_key_cap');
  return true;
}

/**
 * Whether the agent's monthly cap (CHAT-27 item 23) is used: its share this
 * period, own-key steps included, at or past it. The agent pauses (cap)
 * until the next period then; it resumes by itself (the sweep). Shares
 * that can't be read let it fire: each step is held on the budget anyway.
 */
async function monthCapUsed(agent: FiringAgent): Promise<boolean> {
  if (!(await agentMonthCapReached(agent.organizationId, agent.id, agent.maxMonthShare))) {
    return false;
  }
  await pauseAgentForSystem(agent.organizationId, agent.id, 'cap');
  return true;
}

/**
 * Whether an agent's monthly cap (max_month_share; null: none) is used this
 * period, own-key steps included. Read on a fire, and again before every
 * run starts, Run now's too (agentDriver.ts). Shares that can't be read
 * answer false: each step is held on the budget anyway.
 */
export async function agentMonthCapReached(
  organizationId: string,
  agentId: string,
  maxMonthShare: number | null,
): Promise<boolean> {
  if (maxMonthShare === null) return false;
  const shares = await readAgentShares(organizationId, 'period');
  const mine = shares?.byAgent.get(agentId);
  if (!mine) return false;
  // A hair under counts as reached: 0.18 + 0.02 is 0.19999… in floating point.
  return mine.share + mine.ownKeyShare >= Number(maxMonthShare) - 1e-9;
}

// ─── Queuing a fire ──────────────────────────────────────────────────────────

/** What a fire on one brand came to (agent.trigger.fired's outcome, CHAT-21 Events). */
export type FireOutcome =
  | { kind: 'queued'; runId: string }
  | { kind: 'coalesced'; runId: string | null }
  | { kind: 'skipped'; reason: 'cooldown' | 'daily_limit' };

interface RecentRun {
  id: string;
  brand_id: string | null;
  trigger_kind: string;
  status: string;
  skipped_reason: string | null;
  queued_at: string;
  evidence_json: Json;
}

/** The start of `now`'s day in UTC: the daily limit's day. */
const dayStart = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

/**
 * Queues one brand's run for a fire, or keeps the fire as joined or skipped
 * by the noise rules (above). The run acts as the agent's owner, at the
 * agent's per-run cap. Answers what it came to.
 */
export async function queueTriggeredRun(
  agent: FiringAgent,
  brandId: string,
  trigger: { id: string; kind: AgentFire['kind'] },
  fires: AgentFire[],
  limits: AgentPlanLimits,
  now: Date,
): Promise<FireOutcome> {
  const nowMs = now.getTime();
  // The agent's newest runs on this brand, newest first, then in fire order.
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select('id, brand_id, trigger_kind, status, skipped_reason, queued_at, evidence_json')
    .eq('agent_id', agent.id)
    .eq('brand_id', brandId)
    .gt('queued_at', new Date(nowMs - RECENT_MS).toISOString())
    .order('queued_at', { ascending: false })
    .limit(RECENT_ROWS);
  if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
  const onBrand = ((data ?? []) as RecentRun[]).reverse();
  const age = (r: RecentRun) => nowMs - Date.parse(r.queued_at);
  const ref = fires[0]?.ref ?? trigger.kind;

  const keep = async (
    reason: 'coalesced' | 'cooldown' | 'daily_limit',
    into: RecentRun | null,
  ): Promise<void> => {
    const { error: keepError } = await supabaseAdmin.from('chat_agent_runs').insert({
      organization_id: agent.organizationId,
      agent_id: agent.id,
      agent_version: agent.version,
      brand_id: brandId,
      trigger_kind: trigger.kind,
      trigger_id: trigger.id,
      trigger_ref: ref.slice(0, 200),
      acting_user_id: agent.ownerId,
      status: 'skipped',
      skipped_reason: reason,
      evidence_json: { fires, ...(into ? { coalescedInto: into.id } : {}) } as unknown as Json,
      max_share: agent.maxRunShare,
      queued_at: now.toISOString(),
      finished_at: now.toISOString(),
    });
    if (keepError) throw new Error(`Could not keep the agent's fire: ${keepError.message}`);
  };

  // A triggered run still waiting, fired in the last 15 minutes: this fire joins it.
  const waiting = onBrand.filter((r) => r.status === 'queued');
  const joinable = waiting.filter((r) => isTriggered(r.trigger_kind) && age(r) < COALESCE_MS);
  // Past the 3 waiting, a fire joins the last (§M item 58).
  const target = joinable.at(-1) ?? (waiting.length >= MAX_WAITING ? waiting.at(-1) : undefined);
  if (target) {
    const evidence = evidenceOf(target.evidence_json);
    const merged = { ...evidence, fires: [...evidence.fires, ...fires].slice(0, MAX_FIRES) };
    const { error: mergeError } = await supabaseAdmin
      .from('chat_agent_runs')
      .update({ evidence_json: merged as unknown as Json })
      .eq('id', target.id)
      .eq('status', 'queued');
    if (mergeError) throw new Error(`Could not add to the agent's run: ${mergeError.message}`);
    await keep('coalesced', target);
    return { kind: 'coalesced', runId: target.id };
  }
  // A triggered run that started in the last 15 minutes: the fire is part of its burst.
  const started = onBrand.find(
    (r) =>
      isTriggered(r.trigger_kind) &&
      ['running', 'needs_you', 'paused_cap'].includes(r.status) &&
      age(r) < COALESCE_MS,
  );
  if (started) {
    await keep('coalesced', started);
    return { kind: 'coalesced', runId: started.id };
  }

  if (isEvent(trigger.kind)) {
    const ran = (r: RecentRun) => isEvent(r.trigger_kind) && r.status !== 'skipped';
    // The agent's event runs today (UTC), every brand: counted, not read.
    const { count: todays, error: countError } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', agent.id)
      .in('trigger_kind', [...EVENT_KINDS])
      .neq('status', 'skipped')
      .gte('queued_at', new Date(dayStart(now)).toISOString());
    if (countError) throw new Error(`Could not count the agent's runs: ${countError.message}`);
    if ((todays ?? 0) >= limits.eventRunsPerDay) {
      await keep('daily_limit', null);
      return { kind: 'skipped', reason: 'daily_limit' };
    }
    if (onBrand.some((r) => ran(r) && age(r) < COOLDOWN_MS)) {
      await keep('cooldown', null);
      return { kind: 'skipped', reason: 'cooldown' };
    }
  }

  // The fires kept since the agent's last run on this brand go with this one.
  const lastRun = onBrand.filter((r) => r.status !== 'skipped').at(-1);
  const earlier = onBrand
    .filter(
      (r) =>
        r.status === 'skipped' &&
        r.skipped_reason !== 'coalesced' &&
        (!lastRun || Date.parse(r.queued_at) > Date.parse(lastRun.queued_at)),
    )
    .flatMap((r) =>
      evidenceOf(r.evidence_json).fires.map((f) => ({
        ...f,
        skipped: r.skipped_reason as 'cooldown' | 'daily_limit',
      })),
    )
    .slice(-MAX_FIRES);
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('chat_agent_runs')
    .insert({
      organization_id: agent.organizationId,
      agent_id: agent.id,
      agent_version: agent.version,
      brand_id: brandId,
      trigger_kind: trigger.kind,
      trigger_id: trigger.id,
      trigger_ref: ref.slice(0, 200),
      acting_user_id: agent.ownerId,
      status: 'queued',
      evidence_json: { fires, earlier } as unknown as Json,
      max_share: agent.maxRunShare,
      queued_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    throw new Error(`Could not queue the agent's run: ${insertError?.message ?? 'no row'}`);
  }
  return { kind: 'queued', runId: (inserted as { id: string }).id };
}

/** Marks a trigger fired; an event trigger's cooldown runs from now (§E item 24). */
async function markFired(triggerId: string, kind: string, now: Date): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_agent_triggers')
    .update({
      last_fired_at: now.toISOString(),
      ...(isEvent(kind)
        ? { cooldown_until: new Date(now.getTime() + COOLDOWN_MS).toISOString() }
        : {}),
    })
    .eq('id', triggerId);
  if (error) console.error('[chat/agents] could not mark a trigger fired:', error);
}

/** What a round of fires did, for the cron's log; `failed`: triggers or brands that failed, the rest went on. */
export interface FireCounts {
  fired: number;
  queued: number;
  coalesced: number;
  skipped: number;
  failed: number;
}

const noFires = (): FireCounts => ({ fired: 0, queued: 0, coalesced: 0, skipped: 0, failed: 0 });

/**
 * The brands a fire queues runs on: its scope's that the owner may use now,
 * since a triggered run acts as them (all_brands is all of theirs,
 * BRAND-ACCESS §5.3); the run checks again when it starts. When its scope
 * still has brands but the owner may use none of them, nothing is queued
 * and the agent pauses, as for brands gone (brand_gone). An agent with no
 * owner, or one no longer in the workspace, queues on its scope's brands as
 * before: its run stops before it starts and pauses it (owner_role).
 */
async function fireBrands(agent: FiringAgent): Promise<{ id: string; name: string }[]> {
  const access = agent.ownerId
    ? ((await readBrandAccess(agent.ownerId, agent.organizationId)) ?? 'all')
    : 'all';
  const brands = await runnableBrands(agent.organizationId, agent.data.scope, access);
  if (
    brands.length === 0 &&
    access !== 'all' &&
    (await runnableBrands(agent.organizationId, agent.data.scope, 'all')).length > 0
  ) {
    await pauseAgentForSystem(agent.organizationId, agent.id, 'brand_gone');
  }
  return brands;
}

/**
 * Queues a fire on each brand, one brand's failure apart from the others':
 * it is logged and counted. Answers whether any brand's run was queued.
 */
async function queueOnBrands(
  agent: FiringAgent,
  brandIds: readonly string[],
  trigger: { id: string; kind: AgentFire['kind'] },
  fires: AgentFire[],
  limits: AgentPlanLimits,
  now: Date,
  counts: FireCounts,
): Promise<boolean> {
  let queued = false;
  for (const brandId of brandIds) {
    try {
      const outcome = await queueTriggeredRun(agent, brandId, trigger, fires, limits, now);
      count(counts, outcome);
      queued ||= outcome.kind === 'queued';
    } catch (err) {
      counts.failed += 1;
      console.error('[chat/agents] a fire failed on a brand:', err);
    }
  }
  return queued;
}

function count(counts: FireCounts, outcome: FireOutcome) {
  if (outcome.kind === 'queued') counts.queued += 1;
  else if (outcome.kind === 'coalesced') counts.coalesced += 1;
  else counts.skipped += 1;
}

// ─── Schedules ───────────────────────────────────────────────────────────────

/**
 * The slot a Schedule trigger is due for at `now`, or null: the first after
 * its last fire (or its creation, or the agent's last Resume: no catch-up),
 * at most SCHEDULE_GRACE_MS late, and not after now. Pure.
 */
export function dueSlot(
  config: unknown,
  {
    lastFiredAt,
    createdAt,
    activatedAt,
  }: {
    lastFiredAt: string | null;
    createdAt: string;
    activatedAt: string | null;
  },
  now: Date,
): string | null {
  const from = Math.max(
    Date.parse(lastFiredAt ?? createdAt) || 0,
    activatedAt ? Date.parse(activatedAt) || 0 : 0,
    now.getTime() - SCHEDULE_GRACE_MS,
  );
  const slot = nextScheduleFire(config, new Date(from));
  return slot && Date.parse(slot) <= now.getTime() ? slot : null;
}

/**
 * Fires every Schedule trigger that is due (the server's minute cron): one
 * run per brand of the agent's scope, acting as its owner. A trigger is
 * claimed by moving its last fire from what was read to now, so two crons
 * at once fire it once. Then the workspaces with new runs start what they
 * have room for.
 */
export async function fireDueSchedules(
  now: Date,
  driver: AgentRunDriver | null,
): Promise<FireCounts> {
  const counts = noFires();
  const triggers = await enabledTriggers('schedule');
  if (triggers.length === 0) return counts;
  const agents = await activeAgents(triggers.map((t) => t.agent_id));
  const armed = await readArmedOrgs([...agents.values()].map((a) => a.organizationId));
  const touched = new Set<string>();

  for (const trigger of triggers) {
    const agent = agents.get(trigger.agent_id);
    const org = agent && armed.get(agent.organizationId);
    if (!agent || !org || trigger.input.kind !== 'schedule') continue;
    try {
      if (await fireSchedule(trigger, agent, org, now, counts)) touched.add(agent.organizationId);
    } catch (err) {
      counts.failed += 1;
      console.error('[chat/agents] a schedule failed:', err);
    }
  }
  for (const orgId of touched) {
    try {
      await startQueuedAgentRuns(orgId, armed.get(orgId)!.limits.runsAtOnce, driver);
    } catch (err) {
      console.error('[chat/agents] could not start a workspace’s runs:', err);
    }
  }
  return counts;
}

/** One due Schedule trigger, claimed, then queued on each brand of its scope. */
async function fireSchedule(
  trigger: TriggerRow & { input: AgentTriggerInput },
  agent: FiringAgent,
  org: ArmedOrg,
  now: Date,
  counts: FireCounts,
): Promise<boolean> {
  if (trigger.input.kind !== 'schedule') return false;
  const slot = dueSlot(
    trigger.config_json,
    {
      lastFiredAt: trigger.last_fired_at,
      createdAt: trigger.created_at,
      activatedAt: agent.activatedAt,
    },
    now,
  );
  if (!slot) return false;

  // Claim it: only the cron that moves its last fire from what it read fires it.
  let claim = supabaseAdmin
    .from('chat_agent_triggers')
    .update({ last_fired_at: now.toISOString() })
    .eq('id', trigger.id);
  claim = trigger.last_fired_at
    ? claim.eq('last_fired_at', trigger.last_fired_at)
    : claim.is('last_fired_at', null);
  const { data: claimed, error } = await claim.select('id');
  if (error) throw new Error(`Could not claim a schedule: ${error.message}`);
  if ((claimed ?? []).length === 0) return false;
  counts.fired += 1;

  if ((await keyCapUsed(agent)) || (await monthCapUsed(agent))) return false;
  const config = trigger.input.config;
  const fire: AgentFire = {
    kind: 'schedule',
    ref: `schedule:${slot}`,
    at: now.toISOString(),
    ...(config.type === 'recurring' ? { timezone: config.timezone } : {}),
  };
  const brands = await fireBrands(agent);
  // Claimed: a brand that fails doesn't stop the others.
  return queueOnBrands(
    agent,
    brands.map((b) => b.id),
    { id: trigger.id, kind: 'schedule' },
    [fire],
    org.limits,
    now,
    counts,
  );
}

// ─── Signals ─────────────────────────────────────────────────────────────────

/**
 * A new signal as the server's signal pass reports it: its kind, the
 * Action Center definitions it feeds (with their categories), and the
 * entities it names, for a trigger's filter.
 */
export const firedSignalSchema = z.strictObject({
  id: z.guid(),
  kind: z.string().trim().min(1).max(100),
  definitions: z
    .array(
      z.strictObject({
        id: z.string().trim().min(1).max(100),
        category: z.string().trim().min(1).max(40),
      }),
    )
    .max(20),
  urls: z.array(z.string().trim().max(2048)).max(50).default([]),
  engines: z.array(z.string().trim().max(100)).max(50).default([]),
});
export type FiredSignal = z.infer<typeof firedSignalSchema>;

export const signalBatchSchema = z.strictObject({
  brandId: z.guid(),
  signals: z.array(firedSignalSchema).min(1).max(200),
});

/**
 * An address as compared: lower-case, without its scheme, www., query or
 * trailing slash; and its path alone, for a signal that names a page by
 * its path ("/pricing").
 */
function urlParts(url: string): { full: string | null; path: string } {
  const bare = url
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '');
  const trim = (path: string) => path.replace(/\/+$/, '') || '/';
  if (bare.startsWith('/')) return { full: null, path: trim(bare) };
  const host = bare.replace(/^https?:\/\//, '').replace(/^www\./, '');
  const slash = host.indexOf('/');
  return { full: trim(host), path: slash === -1 ? '/' : trim(host.slice(slash)) };
}

/** Whether two addresses are the same page: whole when both are, else by path. */
function samePage(a: string, b: string): boolean {
  const x = urlParts(a);
  const y = urlParts(b);
  return x.full && y.full ? x.full === y.full : x.path === y.path;
}

/**
 * Whether a Signal trigger's settings match a signal (§E item 22): a
 * definition of the trigger's category feeds it (one of its definitions,
 * when it names some), and it names an entity of each filter the trigger
 * sets. Prompt tags aren't kept on prompts yet, so a filter on them
 * matches nothing. Pure.
 */
export function signalMatches(
  config: Extract<AgentTriggerInput, { kind: 'signal' }>['config'],
  signal: FiredSignal,
): boolean {
  const feeds = signal.definitions.filter((d) => d.category === config.category);
  if (feeds.length === 0) return false;
  if (config.definition_ids && !feeds.some((d) => config.definition_ids!.includes(d.id))) {
    return false;
  }
  const filter = config.entity_filter;
  if (!filter) return true;
  if (filter.prompt_tags) return false;
  if (filter.urls && !signal.urls.some((url) => filter.urls!.some((want) => samePage(url, want)))) {
    return false;
  }
  if (filter.engines && !signal.engines.some((e) => filter.engines!.includes(e))) return false;
  return true;
}

/**
 * Fires the Signal triggers new signals on a brand match (the server's
 * hook after its signal pass): for each active agent whose scope has the
 * brand, every enabled Signal trigger with a match fires once with all its
 * matching signals as evidence. Then the workspace starts what it has room
 * for.
 */
export async function fireSignals(
  batch: z.infer<typeof signalBatchSchema>,
  now: Date,
  driver: AgentRunDriver | null,
): Promise<FireCounts> {
  const counts = noFires();
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('id, organization_id, is_demo')
    .eq('id', batch.brandId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the brand: ${error.message}`);
  const brandRow = brand as { id: string; organization_id: string; is_demo: boolean } | null;
  if (!brandRow || brandRow.is_demo) return counts;
  const org = (await readArmedOrgs([brandRow.organization_id])).get(brandRow.organization_id);
  if (!org) return counts;

  let ids: string[];
  try {
    ids = (
      await readAllRpcRows<{ id: string }>(
        (from, to) =>
          supabaseAdmin
            .from('chat_agents')
            .select('id')
            .eq('organization_id', brandRow.organization_id)
            .eq('status', 'active')
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: { id: string }[] | null;
            error: { message: string } | null;
          }>,
      )
    ).map((a) => a.id);
  } catch (err) {
    throw new Error(`Could not read the agents: ${(err as Error).message}`);
  }
  if (ids.length === 0) return counts;
  const triggers = await enabledTriggers('signal', ids);
  if (triggers.length === 0) return counts;
  const agents = await activeAgents(triggers.map((t) => t.agent_id));

  let queued = false;
  for (const trigger of triggers) {
    const agent = agents.get(trigger.agent_id);
    if (!agent || trigger.input.kind !== 'signal') continue;
    const config = trigger.input.config;
    const matched = batch.signals.filter((signal) => signalMatches(config, signal));
    if (matched.length === 0) continue;
    // One trigger's failure is its own: the others still fire.
    try {
      const brands = await fireBrands(agent);
      if (!brands.some((b) => b.id === brandRow.id)) continue;
      counts.fired += 1;
      if ((await keyCapUsed(agent)) || (await monthCapUsed(agent))) continue;
      const fires: AgentFire[] = matched.slice(0, MAX_FIRES).map((signal) => ({
        kind: 'signal',
        ref: signal.id,
        at: now.toISOString(),
        signalKind: signal.kind,
        definitions: signal.definitions
          .filter((d) => d.category === config.category)
          .map((d) => d.id),
      }));
      const outcome = await queueTriggeredRun(
        agent,
        brandRow.id,
        { id: trigger.id, kind: 'signal' },
        fires,
        org.limits,
        now,
      );
      count(counts, outcome);
      if (outcome.kind === 'queued') {
        queued = true;
        await markFired(trigger.id, 'signal', now);
      }
    } catch (err) {
      counts.failed += 1;
      console.error('[chat/agents] a signal trigger failed:', err);
    }
  }
  if (queued) {
    try {
      await startQueuedAgentRuns(brandRow.organization_id, org.limits.runsAtOnce, driver);
    } catch (err) {
      console.error('[chat/agents] could not start a workspace’s runs:', err);
    }
  }
  return counts;
}
