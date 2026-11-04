import { z } from 'zod';
import type { TeamRole } from '@/components/context/RoleProvider';
import { ACTION_CATEGORIES } from '@/lib/action-center/registry';
import { KPI_KEYS } from '@/lib/kpis/registry';
import { dayIn, zonedInstant } from '@/lib/timeZone';
import type { Json } from '@/types/supabase';
import {
  MAX_AGENT_TRIGGERS,
  agentScopeSchema,
  agentTriggerSchema,
  defaultAgentName,
  triggerTimeProblem,
  type AgentConnection,
  type AgentEffort,
  type AgentVisibility,
} from './agentRules';
import {
  RRULE_DAYS,
  formatRecurringRule,
  nextScheduleFire,
  parseRecurringRule,
  type RecurringRule,
  type RruleDay,
} from './agentSchedule';
import { skillConnections } from './agentSkills';
import type { AgentDetail, AgentTriggerView } from './agents';
import type { AgentPreset, PresetTrigger } from './agents/catalog';
import type { ChatMode } from './precedence';

/**
 * Chat's create-agent flow (CHAT-21 §D; governance mockup #g-agent-new;
 * CHAT-27 item 19) as data: what the four steps hold, what an agent's
 * detail fills them with for Edit, what each step needs before Next, the
 * bodies POST /api/chat/agents and PATCH /{id} take, and the step a
 * server's refusal belongs to. The server checks it all again
 * (agentRules.ts). Pure: the page puts the words around it.
 */

/** The steps, in the mockup's order: Skill · Trigger · Mode & approvals · Connections & model. */
export const AGENT_FORM_STEPS = ['skill', 'trigger', 'mode', 'connections'] as const;
export type AgentFormStep = 0 | 1 | 2 | 3;
export const LAST_STEP: AgentFormStep = 3;

/** What the page knows before the form opens, read on the server (agentFormSetup.ts). */
export interface AgentFormSetup {
  role: TeamRole;
  /** The brands an agent may work on: the workspace's, never the demo brand. */
  brands: { id: string; name: string }[];
  /** Their topics, to narrow the scope. */
  topics: { id: string; name: string; brandId: string }[];
  /** The engines the plan tracks, by id (§D item 19). */
  engines: string[];
  /** Full auto: open, locked by the plan (Growth and up), or turned off in Settings › Chat. */
  fullAuto: 'open' | 'plan' | 'policy';
  /** The workspace's plan, and the one Full auto needs. */
  planName: string;
  fullAutoPlan: string;
  /** Settings › Chat keeps workspace agents to Admins. */
  workspaceAgentsAdminsOnly: boolean;
  /** A new agent's Max per run (Settings › Chat), as a share: 0.1 for 10%. */
  runShareDefault: number;
  /** The names of the agents the person sees, for a new agent's default name (§O). */
  takenNames: string[];
  /** The provider whose key Chat runs on (`anthropic`), or null: the monthly AI limit pays. */
  ownKeyProvider: string | null;
  /**
   * The workspace's switch for agents that publish and send on their own
   * (AUTONOMOUS-GO-LIVE §7.1): the form's box shows unless it's hidden
   * (CHAT_AUTO_GO_LIVE off). Absent: hidden.
   */
  goLive?: 'hidden' | 'off' | 'on';
}

/** How often a Schedule fires, as its token offers it (mockup: Monday, Weekday, 1st of the month). */
export type ScheduleRepeat =
  | 'daily'
  | 'weekdays'
  | RruleDay
  | 'month_first'
  | 'month_last'
  | 'once'
  /** A rule the token can't name (made elsewhere): kept, its time still editable. */
  | 'custom';

export const SCHEDULE_REPEATS: readonly ScheduleRepeat[] = [
  'daily',
  'weekdays',
  ...RRULE_DAYS,
  'month_first',
  'month_last',
  'once',
];

/**
 * A trigger being edited. `raw` is the settings it was read with, sent back
 * as they were until a field of it changes, so a trigger that is only kept
 * keeps its exact settings (and its last fire).
 */
