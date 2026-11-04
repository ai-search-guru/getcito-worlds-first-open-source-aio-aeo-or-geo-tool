import type { TeamRole } from '@/components/context/RoleProvider';
import type { PlanId } from '@/config/plans';
import type { BrandAccess } from '@/lib/brandAccess';
import type { GateResult } from '@/lib/content/goLiveGate';
import type { GoLiveTextHold } from './goLiveChecks';
import { planGateLock, type PlanFacts } from './planFacts';
import {
  WRITE_POLICIES,
  type ChatTool,
  type ExecuteGroup,
  type PlanGate,
  type ToolPolicy,
  type WritePolicy,
} from './registry/defineTool';

/**
 * Whether a person may run a tool now, and how: the approval precedence
 * (CHAT-20 §5). Pure: before every call the server reads what it decides on
 * fresh (precedenceContext.ts: the live role, the plan, the workspace's
 * Chat settings, the person's "Don't ask again" choices) and the tool
 * endpoint acts on the answer. The model never decides it (§2 principle 3),
 * and only sees the tools allowedTools() leaves.
 *
 * Most restrictive wins, top to bottom; a step only takes options away:
 *
 *   0. Brand scope: a brand the person can't access doesn't exist for Chat
 *      (§15b), so it's refused before anything about it is used, its demo
 *      flag included, and the refusal names nothing. So is a call on a
 *      brand-bound row whose brand wasn't found in the workspace (an id of
 *      another workspace's object, or of none).
 *   1. Hard rules: a read-only workspace refuses what changes, goes live or
 *      spends (402); the demo brand's sample data the same; a tool an Admin
 *      set to Never is refused; an EXECUTE is at most a click, except what
 *      step 4b lifts for an agent an Admin allowed to go live on its own, and
 *      an always_card WRITE at most a card, in every mode.
 *   2. Plan gates (§7): the tool's own; Full auto, "Don't ask again" and an
 *      Admin's Always are Growth and up, paid (below it they ask, as Ask
 *      does). MCP (§17): not in the trial, reads only on Starter, the rest
 *      from Growth. None on self-hosted.
 *   3. The live role (§4), against the row's minRole and the roles it
 *      leaves out. The roles follow the role model of 2026-10-29: daily work
 *      (drafts, tasks, audits, reports) open to every role; settings,
 *      deleting, adding prompts and costly work to Admins and Managers.
 *      Agency partners act as Analysts until brand sharing (Wave 2), except
 *      where a row leaves them out as the server does.
 *   4. The Admin's policy: the tool's level (Ask, Ask with auto in Full
 *      auto, Always), Full auto for people other than Admins (which Always
 *      doesn't need), and the go-live groups switched off for Managers.
 *  4b. An Admin's go-live permission (AUTONOMOUS-GO-LIVE §5.2), the one
 *      exception to hard rule 1, last for an EXECUTE every other step let
 *      through: it only turns a click into a run, never a denial or a card.
 *      An agent run in Full auto, allowed for its version, on a workspace
 *      whose Admins let agents take that group live, on Growth and up
 *      (goLiveCandidate); then the page's guards in order (goLiveHold), and
 *      any that fails keeps the click, saying why.
 *   5. The run mode: Ask me first shows a card for every WRITE. Auto shows
 *      one too, except for a tool whose policy is Always, which runs in Auto
 *      and Full auto alike. Full auto also runs "Ask (auto allowed in Full
 *      auto)". No WRITE runs by itself anywhere but Chat: over MCP (v1), or
 *      from a surface this code doesn't know. A mode it doesn't know is Ask
 *      me first.
 *      Differs from §5 step 5 as written ("Auto: each WRITE shows a card"),
 *      by decision of 2026-10-29: otherwise Always and "Ask (auto allowed in
 *      Full auto)" would do the same. Step 5's card in Auto holds for every
 *      tool not set to Always; EXECUTE and always_card rows can't be Always.
 *   6. "Don't ask again": in Auto, the person's tick runs that WRITE as Full
 *      auto would, and only where Full auto could.
 *   7. Taint (§16a): a WRITE whose target or text came from untrusted content
 *      shows a card in every mode; a detected injection does the same for
 *      the rest of the run.
 */

