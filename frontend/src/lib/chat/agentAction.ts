import { createTranslator } from 'next-intl';
import { z } from 'zod';
import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { actionTexts, taskText } from '@/lib/action-center/display';
import {
  currentTaskParams,
  readEntityCounts,
  withEntityCounts,
} from '@/lib/action-center/entityCounts';
import {
  ACTION_CATEGORIES,
  OPEN_ACTION_STATUSES,
  UNCOUNTED_TASK_STATUSES,
  type ActionCategory,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import type { ChatMode } from './precedence';
import {
  refused,
  runnableAgents,
  type AgentContext,
  type AgentResult,
  type LoadedAgent,
} from './agents';

/**
 * Run agent on an Action Center action (CHAT-21 §F, CHAT-09 item 21b;
 * governance mockup #g-run-agent): what the picker lists, the action a run
 * is scoped to, and the action's History events. The Action Center engine
 * doesn't change (CHAT-09 guardrail): it is read here, and written only as
 * History events (action_events), the one write into Action Center a run
 * makes (§F item 31). Server only.
 *
 * A run on an action keeps the action as it was when the person asked
 * (§F item 28: its number, title, category and open tasks), in its
 * evidence (chat_agent_runs.evidence_json.action), and reads the rest
 * through Chat's Action Center reads (get_action). It never widens the
 * action's targets: no Chat tool edits them.
 */

const textsT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTexts' });
const tasksT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTasks' });
const categoriesT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'actionCenter.actionCategories',
});

/** The plain (key, values) translator display.ts's helpers take. */
const plain =
  (t: (key: never, values?: never) => string) =>
  (key: string, values?: Record<string, string | number>) =>
    t(key as never, values as never);

/** Open tasks a snapshot keeps at most, and the longest title. */
const SNAPSHOT_TASKS = 20;
const TITLE_MAX = 300;

// ─── The action a run is scoped to ───────────────────────────────────────────

/** The action as the person asked for the run on it: kept with the run (§F item 28). */
export const actionSnapshotSchema = z.object({
  id: z.guid(),
  no: z.number().int().positive(),
  title: z.string().max(TITLE_MAX),
  category: z.enum(ACTION_CATEGORIES as [ActionCategory, ...ActionCategory[]]),
  kind: z.string().max(100),
  /** When it was kept, ISO. */
  at: z.string().max(40),
  /** Its open tasks then, in order. */
  tasks: z.array(z.string().max(TITLE_MAX)).max(SNAPSHOT_TASKS),
});
export type ActionSnapshot = z.infer<typeof actionSnapshotSchema>;

/** A run's action, from its evidence as stored; null for a run not on an action, or one that doesn't read. */
export function actionScopeOf(evidence: unknown): ActionSnapshot | null {
  if (!evidence || typeof evidence !== 'object') return null;
  const parsed = actionSnapshotSchema.safeParse((evidence as { action?: unknown }).action);
  return parsed.success ? parsed.data : null;
}

/** "Recover" — the category's name, for the run's message. */
export const categoryName = (category: ActionCategory) => categoriesT(category);

interface ActionRow {
  id: string;
  action_no: number;
  brand_id: string;
  category: ActionCategory;
  kind: string;
  status: ActionStatus;
  payload: Record<string, unknown> | null;
  deleted_at: string | null;
}

/** An action a run may be scoped to, with its brand. */
export interface ActionForRun {
  snapshot: ActionSnapshot;
  brand: { id: string; name: string };
}

/**
 * The action as a run on it starts from: in the person's workspace and
 * brands (one they can't see isn't found), not deleted, open (new, in
 * progress or on hold: a closed one is refused, edge case 7), and not on
 * the demo brand (its sample data takes no runs). Its title and open tasks
 * as the Action Center names them, in English.
 */