export type TriggerDraft = { key: string; enabled: boolean; raw: Json | null } & (
  | {
      kind: 'schedule';
      repeat: ScheduleRepeat;
      /** "07:00", 24-hour, on the clock of `timezone`. */
      time: string;
      /** "2026-11-05", for a one-off. */
      date: string;
      timezone: string;
      custom: RecurringRule | null;
    }
  | { kind: 'signal'; category: string }
  | {
      kind: 'kpi';
      kpi: string;
      direction: 'up' | 'down' | 'any';
      /** As typed. */
      threshold: string;
      unit: 'absolute' | 'percent';
      period: 'day' | 'week' | 'month';
    }
  /** Watch rules are picked on the rule itself (CHAT-22): kept here as they are. */
  | { kind: 'watch_rule' }
);

export type TriggerKind = TriggerDraft['kind'];

export interface AgentFormState {
  /** The primary skill first, then up to 2 follow-on skills. */
  skills: string[];
  instructions: string;
  triggers: TriggerDraft[];
  allBrands: boolean;
  brandIds: string[];
  topicIds: string[];
  engines: string[];
  /** As typed: one per line (a URL or a tag may hold a comma). */
  tagsText: string;
  urlsText: string;
  mode: ChatMode;
  connections: AgentConnection[];
  model: string;
  /** Kept as they are: the flow has no field for them yet. */
  effort: AgentEffort;
  notifyUserIds: string[];
  followupDays: number;
  name: string;
  /** The person typed a name: a skill or brand change no longer renames it. */
  nameEdited: boolean;
  visibility: AgentVisibility;
  /** Percents as typed. */
  maxRun: string;
  monthCapOn: boolean;
  maxMonth: string;
}

/**
 * The models the Model step offers (CHAT-16): Auto, or Haiku for Fast and
 * Sonnet for Best writing, by the ids Auto's two phases price them by
 * (engineModel.ts AUTO_READ_MODEL / AUTO_WRITE_MODEL `catalog`).
 */
export const FAST_MODEL = 'anthropic/claude-haiku-5.5';
export const WRITING_MODEL = 'anthropic/claude-sonnet-5.5';

export const MAX_INSTRUCTIONS = 2000;
export const MAX_NAME = 60;

// ─── Small parts ─────────────────────────────────────────────────────────────

/** A name as the server keeps it: spaces folded. */
export const foldName = (name: string) => name.replace(/\s+/g, ' ').trim();

