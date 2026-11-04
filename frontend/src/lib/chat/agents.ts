import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { PLANS } from '@/config/plans';
import {
  allowedBrands,
  brandAccessOf,
  hasBrandAccess,
  readAccessProfile,
  readBrandAccess,
  type BrandAccess,
} from '@/lib/brandAccess';
import { ORG_PLAN_COLUMNS } from '@/lib/guards/planRow';
import { getAiUsageFor } from '@/lib/mcp/account';
import { DEMO_BRAND } from '@/lib/subscriptionGuard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { recordAccessDenied } from './accessLog';
import { logActivity, summaryValue } from './activity';
import { connectionName, missingRequiredConnection } from './agentConnections';
import { offAgentSkill } from './agentSkills';
import {
  AGENT_PAUSED_REASONS,
  AGENT_STATUSES,
  AGENT_TRIGGER_KINDS,
  AGENT_VISIBILITIES,
  DEFAULT_AGENT_SETTINGS,
  agentActDenial,
  agentPlanLimits,
  agentTriggerSchema,
  canSeeAgent,
  copyName,
  defaultAgentName,
  editable,
  enginesDenial,
  enginesNamed,
  firstVersion,
  lifecycleTarget,
  modeDenial,
  monthCapDenial,
  nameKey,
  nextVersion,
  triggerTimeProblem,
  versionFromRow,
  visibilityDenial,
  type AgentAct,
  type AgentAsk,
  type AgentDenial,
  type AgentFacts,
  type AgentLifecycleAction,
  type AgentListView,
  type AgentPausedReason,
  type AgentPlanLimits,
  type AgentScope,
  type AgentSettings,
  type AgentStatus,
  type AgentTriggerInput,
  type AgentTriggerKind,
  type AgentVersionData,
  type AgentViewer,
  type AgentVisibility,
  type CreateAgentInput,
  type UpdateAgentInput,
} from './agentRules';
import { nextScheduleFire } from './agentSchedule';
import { readAgentShares } from './agentShares';
import { buildActionDenial } from './denial';
import { canonicalJson } from './idempotency';
import type { ChatActor } from './engine';
import type { ChatDenialCard } from './events';
import { OwnKeyUnreadableError, failingOwnKey, resolveChatModelKey } from './key';
import type { FailingKey, OwnKeyFailure } from './keyHealth';
import {
  readAgentGoLive,
  readGoLiveLimits,
  tellGoLiveOff,
  type AgentGoLiveDetail,
} from './agentGoLive';
import { ownKeyCapReached } from './ownKeyCap';
import { planFactsFromOrgRow, type PlanFacts } from './planFacts';
import { parseTeamRole, type ChatMode, type ToolDenial } from './precedence';
import { agentSkillStates } from './skills/store';

/**
 * Chat's agents (CHAT-21; CHAT-27 §E): the definitions behind Chat ›
 * Agents, read and written by the server for the agents API
 * (/api/chat/agents…). An agent is one saved object: its row (name, state,
 * owner, visibility, caps), one immutable version per change of what it does
 * (§C item 14), and its triggers (§E). Every read checks who may see the
 * agent (agentRules.ts canSeeAgent, as 00419's policies); every write who
 * may change it, what the plan allows and the state it is in, then writes
 * with the service role and logs the change in the Activity log with the
 * agent (CHAT-27 item 29). A refusal is a value: the out-of-permission
 * answer (CHAT-20 §4c) or a plain one, never a throw (#1777).
 *
 * What leaves for the browser: an agent's handle for its routes (its id),
 * names, states, the settings its editor shows (brand and person ids
 * included, which the editor picks by), and shares of the AI limit. Never a
 * dollar, a tool's name, or a run's, version's or trigger's own id. Server
 * only.
 */

// ─── Who asks ────────────────────────────────────────────────────────────────

/** Everything a request is decided on: the person, their live role, the plan and the settings. */
export interface AgentContext {
  actor: ChatActor;
  viewer: AgentViewer;
  plan: PlanFacts;
  settings: AgentSettings;
}

interface SettingsRow {
  agent_run_share_default: number;
  agents_full_auto: boolean;
  workspace_agents_admins_only: boolean;
  full_auto_for_members: boolean;
}

/** A chat_settings row as the agents read it; no row, the defaults. */
export function agentSettingsOf(row: SettingsRow | null): AgentSettings {
  if (!row) return DEFAULT_AGENT_SETTINGS;
  return {
    runShareDefault: Number(row.agent_run_share_default) || DEFAULT_AGENT_SETTINGS.runShareDefault,
    agentsFullAuto: row.agents_full_auto,
    workspaceAgentsAdminsOnly: row.workspace_agents_admins_only,
    fullAutoForMembers: row.full_auto_for_members,
  };
}

/**
 * The context for one request, read fresh, or null when the person can't
 * act in the workspace now (no profile there, or no live role). A read that
 * fails throws: nothing is decided on missing facts.
 */