export async function readActionForRun(
  ctx: AgentContext,
  actionId: string,
  now = new Date(),
): Promise<AgentResult<ActionForRun>> {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, action_no, brand_id, category, kind, status, payload, deleted_at')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the action: ${error.message}`);
  const row = data as ActionRow | null;
  if (!row || row.deleted_at) return refused('action_not_found');
  const { data: brandRow, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('id, name, is_demo, organization_id')
    .eq('id', row.brand_id)
    .maybeSingle();
  if (brandError) throw new Error(`Could not read the action's brand: ${brandError.message}`);
  const brand = brandRow as {
    id: string;
    name: string;
    is_demo: boolean | null;
    organization_id: string;
  } | null;
  const access = ctx.viewer.brandAccess;
  if (
    !brand ||
    brand.organization_id !== ctx.actor.organizationId ||
    (access !== 'all' && !access.includes(brand.id))
  ) {
    return refused('action_not_found');
  }
  if (brand.is_demo) return refused('demo_brand');
  if (!OPEN_ACTION_STATUSES.includes(row.status)) return refused('action_closed');

  const [counts, tasksRes] = await Promise.all([
    readEntityCounts(supabaseAdmin, [row.id]),
    supabaseAdmin
      .from('action_tasks')
      .select('task_key, title, title_params, status, position')
      .eq('action_id', row.id)
      .order('position'),
  ]);
  if (tasksRes.error)
    throw new Error(`Could not read the action's tasks: ${tasksRes.error.message}`);
  // Named as the list names it: with what is left of its targets (AC-009).
  const payload = withEntityCounts(row.payload ?? {}, counts.get(row.id));
  const title = actionTexts({ kind: row.kind, payload }, plain(textsT)).title;
  const tasks = (
    (tasksRes.data ?? []) as {
      task_key: string | null;
      title: string | null;
      title_params: Record<string, string | number> | null;
      status: TaskStatus;
    }[]
  )
    .filter((task) => task.status !== 'completed' && !UNCOUNTED_TASK_STATUSES.includes(task.status))
    .map((task) =>
      taskText(
        {
          taskKey: task.task_key,
          title: task.title,
          titleParams:
            currentTaskParams(task.title_params ?? {}, payload) ?? task.title_params ?? {},
        },
        plain(tasksT),
      ).slice(0, TITLE_MAX),
    )
    .filter(Boolean)
    .slice(0, SNAPSHOT_TASKS);

  return {
    ok: true,
    value: {
      snapshot: {
        id: row.id,
        no: Number(row.action_no),
        title: title.slice(0, TITLE_MAX),
        category: row.category,
        kind: row.kind,
        at: now.toISOString(),
        tasks,
      },
      brand: { id: brand.id, name: brand.name },
    },
  };
}

/** Whether the action is closed now (completed, dismissed, deleted or gone): its run stops (edge case 7). */
export async function actionClosed(actionId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('status, deleted_at')
    .eq('id', actionId)
    .maybeSingle();
  // A read that fails keeps the run going: the next sweep reads it again.
  if (error) {
    console.error('[chat/agents] could not read a run’s action:', error);
    return false;
  }
  const row = data as { status: ActionStatus; deleted_at: string | null } | null;
  return !row || !!row.deleted_at || !OPEN_ACTION_STATUSES.includes(row.status);
}

// ─── History events ──────────────────────────────────────────────────────────

/** The History events a run on an action writes (§F item 31; CHAT-09 owner decision 2026-10-31). */
export type ActionRunEvent = 'agent_run_started' | 'agent_run_completed' | 'chat_started';

/**
 * Writes one of the action's History events, as the person the run acts as
 * (actor_id), tagged `source: chat` (CHAT-20 §10a). Best-effort, as the
 * Action Center's own trail: a missing line never fails the run it records.
 */
export async function logActionRunEvent(
  actionId: string,
  event: ActionRunEvent,
  data: Record<string, string | null>,
  actorId: string | null,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('action_events')
      .insert({ action_id: actionId, event, data: { source: 'chat', ...data }, actor_id: actorId });
    if (error) console.error('[chat/agents] could not write an action’s History:', error.message);
  } catch (err) {
    console.error('[chat/agents] could not write an action’s History:', err);
  }
}

// ─── The picker ──────────────────────────────────────────────────────────────

/**
 * The skill an agent for a kind of action starts from ("Create an agent for
 * this kind of action", §D item 15): the GetCito skill whose work fits the
 * category (W2-15's catalog), `/tasks` for any other.
 */
