import { z } from 'zod';
import type { TeamRole } from '@/components/context/RoleProvider';
import { PLANS, PLAN_ORDER, type PlanId } from '@/config/plans';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import type { BrandAccess } from '@/lib/brandAccess';
import { KPI_KEYS } from '@/lib/kpis/registry';
import { ONCE_MAX_AHEAD_MS, scheduleConfigSchema } from './agentSchedule';
import type { PlanFacts } from './planFacts';
import { CHAT_MODES, type ChatMode, type ToolDenial } from './precedence';

/**
 * Chat's agents (CHAT-21; CHAT-27 §E), the rules without the database: what
 * an agent is made of and what a request may hold, who may see and change
 * one, which state may follow which, what the plan allows and how many, and
 * the shares of the AI limit it may spend. lib/chat/agents.ts reads and
 * writes the rows by these rules. Pure.
 *
 * What is kept as JSON (the scope, the connections, a trigger's settings)
 * is accepted and answered in the shape it is stored in, snake_case, so the
 * trigger runner (W2-16) reads what the API wrote.
 */

export const AGENT_STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * Why an agent is paused (§G item 34): `manual` a person paused it; the rest
 * the system did. `own_key`: the workspace's own AI key failed (00440); the
 * agent starts again by itself once the key works.
 */
export const AGENT_PAUSED_REASONS = [
  'cap',
  // All agents reached the month's limit on the workspace's own key (AGENT-OWN-KEY §4.2).
  'own_key_cap',
  'connection',
  'skill_off',
  'failures',
  'owner_role',
  'plan',
  'brand_gone',
  'manual',
  'own_key',
] as const;
export type AgentPausedReason = (typeof AGENT_PAUSED_REASONS)[number];

export const AGENT_VISIBILITIES = ['private', 'workspace'] as const;
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number];

export const AGENT_EFFORTS = ['normal', 'high', 'max'] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

/** The triggers kept as rows (§E): Run now and Run agent on an action are always on and have none. */
export const AGENT_TRIGGER_KINDS = ['schedule', 'signal', 'kpi', 'watch_rule'] as const;
export type AgentTriggerKind = (typeof AGENT_TRIGGER_KINDS)[number];

/** Triggers an agent may have (§D item 16); Manual comes on top, always. */
export const MAX_AGENT_TRIGGERS = 5;
/** Runs one agent may have waiting per brand (§M item 58); more fires join the last. */
export const MAX_QUEUED_PER_BRAND = 3;
/** A second Run now within this, by the same person on the same brand, is the first (edge case 14). */
export const RUN_NOW_REPEAT_MS = 60_000;

/** The engines a scope may name: the tracked AI platforms and API models. */
export const AGENT_ENGINES: readonly string[] = [
  ...ALL_SCRAPERS.map((s) => s.id),
  ...ALL_MODELS.map((m) => m.id),
];

// ─── What a request may hold ─────────────────────────────────────────────────

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;
const uuid = z.guid();
const ids = (max: number) => z.array(uuid).max(max).refine(distinct, 'No repeats');
const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const words = (max: number) => z.string().trim().min(1).max(max);
const engine = z.string().refine((e) => AGENT_ENGINES.includes(e), 'Unknown engine');

/** A whole percent, as a share: 0.07 for 7%. */
const share = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, 'Whole percents only')
    .transform((v) => Math.round(v * 100) / 100);

/** The most one run may spend (CHAT-27 item 19): 1–50% of the monthly AI limit. */
export const runShareSchema = share(0.01, 0.5);
/** The most the agent may spend a month (CHAT-27 item 23): 1–100%. */
export const monthShareSchema = share(0.01, 1);

/** 1–60 characters, spaces folded; unique in the workspace whatever the case (§O). */
export const agentNameSchema = z
  .string()
  .transform((name) => name.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(60));

/** A skill by its id (CHAT-13), as chat_agent_versions.skill_ids keeps it. */
const skillId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