/** Tags or URLs as typed: one per line, trimmed, once each. A comma stays in its line. */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function clockOf(time: string): { hour: number; minute: number } | null {
  const match = TIME.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "07:00" for an instant on a zone's clock. */
function clockIn(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
}

/** JSON with its keys in order and nothing undefined, to tell two settings apart. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

/** A scope without its empty lists: the same scope either way. */
function scopeKey(scope: unknown): string {
  const record = (scope ?? {}) as Record<string, unknown>;
  return canonical(
    Object.fromEntries(
      Object.entries(record).filter(([, v]) => !(Array.isArray(v) && v.length === 0)),
    ),
  );
}

// ─── Triggers ────────────────────────────────────────────────────────────────

const WEEKDAYS: readonly RruleDay[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** A new trigger, with the mockup's first values ("Monday at 07:00", "Citation lost", "−10% week over week"). */
export function newTriggerDraft(
  kind: Exclude<TriggerKind, 'watch_rule'>,
  key: string,
  timeZone: string,
): TriggerDraft {
  switch (kind) {
    case 'schedule':
      return {
        key,
        kind,
        enabled: true,
        raw: null,
        repeat: 'MO',
        time: '07:00',
        date: '',
        timezone: timeZone,
        custom: null,
      };
    case 'signal':
      return { key, kind, enabled: true, raw: null, category: 'recover' };
    case 'kpi':
      return {
        key,
        kind,
        enabled: true,
        raw: null,
        kpi: 'citations',
        direction: 'down',
        threshold: '10',
        unit: 'percent',
        period: 'week',
      };
  }
}

/** Which token a stored rule reads as; anything the token can't make itself is `custom`. */
function repeatOf(rule: RecurringRule): ScheduleRepeat {
  if (rule.freq === 'MONTHLY') {
    return rule.byMonthDay === 1 ? 'month_first' : rule.byMonthDay === -1 ? 'month_last' : 'custom';
  }
  if (rule.freq === 'DAILY') return rule.byDay === null ? 'daily' : 'custom';
  const days = rule.byDay ?? [];
  if (days.length === 1) return days[0];
  if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return 'weekdays';
  return 'custom';
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** A stored trigger, to edit; its own settings kept in `raw`. */
export function draftFromView(
  view: Pick<AgentTriggerView, 'kind' | 'config' | 'enabled'>,
  key: string,
  timeZone: string,
): TriggerDraft {
  const config = record(view.config);
  const base = { key, enabled: view.enabled, raw: view.config };
  switch (view.kind) {
    case 'schedule': {
      if (config.type === 'once' && typeof config.at === 'string') {
        return {
          ...base,
          kind: 'schedule',
          repeat: 'once',
          date: dayIn(config.at, timeZone),
          time: clockIn(config.at, timeZone),
          timezone: timeZone,
          custom: null,
        };
      }
      const rule = typeof config.rrule === 'string' ? parseRecurringRule(config.rrule) : null;
      const zone = typeof config.timezone === 'string' ? config.timezone : timeZone;
      return {
        ...base,
        kind: 'schedule',
        repeat: rule ? repeatOf(rule) : 'MO',
        time: rule ? `${pad(rule.hour)}:${pad(rule.minute)}` : '07:00',
        date: '',
        timezone: zone,
        custom: rule && repeatOf(rule) === 'custom' ? rule : null,
      };
    }
    case 'signal':
      return {
        ...base,
        kind: 'signal',
        category: typeof config.category === 'string' ? config.category : '',
      };
    case 'kpi':
      return {
        ...base,
        kind: 'kpi',
        kpi: typeof config.kpi === 'string' ? config.kpi : '',
        direction:
          config.direction === 'up' || config.direction === 'any' ? config.direction : 'down',
        threshold: typeof config.threshold === 'number' ? String(config.threshold) : '',
        unit: config.unit === 'absolute' ? 'absolute' : 'percent',
        period: config.period === 'day' || config.period === 'month' ? config.period : 'week',
      };
    case 'watch_rule':
      return { ...base, kind: 'watch_rule' };
  }
}

/** A recurring schedule's rule, from its token and time. */
function ruleOf(
  draft: Extract<TriggerDraft, { kind: 'schedule' }>,
  hour: number,
  minute: number,
): RecurringRule | null {
  const at = { hour, minute };
  switch (draft.repeat) {
    case 'daily':
      return { freq: 'DAILY', byDay: null, byMonthDay: null, ...at };
    case 'weekdays':
      return { freq: 'WEEKLY', byDay: [...WEEKDAYS], byMonthDay: null, ...at };
    case 'month_first':
      return { freq: 'MONTHLY', byDay: null, byMonthDay: 1, ...at };
    case 'month_last':
      return { freq: 'MONTHLY', byDay: null, byMonthDay: -1, ...at };
    case 'custom':
      return draft.custom ? { ...draft.custom, ...at } : null;
    case 'once':
      return null;
    default:
      return { freq: 'WEEKLY', byDay: [draft.repeat], byMonthDay: null, ...at };
  }
}

/** A trigger as the API takes it (its `config` as kept), or null while a field is missing. */
export function triggerInputOf(
  draft: TriggerDraft,
): { kind: TriggerKind; config: Json; enabled: boolean } | null {
  const out = (config: Json) => ({ kind: draft.kind, config, enabled: draft.enabled });
  if (draft.raw !== null) return out(draft.raw);
  switch (draft.kind) {
    case 'schedule': {
      const clock = clockOf(draft.time);
      if (!clock) return null;
      if (draft.repeat === 'once') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) return null;
        return out({
          type: 'once',
          at: zonedInstant(draft.date, clock.hour, clock.minute, draft.timezone),
        });
      }
      const rule = ruleOf(draft, clock.hour, clock.minute);
      if (!rule) return null;
      return out({ type: 'recurring', rrule: formatRecurringRule(rule), timezone: draft.timezone });
    }
    case 'signal':
      return draft.category ? out({ category: draft.category }) : null;
    case 'kpi': {
      const threshold = Number(draft.threshold);
      if (!draft.kpi || !draft.threshold.trim() || !Number.isFinite(threshold)) return null;
      return out({
        kpi: draft.kpi,
        direction: draft.direction,
        threshold,
        unit: draft.unit,
        period: draft.period,
      });
    }
    case 'watch_rule':
      return null;
  }
}

/** When a Schedule draft fires next, or null (event triggers, or not set yet). */
export function draftNextFire(draft: TriggerDraft, now: Date): string | null {
  if (draft.kind !== 'schedule' || !draft.enabled) return null;
  const input = triggerInputOf(draft);
  return input ? nextScheduleFire(input.config, now) : null;
}

/** What is wrong with a trigger, or null. A kept one isn't held to the clock (the server doesn't). */
export function triggerError(draft: TriggerDraft, now: Date): string | null {
  if (draft.raw === null) {
    switch (draft.kind) {
      case 'schedule':
        if (!clockOf(draft.time)) return 'time_required';
        if (draft.repeat === 'once' && !draft.date) return 'date_required';
        break;
      case 'signal':
        if (!ACTION_CATEGORIES.some((c) => c === draft.category)) return 'category_required';
        break;
      case 'kpi': {
        if (!KPI_KEYS.some((k) => k === draft.kpi)) return 'kpi_required';
        const threshold = Number(draft.threshold);
        if (!draft.threshold.trim() || !Number.isFinite(threshold) || threshold <= 0) {
          return 'threshold';
        }
        if (threshold > 1_000_000) return 'threshold';
        if (draft.unit === 'percent' && threshold > 1000) return 'threshold_percent';
        break;
      }
      case 'watch_rule':
        return 'watch_rule_required';
    }
  }
  const input = triggerInputOf(draft);
  const parsed = input ? agentTriggerSchema.safeParse(input) : null;
  if (!parsed?.success) return 'trigger_invalid';
  if (draft.raw === null) return triggerTimeProblem(parsed.data, now);
  return null;
}

// ─── The form ────────────────────────────────────────────────────────────────

/**
 * The connections an agent's skills use, Required or Optional as the
 * skills say (§D step 4), and the Optional ones it had that its skills
 * don't use.
 */
export function syncConnections(
  previous: readonly AgentConnection[],
  skills: readonly string[],
): AgentConnection[] {
  const needed = skillConnections(skills);
  const keys = new Set(needed.map((c) => c.key));
  return [
    ...needed.map(({ key, required }) => ({ key, required })),
    ...previous.filter((c) => !keys.has(c.key) && !c.required),
  ];
}

/** A new agent's name (§O); the server names it again against every agent (`autoName`). */
export { defaultAgentName };

/** A new agent's form: the skill it starts from, if any, the brand on screen, Monday 07:00. */
export function newForm(
  setup: Pick<AgentFormSetup, 'brands' | 'runShareDefault'>,
  options: { timeZone: string; brandId: string | null; skill: string | null; triggerKey: string },
): AgentFormState {
  const brand = setup.brands.find((b) => b.id === options.brandId) ?? setup.brands[0] ?? null;
  const skills = options.skill ? [options.skill] : [];
  return {
    skills,
    instructions: '',
    triggers: [newTriggerDraft('schedule', options.triggerKey, options.timeZone)],
    allBrands: false,
    brandIds: brand ? [brand.id] : [],
    topicIds: [],
    engines: [],
    tagsText: '',
    urlsText: '',
    mode: 'auto',
    connections: syncConnections([], skills),
    model: 'auto',
    effort: 'normal',
    notifyUserIds: [],
    followupDays: 14,
    name: '',
    nameEdited: false,
    visibility: 'private',
    maxRun: String(Math.round(setup.runShareDefault * 100)),
    monthCapOn: false,
    maxMonth: '',
  };
}

/** A ready-to-use agent's default trigger as the Trigger step edits it, on the person's clock. */
export function presetTriggerDraft(
  trigger: PresetTrigger,
  key: string,
  timeZone: string,
): TriggerDraft {
  const draft = newTriggerDraft(trigger.kind, key, timeZone);
  if (draft.kind === 'schedule' && trigger.kind === 'schedule') {
    return { ...draft, repeat: trigger.repeat, time: trigger.time };
  }
  if (draft.kind === 'signal' && trigger.kind === 'signal') {
    return { ...draft, category: trigger.category };
  }
  if (draft.kind === 'kpi' && trigger.kind === 'kpi') {
    return {
      ...draft,
      kpi: trigger.kpi,
      direction: trigger.direction,
      threshold: String(trigger.threshold),
      unit: trigger.unit,
      period: trigger.period,
    };
  }
  return draft;
}

/**
 * A new agent's form from a ready-to-use agent (Agent Center › Ready to
 * use, "Use this agent"): its skills, triggers, mode and connections, on
 * the brand on screen. Full auto where the plan or Settings › Chat keeps it
 * closed starts on Auto, ask before changes: the card said so. Only filled
 * in, never saved: the person saves it.
 */
export function formFromPreset(
  setup: Pick<AgentFormSetup, 'brands' | 'runShareDefault' | 'fullAuto'>,
  preset: Pick<AgentPreset, 'skills' | 'triggers' | 'mode' | 'connections'>,
  options: { timeZone: string; brandId: string | null },
): AgentFormState {
  const skills = [...preset.skills];
  return {
    ...newForm(setup, { ...options, skill: null, triggerKey: 'k0' }),
    skills,
    triggers: preset.triggers.map((trigger, i) =>
      presetTriggerDraft(trigger, `k${i}`, options.timeZone),
    ),
    mode: preset.mode === 'full_auto' && setup.fullAuto !== 'open' ? 'auto' : preset.mode,
    connections: syncConnections(
      preset.connections.filter((c) => !c.required),
      skills,
    ),
  };
}

/** The form an agent's Edit opens with: its current version, triggers and settings. */
export function formFromAgent(
  agent: AgentDetail,
  setup: Pick<AgentFormSetup, 'brands'>,
  options: { timeZone: string; triggerKey: (i: number) => string },
): AgentFormState | null {
  const settings = agent.settings;
  if (!settings) return null;
  const scope = settings.scope;
  const known = new Set(setup.brands.map((b) => b.id));
  return {
    skills: [...settings.skills],
    instructions: settings.instructions ?? '',
    triggers: agent.triggers.map((view, i) =>
      draftFromView(view, options.triggerKey(i), options.timeZone),
    ),
    allBrands: scope.all_brands === true,
    brandIds: (scope.brand_ids ?? []).filter((id) => known.has(id)),
    topicIds: scope.topic_ids ?? [],
    engines: scope.engines ?? [],
    tagsText: (scope.tags ?? []).join('\n'),
    urlsText: (scope.urls ?? []).join('\n'),
    mode: settings.mode,
    connections: settings.connections.map((c) => ({ ...c })),
    model: settings.model,
    effort: settings.effort,
    notifyUserIds: settings.notifyUserIds,
    followupDays: settings.followupDays,
    name: agent.name,
    nameEdited: true,
    visibility: agent.visibility,
    maxRun: String(Math.round(agent.maxRunShare * 100)),
    monthCapOn: agent.maxMonthShare !== null,
    maxMonth: agent.maxMonthShare !== null ? String(Math.round(agent.maxMonthShare * 100)) : '',
  };
}

/** The scope as kept (§D step 2): brands or all, then the lists that narrow it. */
export function scopeOf(state: AgentFormState): Record<string, unknown> {
  const tags = parseList(state.tagsText);
  const urls = parseList(state.urlsText);
  return {
    ...(state.allBrands ? { all_brands: true } : { brand_ids: state.brandIds }),
    ...(state.topicIds.length > 0 ? { topic_ids: state.topicIds } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(state.engines.length > 0 ? { engines: state.engines } : {}),
    ...(urls.length > 0 ? { urls } : {}),
  };
}

// ─── What each step needs ────────────────────────────────────────────────────

/** Where a problem is shown: a field of a step, or the step's own line (`form`). */
export type FormField =
  | 'skills'
  | 'instructions'
  | 'triggers'
  | 'brands'
  | 'engines'
  | 'tags'
  | 'urls'
  | 'mode'
  | 'connections'
  | 'name'
  | 'visibility'
  | 'maxRun'
  | 'maxMonth'
  | 'form';

/** A step's problems: by field, and by trigger (its key). */
export interface StepProblems {
  fields: Partial<Record<FormField, string>>;
  triggers: Record<string, string>;
}

export interface FormContext {
  setup: Pick<AgentFormSetup, 'role' | 'brands' | 'fullAuto' | 'workspaceAgentsAdminsOnly'>;
  /** The agent being edited, or null for a new one. */
  agent: Pick<AgentDetail, 'visibility' | 'maxMonthShare'> | null;
  now: Date;
}

const httpUrl = z.url({ protocol: /^https?$/ }).max(2048);
const wholeIn = (text: string, min: number, max: number) =>
  /^\d{1,3}$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

export function stepProblems(
  step: AgentFormStep,
  state: AgentFormState,
  ctx: FormContext,
): StepProblems {
  const fields: StepProblems['fields'] = {};
  const triggers: StepProblems['triggers'] = {};
  switch (step) {
    case 0:
      if (state.skills.length === 0) fields.skills = 'skill_required';
      if (state.instructions.length > MAX_INSTRUCTIONS) fields.instructions = 'instructions_long';
      break;
    case 1: {
      for (const draft of state.triggers) {
        const problem = triggerError(draft, ctx.now);
        if (problem) triggers[draft.key] = problem;
      }
      if (state.triggers.length > MAX_AGENT_TRIGGERS) fields.triggers = 'triggers_many';
      else {
        const built = state.triggers.map(triggerInputOf).filter((t) => t !== null);
        const keys = built.map((t) => `${t.kind}:${canonical(t.config)}`);
        if (new Set(keys).size !== keys.length) fields.triggers = 'triggers_same';
      }
      if (!state.allBrands && state.brandIds.length === 0) {
        fields.brands = ctx.setup.brands.length === 0 ? 'no_brands' : 'brand_required';
      }
      if (state.engines.length > 10) fields.engines = 'engines_many';
      const tags = parseList(state.tagsText);
      if (tags.length > 20 || tags.some((tag) => tag.length > 50)) fields.tags = 'tags_invalid';
      const urls = parseList(state.urlsText);
      if (urls.length > 20 || urls.some((url) => !httpUrl.safeParse(url).success)) {
        fields.urls = 'urls_invalid';
      }
      if (Object.keys(fields).length === 0 && !agentScopeSchema.safeParse(scopeOf(state)).success) {
        fields.brands = 'scope_invalid';
      }
      break;
    }
    case 2:
      if (state.mode === 'full_auto' && ctx.setup.fullAuto !== 'open') {
        fields.mode = ctx.setup.fullAuto === 'plan' ? 'full_auto_plan' : 'full_auto_off';
      }
      break;
    case 3: {
      const name = foldName(state.name);
      if (!name) fields.name = 'name_required';
      else if (name.length > MAX_NAME) fields.name = 'name_long';
      if (!wholeIn(state.maxRun, 1, 50)) fields.maxRun = 'run_share';
      if (ctx.setup.role === 'admin' && state.monthCapOn && !wholeIn(state.maxMonth, 1, 100)) {
        fields.maxMonth = 'month_share';
      }
      if (
        state.visibility === 'workspace' &&
        ctx.setup.role !== 'admin' &&
        ctx.setup.workspaceAgentsAdminsOnly &&
        ctx.agent?.visibility !== 'workspace'
      ) {
        fields.visibility = 'workspace_admins_only';
      }
      break;
    }
  }
  return { fields, triggers };
}

export const hasProblems = (problems: StepProblems) =>
  Object.keys(problems.fields).length > 0 || Object.keys(problems.triggers).length > 0;

/** The first step from `from` up to `to` (not included) that isn't ready, or null. */
export function firstStepWithProblems(
  state: AgentFormState,
  ctx: FormContext,
  to: number = AGENT_FORM_STEPS.length,
  from = 0,
): AgentFormStep | null {
  for (let step = from; step < to; step++) {
    if (hasProblems(stepProblems(step as AgentFormStep, state, ctx))) return step as AgentFormStep;
  }
  return null;
}

// ─── What is sent ────────────────────────────────────────────────────────────

function builtTriggers(state: AgentFormState) {
  return state.triggers.map(triggerInputOf).filter((t) => t !== null);
}

/** A share from a percent as typed: "10" → 0.1. */
const shareOf = (percent: string) => Math.round(Number(percent)) / 100;

/**
 * POST /api/chat/agents's body: a new draft. The monthly cap only an Admin
 * sends (CHAT-27 item 23). A name the person didn't type goes as the
 * skill's title (`autoTitle`) for the server to name by §O against every
 * agent, the ones the person can't see included.
 */
export function createBody(
  state: AgentFormState,
  role: TeamRole,
  autoTitle: string | null = null,
): Record<string, unknown> {
  const auto = !state.nameEdited && !!autoTitle;
  return {
    name: auto ? autoTitle : foldName(state.name),
    ...(auto ? { autoName: true } : {}),
    visibility: state.visibility,
    maxRunShare: shareOf(state.maxRun),
    ...(role === 'admin'
      ? { maxMonthShare: state.monthCapOn ? shareOf(state.maxMonth) : null }
      : {}),
    skills: state.skills,
    instructions: state.instructions.trim() || null,
    mode: state.mode,
    connections: state.connections,
    model: state.model,
    effort: state.effort,
    scope: scopeOf(state),
    notifyUserIds: state.notifyUserIds,
    followupDays: state.followupDays,
    triggers: builtTriggers(state),
  };
}

/**
 * PATCH /{id}'s body: only what changed, with the version and the
 * `updatedAt` the form opened (a save over someone else's, even one that
 * made no new version, is refused). Null when nothing changed.
 */
export function patchBody(
  state: AgentFormState,
  agent: AgentDetail,
  role: TeamRole,
): Record<string, unknown> | null {
  const settings = agent.settings;
  if (!settings) return null;
  const patch: Record<string, unknown> = {};
  const name = foldName(state.name);
  if (name !== agent.name) patch.name = name;
  if (state.visibility !== agent.visibility) patch.visibility = state.visibility;
  const run = shareOf(state.maxRun);
  if (Math.round(run * 100) !== Math.round(agent.maxRunShare * 100)) patch.maxRunShare = run;
  if (role === 'admin') {
    const month = state.monthCapOn ? shareOf(state.maxMonth) : null;
    const was = agent.maxMonthShare;
    if ((month === null) !== (was === null) || (month !== null && was !== null && month !== was)) {
      patch.maxMonthShare = month;
    }
  }
  if (canonical(state.skills) !== canonical(settings.skills)) patch.skills = state.skills;
  const instructions = state.instructions.trim() || null;
  if (instructions !== (settings.instructions ?? null)) patch.instructions = instructions;
  if (state.mode !== settings.mode) patch.mode = state.mode;
  if (canonical(state.connections) !== canonical(settings.connections)) {
    patch.connections = state.connections;
  }
  if (state.model !== settings.model) patch.model = state.model;
  const scope = scopeOf(state);
  if (scopeKey(scope) !== scopeKey(settings.scope)) patch.scope = scope;
  const triggers = builtTriggers(state);
  const was = agent.triggers.map((t) => ({ kind: t.kind, config: t.config, enabled: t.enabled }));
  if (canonical(triggers) !== canonical(was)) patch.triggers = triggers;
  if (Object.keys(patch).length === 0) return null;
  return { expectedVersion: agent.version, expectedUpdatedAt: agent.updatedAt, ...patch };
}

// ─── The server's refusals ───────────────────────────────────────────────────

/**
 * The step and field a refusal of the server belongs to: a name taken on
 * the last step, a past one-off on the triggers, the plan's engines on the
 * scope, Full auto on the modes, sharing and the monthly cap on the last
 * step. `asked` names what a denial refused (chatAgents.asked). The rest
 * (the plan's active agents, the AI limit, a save over another) is the
 * last step's line.
 */
export function refusalPlace(
  code: string | null,
  asked: string | null,
): { step: AgentFormStep; field: FormField } {
  switch (code) {
    case 'name_taken':
    case 'name_taken_hidden':
      return { step: 3, field: 'name' };
    case 'schedule_past':
    case 'schedule_too_far':
      return { step: 1, field: 'triggers' };
    case 'brand_not_found':
    case 'topic_not_found':
    case 'no_brand':
    case 'demo_brand':
      return { step: 1, field: 'brands' };
    // The box under the Approvals table (AUTONOMOUS-GO-LIVE §7.2).
    case 'go_live_off':
    case 'go_live_mode':
      return { step: 2, field: 'form' };
  }
  switch (asked) {
    case 'fullAuto':
      return { step: 2, field: 'mode' };
    case 'goLive':
      return { step: 2, field: 'form' };
    case 'engines':
      return { step: 1, field: 'engines' };
    case 'workspace':
      return { step: 3, field: 'visibility' };
    case 'monthCap':
      return { step: 3, field: 'maxMonth' };
  }
  return { step: LAST_STEP, field: 'form' };
}