export async function readAgentContext(actor: ChatActor): Promise<AgentContext | null> {
  const [profile, org, settings] = await Promise.all([
    readAccessProfile(actor.userId),
    supabaseAdmin
      .from('organizations')
      .select(ORG_PLAN_COLUMNS)
      .eq('id', actor.organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_settings')
      .select(
        'agent_run_share_default, agents_full_auto, workspace_agents_admins_only, full_auto_for_members',
      )
      .eq('organization_id', actor.organizationId)
      .maybeSingle(),
  ]);
  for (const result of [org, settings]) {
    if (result.error) throw new Error(`Could not read the agent's facts: ${result.error.message}`);
  }
  const role = parseTeamRole(profile?.role);
  if (!role || profile?.organization_id !== actor.organizationId || !org.data) return null;
  // The brands they may use now (BRAND-ACCESS): what they see of agents, and where a run goes.
  const brandAccess = (await brandAccessOf(profile, actor.userId, actor.organizationId)) ?? [];
  return {
    actor,
    viewer: { userId: actor.userId, role, brandAccess },
    plan: planFactsFromOrgRow(org.data),
    settings: agentSettingsOf(settings.data as SettingsRow | null),
  };
}

// ─── Refusals ────────────────────────────────────────────────────────────────

/** A plain refusal's code; its words are chatAgents.refusal.{code}, the demo brand's the app's own. */
export type AgentRefusalCode =
  | 'invalid'
  | 'not_found'
  | 'name_taken'
  | 'name_taken_hidden'
  | 'wrong_status'
  | 'archived'
  | 'version_conflict'
  | 'schedule_past'
  | 'schedule_too_far'
  | 'brand_not_found'
  | 'topic_not_found'
  | 'member_not_found'
  | 'demo_brand'
  | 'agent_limit'
  | 'no_brand'
  | 'ai_limit'
  | 'own_key_cap'
  | 'owner_role'
  | 'action_not_found'
  | 'action_closed'
  | 'queue_full'
  | 'connection_missing'
  | 'own_key_failed'
  | 'skill_off'
  /** Going live on its own: the workspace's switch is off, or the agent isn't in Full auto. */
  | 'go_live_off'
  | 'go_live_mode'
  | 'failed';

export type AgentRefusal =
  /**
   * The out-of-permission answer (CHAT-20 §4c): a role, the plan or a
   * Settings › Chat switch; `asked`, what it refused, so the create flow
   * shows it on its step (Full auto on the modes, sharing on the last).
   */
  | {
      kind: 'denied';
      status: 402 | 403;
      code: ToolDenial['code'];
      denial: ChatDenialCard;
      asked?: AgentAsk;
    }
  | {
      kind: 'refused';
      status: number;
      code: AgentRefusalCode;
      message: string;
      /** What the words were filled with: the state, the plan's limit. */
      detail?: Record<string, string | number>;
    };

export type AgentResult<T> = { ok: true; value: T } | { ok: false; refusal: AgentRefusal };
export type Refused = { ok: false; refusal: AgentRefusal };

const refusalT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.refusal' });
const ownKeyT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.ownKey' });
const settingsT = createTranslator({ locale: 'en', messages, namespace: 'settings' });
const askedT = createTranslator({ locale: 'en', messages, namespace: 'chatAgents.asked' });

const REFUSAL_STATUS: Record<AgentRefusalCode, number> = {
  invalid: 400,
  not_found: 404,
  name_taken: 409,
  name_taken_hidden: 409,
  wrong_status: 409,
  archived: 409,
  version_conflict: 409,
  schedule_past: 400,
  schedule_too_far: 400,
  brand_not_found: 400,
  topic_not_found: 400,
  member_not_found: 400,
  demo_brand: 402,
  agent_limit: 403,
  no_brand: 409,
  ai_limit: 429,
  own_key_cap: 429,
  owner_role: 409,
  action_not_found: 404,
  action_closed: 409,
  queue_full: 409,
  connection_missing: 409,
  own_key_failed: 409,
  skill_off: 409,
  go_live_off: 409,
  go_live_mode: 409,
  failed: 500,
};

/** A plain refusal, with its words. */
export function refused(code: AgentRefusalCode, detail?: Record<string, string | number>): Refused {
  const message =
    code === 'demo_brand'
      ? DEMO_BRAND.message
      : refusalT(code as Exclude<AgentRefusalCode, 'demo_brand'>, detail as never);
  return {
    ok: false,
    refusal: { kind: 'refused', status: REFUSAL_STATUS[code], code, message, detail },
  };
}

/** The Activity log's label for an agent's changes (chatTools.agents), a WRITE. */
const AGENTS_LABEL = { labelKey: 'agents', class: 'write' } as const;

/**
 * The out-of-permission answer for a refusal the rules gave, recorded in
 * the Activity log as an access.denied row (CHAT-20 §4c), as Chat's own
 * denials are.
 */
export async function denied(ctx: AgentContext, { denial, asked }: AgentDenial): Promise<Refused> {
  const answer = buildActionDenial(denial, {
    action: askedT(asked),
    role: ctx.viewer.role,
    plan: ctx.plan,
  });
  const card: ChatDenialCard = {
    asked: answer.asked,
    rule: answer.rule,
    whoCan: answer.whoCan,
    nextActions: answer.nextActions,
  };
  if (answer.plan) card.needsPlan = PLANS[answer.plan.needs].name;
  await recordAccessDenied(
    {
      userId: ctx.actor.userId,
      organizationId: ctx.actor.organizationId,
      brandId: null,
      toolKey: AGENTS_LABEL.labelKey,
      toolClass: AGENTS_LABEL.class,
      surface: 'chat',
    },
    denial,
  );
  return {
    ok: false,
    refusal: { kind: 'denied', status: answer.status, code: denial.code, denial: card, asked },
  };
}

/** The first refusal of a list of checks, as the person gets it; null when all pass. */
async function firstDenial(
  ctx: AgentContext,
  checks: (AgentDenial | null)[],
): Promise<Refused | null> {
  const denial = checks.find((check): check is AgentDenial => check !== null);
  return denial ? denied(ctx, denial) : null;
}

// ─── Rows ────────────────────────────────────────────────────────────────────

const AGENT_COLUMNS =
  'id, organization_id, name, status, paused_reason, owner_id, visibility, version, max_run_share, max_month_share, created_by, created_at, updated_at, activated_at, archived_at';
const VERSION_COLUMNS =
  'agent_id, version, skill_ids, instructions, mode, connections, model, effort, scope, notify_user_ids, followup_days, created_at';
const TRIGGER_COLUMNS = 'id, agent_id, kind, config_json, enabled, last_fired_at, created_at';
const RUN_COLUMNS =
  'id, agent_id, agent_version, brand_id, trigger_kind, acting_user_id, status, skipped_reason, stop_reason, max_share, usage_share, outcome, outcome_confidence, queued_at, started_at, finished_at';

/** Agents the list reads at most: past the plans' active caps, drafts and archives included. */
const AGENT_LIST_MAX = 500;
/** Runs the list reads for its last run and 30-day outcomes. */
const LIST_RUNS_MAX = 2000;
/** Runs the detail's Overview shows (§C item 11). */
const RECENT_RUNS = 5;

export interface AgentRow {
  id: string;
  organization_id: string;
  name: string;
  status: AgentStatus;
  paused_reason: AgentPausedReason | null;
  owner_id: string | null;
  visibility: AgentVisibility;
  version: number;
  max_run_share: number;
  max_month_share: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  archived_at: string | null;
}

interface VersionRow {
  agent_id: string;
  version: number;
  skill_ids: string[];
  instructions: string | null;
  mode: string;
  connections: Json;
  model: string;
  effort: string;
  scope: Json;
  notify_user_ids: string[];
  followup_days: number;
  created_at: string;
}

interface TriggerRow {
  id: string;
  agent_id: string;
  kind: string;
  config_json: Json;
  enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
}

export interface RunRow {
  id: string;
  agent_id: string | null;
  agent_version: number;
  brand_id: string | null;
  trigger_kind: string;
  acting_user_id: string | null;
  status: string;
  skipped_reason: string | null;
  stop_reason: string | null;
  max_share: number;
  usage_share: number;
  outcome: string | null;
  outcome_confidence: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function toAgentRow(row: Record<string, unknown>): AgentRow {
  const status = AGENT_STATUSES.find((s) => s === row.status) ?? 'draft';
  return {
    ...(row as unknown as AgentRow),
    status,
    paused_reason: AGENT_PAUSED_REASONS.find((r) => r === row.paused_reason) ?? null,
    visibility: AGENT_VISIBILITIES.find((v) => v === row.visibility) ?? 'private',
    max_run_share: Number(row.max_run_share),
    max_month_share: row.max_month_share === null ? null : Number(row.max_month_share),
  };
}

/** An agent with its current version: what every act starts from. */
export interface LoadedAgent {
  row: AgentRow;
  /** Null when the version is missing (a create that didn't finish): it can't run. */
  version: AgentVersionData | null;
}

const factsOf = (agent: LoadedAgent): AgentFacts => ({
  ownerId: agent.row.owner_id,
  visibility: agent.row.visibility,
  scope: agent.version?.scope ?? { brand_ids: [] },
});

/** One agent of the workspace with its current version, or null. */
export async function loadAgent(organizationId: string, id: string): Promise<LoadedAgent | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select(AGENT_COLUMNS)
    .eq('id', id)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent: ${error.message}`);
  if (!data) return null;
  const row = toAgentRow(data as Record<string, unknown>);
  const version = await supabaseAdmin
    .from('chat_agent_versions')
    .select(VERSION_COLUMNS)
    .eq('agent_id', id)
    .eq('version', row.version)
    .maybeSingle();
  if (version.error) throw new Error(`Could not read the agent: ${version.error.message}`);
  return { row, version: version.data ? versionFromRow(version.data as VersionRow) : null };
}

/** The agent when the person may see it; null (not found) otherwise, never "it exists". */
async function visibleAgent(ctx: AgentContext, id: string): Promise<LoadedAgent | null> {
  const agent = await loadAgent(ctx.actor.organizationId, id);
  return agent && canSeeAgent(factsOf(agent), ctx.viewer) ? agent : null;
}

/**
 * An agent the person may see and may `act` on; else not found (one they
 * can't see), or the out-of-permission answer (one they can see).
 */
export async function agentForAct(
  ctx: AgentContext,
  id: string,
  act: AgentAct,
): Promise<{ ok: true; agent: LoadedAgent } | Refused> {
  const agent = await visibleAgent(ctx, id);
  if (!agent) return refused('not_found');
  const denial = await firstDenial(ctx, [
    agentActDenial(act, ctx.viewer, factsOf(agent), ctx.settings),
  ]);
  return denial ?? { ok: true, agent };
}

async function triggersOf(agentIds: string[]): Promise<TriggerRow[]> {
  if (agentIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('chat_agent_triggers')
    .select(TRIGGER_COLUMNS)
    .in('agent_id', agentIds)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Could not read the agents' triggers: ${error.message}`);
  return (data ?? []) as TriggerRow[];
}

interface Brand {
  id: string;
  name: string;
  is_demo: boolean;
}

async function brandsOf(organizationId: string): Promise<Brand[]> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id, name, is_demo')
    .eq('organization_id', organizationId);
  if (error) throw new Error(`Could not read the workspace's brands: ${error.message}`);
  return (data ?? []) as Brand[];
}

/** People's names by id, in the workspace: their profile's. */
async function namesOf(organizationId: string, ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return names;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('organization_id', organizationId)
    .in('id', wanted);
  if (error) throw new Error(`Could not read the people: ${error.message}`);
  for (const row of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (row.full_name?.trim()) names.set(row.id, row.full_name.trim());
  }
  return names;
}

/** "Sam Lee" → "SL"; one name → its letter; none → null. */
function initialsOf(name: string | null | undefined): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const letters = parts.length === 1 ? [parts[0][0]] : [parts[0][0], parts[parts.length - 1][0]];
  return letters.join('').toUpperCase();
}

/**
 * A run the person may see: on a brand they can access, or for one whose
 * brand is gone, with All brands; as chat_agent_runs' policy has it (00424).
 */
const runVisible = (run: Pick<RunRow, 'brand_id'>, access: BrandAccess) =>
  run.brand_id ? hasBrandAccess(access, run.brand_id) : access === 'all';

/**
 * The brands a scope covers among `brands`: every one for all_brands. Give
 * it the brands the person may use, so all_brands is all of theirs
 * (BRAND-ACCESS §5.3).
 */
function scopeBrands(scope: AgentScope, brands: readonly Brand[]): Brand[] {
  if (scope.all_brands) return [...brands];
  const ids = new Set(scope.brand_ids ?? []);
  return brands.filter((brand) => ids.has(brand.id));
}

// ─── What the browser gets ───────────────────────────────────────────────────

/** A trigger as the list and detail show it (its settings as kept, its next fire). */
export interface AgentTriggerView {
  kind: AgentTriggerKind;
  config: Json;
  enabled: boolean;
  /** A schedule's next fire, ISO; null for an event trigger ("Fires when …") or a past one-off. */
  nextFireAt: string | null;
  lastFiredAt: string | null;
}