/** Brands (or all), then optional topics, prompt tags, engines and URLs (§D step 2). */
export const agentScopeSchema = z
  .strictObject({
    all_brands: z.literal(true).optional(),
    brand_ids: ids(50).min(1).optional(),
    topic_ids: ids(50).optional(),
    tags: z.array(words(50)).max(20).refine(distinct, 'No repeats').optional(),
    engines: z.array(engine).max(10).refine(distinct, 'No repeats').optional(),
    urls: z.array(httpUrl).max(20).refine(distinct, 'No repeats').optional(),
  })
  .refine((scope) => (scope.all_brands === true) !== (scope.brand_ids !== undefined), {
    message: 'Either all_brands or brand_ids',
  });
export type AgentScope = z.output<typeof agentScopeSchema>;

/** The workspace connections it may use, each Required or Optional (§D step 4). */
export const agentConnectionsSchema = z
  .array(z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), required: z.boolean() }))
  .max(30)
  .refine((list) => distinct(list.map((c) => c.key)), 'No repeats');
export type AgentConnection = z.output<typeof agentConnectionsSchema>[number];

/** Auto, or a model of the catalog by its id ("anthropic/claude-sonnet-5.5"); never a key. */
const modelSchema = z.union([
  z.literal('auto'),
  z
    .string()
    .max(200)
    .regex(/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:-]*$/),
]);

const instructionsSchema = z
  .string()
  .max(2000)
  .nullable()
  .transform((text) => text?.trim() || null);

/** What a version holds, as the API takes it (camelCase; the stored JSON as stored). */
const versionFields = {
  /** The primary skill, then up to 2 follow-on skills, in order. */
  skills: z.array(skillId).min(1).max(3).refine(distinct, 'No repeats'),
  instructions: instructionsSchema,
  mode: z.enum(CHAT_MODES),
  connections: agentConnectionsSchema,
  model: modelSchema,
  effort: z.enum(AGENT_EFFORTS),
  scope: agentScopeSchema,
  notifyUserIds: ids(20),
  followupDays: z.number().int().min(1).max(90),
};

// A Signal created in Action Center (§E): its category, optionally its definitions and entities.
const signalConfigSchema = z.strictObject({
  category: z.string().refine((c) => ACTION_CATEGORIES.some((known) => known === c), {
    message: 'Unknown category',
  }),
  definition_ids: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/))
    .min(1)
    .max(10)
    .refine(distinct, 'No repeats')
    .optional(),
  entity_filter: z
    .strictObject({
      prompt_tags: z.array(words(50)).min(1).max(10).optional(),
      urls: z.array(httpUrl).min(1).max(10).optional(),
      engines: z.array(engine).min(1).max(10).optional(),
    })
    .optional(),
});

// A KPI crossing a threshold (§E): which, which way, by how much, over what.
const kpiConfigSchema = z
  .strictObject({
    kpi: z.string().refine((k) => KPI_KEYS.some((known) => known === k), 'Unknown KPI'),
    direction: z.enum(['up', 'down', 'any']),
    threshold: z.number().positive().max(1_000_000),
    unit: z.enum(['absolute', 'percent']),
    period: z.enum(['day', 'week', 'month']),
  })
  .refine((c) => c.unit !== 'percent' || c.threshold <= 1000, {
    message: 'A percent threshold is at most 1000',
    path: ['threshold'],
  });

// A watch rule (CHAT-22) whose THEN runs this agent.
const watchRuleConfigSchema = z.strictObject({ watch_rule_id: uuid });

const enabled = z.boolean().default(true);

/** One trigger as the API takes it; `config` is chat_agent_triggers.config_json. */
export const agentTriggerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('schedule'), config: scheduleConfigSchema, enabled }),
  z.strictObject({ kind: z.literal('signal'), config: signalConfigSchema, enabled }),
  z.strictObject({ kind: z.literal('kpi'), config: kpiConfigSchema, enabled }),
  z.strictObject({ kind: z.literal('watch_rule'), config: watchRuleConfigSchema, enabled }),
]);
export type AgentTriggerInput = z.output<typeof agentTriggerSchema>;

/** 0–5 triggers, none twice; Manual is always there besides. */
export const agentTriggersSchema = z
  .array(agentTriggerSchema)
  .max(MAX_AGENT_TRIGGERS)
  .refine(
    (list) => distinct(list.map((t) => `${t.kind}:${JSON.stringify(t.config)}`)),
    'The same trigger twice',
  );