export const TEAM_ROLES = [
  'admin',
  'manager',
  'analyst',
  'agency_partner',
] as const satisfies readonly TeamRole[];

/** A live role from the database, or null for anything else (no Owner, Editor or Viewer, §4). */
export function parseTeamRole(value: unknown): TeamRole | null {
  return TEAM_ROLES.find((role) => role === value) ?? null;
}

// Analyst and Agency partner rank the same: "Analyst" in a row's minRole means every role (§20).
const ROLE_RANK: Record<TeamRole, number> = { admin: 2, manager: 1, analyst: 0, agency_partner: 0 };

/** Whether a role is at or above minRole. */
export function roleMeets(role: TeamRole, minRole: TeamRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}

/** Whether a role may call a row: at or above its minRole, and not one it leaves out. */
export function roleAllowed(tool: Pick<ChatTool, 'minRole' | 'excludeRoles'>, role: TeamRole) {
  return roleMeets(role, tool.minRole) && !tool.excludeRoles.includes(role);
}

/** The roles that may call a row: a denial's "who can", by role, never by person (§4c). */
export function allowedRoles(tool: Pick<ChatTool, 'minRole' | 'excludeRoles'>): TeamRole[] {
  return TEAM_ROLES.filter((role) => roleAllowed(tool, role));
}

/** The run modes of the composer (CHAT-02): Ask me first · Auto, ask before changes · Full auto. */
export const CHAT_MODES = ['ask_first', 'auto', 'full_auto'] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/**
 * The mode a new chat's composer starts in: the person's saved default
 * (chat_user_prefs.default_mode), Auto, ask before changes, when none; a
 * saved Full auto the plan no longer opens starts as Auto too.
 */
export function chatDefaultModeOf(saved: unknown, fullAutoOpen: boolean): ChatMode {
  const mode = CHAT_MODES.find((m) => m === saved) ?? 'auto';
  return mode === 'full_auto' && !fullAutoOpen ? 'auto' : mode;
}

/** Where a call comes from. MCP has no Full auto and no "Don't ask again" in v1 (§17). */
export const CHAT_SURFACES = ['chat', 'mcp'] as const;
export type ChatSurface = (typeof CHAT_SURFACES)[number];

/** What an Admin may set a tool to in Settings › Chat (chat_settings.tool_policies, 00401). */
export const ADMIN_POLICIES = ['never', 'ask', 'ask_full_auto', 'always'] as const;
export type AdminPolicy = (typeof ADMIN_POLICIES)[number];

/** A workspace's Chat settings (chat_settings, 00401). */
export interface ChatSettings {
  /** An Admin's policy per tool, by label key; a tool not named keeps its row's default. */
  toolPolicies: Readonly<Record<string, AdminPolicy>>;
  /** People other than Admins may use Full auto (CHAT-23 policy.toggleFullAutoForManagers). */
  fullAutoForMembers: boolean;
  /** "Don't ask again" is offered, and the ticks count; off, they stop at once. */
  dontAskAgain: boolean;
  /** The go-live groups Managers can't click through. */
  managerExecuteOff: readonly ExecuteGroup[];
  /**
   * The go-live groups an Admin let allowed agents take live on their own
   * (chat_settings.auto_go_live_groups, 00443); absent or empty: none.
   */
  autoGoLiveGroups?: readonly ExecuteGroup[];
  /** Agents may run in Full auto (chat_settings.agents_full_auto, 00419); absent: not known, so no. */
  agentsFullAuto?: boolean;
}

/** A workspace without a chat_settings row. Frozen: every such workspace shares it. */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = Object.freeze({
  toolPolicies: Object.freeze({}),
  fullAutoForMembers: true,
  dontAskAgain: true,
  managerExecuteOff: Object.freeze([]),
});

