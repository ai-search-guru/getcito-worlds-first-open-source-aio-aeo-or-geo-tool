import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PlanFacts } from './planFacts';

/**
 * Chat's limits (CHAT-20 §14, CHAT-04 item 5), checked on the server before
 * and during a run: messages per person, runs at once per workspace and per
 * person, and what one run may read and change. Pure decisions over counts,
 * and the one read that gets the counts (chat_run_limits, 00406).
 */

/** Messages a person may send in an hour, then in a day. */
export const MESSAGES_PER_HOUR = 60;
export const MESSAGES_PER_DAY = 600;

/** Runs working at once per workspace, by plan (§14); extra runs wait as Queued. */
const WORKSPACE_RUNS: Record<string, number> = {
  trial: 2,
  starter: 3,
  growth: 10,
  enterprise: 30,
  self_hosted: 30,
};

/** Runs working at once per person (§14). */
export const RUNS_PER_USER = 5;

/** A workspace's concurrent runs on its plan: the trial's, whatever plan it tries. */
export function workspaceRunLimit(plan: Pick<PlanFacts, 'planId' | 'isTrial'>): number {
  if (plan.isTrial) return WORKSPACE_RUNS.trial;
  return WORKSPACE_RUNS[plan.planId] ?? WORKSPACE_RUNS.starter;
}

/** The counts a new message is checked against (chat_run_limits). */
export interface RunCounts {
  workspaceRunning: number;
  userRunning: number;
  messagesHour: number;
  messagesDay: number;
}

/**
 * Whether a new message may start a run: refused past the day's or the
 * hour's messages (rate_limited, §11a); otherwise it starts, or waits as
 * Queued when the workspace or the person has every slot busy.
 */
export type StartDecision =
  { kind: 'start' } | { kind: 'queue' } | { kind: 'refuse'; reason: 'hour' | 'day' };

export function startDecision(
  counts: RunCounts,
  plan: Pick<PlanFacts, 'planId' | 'isTrial'>,
): StartDecision {
  if (counts.messagesDay >= MESSAGES_PER_DAY) return { kind: 'refuse', reason: 'day' };
  if (counts.messagesHour >= MESSAGES_PER_HOUR) return { kind: 'refuse', reason: 'hour' };
  if (counts.workspaceRunning >= workspaceRunLimit(plan) || counts.userRunning >= RUNS_PER_USER) {
    return { kind: 'queue' };
  }
  return { kind: 'start' };
}

/** The run's effort (CHAT-16 §E): High doubles Normal's budgets, Max triples them (CHAT-04 item 5). */
export type ChatEffort = 'normal' | 'high' | 'max';

const EFFORT_SCALE: Record<ChatEffort, number> = { normal: 1, high: 2, max: 3 };

/** What one run may read: CHAT-04 item 5, in characters (about 4 to a token). */
export interface ReadBudget {
  /** Reads per run (Normal 6; an agent's run 10). */
  reads: number;
  /** One tool result, before the model sees it (Normal 3k tokens). */
  resultChars: number;
  /** All the data a run reads (Normal 12k tokens). */
  dataChars: number;
  /** The earlier messages of the chat sent with each step (Normal 6k tokens). */
  historyChars: number;
}

/**
 * An agent's run reads more (CHAT-21): its skills, up to three, each list
 * the reads their task needs ("What to read", 4 to 7 each), and a run that
 * stops reading before them answers without the change it was for (the
 * agents' test set, 2026-11-03: 19 of 20 runs used all 6 reads).
 */
export const AGENT_READS = 10;
const AGENT_DATA_CHARS = 80_000;

export function readBudget(
  effort: ChatEffort = 'normal',
  { agent = false }: { agent?: boolean } = {},
): ReadBudget {
  const scale = EFFORT_SCALE[effort] ?? 1;
  return {
    reads: (agent ? AGENT_READS : 6) * scale,
    resultChars: 12_000 * scale,
    dataChars: (agent ? AGENT_DATA_CHARS : 48_000) * scale,
    historyChars: 24_000 * scale,
  };
}

/**
 * WRITE caps per run (§14), by tool name; a write not named here gets
 * DEFAULT_WRITE_CAP. A batch row's cap counts its items (add_prompts: 50
 * prompts, add_competitors: 5 competitors), any other's its calls. Rows that
 * don't exist yet are named so they come capped.
 */
export const WRITE_CAPS: Readonly<Record<string, number>> = {
  add_prompts: 50,
  add_competitors: 5,
  // Prompts paused, as the row takes them (up to 50 a call, §9 row 22).
  pause_prompts: 50,
  create_action: 5,
  create_draft: 10,
  set_follow_up_check: 3,
};
export const DEFAULT_WRITE_CAP = 10;

export function writeCap(toolName: string): number {
  return WRITE_CAPS[toolName] ?? DEFAULT_WRITE_CAP;
}

/**
 * READ caps per run (§14), by tool name, on top of the read budget: pages
 * opened (fetch_page, CHAT-10 item 12), whatever the effort. A read not
 * named here has only the budget.
 */
export const READ_CAPS: Readonly<Record<string, number>> = {
  fetch_page: 10,
};

export function readCap(toolName: string): number | null {
  return READ_CAPS[toolName] ?? null;
}

/** Model steps one run may take before it answers with what it has. */
export const MAX_MODEL_STEPS = 16;

/** The counts for a person in their workspace, or null when they can't be read. */
export async function readRunCounts(
  organizationId: string,
  userId: string,
): Promise<RunCounts | null> {
  const { data, error } = await supabaseAdmin.rpc('chat_run_limits', {
    p_organization_id: organizationId,
    p_user_id: userId,
  });
  if (error || !data || typeof data !== 'object') {
    console.error('[chat/limits] could not read the run counts:', error?.message ?? data);
    return null;
  }
  const raw = data as Record<string, unknown>;
  const n = (key: string) => (typeof raw[key] === 'number' ? (raw[key] as number) : 0);
  return {
    workspaceRunning: n('workspaceRunning'),
    userRunning: n('userRunning'),
    messagesHour: n('messagesHour'),
    messagesDay: n('messagesDay'),
  };
}

/**
 * Starts a queued run when a slot is free (chat_claim_run_slot): true when
 * this call started it.
 */
export async function claimRunSlot(
  runId: string,
  plan: Pick<PlanFacts, 'planId' | 'isTrial'>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('chat_claim_run_slot', {
    p_run_id: runId,
    p_workspace_limit: workspaceRunLimit(plan),
    p_user_limit: RUNS_PER_USER,
  });
  if (error) {
    console.error('[chat/limits] could not claim a run slot:', error.message);
    return false;
  }
  return data === true;
}