export const AGENT_OUTCOMES = [
  'pending',
  'improved',
  'no_meaningful_change',
  'declined',
  'not_measurable',
] as const;
export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];

/** A share of the monthly AI limit (CHAT-27 items 24–25); never dollars. */
export interface AgentUsageView {
  share: number;
  /** What it ran on the workspace's own key, over the same limit ("on your own key"). */
  ownKeyShare: number;
  runs: number;
}

/** One row of the Agents list (§B item 6). */
export interface AgentListItem {
  /** The agent's handle for its routes. */
  id: string;
  name: string;
  status: AgentStatus;
  pausedReason: AgentPausedReason | null;
  visibility: AgentVisibility;
  /** The person owns it. */
  mine: boolean;
  ownerInitials: string | null;
  /** In order: the primary skill first. */
  skills: string[];
  mode: ChatMode | null;
  triggers: AgentTriggerView[];
  scope: { allBrands: boolean; brands: string[] };
  lastRun: { status: string; at: string } | null;
  /** Outcomes of its runs in the last 30 days (§B item 6), by the one vocabulary (§I item 43). */
  outcomes30d: Record<AgentOutcome, number>;
  /** Its AI use over the last 30 days (CHAT-27 item 24); null when it couldn't be read or isn't metered. */
  usage30d: AgentUsageView | null;
  /** Shares of the monthly AI limit (CHAT-27 items 19, 23). */
  maxRunShare: number;
  maxMonthShare: number | null;
  version: number;
  updatedAt: string;
  /** The row's buttons the person may use now (§B item 7), as the detail's `can` decides them. */
  can: Pick<AgentAbilities, 'run' | 'pause' | 'resume'>;
  /**
   * It publishes and sends on its own, at most this many a day
   * (AUTONOMOUS-GO-LIVE §7.2): its card's badge. Absent when it doesn't.
   */
  goLiveLimit?: number;
}

export interface AgentListResult {
  agents: AgentListItem[];
  /**
   * The workspace runs on its own AI key and it is marked failing
   * (AGENT-OWN-KEY §5.2 item 6): Agent Center's banner. Null otherwise.
   */
  keyFailure: FailingKey | null;
  /** The tabs' counts (§B item 5). */
  counts: Record<AgentListView, number>;
  /** Active agents the person sees ("Agents 6", §A item 1). */
  active: number;
  /** Active agents in the workspace, against the plan's cap (null: none) (§M item 57). */
  activeInWorkspace: number;
  activeLimit: number | null;
}

/** A run as the detail's Overview and Runs tab show it (§C item 13, CHAT-27 item 25). */
export interface AgentRunView {
  status: string;
  triggerKind: string;
  version: number;
  brand: string | null;
  /** Who it acted as, by name ("Manual · Ayşe"). */
  by: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  skippedReason: string | null;
  stopReason: string | null;
  outcome: string | null;
  outcomeConfidence: string | null;
  /** Shares of the monthly AI limit: what it used of its cap ("3.2% of 10%"). */
  usageShare: number;
  maxShare: number;
  /** Its chat's handle, once its run has one (§H item 36). */
  chatId: string | null;
}

/** What an agent does, as its Settings tab edits it (§C item 14): the stored shapes. */
export interface AgentSettingsView {
  skills: string[];
  instructions: string | null;
  mode: ChatMode;
  connections: AgentVersionData['connections'];
  model: string;
  effort: AgentVersionData['effort'];
  scope: AgentScope;
  notifyUserIds: string[];
  followupDays: number;
}

/** What the person may do with it now, so the page shows only those buttons. */
export type AgentAbilities = Record<AgentAct, boolean>;

export interface AgentDetail extends AgentListItem {
  createdAt: string;
  activatedAt: string | null;
  archivedAt: string | null;
  /** Null for an agent whose version is missing. */
  settings: AgentSettingsView | null;
  /** The scope's brands that are still there, by id and name, for the editor. */
  brands: { id: string; name: string }[];
  recentRuns: AgentRunView[];
  /** This period's AI use (CHAT-27 item 25: "This period: x%"). */
  usagePeriod: AgentUsageView | null;
  can: AgentAbilities;
  /** The plan's agent limits (§M). */
  limits: AgentPlanLimits;
  /**
   * Its permission to publish and send on its own, the workspace's switch
   * and its last day's go-lives (agentGoLive.ts); absent while
   * CHAT_AUTO_GO_LIVE is off.
   */
  goLive?: AgentGoLiveDetail;
}

function triggerView(row: TriggerRow, now: Date): AgentTriggerView {
  const kind = AGENT_TRIGGER_KINDS.find((k) => k === row.kind) ?? 'schedule';
  return {
    kind,
    config: row.config_json,
    enabled: row.enabled,
    nextFireAt: kind === 'schedule' && row.enabled ? nextScheduleFire(row.config_json, now) : null,
    lastFiredAt: row.last_fired_at,
  };
}

const emptyOutcomes = (): Record<AgentOutcome, number> =>
  Object.fromEntries(AGENT_OUTCOMES.map((o) => [o, 0])) as Record<AgentOutcome, number>;

function listItem(
  ctx: AgentContext,
  agent: LoadedAgent,
  parts: {
    triggers: TriggerRow[];
    runs: RunRow[];
    brands: readonly Brand[];
    owners: Map<string, string>;
    usage: AgentUsageView | null;
    now: Date;
  },
): AgentListItem {
  const { row, version } = agent;
  const access = ctx.viewer.brandAccess;
  // Only what the person may see: their brands' names, and runs on them (BRAND-ACCESS).
  const runs = parts.runs.filter((run) => runVisible(run, access));
  const since = parts.now.getTime() - 30 * 86_400_000;
  const outcomes = emptyOutcomes();
  for (const run of runs) {
    const outcome = AGENT_OUTCOMES.find((o) => o === run.outcome);
    if (outcome && Date.parse(run.queued_at) >= since) outcomes[outcome] += 1;
  }
  const last = runs[0];
  const scope = version?.scope ?? { brand_ids: [] };
  const can = abilitiesOf(ctx, agent);
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pausedReason: row.paused_reason,
    visibility: row.visibility,
    mine: row.owner_id === ctx.actor.userId,
    ownerInitials: row.owner_id ? initialsOf(parts.owners.get(row.owner_id)) : null,
    skills: version?.skill_ids ?? [],
    mode: version?.mode ?? null,
    triggers: parts.triggers.map((t) => triggerView(t, parts.now)),
    scope: {
      allBrands: scope.all_brands === true,
      brands: scopeBrands(scope, allowedBrands(access, parts.brands)).map((b) => b.name),
    },
    lastRun: last
      ? { status: last.status, at: last.finished_at ?? last.started_at ?? last.queued_at }
      : null,
    outcomes30d: outcomes,
    usage30d: parts.usage,
    maxRunShare: row.max_run_share,
    maxMonthShare: row.max_month_share,
    version: row.version,
    updatedAt: row.updated_at,
    can: { run: can.run, pause: can.pause, resume: can.resume },
  };
}

const usageOf = (
  shares: Awaited<ReturnType<typeof readAgentShares>>,
  agentId: string,
): AgentUsageView | null => {
  if (!shares || shares.unlimited) return null;
  return shares.byAgent.get(agentId) ?? { share: 0, ownKeyShare: 0, runs: 0 };
};

/** Every act's answer for the person, so the page shows only the buttons that work. */
function abilitiesOf(ctx: AgentContext, agent: LoadedAgent): AgentAbilities {
  const may = (act: AgentAct) =>
    agentActDenial(act, ctx.viewer, factsOf(agent), ctx.settings) === null;
  const status = agent.row.status;
  const to = (action: AgentLifecycleAction) =>
    may(action) && lifecycleTarget(action, status) !== undefined;
  return {
    create: may('create'),
    edit: may('edit') && editable(status),
    activate: to('activate'),
    pause: to('pause'),
    resume: to('resume'),
    archive: to('archive'),
    restore: to('restore'),
    delete: to('delete'),
    duplicate: may('duplicate') && agent.version !== null,
    takeOver: may('takeOver') && status !== 'archived' && agent.row.owner_id !== ctx.actor.userId,
    run: may('run') && status !== 'archived' && agent.version !== null,
  };
}

function runView(
  run: RunRow,
  brands: ReadonlyMap<string, string>,
  people: ReadonlyMap<string, string>,
  chats: ReadonlyMap<string, string>,
): AgentRunView {
  return {
    status: run.status,
    triggerKind: run.trigger_kind,
    version: run.agent_version,
    brand: run.brand_id ? (brands.get(run.brand_id) ?? null) : null,
    by: run.acting_user_id ? (people.get(run.acting_user_id) ?? null) : null,
    queuedAt: run.queued_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    skippedReason: run.skipped_reason,
    stopReason: run.stop_reason,
    outcome: run.outcome,
    outcomeConfidence: run.outcome_confidence,
    usageShare: Number(run.usage_share),
    maxShare: Number(run.max_share),
    chatId: chats.get(run.id) ?? null,
  };
}