/** Everything a call is decided on but the call itself. */
export interface PrecedenceContext {
  /** The workspace the person acts in: a call's brand must belong to it. */
  organizationId: string;
  /** Read for this call: never a role kept from earlier in the run (§4 "Role change mid-run"). */
  role: TeamRole;
  plan: PlanFacts;
  settings: ChatSettings;
  /** The mode the run is in, as the person picked it. */
  mode: ChatMode;
  surface: ChatSurface;
  /** Label keys of the tools the person ticked "Don't ask again" on. */
  autoChoices: ReadonlySet<string>;
  /** The brands the person may use: all of the workspace's, or the ones shared with them. */
  brandAccess: BrandAccess;
  /** An injection attempt was found in this run (§16a rule 3). */
  injectionDetected: boolean;
  /**
   * An agent run, while going live on its own can apply to it (the flag on
   * and an Admin's switch on a group): its agent, whether the run is in
   * Full auto (the agent's mode, before an injection asks first), and its
   * permission when it is valid for the run's version. Absent or null: a
   * person's own chat, or nothing to lift.
   */
  agent?: GoLiveAgent | null;
  /** CHAT_AUTO_GO_LIVE (and _ORGS) for this workspace; absent: off. */
  autoGoLiveOn?: boolean;
}

/** An agent run as step 4b reads it. */
export interface GoLiveAgent {
  id: string;
  /** Its name, for the words of a click card held at its daily limit. */
  name: string;
  /** The run is in Full auto. */
  fullAuto: boolean;
  /** Its go-live permission, valid for the run's version and its skills; null: none. */
  goLive: { dailyLimit: number } | null;
}

/**
 * What step 4b's guards read for a call (readGoLiveFacts), only for a
 * candidate: in their order, each read only once those before it passed. One
 * missing where it's needed keeps the click (`unchecked`, the closed side).
 */
export interface GoLiveFacts {
  /** The run started from outside text: Run agent on an action, or a tainted next move. */
  runUntrusted: boolean;
  /** The page as it will go out: ready, or why it can't be made (Send to CMS' own check). */
  page?: 'ready' | 'placeholders' | 'fields';
  /** Its text and links: null when clean (goLiveChecks.ts). */
  text?: { hold: GoLiveTextHold } | { hold: 'foreign_link'; host: string } | { hold: null };
  /** The page is live already: an update stays a person's click. */
  liveItem?: boolean;
  /** Someone took the page down before (PR 10): it never goes live on its own again. */
  takenDown?: boolean;
  /** Its quality and brand facts (lib/content/goLiveGate.ts). */
  gate?: GateResult;
  /**
   * The agent's go-lives in the last 24 hours, one per page and destination
   * (reserve_agent_go_live's count); `counted`: this page's own already is,
   * so it takes no new slot; `nextAt`: when the oldest frees.
   */
  usage?: { used: number; counted: boolean; nextAt: string | null };
}

/** Why an allowed agent's step still waits for a click: the card says it. */
export type GoLiveHold =
  | {
      code:
        | 'unchecked'
        | 'injection'
        | 'untrusted_scope'
        | 'placeholders'
        | 'fields'
        | 'instructions'
        | 'hidden_text'
        | 'copied'
        | 'live_page'
        | 'taken_down'
        | 'quality_off'
        | 'suggestions'
        | 'facts_unchecked';
    }
  | { code: 'foreign_link'; host: string }
  | { code: 'quality_unread'; why: string }
  | { code: 'facts'; page: string; fact: string }
  | { code: 'qualityLow'; check: 'eeat' | 'trust' | 'readability'; score: number }
  | { code: 'quality'; score: number }
  | { code: 'limit'; agent: string; limit: number; nextAt: string | null }
  /** The engine's: the send went and failed, its slot freed (§5.4 item 4). */
  | { code: 'failed'; why: string };

/** What a call is about. */
export interface ToolCall {
  /**
   * The brand it reads or changes, found in the person's workspace
   * (precedenceContext.ts readToolCall). Null: none, which a brand-bound
   * row is refused for, since its brand wasn't found.
   */
  brandId: string | null;
  /** That brand is the demo brand (brands.is_demo). */
  brandIsDemo: boolean;
  /** Its target or text came from untrusted content in this run: a page, an upload, an AI answer… */
  tainted: boolean;
  /**
   * With the run's earlier calls of its row, more items than the row runs
   * without a card (§9 row 22: "> 5 prompts: Ask").
   */
  overBatch?: boolean;
  /** Step 4b's facts: read only for a candidate (goLiveCandidate), so other calls pay nothing. */
  goLive?: GoLiveFacts;
}