/** A new agent, saved as a draft (§D item 17). */
export const createAgentInput = z.strictObject({
  name: agentNameSchema,
  /**
   * `name` is the primary skill's title, not one the person typed: the
   * server names it by §O against every agent of the workspace (with its
   * brand, then " 2"…), private ones it can't show the person included.
   */
  autoName: z.boolean().default(false),
  visibility: z.enum(AGENT_VISIBILITIES).default('private'),
  /** Left out: the workspace's default (chat_settings.agent_run_share_default). */
  maxRunShare: runShareSchema.optional(),
  maxMonthShare: monthShareSchema.nullable().default(null),
  skills: versionFields.skills,
  instructions: instructionsSchema.default(null),
  mode: versionFields.mode.default('auto'),
  connections: versionFields.connections.default([]),
  model: versionFields.model.default('auto'),
  effort: versionFields.effort.default('normal'),
  scope: versionFields.scope,
  notifyUserIds: versionFields.notifyUserIds.default([]),
  followupDays: versionFields.followupDays.default(14),
  triggers: agentTriggersSchema.default([]),
});
export type CreateAgentInput = z.output<typeof createAgentInput>;

/**
 * A change (Settings, §C item 14): only what it names. `expectedVersion`, the
 * version the editor opened, refuses a save over someone else's. `triggers`
 * replaces them all.
 */
export const updateAgentInput = z
  .strictObject({
    expectedVersion: z.number().int().min(1).optional(),
    /**
     * The agent's `updatedAt` the editor opened: any save since (a name,
     * sharing, a cap or triggers, which make no new version) refuses this one.
     */
    expectedUpdatedAt: z.string().min(1).max(64).optional(),
    name: agentNameSchema.optional(),
    visibility: z.enum(AGENT_VISIBILITIES).optional(),
    maxRunShare: runShareSchema.optional(),
    maxMonthShare: monthShareSchema.nullable().optional(),
    skills: versionFields.skills.optional(),
    instructions: instructionsSchema.optional(),
    mode: versionFields.mode.optional(),
    connections: versionFields.connections.optional(),
    model: versionFields.model.optional(),
    effort: versionFields.effort.optional(),
    scope: versionFields.scope.optional(),
    notifyUserIds: versionFields.notifyUserIds.optional(),
    followupDays: versionFields.followupDays.optional(),
    triggers: agentTriggersSchema.optional(),
  })
  .refine(
    (patch) =>
      Object.keys(patch).some((key) => key !== 'expectedVersion' && key !== 'expectedUpdatedAt'),
    'Nothing to change',
  );
export type UpdateAgentInput = z.output<typeof updateAgentInput>;

/**
 * Run now (§E Manual): one brand of its scope, or every one, one run each
 * (§H item 41). Run agent on an Action Center action (§F) names the action
 * instead: one run, on the action's brand.
 */
export const runNowInput = z
  .strictObject({ brandId: uuid.optional(), actionId: uuid.optional() })
  .refine((input) => !(input.brandId && input.actionId), 'Either brandId or actionId');

/** The Agents list's tabs (§B item 5) and its search, by name or skill. */
export const AGENT_LIST_VIEWS = ['mine', 'workspace', 'paused', 'archived'] as const;
export type AgentListView = (typeof AGENT_LIST_VIEWS)[number];
export const agentListQuery = z.object({
  view: z.enum(AGENT_LIST_VIEWS).default('mine'),
  q: z.string().trim().max(100).optional(),
});

/** Runs the Runs tab lists (§C item 13). */
export const AGENT_RUNS_MAX = 50;
export const agentRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(AGENT_RUNS_MAX).default(AGENT_RUNS_MAX),
});

/**
 * A trigger's settings that the clock makes wrong: a one-off schedule in the
 * past or more than a year ahead. Null when it is fine.
 */
export function triggerTimeProblem(
  trigger: AgentTriggerInput,
  now: Date,
): 'schedule_past' | 'schedule_too_far' | null {
  if (trigger.kind !== 'schedule' || trigger.config.type !== 'once') return null;
  const at = Date.parse(trigger.config.at);
  if (at <= now.getTime()) return 'schedule_past';
  if (at > now.getTime() + ONCE_MAX_AHEAD_MS) return 'schedule_too_far';
  return null;
}