/**
 * Runs as the detail and the Runs tab show them, with their brand, person
 * and chat: the ones on a brand the person may see (runVisible). A run's
 * chat is given only when the person can open it as the
 * chat page reads chats today (`readChat`): their own, or shared with the
 * team. Anyone else's private chat would open on "This chat isn't
 * available".
 */
export async function runViews(
  organizationId: string,
  viewer: Pick<AgentViewer, 'userId' | 'brandAccess'>,
  allRuns: RunRow[],
): Promise<AgentRunView[]> {
  const viewerId = viewer.userId;
  const runs = allRuns.filter((run) => runVisible(run, viewer.brandAccess));
  if (runs.length === 0) return [];
  const [brands, people, chats] = await Promise.all([
    brandsOf(organizationId),
    namesOf(
      organizationId,
      runs.map((r) => r.acting_user_id).filter((id): id is string => !!id),
    ),
    supabaseAdmin
      .from('chat_conversations')
      .select('id, agent_run_id, user_id, shared_at')
      .eq('organization_id', organizationId)
      .in(
        'agent_run_id',
        runs.map((r) => r.id),
      )
      // A deleted chat (Delete with Undo, 00407) isn't opened from a run.
      .is('deleted_at', null),
  ]);
  if (chats.error) throw new Error(`Could not read the runs' chats: ${chats.error.message}`);
  const brandNames = new Map(brands.map((b) => [b.id, b.name]));
  const chatOf = new Map(
    (
      (chats.data ?? []) as {
        id: string;
        agent_run_id: string | null;
        user_id: string | null;
        shared_at: string | null;
      }[]
    ).flatMap((c) =>
      c.agent_run_id && (c.user_id === viewerId || c.shared_at !== null)
        ? [[c.agent_run_id, c.id] as const]
        : [],
    ),
  );
  return runs.map((run) => runView(run, brandNames, people, chatOf));
}

/** An agent's runs, newest first. */
export async function runsOf(agentId: string, limit: number): Promise<RunRow[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_runs')
    .select(RUN_COLUMNS)
    .eq('agent_id', agentId)
    .order('queued_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not read the agent's runs: ${error.message}`);
  return (data ?? []) as RunRow[];
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * The Agents list (§B): every agent the person may see, filtered to a tab —
 * Mine (theirs, not archived), Workspace (shared, not archived; for an
 * Admin, others' private ones too), Paused, Archived — and by a search on
 * its name or skills, newest change first, with each tab's count.
 */
export async function listAgents(
  ctx: AgentContext,
  query: { view: AgentListView; q?: string },
  now = new Date(),
): Promise<AgentListResult> {
  const org = ctx.actor.organizationId;
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select(AGENT_COLUMNS)
    .eq('organization_id', org)
    .order('updated_at', { ascending: false })
    .limit(AGENT_LIST_MAX);
  if (error) throw new Error(`Could not read the agents: ${error.message}`);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toAgentRow);

  // The current versions: only the version numbers in use, then each agent's own.
  const versions = new Map<string, AgentVersionData>();
  if (rows.length > 0) {
    const read = await supabaseAdmin
      .from('chat_agent_versions')
      .select(VERSION_COLUMNS)
      .in(
        'agent_id',
        rows.map((r) => r.id),
      )
      .in('version', [...new Set(rows.map((r) => r.version))]);
    if (read.error) throw new Error(`Could not read the agents: ${read.error.message}`);
    const current = new Map(rows.map((r) => [r.id, r.version]));
    for (const v of (read.data ?? []) as VersionRow[]) {
      if (current.get(v.agent_id) === v.version) versions.set(v.agent_id, versionFromRow(v));
    }
  }
  const visible = rows
    .map((row): LoadedAgent => ({ row, version: versions.get(row.id) ?? null }))
    .filter((agent) => canSeeAgent(factsOf(agent), ctx.viewer));

  const inView = (agent: LoadedAgent, view: AgentListView) => {
    const { status, owner_id, visibility } = agent.row;
    switch (view) {
      case 'mine':
        return owner_id === ctx.actor.userId && status !== 'archived';
      case 'workspace':
        // An Admin's: every agent in use, others' private ones too (§K item 51, edge case 1).
        return (
          status !== 'archived' &&
          (visibility === 'workspace' ||
            (ctx.viewer.role === 'admin' && owner_id !== ctx.actor.userId))
        );
      case 'paused':
        return status === 'paused';
      case 'archived':
        return status === 'archived';
    }
  };
  const counts = {
    mine: visible.filter((a) => inView(a, 'mine')).length,
    workspace: visible.filter((a) => inView(a, 'workspace')).length,
    paused: visible.filter((a) => inView(a, 'paused')).length,
    archived: visible.filter((a) => inView(a, 'archived')).length,
  };
  const needle = query.q?.toLowerCase();
  const shown = visible.filter(
    (agent) =>
      inView(agent, query.view) &&
      (!needle ||
        agent.row.name.toLowerCase().includes(needle) ||
        (agent.version?.skill_ids ?? []).some((skill) => skill.includes(needle))),
  );
  const ids = shown.map((a) => a.row.id);

  const [triggers, runs, brands, owners, shares, key] = await Promise.all([
    triggersOf(ids),
    ids.length
      ? supabaseAdmin
          .from('chat_agent_runs')
          .select(RUN_COLUMNS)
          .in('agent_id', ids)
          .order('queued_at', { ascending: false })
          .limit(LIST_RUNS_MAX)
      : Promise.resolve({ data: [], error: null }),
    brandsOf(org),
    namesOf(
      org,
      shown.map((a) => a.row.owner_id).filter((id): id is string => !!id),
    ),
    ids.length ? readAgentShares(org, 'days30') : Promise.resolve(null),
    failingOwnKey(org),
  ]);
  if (runs.error) throw new Error(`Could not read the agents' runs: ${runs.error.message}`);
  const runRows = (runs.data ?? []) as RunRow[];
  // The cards' "Publishes on its own" badge (AUTONOMOUS-GO-LIVE §7.2).
  const goLive = await readGoLiveLimits(
    org,
    shown.map((agent) => ({ id: agent.row.id, version: agent.row.version })),
  );

  return {
    agents: shown.map((agent) => {
      const item = listItem(ctx, agent, {
        triggers: triggers.filter((t) => t.agent_id === agent.row.id),
        runs: runRows.filter((r) => r.agent_id === agent.row.id),
        brands,
        owners,
        usage: usageOf(shares, agent.row.id),
        now,
      });
      const limit = goLive.get(agent.row.id);
      return limit === undefined ? item : { ...item, goLiveLimit: limit };
    }),
    counts,
    keyFailure: key ? { class: key.class, provider: key.provider } : null,
    active: visible.filter((a) => a.row.status === 'active').length,
    activeInWorkspace: rows.filter((r) => r.status === 'active').length,
    activeLimit: agentPlanLimits(ctx.plan).activeAgents,
  };
}

/**
 * The agents the person may run now (Run agent's picker, CHAT-21 §F item
 * 27): ones they see and may run (§K item 51), active or paused (Run now
 * starts a paused one too; a draft hasn't passed its activation checks),
 * with their current version. Newest change first.
 */
export async function runnableAgents(ctx: AgentContext): Promise<LoadedAgent[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select(AGENT_COLUMNS)
    .eq('organization_id', ctx.actor.organizationId)
    .in('status', ['active', 'paused'])
    .order('updated_at', { ascending: false })
    .limit(AGENT_LIST_MAX);
  if (error) throw new Error(`Could not read the agents: ${error.message}`);
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toAgentRow);
  if (rows.length === 0) return [];
  const read = await supabaseAdmin
    .from('chat_agent_versions')
    .select(VERSION_COLUMNS)
    .in(
      'agent_id',
      rows.map((r) => r.id),
    )
    .in('version', [...new Set(rows.map((r) => r.version))]);
  if (read.error) throw new Error(`Could not read the agents: ${read.error.message}`);
  const current = new Map(rows.map((r) => [r.id, r.version]));
  const versions = new Map<string, AgentVersionData>();
  for (const v of (read.data ?? []) as VersionRow[]) {
    if (current.get(v.agent_id) === v.version) versions.set(v.agent_id, versionFromRow(v));
  }
  return rows
    .map((row): LoadedAgent => ({ row, version: versions.get(row.id) ?? null }))
    .filter(
      (agent) =>
        agent.version !== null &&
        canSeeAgent(factsOf(agent), ctx.viewer) &&
        agentActDenial('run', ctx.viewer, factsOf(agent), ctx.settings) === null,
    );
}

/** One agent as its detail shows it (§C), or null when the person can't see it. */
export async function readAgent(
  ctx: AgentContext,
  id: string,
  now = new Date(),
): Promise<AgentDetail | null> {
  const agent = await visibleAgent(ctx, id);
  return agent ? detailOf(ctx, agent, now) : null;
}