/** Why a call is refused, with what the denial says (denial.ts). Codes as §11a's where it has one. */
export type ToolDenial =
  /** No context: the person isn't a member of the workspace now (decideOrDeny). */
  | { code: 'no_access' }
  | { code: 'brand_scope' }
  | { code: 'subscription_inactive' }
  | { code: 'demo_brand' }
  | { code: 'policy_never' }
  | { code: 'plan_locked'; needs: PlanId }
  /** roles: the ones that may call it. */
  | { code: 'forbidden_role'; role: TeamRole; roles: TeamRole[] }
  | { code: 'execute_off'; group: ExecuteGroup };

/** Why a WRITE stops at a card: the first step that kept it from running by itself. */
export type AskReason =
  | 'always_card'
  | 'mode'
  | 'full_auto_locked'
  | 'policy'
  | 'full_auto_off'
  | 'mcp'
  | 'dont_ask_again_off'
  | 'tainted'
  /** The engine's: a change in a run no session is behind (engine.ts askWithoutSession). */
  | 'no_session';

export type ToolDecision =
  /**
   * It runs now: a READ, or a WRITE set to Always, in Full auto, or under the
   * person's tick; an EXECUTE only by step 4b (go_live).
   */
  | { kind: 'run'; via: 'read' | 'always' | 'full_auto' | 'dont_ask_again' | 'go_live' }
  /** An approval card; offerDontAskAgain: the card may offer the tick (§6). */
  | { kind: 'ask'; reason: AskReason; offerDontAskAgain: boolean }
  /** An EXECUTE: only the person's click runs it; held: why an allowed agent still waits. */
  | { kind: 'click'; held?: GoLiveHold }
  | { kind: 'deny'; denial: ToolDenial };

const writeRank = (policy: WritePolicy) => WRITE_POLICIES.indexOf(policy);

/**
 * What Settings › Chat offers for a row (§5 step 4): a read only Never, when
 * an Admin may switch it off; an EXECUTE only Never (otherwise a click); a
 * WRITE Never and the levels up to its maximum, so never Always for an
 * always_card row.
 */
export function policyChoices(tool: ChatTool): AdminPolicy[] {
  if (tool.class === 'read') return tool.flags.adminMayTurnOff ? ['never'] : [];
  if (tool.class === 'execute') return ['never'];
  const max = writeRank(tool.maxPolicy as WritePolicy);
  return ['never', ...WRITE_POLICIES.filter((policy) => writeRank(policy) <= max)];
}

/**
 * Why Settings › Chat shows a policy locked on this plan, or null when it
 * may be picked: below Growth (Starter, the trial) Always and "Ask (auto
 * allowed in Full auto)" only act as Ask, since both run without a card
 * only where Full auto is open (CHAT-23 policy.toggleAutoInFullAuto). The
 * same reason the precedence gives a call: full_auto_locked.
 */
export function policyChoiceLock(plan: PlanFacts, policy: AdminPolicy): 'full_auto_locked' | null {
  return !plan.fullAuto && (policy === 'always' || policy === 'ask_full_auto')
    ? 'full_auto_locked'
    : null;
}

/**
 * A row's policy in this workspace: the Admin's choice where the row offers
 * it, else the row's default. A choice past the row's maximum is held at the
 * maximum, so a stored "Always" never lifts an always_card WRITE.
 */
export function effectivePolicy(tool: ChatTool, settings: ChatSettings): ToolPolicy {
  const set = settings.toolPolicies[tool.labelKey];
  if (set === 'never') return policyChoices(tool).includes('never') ? 'never' : tool.defaultPolicy;
  if (tool.class !== 'write' || !isWritePolicy(set)) return tool.defaultPolicy;
  return writeRank(set) > writeRank(tool.maxPolicy as WritePolicy) ? tool.maxPolicy : set;
}

function isWritePolicy(value: unknown): value is WritePolicy {
  return WRITE_POLICIES.some((policy) => policy === value);
}

function canAccessBrand(access: PrecedenceContext['brandAccess'], brandId: string): boolean {
  return access === 'all' || access.includes(brandId);
}

const deny = (denial: ToolDenial): ToolDecision => ({ kind: 'deny', denial });