export const ACTION_CATEGORY_SKILL: Record<ActionCategory, string> = {
  recover: 'winback',
  compete: 'beat',
  growth: 'faq',
  protect: 'refresh',
  fix: 'quality',
};

/** One agent in the picker. */
export interface CompatibleAgent {
  /** Its handle for the run route. */
  id: string;
  name: string;
  status: 'active' | 'paused';
  /** In order: the primary first, without the slash. */
  skills: string[];
  mode: ChatMode;
  /** Its last run on an action of this category, ISO; null when none. */
  usedOnCategoryAt: string | null;
}

export interface CompatibleAgents {
  action: { no: number; category: ActionCategory };
  agents: CompatibleAgent[];
  /** The skill "Create an agent for this kind of action" starts from. */
  createSkill: string;
}

/** Runs read for "last use on this category": the newest on actions. */
const USE_ROWS = 500;

/** Whether an agent's scope covers a brand. */
const covers = (agent: LoadedAgent, brandId: string) =>
  !!agent.version &&
  (agent.version.scope.all_brands === true ||
    (agent.version.scope.brand_ids ?? []).includes(brandId));

/**
 * The agents the person may run on the action (§F item 27): ones they may
 * run whose scope covers its brand, sorted by their last run on an action
 * of its category, then the ones whose skills fit it, then by name. The
 * person must be able to run agents (Admins and Managers, §K item 51);
 * the routes check that first.
 */
export async function compatibleAgents(
  ctx: AgentContext,
  actionId: string,
  now = new Date(),
): Promise<AgentResult<CompatibleAgents>> {
  const action = await readActionForRun(ctx, actionId, now);
  if (!action.ok) return action;
  const { snapshot, brand } = action.value;
  const agents = (await runnableAgents(ctx)).filter((agent) => covers(agent, brand.id));

  // Each agent's last run on an action of this category.
  const usedAt = new Map<string, string>();
  if (agents.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('chat_agent_runs')
      .select('agent_id, action_id, queued_at')
      .in(
        'agent_id',
        agents.map((a) => a.row.id),
      )
      .not('action_id', 'is', null)
      .order('queued_at', { ascending: false })
      .limit(USE_ROWS);
    if (error) throw new Error(`Could not read the agents' runs: ${error.message}`);
    const runs = (data ?? []) as { agent_id: string; action_id: string; queued_at: string }[];
    const actionIds = [...new Set(runs.map((r) => r.action_id))];
    if (actionIds.length > 0) {
      const { data: actions, error: actionsError } = await supabaseAdmin
        .from('actions')
        .select('id, category')
        .in('id', actionIds);
      if (actionsError) throw new Error(`Could not read the actions: ${actionsError.message}`);
      const sameCategory = new Set(
        ((actions ?? []) as { id: string; category: string }[])
          .filter((a) => a.category === snapshot.category)
          .map((a) => a.id),
      );
      for (const run of runs) {
        if (sameCategory.has(run.action_id) && !usedAt.has(run.agent_id)) {
          usedAt.set(run.agent_id, run.queued_at);
        }
      }
    }
  }

  const fitting = new Set([ACTION_CATEGORY_SKILL[snapshot.category], 'tasks']);
  const fits = (agent: LoadedAgent) =>
    (agent.version?.skill_ids ?? []).some((skill) => fitting.has(skill));
  const listed = agents
    .map((agent) => ({ agent, used: usedAt.get(agent.row.id) ?? null }))
    .sort(
      (a, b) =>
        (b.used ?? '').localeCompare(a.used ?? '') ||
        Number(fits(b.agent)) - Number(fits(a.agent)) ||
        a.agent.row.name.localeCompare(b.agent.row.name),
    );
  return {
    ok: true,
    value: {
      action: { no: snapshot.no, category: snapshot.category },
      agents: listed.map(({ agent, used }) => ({
        id: agent.row.id,
        name: agent.row.name,
        status: agent.row.status === 'paused' ? 'paused' : 'active',
        skills: agent.version?.skill_ids ?? [],
        mode: agent.version?.mode ?? 'auto',
        usedOnCategoryAt: used,
      })),
      createSkill: ACTION_CATEGORY_SKILL[snapshot.category],
    },
  };
}