async function detailOf(ctx: AgentContext, agent: LoadedAgent, now: Date): Promise<AgentDetail> {
  const org = ctx.actor.organizationId;
  const { row, version } = agent;
  const [triggers, runs, brands, owners, period, days30, goLive] = await Promise.all([
    triggersOf([row.id]),
    runsOf(row.id, RECENT_RUNS),
    brandsOf(org),
    namesOf(org, row.owner_id ? [row.owner_id] : []),
    readAgentShares(org, 'period'),
    readAgentShares(org, 'days30'),
    readAgentGoLive(org, row.id, row.version, now),
  ]);
  const item = listItem(ctx, agent, {
    triggers,
    runs,
    brands,
    owners,
    usage: usageOf(days30, row.id),
    now,
  });
  return {
    ...item,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
    settings: version
      ? {
          skills: version.skill_ids,
          instructions: version.instructions,
          mode: version.mode,
          connections: version.connections,
          model: version.model,
          effort: version.effort,
          scope: version.scope,
          notifyUserIds: version.notify_user_ids,
          followupDays: version.followup_days,
        }
      : null,
    brands: version
      ? scopeBrands(version.scope, allowedBrands(ctx.viewer.brandAccess, brands)).map((b) => ({
          id: b.id,
          name: b.name,
        }))
      : [],
    recentRuns: await runViews(org, ctx.viewer, runs),
    usagePeriod: usageOf(period, row.id),
    can: abilitiesOf(ctx, agent),
    limits: agentPlanLimits(ctx.plan),
    ...(goLive ? { goLive } : {}),
  };
}

/** An agent's last runs (the Runs tab, §C item 13), or null when the person can't see it. */
export async function listAgentRuns(
  ctx: AgentContext,
  id: string,
  limit: number,
): Promise<AgentRunView[] | null> {
  const agent = await visibleAgent(ctx, id);
  if (!agent) return null;
  return runViews(ctx.actor.organizationId, ctx.viewer, await runsOf(agent.row.id, limit));
}

// ─── Checks before a write ───────────────────────────────────────────────────

/**
 * A version's references, checked in the workspace: its brands are the
 * workspace's, ones the person saving it may use (BRAND-ACCESS: another is
 * as not found), and none is the demo brand (00380: nothing runs on it),
 * its topics belong to its brands, and the people it tells are members.
 */
async function referencesRefusal(
  ctx: AgentContext,
  version: Pick<AgentVersionData, 'scope' | 'notify_user_ids'>,
): Promise<Refused | null> {
  const organizationId = ctx.actor.organizationId;
  const brands = allowedBrands(ctx.viewer.brandAccess, await brandsOf(organizationId));
  const scope = version.scope;
  const byId = new Map(brands.map((b) => [b.id, b]));
  for (const id of scope.brand_ids ?? []) {
    const brand = byId.get(id);
    if (!brand) return refused('brand_not_found');
    if (brand.is_demo) return refused('demo_brand');
  }
  const topicIds = scope.topic_ids ?? [];
  if (topicIds.length > 0) {
    const inScope = new Set(scopeBrands(scope, brands).map((b) => b.id));
    const { data, error } = await supabaseAdmin
      .from('topics')
      .select('id, brand_id')
      .in('id', topicIds);
    if (error) throw new Error(`Could not read the scope's topics: ${error.message}`);
    const found = (data ?? []) as { id: string; brand_id: string }[];
    if (found.length !== topicIds.length || found.some((t) => !inScope.has(t.brand_id))) {
      return refused('topic_not_found');
    }
  }
  const people = version.notify_user_ids;
  if (people.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('organization_id', organizationId)
      .in('id', people);
    if (error) throw new Error(`Could not read the people to notify: ${error.message}`);
    if ((data ?? []).length !== people.length) return refused('member_not_found');
  }
  return null;
}

interface NamedAgent {
  id: string;
  name: string;
  owner_id: string | null;
  visibility: AgentVisibility;
}

/** Every agent's name in the workspace, with who may see it (§O: names are one a workspace). */
async function agentNames(organizationId: string): Promise<NamedAgent[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id, name, owner_id, visibility')
    .eq('organization_id', organizationId);
  if (error) throw new Error(`Could not read the agents' names: ${error.message}`);
  return (data ?? []) as NamedAgent[];
}

/**
 * Another agent of the workspace with this name, whatever its case (§O), as
 * its refusal: the name said back only when the person sees that agent (an
 * Admin every one, others theirs and the workspace's); a private agent's
 * name is never told to someone who can't see it. Null when it is free.
 */
async function nameRefusal(
  ctx: AgentContext,
  name: string,
  except?: string,
): Promise<Refused | null> {
  const clash = (await agentNames(ctx.actor.organizationId)).find(
    (a) => a.id !== except && nameKey(a.name) === nameKey(name),
  );
  if (!clash) return null;
  const seen =
    ctx.viewer.role === 'admin' ||
    clash.visibility === 'workspace' ||
    clash.owner_id === ctx.actor.userId;
  return seen ? refused('name_taken', { name }) : refused('name_taken_hidden');
}

/** Two trigger lists that differ (the same triggers in another order are the same). */
function triggersDiffer(current: TriggerRow[], wanted: readonly AgentTriggerInput[]): boolean {
  const keys = (list: string[]) => list.sort().join('\n');
  return (
    keys(current.map((t) => `${triggerKey(t.kind, t.config_json)}:${t.enabled}`)) !==
    keys(wanted.map((t) => `${triggerKey(t.kind, t.config)}:${t.enabled}`))
  );
}

/** The first trigger whose time is wrong (a past one-off), as its refusal. */
function triggersRefusal(triggers: readonly AgentTriggerInput[], now: Date): Refused | null {
  for (const trigger of triggers) {
    const problem = triggerTimeProblem(trigger, now);
    if (problem) return refused(problem);
  }
  return null;
}

const isUniqueClash = (error: { code?: string } | null) => error?.code === '23505';

/** Two instants the same (the database's text, or the same moment written another way). */
const sameInstant = (a: string, b: string) => a === b || Date.parse(a) === Date.parse(b);

/**
 * The AI limit at 100% (§D item 21), unless Chat runs on the workspace's own
 * key: the agent can't start. A read that fails lets it start: each of its
 * steps is held on the budget anyway (CHAT-04), which refuses it then.
 */
async function aiLimitReached(ctx: AgentContext): Promise<boolean> {
  try {
    const key = await resolveChatModelKey(ctx.actor.organizationId).catch((err: unknown) => {
      // A saved key that can't be read is still the workspace's own: no AI limit.
      if (err instanceof OwnKeyUnreadableError) return { source: 'own' as const };
      throw err;
    });
    if (key?.source === 'own') return false;
    const usage = await getAiUsageFor({
      userId: ctx.actor.userId,
      email: ctx.actor.email,
      organizationId: ctx.actor.organizationId,
      role: ctx.viewer.role,
      apiKeyId: 'chat-agents',
    });
    return !!usage && !usage.unlimited && (usage.percent_used ?? 0) >= 100;
  } catch (err) {
    console.error('[chat/agents] could not read the AI limit:', err);
    return false;
  }
}

/**
 * The brands a run of the agent may use now: its scope's, in the workspace,
 * that the person it acts as may use (`access`: all_brands is all of
 * theirs, BRAND-ACCESS §5.3), never the demo.
 */
export async function runnableBrands(
  organizationId: string,
  scope: AgentScope,
  access: BrandAccess,
): Promise<{ id: string; name: string }[]> {
  return scopeBrands(scope, allowedBrands(access, await brandsOf(organizationId)))
    .filter((b) => !b.is_demo)
    .map((b) => ({ id: b.id, name: b.name }));
}

/**
 * Whether the agent may run with these settings now (§D item 21: on
 * Activate, on Resume and before a run): the plan and Settings › Chat allow
 * its mode and engines for the person it acts as, a brand of its scope is
 * there that they may use (`access`, theirs: the person in `ctx` by
 * default, the owner on Resume), its skills are on for the person it acts
 * as (CHAT-13: else skill_off), and the AI limit isn't used up. Its Required
 * connections are checked for the run's brand before the run (agentDriver.ts,
 * agentConnections.ts), and for each brand of its scope on Resume.
 * `actingUserId`: whose skills it runs, the person checking unless said
 * (Resume: its owner, whom its triggered runs act as).
 */
export async function runChecks(
  ctx: AgentContext,
  agent: LoadedAgent,
  actingRole: AgentViewer['role'],
  triggers: readonly AgentTriggerInput[],
  access: BrandAccess = ctx.viewer.brandAccess,
  actingUserId: string = ctx.actor.userId,
): Promise<Refused | null> {
  const version = agent.version;
  if (!version) return refused('failed');
  const denial = await firstDenial(ctx, [
    modeDenial(version.mode, ctx.plan, ctx.settings, actingRole),
    enginesDenial(ctx.plan, enginesNamed(version.scope, triggers)),
  ]);
  if (denial) return denial;
  if ((await runnableBrands(ctx.actor.organizationId, version.scope, access)).length === 0) {
    return refused('no_brand');
  }
  // A skill turned off, not approved, gone or changed since (CHAT-13 items 10, 19).
  const offSkill = offAgentSkill(
    version.skill_ids,
    await agentSkillStates(ctx.actor.organizationId, actingUserId, version.skill_ids),
  );
  if (offSkill) return refused('skill_off', { skill: offSkill });
  // The workspace's own key is marked failing (AGENT-OWN-KEY §5.2 item 4): nothing is queued.
  const key = await failingOwnKey(ctx.actor.organizationId);
  if (key) return refused('own_key_failed', { why: ownKeyWhy(key) });
  if (await aiLimitReached(ctx)) return refused('ai_limit');
  // All agents reached the month's limit on the workspace's own key (AGENT-OWN-KEY §4.2).
  const keyCap = await ownKeyCapReached(ctx.actor.organizationId);
  if (keyCap) return refused('own_key_cap', { date: renewsOn(keyCap.renewsAt) });
  return null;
}