/**
 * What a surface other than Chat needs of the plan (§7, §17): MCP isn't in
 * the trial, its reads are Starter and up, its writes and executes Growth
 * and up. A surface this code doesn't know gets MCP's, the closed side.
 */
function surfaceGate(ctx: PrecedenceContext, tool: ChatTool): PlanGate | null {
  if (ctx.surface === 'chat') return null;
  return { minPlan: tool.class === 'read' ? 'starter' : 'growth' };
}

/**
 * The decision for one call. Run it before every tool call, with a context
 * read for that call: a role, a plan or a setting changed mid-run counts
 * from the next call.
 *
 * For the engine (C3): an `ask` or a `click` is not a permission kept for
 * later. When the person approves the card or clicks, read the context and
 * the call again and decide again; run only if that answer still lets it
 * (the approval stands for the card, a `click` for the click). A role, a
 * plan, a policy or the brand that changed while the card waited wins.
 */
export function decideToolCall(
  tool: ChatTool,
  ctx: PrecedenceContext,
  call: ToolCall,
): ToolDecision {
  return decide(tool, ctx, call, false);
}

/**
 * decideToolCall for a context that may be missing: readPrecedenceContext
 * returns null when the person isn't a member of the workspace now (no
 * profile, another workspace, no live role), and then nothing runs.
 */
export function decideOrDeny(
  tool: ChatTool,
  ctx: PrecedenceContext | null,
  call: ToolCall,
): ToolDecision {
  return ctx ? decideToolCall(tool, ctx, call) : deny({ code: 'no_access' });
}

/** listing: for the model's tool list, where a run may not have named its brand yet. */
function decide(
  tool: ChatTool,
  ctx: PrecedenceContext,
  call: ToolCall,
  listing: boolean,
): ToolDecision {
  // 0. A brand outside the person's scope doesn't exist for Chat, nor one not found in the
  // workspace. A list for a run without a brand keeps the brand-bound rows: each call
  // names its own, and is decided with it.
  if (call.brandId === null) {
    if (tool.brandOf && !listing) return deny({ code: 'brand_scope' });
  } else if (!canAccessBrand(ctx.brandAccess, call.brandId)) {
    return deny({ code: 'brand_scope' });
  }

  // 1. Hard rules.
  const changes = tool.class !== 'read';
  // A read that runs a model (C2, C3) spends the AI budget, which a read-only workspace can't.
  const spends = tool.costClass === 'C2' || tool.costClass === 'C3';
  if (!ctx.plan.writable && (changes || spends)) return deny({ code: 'subscription_inactive' });
  if (call.brandIsDemo && (changes || spends)) return deny({ code: 'demo_brand' });
  const policy = effectivePolicy(tool, ctx.settings);
  if (policy === 'never') return deny({ code: 'policy_never' });

  // 2. The plan, the tool's and its surface's. While read-only, choosing a plan is what
  // opens it, whatever it needs.
  const needs =
    planGateLock(ctx.plan, tool.planGate) ?? planGateLock(ctx.plan, surfaceGate(ctx, tool));
  if (needs) {
    return deny(
      ctx.plan.writable ? { code: 'plan_locked', needs } : { code: 'subscription_inactive' },
    );
  }

  // 3. The live role.
  if (!roleAllowed(tool, ctx.role)) {
    return deny({ code: 'forbidden_role', role: ctx.role, roles: allowedRoles(tool) });
  }

  if (tool.class === 'read') return { kind: 'run', via: 'read' };

  if (tool.class === 'execute') {
    // 4. The Admin's switch for Managers; then the hard rule: a click, whatever the mode.
    const group = tool.executeGroup;
    if (ctx.role === 'manager' && group && ctx.settings.managerExecuteOff.includes(group)) {
      return deny({ code: 'execute_off', group });
    }
    // 4b. An Admin's go-live permission: the one exception to hard rule 1, lifting a click only.
    if (listing || !goLiveCandidate(tool, ctx)) return { kind: 'click' };
    const held = goLiveHold(ctx, call.goLive);
    return held ? { kind: 'click', held } : { kind: 'run', via: 'go_live' };
  }

  return decideWrite(tool, ctx, call, policy as WritePolicy);
}