// ─── A version ───────────────────────────────────────────────────────────────

/** What a version holds, as chat_agent_versions keeps it. */
export interface AgentVersionData {
  skill_ids: string[];
  instructions: string | null;
  mode: ChatMode;
  connections: AgentConnection[];
  model: string;
  effort: AgentEffort;
  scope: AgentScope;
  notify_user_ids: string[];
  followup_days: number;
}

const VERSION_KEYS = [
  'skills',
  'instructions',
  'mode',
  'connections',
  'model',
  'effort',
  'scope',
  'notifyUserIds',
  'followupDays',
] as const;

/** The version a new agent starts with. */
export function firstVersion(input: CreateAgentInput): AgentVersionData {
  return {
    skill_ids: input.skills,
    instructions: input.instructions,
    mode: input.mode,
    connections: input.connections,
    model: input.model,
    effort: input.effort,
    scope: input.scope,
    notify_user_ids: input.notifyUserIds,
    followup_days: input.followupDays,
  };
}

/**
 * The version a change makes, from the current one; null when the change
 * leaves what the agent does as it is (only its name, visibility, caps or
 * triggers): no new version then.
 */
export function nextVersion(
  current: AgentVersionData,
  patch: UpdateAgentInput,
): AgentVersionData | null {
  if (!VERSION_KEYS.some((key) => patch[key] !== undefined)) return null;
  const next: AgentVersionData = {
    skill_ids: patch.skills ?? current.skill_ids,
    instructions: patch.instructions !== undefined ? patch.instructions : current.instructions,
    mode: patch.mode ?? current.mode,
    connections: patch.connections ?? current.connections,
    model: patch.model ?? current.model,
    effort: patch.effort ?? current.effort,
    scope: patch.scope ?? current.scope,
    notify_user_ids: patch.notifyUserIds ?? current.notify_user_ids,
    followup_days: patch.followupDays ?? current.followup_days,
  };
  return sameVersion(current, next) ? null : next;
}

/** Whether two versions hold the same, key order aside. */
export function sameVersion(a: AgentVersionData, b: AgentVersionData): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, canonical(v)]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** A version row as stored, read back defensively: what doesn't parse is left as the default. */
export function versionFromRow(row: {
  skill_ids: string[];
  instructions: string | null;
  mode: string;
  connections: unknown;
  model: string;
  effort: string;
  scope: unknown;
  notify_user_ids: string[];
  followup_days: number;
}): AgentVersionData {
  const scope = agentScopeSchema.safeParse(row.scope);
  const connections = agentConnectionsSchema.safeParse(row.connections);
  return {
    skill_ids: row.skill_ids,
    instructions: row.instructions,
    mode: CHAT_MODES.find((m) => m === row.mode) ?? 'ask_first',
    connections: connections.success ? connections.data : [],
    model: row.model,
    effort: AGENT_EFFORTS.find((e) => e === row.effort) ?? 'normal',
    // A scope that doesn't read names no brand: the agent can't run until it is fixed.
    scope: scope.success ? scope.data : { brand_ids: [] as string[] },
    notify_user_ids: row.notify_user_ids,
    followup_days: row.followup_days,
  };
}

// ─── Names ───────────────────────────────────────────────────────────────────

/** A name's key for the workspace's one-per-name rule (chat_agents_name_uidx). */
export const nameKey = (name: string) => name.toLowerCase();

/**
 * A new agent's name (§O): the primary skill's title; taken in the
 * workspace (whatever the case), with its brand ("Win back lost citations
 * · Brand A"), then " 2", " 3". At most 60 characters.
 */