/** When the AI period renews, as the refusal says it: "November 20, 2026". */
function renewsOn(at: string | null): string {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return 'the next period';
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Why the workspace's own key fails, in words, by its provider's name. */
export function ownKeyWhy(key: Pick<OwnKeyFailure, 'class' | 'provider'>): string {
  return ownKeyT(`why.${key.class}`, {
    provider: settingsT(`agent_providers.${key.provider}.name` as never),
  });
}

/** An agent's triggers as their inputs read back (the checks that name engines read them). */
export async function readTriggerInputs(agentId: string): Promise<AgentTriggerInput[]> {
  return triggerInputs(await triggersOf([agentId]));
}

function triggerInputs(rows: TriggerRow[]): AgentTriggerInput[] {
  return rows.flatMap((row) => {
    const parsed = agentTriggerSchema.safeParse({
      kind: row.kind,
      config: row.config_json,
      enabled: row.enabled,
    });
    return parsed.success ? [parsed.data] : [];
  });
}

// ─── The Activity log ────────────────────────────────────────────────────────

type AgentSummaryKey =
  | 'agentCreated'
  | 'agentUpdated'
  | 'agentActivated'
  | 'agentPaused'
  | 'agentResumed'
  | 'agentArchived'
  | 'agentRestored'
  | 'agentDeleted'
  | 'agentDuplicated'
  | 'agentTakenOver'
  | 'agentRunQueued'
  | 'agentRunOnAction'
  | 'agentGoLiveOn'
  | 'agentGoLiveOff';

/**
 * Logs a person's change to an agent (CHAT-21: created, changed, state,
 * Run now) with the agent and, for Run now, its run (CHAT-27 item 29). A
 * deleted agent's row keeps its id as the target only. A log that fails
 * doesn't undo the change: the server's log gets it.
 */
export async function logAgentChange(
  ctx: AgentContext,
  agent: { id: string; name: string; deleted?: boolean },
  key: AgentSummaryKey,
  extra: { params?: Record<string, string>; brandId?: string | null; agentRunId?: string } = {},
): Promise<void> {
  try {
    await logActivity({
      organizationId: ctx.actor.organizationId,
      userId: ctx.actor.userId,
      brandId: extra.brandId ?? null,
      place: { conversationId: null, runId: null, stepId: null },
      surface: 'chat',
      tool: AGENTS_LABEL,
      mode: null,
      approval: { kind: 'run' },
      target: { type: 'chat_agent', id: agent.id },
      summary: { key, params: { name: summaryValue(agent.name), ...(extra.params ?? {}) } },
      undo: null,
      agentId: agent.deleted ? null : agent.id,
      agentRunId: extra.agentRunId ?? null,
    });
  } catch (err) {
    console.error('[chat/agents] could not log a change:', err);
  }
}

// ─── Writes ──────────────────────────────────────────────────────────────────

const versionInsert = (agentId: string, version: number, data: AgentVersionData, by: string) => ({
  agent_id: agentId,
  version,
  skill_ids: data.skill_ids,
  instructions: data.instructions,
  mode: data.mode,
  connections: data.connections as unknown as Json,
  model: data.model,
  effort: data.effort,
  scope: data.scope as unknown as Json,
  notify_user_ids: data.notify_user_ids,
  followup_days: data.followup_days,
  created_by: by,
});

const triggerInsert = (agentId: string, trigger: AgentTriggerInput, enabled = trigger.enabled) => ({
  agent_id: agentId,
  kind: trigger.kind,
  config_json: trigger.config as unknown as Json,
  enabled,
});

/**
 * A trigger's identity for keeping its row (its last fire, its cooldown)
 * across a save: its kind and settings, keys sorted, since jsonb keeps its
 * own key order, not the one written.
 */
const triggerKey = (kind: string, config: unknown) => `${kind}:${canonicalJson(config)}`;

/**
 * A new agent, saved as a draft (§D item 17): Admins and Managers only
 * (§D item 20), shared with the workspace only where Settings › Chat lets
 * them, a monthly cap only by an Admin, Full auto and engines as the plan
 * allows. Its owner is its maker until someone activates it. Answers its
 * detail.
 */
export async function createAgent(
  ctx: AgentContext,
  input: CreateAgentInput,
  now = new Date(),
): Promise<AgentResult<AgentDetail>> {
  const version = firstVersion(input);
  const denial = await firstDenial(ctx, [
    agentActDenial('create', ctx.viewer, null, ctx.settings),
    visibilityDenial(input.visibility, ctx.viewer, ctx.settings),
    input.maxMonthShare !== null ? monthCapDenial(ctx.viewer) : null,
    modeDenial(version.mode, ctx.plan, ctx.settings, ctx.viewer.role),
    enginesDenial(ctx.plan, enginesNamed(version.scope, input.triggers)),
  ]);
  if (denial) return denial;
  const problem = triggersRefusal(input.triggers, now) ?? (await referencesRefusal(ctx, version));
  if (problem) return problem;
  const org = ctx.actor.organizationId;
  // A name the person didn't type: §O against every agent, the ones they can't see included.
  let name = input.name;
  if (input.autoName) {
    const brandIds = version.scope.brand_ids ?? [];
    const brand =
      brandIds.length === 1
        ? ((await brandsOf(org)).find((b) => b.id === brandIds[0])?.name ?? null)
        : null;
    name = defaultAgentName(
      input.name,
      brand,
      (await agentNames(org)).map((a) => a.name),
    );
  }
  const clash = await nameRefusal(ctx, name);
  if (clash) return clash;

  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .insert({
      organization_id: org,
      name,
      status: 'draft',
      owner_id: ctx.actor.userId,
      visibility: input.visibility,
      version: 1,
      max_run_share: input.maxRunShare ?? ctx.settings.runShareDefault,
      max_month_share: input.maxMonthShare,
      created_by: ctx.actor.userId,
    })
    .select(AGENT_COLUMNS)
    .single();
  // Taken between the check and the save: by whom isn't known, so the name isn't said.
  if (isUniqueClash(error)) return refused('name_taken_hidden');
  if (error || !data) throw new Error(`Could not save the agent: ${error?.message}`);
  const row = toAgentRow(data as Record<string, unknown>);

  // No transaction across the three tables: a part that fails takes the agent away again.
  try {
    const written = await supabaseAdmin
      .from('chat_agent_versions')
      .insert(versionInsert(row.id, 1, version, ctx.actor.userId));
    if (written.error) throw new Error(written.error.message);
    if (input.triggers.length > 0) {
      const triggers = await supabaseAdmin
        .from('chat_agent_triggers')
        .insert(input.triggers.map((t) => triggerInsert(row.id, t)));
      if (triggers.error) throw new Error(triggers.error.message);
    }
  } catch (err) {
    await supabaseAdmin.from('chat_agents').delete().eq('id', row.id);
    throw new Error(`Could not save the agent: ${(err as Error).message}`);
  }

  await logAgentChange(ctx, row, 'agentCreated');
  return { ok: true, value: await detailOf(ctx, { row, version }, now) };
}

/**
 * A change from the agent's Settings (§C item 14). What it does changes
 * only as a new version, never in place: a run keeps the version it
 * started with. Its name, visibility and caps change on the agent; its
 * triggers are replaced (one kept as it was keeps its last fire). Saved
 * over another save since `expectedVersion`: refused.
 */
export async function updateAgent(
  ctx: AgentContext,
  id: string,
  patch: UpdateAgentInput,
  now = new Date(),
): Promise<AgentResult<AgentDetail>> {
  const found = await agentForAct(ctx, id, 'edit');
  if (!found.ok) return found;
  const { agent } = found;
  const { row } = agent;
  if (!editable(row.status)) return refused('archived');
  if (patch.expectedVersion !== undefined && patch.expectedVersion !== row.version) {
    return refused('version_conflict');
  }
  // A name, sharing, a cap or triggers make no new version: their saves move updated_at.
  if (
    patch.expectedUpdatedAt !== undefined &&
    !sameInstant(patch.expectedUpdatedAt, row.updated_at)
  ) {
    return refused('version_conflict');
  }
  if (!agent.version) return refused('failed');

  const next = nextVersion(agent.version, patch);
  const result = next ?? agent.version;
  const currentTriggers = await triggersOf([row.id]);
  const triggers = patch.triggers ?? triggerInputs(currentTriggers);
  // Only a new or changed trigger is held to the clock: a one-off that already fired stays.
  const kept = new Set(currentTriggers.map((t) => triggerKey(t.kind, t.config_json)));
  const changedTriggers = (patch.triggers ?? []).filter(
    (t) => !kept.has(triggerKey(t.kind, t.config)),
  );
  const visibilityChanged = patch.visibility !== undefined && patch.visibility !== row.visibility;
  const monthChanged =
    patch.maxMonthShare !== undefined && patch.maxMonthShare !== row.max_month_share;
  // An Admin's change to someone else's agent that is on (or paused, to come back) is held to
  // the mode its owner may use too: its triggered runs act as the owner, as Resume checks.
  const ownerRole =
    next && row.status !== 'draft' && row.owner_id && row.owner_id !== ctx.actor.userId
      ? await ownerRoleOf(ctx.actor.organizationId, row)
      : null;
  const denial = await firstDenial(ctx, [
    visibilityChanged ? visibilityDenial(patch.visibility!, ctx.viewer, ctx.settings) : null,
    monthChanged ? monthCapDenial(ctx.viewer) : null,
    next ? modeDenial(result.mode, ctx.plan, ctx.settings, ctx.viewer.role) : null,
    ownerRole ? modeDenial(result.mode, ctx.plan, ctx.settings, ownerRole) : null,
    next || patch.triggers ? enginesDenial(ctx.plan, enginesNamed(result.scope, triggers)) : null,
  ]);
  if (denial) return denial;
  const problem =
    triggersRefusal(changedTriggers, now) ??
    (next && (patch.scope || patch.notifyUserIds) ? await referencesRefusal(ctx, next) : null);
  if (problem) return problem;
  const renamed = patch.name !== undefined && patch.name !== row.name;
  if (renamed) {
    const clash = await nameRefusal(ctx, patch.name!, row.id);
    if (clash) return clash;
  }

  const agentPatch: Record<string, unknown> = {};
  if (renamed) agentPatch.name = patch.name;
  if (visibilityChanged) agentPatch.visibility = patch.visibility;
  if (patch.maxRunShare !== undefined && patch.maxRunShare !== row.max_run_share) {
    agentPatch.max_run_share = patch.maxRunShare;
  }
  if (monthChanged) agentPatch.max_month_share = patch.maxMonthShare;
  const newVersion = next ? (await highestVersion(row.id)) + 1 : row.version;
  if (next) {
    // The key (agent_id, version) refuses a second save of the same number: the later one loses.
    const written = await supabaseAdmin
      .from('chat_agent_versions')
      .insert(versionInsert(row.id, newVersion, next, ctx.actor.userId));
    if (isUniqueClash(written.error)) return refused('version_conflict');
    if (written.error) throw new Error(`Could not save the agent: ${written.error.message}`);
    agentPatch.version = newVersion;
  }

  const triggersChange = !!patch.triggers && triggersDiffer(currentTriggers, patch.triggers);
  let updated = row;
  if (Object.keys(agentPatch).length > 0 || triggersChange) {
    // Every save claims the row as it was read: a save in between (of anything) wins, this one is refused.
    // Always later than what was read (the database's own trigger sets it too).
    agentPatch.updated_at = new Date(
      Math.max(Date.now(), (Date.parse(row.updated_at) || 0) + 1),
    ).toISOString();
    const { data, error } = await supabaseAdmin
      .from('chat_agents')
      .update(agentPatch)
      .eq('id', row.id)
      .eq('version', row.version)
      .eq('updated_at', row.updated_at)
      .select(AGENT_COLUMNS);
    const lost = !error && (data ?? []).length === 0;
    if (error || lost) {
      // The version this save wrote would block the next one: it goes with the save.
      if (next) {
        await supabaseAdmin
          .from('chat_agent_versions')
          .delete()
          .eq('agent_id', row.id)
          .eq('version', newVersion);
      }
      if (isUniqueClash(error)) return refused('name_taken_hidden');
      if (lost) return refused('version_conflict');
      throw new Error(`Could not save the agent: ${error?.message}`);
    }
    updated = toAgentRow((data ?? [])[0] as Record<string, unknown>);
  }

  const triggersChanged = triggersChange
    ? await replaceTriggers(row.id, currentTriggers, patch.triggers!)
    : false;
  if (updated !== row || triggersChanged) {
    await logAgentChange(ctx, updated, 'agentUpdated');
  }
  // A new version of an agent allowed to go live on its own: it no longer is, and they're told.
  if (next) await tellGoLiveOff(ctx.actor.organizationId, row.id, row.version, ctx.actor.userId);
  return { ok: true, value: await detailOf(ctx, { row: updated, version: result }, now) };
}

/**
 * The highest version written for an agent: a save numbers its version past
 * it, so one left by a save that never finished doesn't block the next.
 */
async function highestVersion(agentId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agent_versions')
    .select('version')
    .eq('agent_id', agentId)
    .order('version', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Could not read the agent's versions: ${error.message}`);
  return ((data ?? []) as { version: number }[])[0]?.version ?? 0;
}

/**
 * Puts an agent's triggers to `wanted`: one already there as it is keeps its
 * row, its last fire and cooldown (only its on/off follows); the rest go and
 * the new come. Answers whether anything changed.
 */
async function replaceTriggers(
  agentId: string,
  current: TriggerRow[],
  wanted: AgentTriggerInput[],
): Promise<boolean> {
  const byKey = new Map(current.map((t) => [triggerKey(t.kind, t.config_json), t]));
  const keep = new Set<string>();
  const add: AgentTriggerInput[] = [];
  let changed = false;
  for (const trigger of wanted) {
    const existing = byKey.get(triggerKey(trigger.kind, trigger.config));
    if (existing && !keep.has(existing.id)) {
      keep.add(existing.id);
      if (existing.enabled !== trigger.enabled) {
        const { error } = await supabaseAdmin
          .from('chat_agent_triggers')
          .update({ enabled: trigger.enabled })
          .eq('id', existing.id);
        if (error) throw new Error(`Could not save the agent's triggers: ${error.message}`);
        changed = true;
      }
    } else {
      add.push(trigger);
    }
  }
  const gone = current.filter((t) => !keep.has(t.id)).map((t) => t.id);
  // Gone first: at most 5 an agent, counted by the database too.
  if (gone.length > 0) {
    const { error } = await supabaseAdmin.from('chat_agent_triggers').delete().in('id', gone);
    if (error) throw new Error(`Could not save the agent's triggers: ${error.message}`);
    changed = true;
  }
  if (add.length > 0) {
    const { error } = await supabaseAdmin
      .from('chat_agent_triggers')
      .insert(add.map((t) => triggerInsert(agentId, t)));
    if (error) throw new Error(`Could not save the agent's triggers: ${error.message}`);
    changed = true;
  }
  return changed;
}

/** The detail after a change of state, or { deleted } once it is gone. */
export type AgentStateResult = AgentResult<AgentDetail | { deleted: true }>;

const STATE_SUMMARY: Record<AgentLifecycleAction, AgentSummaryKey> = {
  activate: 'agentActivated',
  pause: 'agentPaused',
  resume: 'agentResumed',
  archive: 'agentArchived',
  restore: 'agentRestored',
  delete: 'agentDeleted',
};

/**
 * A change of state a person asks for (§G item 33): Activate a draft and
 * Resume a paused agent after the activation checks (item 21; Activate
 * makes the person its owner, the one its triggered runs act as; Resume
 * also wants each brand's Required connections, as Run now does), Pause
 * (a person's reason, `manual`), Archive (its waiting runs stop; a running
 * one finishes), Restore (back to paused, never straight to active), and
 * Delete once archived (its runs, chats and files stay).
 */
export async function changeAgentState(
  ctx: AgentContext,
  id: string,
  action: AgentLifecycleAction,
  now = new Date(),
): Promise<AgentStateResult> {
  const found = await agentForAct(ctx, id, action);
  if (!found.ok) return found;
  const { agent } = found;
  const { row } = agent;
  const target = lifecycleTarget(action, row.status);
  if (target === undefined) return refused('wrong_status', { status: row.status });
  const org = ctx.actor.organizationId;

  if (action === 'delete') {
    const { data, error } = await supabaseAdmin
      .from('chat_agents')
      .delete()
      .eq('id', row.id)
      .eq('status', 'archived')
      .select('id');
    if (error) throw new Error(`Could not delete the agent: ${error.message}`);
    if ((data ?? []).length === 0) return refused('wrong_status', { status: row.status });
    await logAgentChange(ctx, { ...row, deleted: true }, 'agentDeleted');
    return { ok: true, value: { deleted: true } };
  }

  const patch: Record<string, unknown> = { status: target };
  if (action === 'activate' || action === 'resume') {
    // Triggered runs act as the owner (Addendum 2 H): Activate makes the person the owner.
    const ownerRole = action === 'activate' ? ctx.viewer.role : await ownerRoleOf(org, row);
    if (!ownerRole) return refused('owner_role');
    // Its brands are the owner's too (BRAND-ACCESS §5.3): an Admin resuming someone else's
    // agent is held to the brands its owner may use.
    const ownerAccess =
      action === 'resume' && row.owner_id && row.owner_id !== ctx.actor.userId
        ? ((await readBrandAccess(row.owner_id, org)) ?? [])
        : ctx.viewer.brandAccess;
    const limit = agentPlanLimits(ctx.plan).activeAgents;
    if (limit !== null && (await activeCount(org, row.id)) >= limit) {
      return refused('agent_limit', { limit });
    }
    const failing = await runChecks(
      ctx,
      agent,
      ownerRole,
      triggerInputs(await triggersOf([row.id])),
      ownerAccess,
      action === 'activate' ? ctx.actor.userId : (row.owner_id ?? ctx.actor.userId),
    );
    if (failing) return failing;
    // A brand without a Required connection would pause it again on its next run
    // (agentDriver.ts): Resume refuses, naming both, as Run now does (§H item 42).
    if (action === 'resume' && agent.version) {
      for (const brand of await runnableBrands(org, agent.version.scope, ownerAccess)) {
        const missing = await missingRequiredConnection(agent.version, brand.id);
        if (missing) {
          return refused('connection_missing', {
            name: connectionName(missing),
            brand: brand.name,
          });
        }
      }
    }
    patch.paused_reason = null;
    patch.activated_at = now.toISOString();
    if (action === 'activate') patch.owner_id = ctx.actor.userId;
  } else if (action === 'pause' || action === 'restore') {
    patch.paused_reason = 'manual' satisfies AgentPausedReason;
    if (action === 'restore') patch.archived_at = null;
  } else if (action === 'archive') {
    patch.paused_reason = null;
    patch.archived_at = now.toISOString();
  }

  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .update(patch)
    .eq('id', row.id)
    .eq('status', row.status)
    .select(AGENT_COLUMNS);
  if (error) throw new Error(`Could not change the agent: ${error.message}`);
  if ((data ?? []).length === 0) return refused('wrong_status', { status: row.status });
  const updated = toAgentRow((data ?? [])[0] as Record<string, unknown>);

  if (action === 'archive') await stopQueuedRuns(row.id, now);
  await logAgentChange(ctx, updated, STATE_SUMMARY[action]);
  return { ok: true, value: await detailOf(ctx, { row: updated, version: agent.version }, now) };
}

/**
 * Take over (§G item 34, edge case 1): an Admin becomes the agent's owner,
 * the one its triggered runs act as — after its owner left the workspace or
 * lost the role, or whenever an Admin chooses. An agent that is on, or
 * paused because of its owner, first passes the activation checks under its
 * new owner (item 21); one paused because of its owner then turns on again.
 * Not an archived agent (restore it first). Answers its detail.
 */
export async function takeOverAgent(
  ctx: AgentContext,
  id: string,
  now = new Date(),
): Promise<AgentResult<AgentDetail>> {
  const found = await agentForAct(ctx, id, 'takeOver');
  if (!found.ok) return found;
  const { agent } = found;
  const { row } = agent;
  if (row.status === 'archived') return refused('archived');
  if (row.owner_id === ctx.actor.userId) {
    return { ok: true, value: await detailOf(ctx, agent, now) };
  }
  const org = ctx.actor.organizationId;
  const backOn = row.status === 'paused' && row.paused_reason === 'owner_role';
  const patch: Record<string, unknown> = { owner_id: ctx.actor.userId };
  if (row.status === 'active' || backOn) {
    const limit = agentPlanLimits(ctx.plan).activeAgents;
    if (backOn && limit !== null && (await activeCount(org, row.id)) >= limit) {
      return refused('agent_limit', { limit });
    }
    const failing = await runChecks(
      ctx,
      agent,
      ctx.viewer.role,
      triggerInputs(await triggersOf([row.id])),
    );
    if (failing) return failing;
    if (backOn) {
      patch.status = 'active';
      patch.paused_reason = null;
      patch.activated_at = now.toISOString();
    }
  }

  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .update(patch)
    .eq('id', row.id)
    .eq('status', row.status)
    .select(AGENT_COLUMNS);
  if (error) throw new Error(`Could not take the agent over: ${error.message}`);
  if ((data ?? []).length === 0) return refused('wrong_status', { status: row.status });
  const updated = toAgentRow((data ?? [])[0] as Record<string, unknown>);
  await logAgentChange(ctx, updated, 'agentTakenOver');
  return { ok: true, value: await detailOf(ctx, { row: updated, version: agent.version }, now) };
}

/**
 * Pauses an active agent for a reason of the system's (§G item 34): the
 * trigger runner's (W2-16) when a check before a run fails. Nothing else
 * changes; a person resumes it (only `cap` comes back by itself). Answers
 * whether it paused.
 */
export async function pauseAgentForSystem(
  organizationId: string,
  agentId: string,
  reason: Exclude<AgentPausedReason, 'manual'>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .update({ status: 'paused', paused_reason: reason })
    .eq('id', agentId)
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .select('id');
  if (error) throw new Error(`Could not pause the agent: ${error.message}`);
  return (data ?? []).length > 0;
}

/** The owner's role when they may still own agents (an Admin or Manager of the workspace). */
async function ownerRoleOf(organizationId: string, row: AgentRow) {
  if (!row.owner_id) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('role, organization_id')
    .eq('id', row.owner_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the agent's owner: ${error.message}`);
  const role = parseTeamRole(data?.role);
  return role &&
    data?.organization_id === organizationId &&
    (role === 'admin' || role === 'manager')
    ? role
    : null;
}

async function activeCount(organizationId: string, except: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('status', 'active');
  if (error) throw new Error(`Could not count the active agents: ${error.message}`);
  return ((data ?? []) as { id: string }[]).filter((a) => a.id !== except).length;
}

/** An archived agent's waiting runs never start (00419): they stop, as a person's Stop. */
async function stopQueuedRuns(agentId: string, now: Date): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_agent_runs')
    .update({ status: 'stopped', stop_reason: 'user', finished_at: now.toISOString() })
    .eq('agent_id', agentId)
    .eq('status', 'queued');
  if (error) console.error('[chat/agents] could not stop an archived agent’s queue:', error);
}

/**
 * Duplicate (edge case 12): the current version as a new draft, "{name}
 * copy", owned by the person; its triggers copied switched off. Shared with
 * the workspace only where the person may share it, its monthly cap only
 * for an Admin.
 */
export async function duplicateAgent(
  ctx: AgentContext,
  id: string,
  now = new Date(),
): Promise<AgentResult<AgentDetail>> {
  const found = await agentForAct(ctx, id, 'duplicate');
  if (!found.ok) return found;
  const { agent } = found;
  if (!agent.version) return refused('failed');
  const org = ctx.actor.organizationId;
  const { row } = agent;
  // A copy is a new agent: it is held to what creating one is.
  const sourceTriggers = await triggersOf([row.id]);
  const denial = await firstDenial(ctx, [
    modeDenial(agent.version.mode, ctx.plan, ctx.settings, ctx.viewer.role),
    enginesDenial(ctx.plan, enginesNamed(agent.version.scope, triggerInputs(sourceTriggers))),
  ]);
  if (denial) return denial;
  const problem = await referencesRefusal(ctx, agent.version);
  if (problem) return problem;
  const { data: names, error: namesError } = await supabaseAdmin
    .from('chat_agents')
    .select('name')
    .eq('organization_id', org);
  if (namesError) throw new Error(`Could not read the agents' names: ${namesError.message}`);
  const taken = new Set(((names ?? []) as { name: string }[]).map((a) => nameKey(a.name)));

  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .insert({
      organization_id: org,
      name: copyName(row.name, taken),
      status: 'draft',
      owner_id: ctx.actor.userId,
      visibility:
        visibilityDenial(row.visibility, ctx.viewer, ctx.settings) === null
          ? row.visibility
          : 'private',
      version: 1,
      max_run_share: row.max_run_share,
      max_month_share: ctx.viewer.role === 'admin' ? row.max_month_share : null,
      created_by: ctx.actor.userId,
    })
    .select(AGENT_COLUMNS)
    .single();
  if (isUniqueClash(error)) return refused('name_taken', { name: copyName(row.name, taken) });
  if (error || !data) throw new Error(`Could not copy the agent: ${error?.message}`);
  const copy = toAgentRow(data as Record<string, unknown>);

  try {
    const written = await supabaseAdmin
      .from('chat_agent_versions')
      .insert(versionInsert(copy.id, 1, agent.version, ctx.actor.userId));
    if (written.error) throw new Error(written.error.message);
    if (sourceTriggers.length > 0) {
      const copied = await supabaseAdmin.from('chat_agent_triggers').insert(
        sourceTriggers.map((t) => ({
          agent_id: copy.id,
          kind: t.kind,
          config_json: t.config_json,
          enabled: false,
        })),
      );
      if (copied.error) throw new Error(copied.error.message);
    }
  } catch (err) {
    await supabaseAdmin.from('chat_agents').delete().eq('id', copy.id);
    throw new Error(`Could not copy the agent: ${(err as Error).message}`);
  }

  await logAgentChange(ctx, copy, 'agentDuplicated', {
    params: { from: summaryValue(row.name) },
  });
  return { ok: true, value: await detailOf(ctx, { row: copy, version: agent.version }, now) };
}