/**
 * Step 4b's conditions (AUTONOMOUS-GO-LIVE §5.2), all of them, for an
 * EXECUTE the earlier steps leave a click: the flag is on; it's an agent run
 * in Chat (never MCP, never a person's own chat); an Admin let agents take
 * the row's group live; the agent is allowed for the run's version; Full
 * auto is open (Growth and up, paid) and on for agents; the run is in Full
 * auto; and the row may go out on its own. The engine reads the guards'
 * facts (call.goLive) only when this holds.
 */
export function goLiveCandidate(tool: ChatTool, ctx: PrecedenceContext): boolean {
  const agent = ctx.agent;
  const group = tool.executeGroup;
  return (
    tool.class === 'execute' &&
    tool.flags.goLiveOnOwn &&
    ctx.autoGoLiveOn === true &&
    ctx.surface === 'chat' &&
    !!agent &&
    group !== null &&
    (ctx.settings.autoGoLiveGroups ?? []).includes(group) &&
    agent.goLive !== null &&
    ctx.plan.fullAuto &&
    ctx.settings.agentsFullAuto === true &&
    agent.fullAuto
  );
}

const UNCHECKED: GoLiveHold = { code: 'unchecked' };

/**
 * The first of step 4b's guards that holds a candidate's step for a click,
 * in their order (§5.2), or null to let it go out on its own: injection
 * and an untrusted start (the run's), the page's own state, its text and
 * links (goLiveChecks.ts), a live page or one someone took down, its quality and brand facts
 * (the gate), and last the agent's daily limit, so a page that fails a
 * check doesn't hold a slot. A fact missing where it's needed: `unchecked`.
 */
export function goLiveHold(
  ctx: PrecedenceContext,
  facts: GoLiveFacts | undefined,
): GoLiveHold | null {
  if (ctx.injectionDetected) return { code: 'injection' };
  if (!facts) return UNCHECKED;
  if (facts.runUntrusted) return { code: 'untrusted_scope' };
  if (!facts.page) return UNCHECKED;
  if (facts.page !== 'ready') return { code: facts.page };
  if (!facts.text) return UNCHECKED;
  if (facts.text.hold === 'foreign_link') return { code: 'foreign_link', host: facts.text.host };
  if (facts.text.hold) return { code: facts.text.hold };
  if (facts.liveItem === undefined) return UNCHECKED;
  if (facts.liveItem) return { code: 'live_page' };
  if (facts.takenDown === undefined) return UNCHECKED;
  if (facts.takenDown) return { code: 'taken_down' };
  if (!facts.gate) return UNCHECKED;
  if (!facts.gate.pass) return gateHold(facts.gate);
  if (!facts.usage) return UNCHECKED;
  const limit = ctx.agent?.goLive?.dailyLimit ?? 0;
  if (!facts.usage.counted && facts.usage.used >= limit) {
    return { code: 'limit', agent: ctx.agent?.name ?? '', limit, nextAt: facts.usage.nextAt };
  }
  return null;
}

/** The quality gate's refusal, as the click card says it. */
function gateHold(gate: Extract<GateResult, { pass: false }>): GoLiveHold {
  switch (gate.hold) {
    case 'quality_unread':
      return { code: 'quality_unread', why: gate.why };
    case 'facts':
      return { code: 'facts', page: gate.page, fact: gate.fact };
    case 'qualityLow':
      return { code: 'qualityLow', check: gate.check, score: gate.score };
    case 'quality':
      return { code: 'quality', score: gate.score };
    default:
      return { code: gate.hold };
  }
}