export function defaultAgentName(
  title: string,
  brand: string | null,
  taken: readonly string[],
): string {
  const used = new Set(taken.map(nameKey));
  const fit = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 60).trimEnd();
  const free = (text: string) => !used.has(nameKey(text));
  const first = fit(title);
  if (free(first)) return first;
  if (brand) {
    const withBrand = fit(`${title} · ${brand}`);
    if (free(withBrand)) return withBrand;
  }
  for (let n = 2; n < 1000; n++) {
    const suffix = ` ${n}`;
    const candidate = `${first.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (free(candidate)) return candidate;
  }
  return first;
}

/**
 * A duplicate's name (edge case 12): "{name} copy", then " 2", " 3"… past
 * the names taken (lower-cased), the name shortened to stay within 60.
 */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; n < 1000; n++) {
    const suffix = n === 1 ? ' copy' : ` copy ${n}`;
    const candidate = `${name.slice(0, 60 - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return `${name.slice(0, 40).trimEnd()} copy ${Date.now()}`.slice(0, 60);
}

// ─── States ──────────────────────────────────────────────────────────────────

/** A change of state a person asks for (§G item 33); `delete` removes it for good. */
export type AgentLifecycleAction =
  'activate' | 'pause' | 'resume' | 'archive' | 'restore' | 'delete';

/**
 * The states each action leaves from. A draft may be archived too, so a
 * draft no one wants can be deleted. Restore never goes straight to active.
 */
const LIFECYCLE: Record<AgentLifecycleAction, { from: AgentStatus[]; to: AgentStatus | null }> = {
  activate: { from: ['draft'], to: 'active' },
  pause: { from: ['active'], to: 'paused' },
  resume: { from: ['paused'], to: 'active' },
  archive: { from: ['draft', 'active', 'paused'], to: 'archived' },
  restore: { from: ['archived'], to: 'paused' },
  delete: { from: ['archived'], to: null },
};

/** The state an action leads to from `status`: null for deleted, undefined when it can't. */
export function lifecycleTarget(
  action: AgentLifecycleAction,
  status: AgentStatus,
): AgentStatus | null | undefined {
  const rule = LIFECYCLE[action];
  return rule.from.includes(status) ? rule.to : undefined;
}

/** Whether an agent's definition may change: not while archived (restore it first). */
export const editable = (status: AgentStatus) => status !== 'archived';

// ─── Who may ─────────────────────────────────────────────────────────────────

/** What a person asks to do with an agent, as the denial names it (chatAgents.asked). */
export type AgentAsk =
  | 'create'
  | 'edit'
  | 'activate'
  | 'pause'
  | 'resume'
  | 'archive'
  | 'restore'
  | 'delete'
  | 'duplicate'
  | 'run'
  | 'takeOver'
  | 'workspace'
  | 'monthCap'
  | 'fullAuto'
  | 'engines'
  | 'runWithChat'
  /** An agent's permission to publish and send on its own (AUTONOMOUS-GO-LIVE §7.2). */
  | 'goLive';

/** A refusal: the precedence's denial, and what was asked in words. */
export interface AgentDenial {
  denial: ToolDenial;
  asked: AgentAsk;
}

export interface AgentViewer {
  userId: string;
  role: TeamRole;
  /** The brands the person may use: all, or the ones shared with them (Selected brands). */
  brandAccess: BrandAccess;
}

/** An agent as the rules need it. */
export interface AgentFacts {
  ownerId: string | null;
  visibility: AgentVisibility;
  scope: AgentScope;
}

export interface AgentSettings {
  /** chat_settings.agent_run_share_default: a new agent's per-run cap. */
  runShareDefault: number;
  /** chat_settings.agents_full_auto: agents may run in Full auto. */
  agentsFullAuto: boolean;
  /** chat_settings.workspace_agents_admins_only. */
  workspaceAgentsAdminsOnly: boolean;
  /** chat_settings.full_auto_for_members: people other than Admins may use Full auto. */
  fullAutoForMembers: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = Object.freeze({
  runShareDefault: 0.1,
  agentsFullAuto: true,
  workspaceAgentsAdminsOnly: false,
  fullAutoForMembers: true,
});

/** Admins and Managers make and run agents (§K item 51); Analysts and Agency partners read. */
export const canWriteAgents = (role: TeamRole) => role === 'admin' || role === 'manager';

const forbidden = (role: TeamRole, roles: TeamRole[], asked: AgentAsk): AgentDenial => ({
  denial: { code: 'forbidden_role', role, roles },
  asked,
});

/**
 * Whether a person sees an agent (§K item 51, CHAT-21 Definition): a
 * workspace agent, every member; a private one, its owner and the Admins.
 * Someone with Selected brands sees only agents whose brands are all shared
 * with them, and their own agent on All brands, which runs on their brands
 * only (BRAND-ACCESS §5.3: all of the owner's). The database's
 * can_see_chat_agent (00436) has the same rule.
 */
export function canSeeAgent(agent: AgentFacts, viewer: AgentViewer): boolean {
  if (viewer.role === 'admin') return true;
  if (agent.visibility === 'private' && agent.ownerId !== viewer.userId) return false;
  if (viewer.brandAccess === 'all') return true;
  const access = viewer.brandAccess;
  if (agent.scope.all_brands) return agent.ownerId === viewer.userId;
  return (agent.scope.brand_ids ?? []).every((id) => access.includes(id));
}

/** The acts on an existing agent (create and duplicate make a new one). */
export type AgentAct = Exclude<
  AgentAsk,
  'workspace' | 'monthCap' | 'fullAuto' | 'engines' | 'runWithChat' | 'goLive'
>;

/** What only an Admin may do to a workspace agent while Settings › Chat keeps them to Admins. */
const ADMINS_ONLY_ACTS: readonly AgentAct[] = ['edit', 'activate', 'resume'];

/**
 * Whether a person may do `act` to an agent they can see (§K item 51, §G):
 * Admins anything; Managers their own agents, and Run now on any workspace
 * agent; Analysts and Agency partners nothing. While only Admins may keep
 * workspace agents, a Manager's own workspace agent can still be paused,
 * archived, restored, deleted and run, but not changed or turned on. Take
 * over is an Admin's alone. Null when they may.
 */
export function agentActDenial(
  act: AgentAct,
  viewer: AgentViewer,
  agent: AgentFacts | null,
  settings: AgentSettings,
): AgentDenial | null {
  // Take over is an Admin's, whoever owns the agent (§G item 34, §K item 51).
  if (act === 'takeOver') {
    return viewer.role === 'admin' ? null : forbidden(viewer.role, ['admin'], act);
  }
  if (!canWriteAgents(viewer.role)) return forbidden(viewer.role, ['admin', 'manager'], act);
  if (viewer.role === 'admin' || !agent || act === 'create' || act === 'duplicate') return null;
  if (act === 'run' && agent.visibility === 'workspace') return null;
  if (agent.ownerId !== viewer.userId) return forbidden(viewer.role, ['admin'], act);
  if (
    agent.visibility === 'workspace' &&
    settings.workspaceAgentsAdminsOnly &&
    ADMINS_ONLY_ACTS.includes(act)
  ) {
    return { denial: { code: 'policy_never' }, asked: act };
  }
  return null;
}

/**
 * Run with Chat on an Action Center action (CHAT-21 §F item 27): Chat works
 * the action's tasks, which are changes, so Admins and Managers only, as
 * Run agent. Null when they may.
 */
export function runWithChatDenial(viewer: AgentViewer): AgentDenial | null {
  return canWriteAgents(viewer.role)
    ? null
    : forbidden(viewer.role, ['admin', 'manager'], 'runWithChat');
}

/** Making an agent visible to the workspace: refused for Managers while Admins keep it. */
export function visibilityDenial(
  visibility: AgentVisibility,
  viewer: AgentViewer,
  settings: AgentSettings,
): AgentDenial | null {
  if (visibility !== 'workspace' || viewer.role === 'admin') return null;
  return settings.workspaceAgentsAdminsOnly
    ? { denial: { code: 'policy_never' }, asked: 'workspace' }
    : null;
}

/** The monthly cap is an Admin's (CHAT-27 item 23). */
export function monthCapDenial(viewer: AgentViewer): AgentDenial | null {
  return viewer.role === 'admin' ? null : forbidden(viewer.role, ['admin'], 'monthCap');
}

// ─── What the plan allows ────────────────────────────────────────────────────

const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);

/**
 * Full auto (§D item 19): Growth and up, paid; and on in Settings › Chat for
 * agents, and for people other than Admins. Null when the mode is fine.
 */
export function modeDenial(
  mode: ChatMode,
  plan: PlanFacts,
  settings: AgentSettings,
  role: TeamRole,
): AgentDenial | null {
  if (mode !== 'full_auto') return null;
  if (!plan.fullAuto) {
    return { denial: { code: 'plan_locked', needs: 'growth' }, asked: 'fullAuto' };
  }
  if (!settings.agentsFullAuto || (role !== 'admin' && !settings.fullAutoForMembers)) {
    return { denial: { code: 'policy_never' }, asked: 'fullAuto' };
  }
  return null;
}

/** The lowest plan above the workspace's that tracks an engine; Enterprise for API models. */
function engineNeeds(plan: PlanFacts, engineId: string): PlanId | null {
  const isModel = ALL_MODELS.some((m) => m.id === engineId);
  const listOf = (limits: PlanFacts['limits']) =>
    isModel ? limits.allowedModels : limits.allowedScrapers;
  const allowed = listOf(plan.limits);
  if (!allowed || allowed.includes(engineId)) return null;
  for (const id of PLAN_ORDER) {
    const list = listOf(PLANS[id].limits);
    if (rank(id) > rank(plan.planId) && (!list || list.includes(engineId))) return id;
  }
  // API models (Claude) are tracked on Enterprise, set per contract.
  return 'enterprise';
}

/**
 * Engines in scope are the plan's engines (§D item 19): a scope or Signal
 * filter naming one the plan doesn't track is refused with the plan that does.
 */
export function enginesDenial(plan: PlanFacts, engines: readonly string[]): AgentDenial | null {
  if (plan.selfHosted) return null;
  let needs: PlanId | null = null;
  for (const id of engines) {
    const lock = engineNeeds(plan, id);
    if (lock && (!needs || rank(lock) > rank(needs))) needs = lock;
  }
  return needs ? { denial: { code: 'plan_locked', needs }, asked: 'engines' } : null;
}

/** Every engine a version and its triggers name. */
export function enginesNamed(
  scope: AgentScope,
  triggers: readonly AgentTriggerInput[] = [],
): string[] {
  const named = new Set(scope.engines ?? []);
  for (const trigger of triggers) {
    if (trigger.kind === 'signal') {
      for (const id of trigger.config.entity_filter?.engines ?? []) named.add(id);
    }
  }
  return [...named];
}

/** How many agents a plan keeps on, and runs at once (§M item 57). */
export interface AgentPlanLimits {
  /** Active agents at once; null: no cap (self-hosted). */
  activeAgents: number | null;
  /** Agent runs working at once in the workspace; more wait as Queued (§M item 59). */
  runsAtOnce: number;
  /** Event-triggered runs per agent a day (the trigger runner's, W2-16). */
  eventRunsPerDay: number;
}

const AGENT_LIMITS: Record<'trial' | 'starter' | 'growth' | 'enterprise', AgentPlanLimits> = {
  trial: { activeAgents: 1, runsAtOnce: 1, eventRunsPerDay: 2 },
  starter: { activeAgents: 5, runsAtOnce: 2, eventRunsPerDay: 6 },
  growth: { activeAgents: 25, runsAtOnce: 5, eventRunsPerDay: 6 },
  enterprise: { activeAgents: 100, runsAtOnce: 10, eventRunsPerDay: 12 },
};

/**
 * The workspace's agent limits (§M item 57, approved as written, DECISIONS
 * N.4): the trial's in the trial, whatever its plan; Enterprise's active
 * agents from the contract (plan_overrides.maxActiveAgents), 100 without
 * one. Self-hosted has no plan: no cap on agents, Enterprise's runs at once.
 */
export function agentPlanLimits(plan: PlanFacts): AgentPlanLimits {
  if (plan.selfHosted) return { ...AGENT_LIMITS.enterprise, activeAgents: null };
  if (plan.isTrial) return AGENT_LIMITS.trial;
  if (plan.planId === 'enterprise') {
    const contract = (plan.limits as { maxActiveAgents?: unknown }).maxActiveAgents;
    return {
      ...AGENT_LIMITS.enterprise,
      activeAgents:
        typeof contract === 'number' && Number.isInteger(contract) && contract > 0
          ? contract
          : AGENT_LIMITS.enterprise.activeAgents,
    };
  }
  return plan.planId === 'growth' ? AGENT_LIMITS.growth : AGENT_LIMITS.starter;
}