/** Steps 1 and 2, 4–7 for a WRITE the plan and the role allow. */
function decideWrite(
  tool: ChatTool,
  ctx: PrecedenceContext,
  call: ToolCall,
  policy: WritePolicy,
): ToolDecision {
  const tainted = call.tainted || ctx.injectionDetected;
  // A mode this code doesn't know is the most careful one.
  const mode: ChatMode = ctx.mode === 'auto' || ctx.mode === 'full_auto' ? ctx.mode : 'ask_first';
  const ask = (reason: AskReason): ToolDecision => ({
    kind: 'ask',
    reason,
    // The tick is offered only where it would count (§6): in Auto, for a change Full auto could run.
    offerDontAskAgain:
      reason === 'mode' && mode === 'auto' && !tainted && tickWouldCount(tool, ctx, policy),
  });

  // 1. A card in every mode: the row's, a cost said first, or a batch past its row's size (§9 row 22).
  if (tool.flags.alwaysCard || tool.flags.costCard || call.overBatch) return ask('always_card');
  // 5. The person asked to be asked first: their mode wins over every policy.
  if (mode === 'ask_first') return ask('mode');
  // 4–5. Set to Always by an Admin: runs in Auto and Full auto (see the header).
  if (policy === 'always') {
    // 2. Under Full auto's plan lock: Always mustn't get past the plan difference (Starter, trial).
    if (!ctx.plan.fullAuto) return ask('full_auto_locked');
    // Not under "Full auto for members": Always is the Admin's own choice for this one tool,
    // so it runs for every role it allows even with that switch off.
    if (ctx.surface !== 'chat') return ask('mcp');
    if (tainted) return ask('tainted');
    return { kind: 'run', via: 'always' };
  }
  // 5–6. What the person asked for: Full auto, or in Auto their tick on this tool.
  const via =
    mode === 'full_auto'
      ? 'full_auto'
      : ctx.autoChoices.has(tool.labelKey)
        ? 'dont_ask_again'
        : null;
  if (!via) return ask('mode');
  // 2. Full auto and "Don't ask again" are Growth+, paid.
  if (!ctx.plan.fullAuto) return ask('full_auto_locked');
  // 4. The Admin's policy.
  if (policy === 'ask') return ask('policy');
  if (ctx.role !== 'admin' && !ctx.settings.fullAutoForMembers) return ask('full_auto_off');
  // 5. Writes asked for from MCP (v1), or from a surface this code doesn't know, always ask.
  if (ctx.surface !== 'chat') return ask('mcp');
  // 6. An Admin switched "Don't ask again" off: the ticks stop at once.
  if (via === 'dont_ask_again' && !ctx.settings.dontAskAgain) return ask('dont_ask_again_off');
  // 7. Untrusted content chose the target or the text.
  if (tainted) return ask('tainted');
  return { kind: 'run', via };
}

/**
 * Whether a "Don't ask again" tick would run this WRITE: where Full auto
 * could, with the option on. An Always tool runs without one.
 */
function tickWouldCount(tool: ChatTool, ctx: PrecedenceContext, policy: WritePolicy): boolean {
  return (
    !tool.flags.alwaysCard &&
    !tool.flags.costCard &&
    ctx.plan.fullAuto &&
    policy === 'ask_full_auto' &&
    (ctx.role === 'admin' || ctx.settings.fullAutoForMembers) &&
    ctx.surface === 'chat' &&
    ctx.settings.dontAskAgain
  );
}

/**
 * The tools the model gets for a run (§9: its list equals the rows the
 * person's role, plan, brand access and policy allow): every row whose call
 * on the run's brand wouldn't be refused. A tool that only asks or waits on
 * a click stays: the card or the click is how it runs. A run about no brand
 * yet (brandId null) keeps the brand-bound rows; each call is decided with
 * the brand it names.
 */
export function allowedTools<T extends ChatTool>(
  tools: readonly T[],
  ctx: PrecedenceContext,
  scope: { brandId: string | null; brandIsDemo: boolean },
): T[] {
  return tools.filter(
    (tool) => decide(tool, ctx, { ...scope, tainted: false }, true).kind !== 'deny',
  );
}

/**
 * Why allowedTools() leaves a row out of the model's list, or null when it
 * keeps it. The engine (C3) names the rows left out to the model, so it can
 * answer "why not" with the out-of-permission answer (§4c) instead of
 * silence: the reason is decided as the list is, on the run's brand.
 */
export function listingDenial(
  tool: ChatTool,
  ctx: PrecedenceContext,
  scope: { brandId: string | null; brandIsDemo: boolean },
): ToolDenial | null {
  const decision = decide(tool, ctx, { ...scope, tainted: false }, true);
  return decision.kind === 'deny' ? decision.denial : null;
}
