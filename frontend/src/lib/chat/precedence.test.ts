// @vitest-environment node
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { TeamRole } from '@/components/context/RoleProvider';
import { planFactsFromOrgRow, type OrgPlanRow, type PlanFacts } from './planFacts';
import {
  chatDefaultModeOf,
  CHAT_MODES,
  CHAT_SURFACES,
  DEFAULT_CHAT_SETTINGS,
  TEAM_ROLES,
  allowedTools,
  decideOrDeny,
  decideToolCall,
  effectivePolicy,
  goLiveCandidate,
  listingDenial,
  parseTeamRole,
  policyChoiceLock,
  policyChoices,
  roleAllowed,
  type AdminPolicy,
  type ChatSettings,
  type GoLiveFacts,
  type PrecedenceContext,
  type ToolCall,
  type ToolDecision,
} from './precedence';
import { defineTool, type ChatTool, type ToolDefinition } from './registry/defineTool';

/**
 * The approval precedence (CHAT-20 §5) against a fixture table of rows, one
 * per kind of tool, and every combination of role, plan, mode, surface,
 * policy, tick, taint and brand state: permission correctness is 100% or
 * nothing (§19). One test per acceptance criterion of §21 it covers.
 */

// ─── Fixture rows ───────────────────────────────────────────────────────────

const base = {
  area: 'content' as const,
  description: 'fixture',
  planGate: null,
  costClass: 'C1' as const,
  route: null,
  mcpTool: null,
  specRow: '0',
  // Most rows are about a brand, named in the input (the registry's usual brandOf).
  brandOf: { input: 'brand_id' as const },
  inputSchema: z.object({ brand_id: z.string() }),
  run: async () => null,
  fixture: { input: { brand_id: 'brand' } },
};

type Def = ToolDefinition<z.ZodObject>;
const row = (name: string, def: Partial<Def> & Pick<Def, 'class'>): ChatTool =>
  defineTool({ ...base, name, labelKey: name, minRole: 'analyst', ...def } as Def);

const ROWS = {
  // About no brand: the person or the workspace (a profile, usage).
  read: row('read', { class: 'read', brandOf: null }),
  readOff: row('readOff', { class: 'read', flags: { adminMayTurnOff: true } }),
  readSpends: row('readSpends', { class: 'read', minRole: 'manager', costClass: 'C2' }),
  readShopping: row('readShopping', {
    class: 'read',
    planGate: { feature: 'shopping_analytics' },
  }),
  readPlatforms: row('readPlatforms', { class: 'read', planGate: { platforms: true } }),
  // Daily work: open to every role (the role model of 2026-10-29).
  draft: row('draft', {
    class: 'write',
    costClass: 'C2',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
  }),
  // Daily work the server refuses Agency partners (#1762, #1763).
  dismiss: row('dismiss', {
    class: 'write',
    excludeRoles: ['agency_partner'],
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
  }),
  addPrompts: row('addPrompts', {
    class: 'write',
    minRole: 'manager',
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
  }),
  schedule: row('schedule', {
    class: 'write',
    minRole: 'manager',
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
  }),
  removeCompetitor: row('removeCompetitor', {
    class: 'write',
    minRole: 'manager',
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
  }),
  workspaceMemory: row('workspaceMemory', {
    class: 'write',
    minRole: 'admin',
    defaultPolicy: 'ask',
    maxPolicy: 'ask',
    flags: { alwaysCard: true },
  }),
  growthWrite: row('growthWrite', {
    class: 'write',
    minRole: 'manager',
    planGate: { minPlan: 'growth' },
    defaultPolicy: 'ask_full_auto',
    maxPolicy: 'always',
  }),
  publish: row('publish', { class: 'execute', minRole: 'manager', executeGroup: 'publishing' }),
  openPr: row('openPr', {
    class: 'execute',
    minRole: 'manager',
    executeGroup: 'code_prs',
    planGate: { minPlan: 'growth' },
  }),
} satisfies Record<string, ChatTool>;
const ALL_ROWS: ChatTool[] = Object.values(ROWS);

// ─── Plans and contexts ─────────────────────────────────────────────────────

function factsFor(orgRow: OrgPlanRow, cloud = true): PlanFacts {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', cloud ? 'true' : 'false');
  try {
    return planFactsFromOrgRow(orgRow);
  } finally {
    vi.unstubAllEnvs();
  }
}

const PLAN = {
  starter: factsFor({ plan: 'starter', subscription_status: 'active' }),
  growth: factsFor({ plan: 'growth', subscription_status: 'active' }),
  enterprise: factsFor({ plan: 'enterprise', subscription_status: 'active' }),
  trial: factsFor({ plan: 'growth', subscription_status: 'trialing' }),
  readOnly: factsFor({ plan: 'growth', subscription_status: 'canceled' }),
  selfHosted: factsFor(null, false),
};
type PlanKey = keyof typeof PLAN;

function ctx(over: Partial<PrecedenceContext> & { planKey?: PlanKey } = {}): PrecedenceContext {
  const { planKey = 'growth', ...rest } = over;
  return {
    organizationId: 'org-1',
    role: 'manager',
    plan: PLAN[planKey],
    settings: DEFAULT_CHAT_SETTINGS,
    mode: 'auto',
    surface: 'chat',
    autoChoices: new Set(),
    brandAccess: 'all',
    injectionDetected: false,
    ...rest,
  };
}

const settings = (over: Partial<ChatSettings>): ChatSettings => ({
  ...DEFAULT_CHAT_SETTINGS,
  ...over,
});

const BRAND_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRAND_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const call = (over: Partial<ToolCall> = {}): ToolCall => ({
  brandId: BRAND_A,
  brandIsDemo: false,
  tainted: false,
  ...over,
});

const RUN_READ: ToolDecision = { kind: 'run', via: 'read' };
const CLICK: ToolDecision = { kind: 'click' };
const ask = (reason: string, offerDontAskAgain = false): ToolDecision =>
  ({ kind: 'ask', reason, offerDontAskAgain }) as ToolDecision;
const deny = (denial: object): ToolDecision => ({ kind: 'deny', denial }) as ToolDecision;

// ─── The fixture table ──────────────────────────────────────────────────────

const TABLE: [string, ChatTool, PrecedenceContext, ToolCall, ToolDecision][] = [
  // Reads
  ['a read runs for every role', ROWS.read, ctx({ role: 'agency_partner' }), call(), RUN_READ],
  ['a read runs on Starter', ROWS.read, ctx({ planKey: 'starter' }), call(), RUN_READ],
  ['a read runs while read-only', ROWS.read, ctx({ planKey: 'readOnly' }), call(), RUN_READ],
  ['a read runs on the demo brand', ROWS.read, ctx(), call({ brandIsDemo: true }), RUN_READ],
  [
    'a platforms read is open on Starter',
    ROWS.readPlatforms,
    ctx({ planKey: 'starter' }),
    call(),
    RUN_READ,
  ],
  [
    'a read an Admin turned off is refused',
    ROWS.readOff,
    ctx({ settings: settings({ toolPolicies: { readOff: 'never' } }) }),
    call(),
    deny({ code: 'policy_never' }),
  ],
  [
    'a read an Admin may not turn off keeps running',
    ROWS.read,
    ctx({ settings: settings({ toolPolicies: { read: 'never' } }) }),
    call(),
    RUN_READ,
  ],
  [
    'a feature read is locked on Starter',
    ROWS.readShopping,
    ctx({ planKey: 'starter' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'a feature read follows the trial plan',
    ROWS.readShopping,
    ctx({ planKey: 'trial' }),
    call(),
    RUN_READ,
  ],
  [
    'a read that spends is refused while read-only',
    ROWS.readSpends,
    ctx({ planKey: 'readOnly' }),
    call(),
    deny({ code: 'subscription_inactive' }),
  ],
  [
    'a read that spends is refused on the demo brand',
    ROWS.readSpends,
    ctx(),
    call({ brandIsDemo: true }),
    deny({ code: 'demo_brand' }),
  ],
  [
    'a manager read is refused to an Analyst',
    ROWS.readSpends,
    ctx({ role: 'analyst' }),
    call(),
    deny({ code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] }),
  ],
  // Writes: modes
  ['Auto asks before a change, offering the tick', ROWS.draft, ctx(), call(), ask('mode', true)],
  [
    'Ask me first asks, without the tick',
    ROWS.draft,
    ctx({ mode: 'ask_first' }),
    call(),
    ask('mode'),
  ],
  [
    'Full auto runs a routine change',
    ROWS.draft,
    ctx({ mode: 'full_auto' }),
    call(),
    { kind: 'run', via: 'full_auto' },
  ],
  // Always (decision of 2026-10-29): no card in Auto or Full auto; Ask me first still asks.
  [
    'Full auto runs a policy Always change',
    ROWS.addPrompts,
    ctx({ mode: 'full_auto', settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    { kind: 'run', via: 'always' },
  ],
  [
    'Auto runs a policy Always change without a card',
    ROWS.addPrompts,
    ctx({ settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    { kind: 'run', via: 'always' },
  ],
  [
    'Ask me first asks even for a policy Always change',
    ROWS.addPrompts,
    ctx({ mode: 'ask_first', settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    ask('mode'),
  ],
  [
    "Always asks on Starter, under Full auto's plan lock",
    ROWS.addPrompts,
    ctx({ planKey: 'starter', settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    ask('full_auto_locked'),
  ],
  [
    'Always asks in the trial',
    ROWS.addPrompts,
    ctx({
      planKey: 'trial',
      mode: 'full_auto',
      settings: settings({ toolPolicies: { addPrompts: 'always' } }),
    }),
    call(),
    ask('full_auto_locked'),
  ],
  [
    "MCP's plan gate refuses an Always write on Starter",
    ROWS.addPrompts,
    ctx({
      planKey: 'starter',
      surface: 'mcp',
      settings: settings({ toolPolicies: { addPrompts: 'always' } }),
    }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'Always runs on self-hosted',
    ROWS.addPrompts,
    ctx({ planKey: 'selfHosted', settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    { kind: 'run', via: 'always' },
  ],
  [
    'Always runs for a Manager with Full auto off for members',
    ROWS.addPrompts,
    ctx({
      settings: settings({ toolPolicies: { addPrompts: 'always' }, fullAutoForMembers: false }),
    }),
    call(),
    { kind: 'run', via: 'always' },
  ],
  [
    'an MCP write set to Always asks',
    ROWS.addPrompts,
    ctx({ surface: 'mcp', settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    ask('mcp'),
  ],
  [
    'a tainted write set to Always asks',
    ROWS.addPrompts,
    ctx({ settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call({ tainted: true }),
    ask('tainted'),
  ],
  [
    "Full auto asks where the Admin's policy is Ask",
    ROWS.addPrompts,
    ctx({ mode: 'full_auto', settings: settings({ toolPolicies: { addPrompts: 'ask' } }) }),
    call(),
    ask('policy'),
  ],
  [
    'a tool fixed at Ask asks in Full auto',
    ROWS.schedule,
    ctx({ mode: 'full_auto' }),
    call(),
    ask('policy'),
  ],
  [
    'Full auto is locked on Starter (§5a example 2)',
    ROWS.addPrompts,
    ctx({ planKey: 'starter', mode: 'full_auto' }),
    call(),
    ask('full_auto_locked'),
  ],
  [
    'Full auto is locked in the trial',
    ROWS.addPrompts,
    ctx({ planKey: 'trial', mode: 'full_auto' }),
    call(),
    ask('full_auto_locked'),
  ],
  [
    'Full auto runs for an Admin with Full auto off for members',
    ROWS.addPrompts,
    ctx({ role: 'admin', mode: 'full_auto', settings: settings({ fullAutoForMembers: false }) }),
    call(),
    { kind: 'run', via: 'full_auto' },
  ],
  [
    'Full auto asks a Manager when an Admin turned it off for members',
    ROWS.addPrompts,
    ctx({ mode: 'full_auto', settings: settings({ fullAutoForMembers: false }) }),
    call(),
    ask('full_auto_off'),
  ],
  // Writes: "Don't ask again"
  [
    'a tick runs the change in Auto (§5a example 6)',
    ROWS.draft,
    ctx({ autoChoices: new Set(['draft']) }),
    call(),
    { kind: 'run', via: 'dont_ask_again' },
  ],
  [
    'a tick counts for nothing in Ask me first',
    ROWS.draft,
    ctx({ mode: 'ask_first', autoChoices: new Set(['draft']) }),
    call(),
    ask('mode'),
  ],
  [
    'a tick stops once an Admin turns the option off',
    ROWS.draft,
    ctx({ autoChoices: new Set(['draft']), settings: settings({ dontAskAgain: false }) }),
    call(),
    ask('dont_ask_again_off'),
  ],
  [
    'no tick is offered once an Admin turns the option off',
    ROWS.draft,
    ctx({ settings: settings({ dontAskAgain: false }) }),
    call(),
    ask('mode'),
  ],
  [
    'a tick left from Growth counts for nothing on Starter',
    ROWS.draft,
    ctx({ planKey: 'starter', autoChoices: new Set(['draft']) }),
    call(),
    ask('full_auto_locked'),
  ],
  ['no tick is offered on Starter', ROWS.draft, ctx({ planKey: 'starter' }), call(), ask('mode')],
  // Writes: taint and MCP
  [
    'a tainted change asks in Full auto (§5a example 10)',
    ROWS.draft,
    ctx({ mode: 'full_auto' }),
    call({ tainted: true }),
    ask('tainted'),
  ],
  [
    'a tainted change asks under a tick',
    ROWS.draft,
    ctx({ autoChoices: new Set(['draft']) }),
    call({ tainted: true }),
    ask('tainted'),
  ],
  [
    'a detected injection makes the rest of the run ask',
    ROWS.draft,
    ctx({ mode: 'full_auto', injectionDetected: true }),
    call(),
    ask('tainted'),
  ],
  [
    'an MCP write asks on Growth in Full auto (§5a example 15)',
    ROWS.addPrompts,
    ctx({ surface: 'mcp', mode: 'full_auto' }),
    call(),
    ask('mcp'),
  ],
  [
    'an MCP write asks under a tick',
    ROWS.addPrompts,
    ctx({ surface: 'mcp', autoChoices: new Set(['addPrompts']) }),
    call(),
    ask('mcp'),
  ],
  // Writes: hard rules, plan and role
  [
    'an always_card write asks in Full auto (§5a example 7)',
    ROWS.removeCompetitor,
    ctx({ mode: 'full_auto' }),
    call(),
    ask('always_card'),
  ],
  [
    'a stored Always never lifts an always_card write',
    ROWS.removeCompetitor,
    ctx({
      mode: 'full_auto',
      settings: settings({ toolPolicies: { removeCompetitor: 'always' } }),
    }),
    call(),
    ask('always_card'),
  ],
  [
    'a write an Admin set to Never is refused',
    ROWS.draft,
    ctx({ settings: settings({ toolPolicies: { draft: 'never' } }) }),
    call(),
    deny({ code: 'policy_never' }),
  ],
  [
    'an Analyst may save a draft (daily work)',
    ROWS.draft,
    ctx({ role: 'analyst' }),
    call(),
    ask('mode', true),
  ],
  [
    'an Analyst may dismiss a prompt suggestion',
    ROWS.dismiss,
    ctx({ role: 'analyst' }),
    call(),
    ask('mode', true),
  ],
  [
    "an Agency partner's dismissal is forbidden_role, as the server has it",
    ROWS.dismiss,
    ctx({ role: 'agency_partner', mode: 'full_auto' }),
    call(),
    deny({
      code: 'forbidden_role',
      role: 'agency_partner',
      roles: ['admin', 'manager', 'analyst'],
    }),
  ],
  [
    "an Analyst's prompt change is forbidden_role (§5a example 3)",
    ROWS.addPrompts,
    ctx({ role: 'analyst' }),
    call(),
    deny({ code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] }),
  ],
  [
    "an Agency partner's prompt change is forbidden_role",
    ROWS.addPrompts,
    ctx({ role: 'agency_partner', mode: 'full_auto' }),
    call(),
    deny({ code: 'forbidden_role', role: 'agency_partner', roles: ['admin', 'manager'] }),
  ],
  [
    "a Manager's workspace memory is forbidden_role",
    ROWS.workspaceMemory,
    ctx(),
    call(),
    deny({ code: 'forbidden_role', role: 'manager', roles: ['admin'] }),
  ],
  [
    'a Growth write is locked on Starter',
    ROWS.growthWrite,
    ctx({ planKey: 'starter' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'a Growth write is locked in the Growth trial',
    ROWS.growthWrite,
    ctx({ planKey: 'trial' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'the plan gate comes before the role',
    ROWS.growthWrite,
    ctx({ planKey: 'starter', role: 'analyst' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'Never comes before the plan gate',
    ROWS.growthWrite,
    ctx({ planKey: 'starter', settings: settings({ toolPolicies: { growthWrite: 'never' } }) }),
    call(),
    deny({ code: 'policy_never' }),
  ],
  [
    'a write is refused while read-only, before its policy',
    ROWS.draft,
    ctx({ planKey: 'readOnly', settings: settings({ toolPolicies: { draft: 'never' } }) }),
    call(),
    deny({ code: 'subscription_inactive' }),
  ],
  [
    'a write is refused on the demo brand',
    ROWS.draft,
    ctx({ role: 'admin', mode: 'full_auto' }),
    call({ brandIsDemo: true }),
    deny({ code: 'demo_brand' }),
  ],
  // Executes
  [
    'a publish waits on the click in Full auto (§5a example 5)',
    ROWS.publish,
    ctx({ mode: 'full_auto' }),
    call(),
    CLICK,
  ],
  [
    'a publish waits on the click over MCP (§5a example 14)',
    ROWS.publish,
    ctx({ surface: 'mcp' }),
    call(),
    CLICK,
  ],
  [
    'a stored Always leaves an execute at the click',
    ROWS.publish,
    ctx({ mode: 'full_auto', settings: settings({ toolPolicies: { publish: 'always' } }) }),
    call(),
    CLICK,
  ],
  [
    'an execute an Admin set to Never is refused',
    ROWS.publish,
    ctx({ settings: settings({ toolPolicies: { publish: 'never' } }) }),
    call(),
    deny({ code: 'policy_never' }),
  ],
  [
    "a Manager's publish is refused with publishing off for Managers (§5a example 11)",
    ROWS.publish,
    ctx({ settings: settings({ managerExecuteOff: ['publishing'] }) }),
    call(),
    deny({ code: 'execute_off', group: 'publishing' }),
  ],
  [
    "an Admin's publish still waits on the click with publishing off for Managers",
    ROWS.publish,
    ctx({ role: 'admin', settings: settings({ managerExecuteOff: ['publishing'] }) }),
    call(),
    CLICK,
  ],
  [
    'another group off leaves the publish at the click',
    ROWS.publish,
    ctx({ settings: settings({ managerExecuteOff: ['feeds', 'code_prs'] }) }),
    call(),
    CLICK,
  ],
  [
    "an Analyst's publish is forbidden_role",
    ROWS.publish,
    ctx({ role: 'analyst' }),
    call(),
    deny({ code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] }),
  ],
  [
    'opening a pull request is locked on Starter (§5a example 3b)',
    ROWS.openPr,
    ctx({ planKey: 'starter' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'opening a pull request is locked in the trial',
    ROWS.openPr,
    ctx({ planKey: 'trial', role: 'admin' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  ['opening a pull request waits on the click on Growth', ROWS.openPr, ctx(), call(), CLICK],
  [
    'an execute is refused on the demo brand',
    ROWS.publish,
    ctx(),
    call({ brandIsDemo: true }),
    deny({ code: 'demo_brand' }),
  ],
  // Brand scope
  [
    'a brand out of scope is refused before anything else',
    ROWS.draft,
    ctx({ planKey: 'readOnly', brandAccess: [BRAND_A] }),
    call({ brandId: BRAND_B, brandIsDemo: true }),
    deny({ code: 'brand_scope' }),
  ],
  [
    'a shared brand is in scope',
    ROWS.read,
    ctx({ role: 'agency_partner', brandAccess: [BRAND_A] }),
    call(),
    RUN_READ,
  ],
  [
    'a call about no brand is in scope',
    ROWS.read,
    ctx({ brandAccess: [] }),
    call({ brandId: null }),
    RUN_READ,
  ],
  [
    "a brand-bound call whose brand wasn't found in the workspace is refused",
    ROWS.draft,
    ctx({ role: 'admin', mode: 'full_auto' }),
    call({ brandId: null }),
    deny({ code: 'brand_scope' }),
  ],
  [
    "a brand-bound read whose brand wasn't found is refused, with access to every brand",
    ROWS.readPlatforms,
    ctx({ role: 'admin' }),
    call({ brandId: null }),
    deny({ code: 'brand_scope' }),
  ],
  // MCP (§7, §17): not in the trial, reads on Starter, the rest from Growth
  [
    'MCP is not in the trial, reads included',
    ROWS.read,
    ctx({ planKey: 'trial', surface: 'mcp', role: 'admin' }),
    call(),
    deny({ code: 'plan_locked', needs: 'starter' }),
  ],
  [
    'MCP writes are not in the trial',
    ROWS.draft,
    ctx({ planKey: 'trial', surface: 'mcp' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'MCP reads run on Starter',
    ROWS.readPlatforms,
    ctx({ planKey: 'starter', surface: 'mcp' }),
    call(),
    RUN_READ,
  ],
  [
    'MCP writes need Growth',
    ROWS.draft,
    ctx({ planKey: 'starter', surface: 'mcp' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'MCP executes need Growth',
    ROWS.publish,
    ctx({ planKey: 'starter', surface: 'mcp' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'an MCP write on self-hosted asks in Full auto',
    ROWS.draft,
    ctx({ planKey: 'selfHosted', surface: 'mcp', mode: 'full_auto' }),
    call(),
    ask('mcp'),
  ],
  // A surface or a mode this code doesn't know is the closed side
  [
    'a write from an unknown surface asks, even in Full auto',
    ROWS.draft,
    ctx({ surface: 'email' as never, mode: 'full_auto' }),
    call(),
    ask('mcp'),
  ],
  [
    'an Always write from an unknown surface asks',
    ROWS.addPrompts,
    ctx({
      surface: 'email' as never,
      settings: settings({ toolPolicies: { addPrompts: 'always' } }),
    }),
    call(),
    ask('mcp'),
  ],
  [
    "an unknown surface gets MCP's plan gates",
    ROWS.draft,
    ctx({ surface: 'email' as never, planKey: 'starter' }),
    call(),
    deny({ code: 'plan_locked', needs: 'growth' }),
  ],
  [
    'an unknown mode asks first, even for an Always write',
    ROWS.addPrompts,
    ctx({ mode: 'yolo' as never, settings: settings({ toolPolicies: { addPrompts: 'always' } }) }),
    call(),
    ask('mode'),
  ],
  [
    'an unknown mode counts no tick and offers none',
    ROWS.draft,
    ctx({ mode: 'yolo' as never, autoChoices: new Set(['draft']) }),
    call(),
    ask('mode'),
  ],
  // Self-hosted
  ['self-hosted has no plan gate', ROWS.openPr, ctx({ planKey: 'selfHosted' }), call(), CLICK],
  [
    'self-hosted runs Full auto',
    ROWS.growthWrite,
    ctx({ planKey: 'selfHosted', mode: 'full_auto' }),
    call(),
    { kind: 'run', via: 'full_auto' },
  ],
];

describe('the approval precedence, case by case', () => {
  it.each(TABLE)('%s', (_name, tool, context, toolCall, expected) => {
    expect(decideToolCall(tool, context, toolCall)).toEqual(expected);
  });
});

// ─── Every combination ──────────────────────────────────────────────────────

const LABELS = ALL_ROWS.map((tool) => tool.labelKey);
// A stored Ask is covered by the rows fixed at Ask and by the table.
const STORED: (AdminPolicy | undefined)[] = [undefined, 'never', 'always'];
// The Admin's switches: as they come, the ticks off, Full auto off for members (ticks on),
// and everything off.
const SWITCHES: Partial<ChatSettings>[] = [
  {},
  { dontAskAgain: false },
  { fullAutoForMembers: false },
  { fullAutoForMembers: false, dontAskAgain: false, managerExecuteOff: ['publishing', 'code_prs'] },
];
// Enterprise decides as Growth does here; the table covers it.
const LOOP_PLANS: PlanKey[] = ['starter', 'growth', 'trial', 'readOnly', 'selfHosted'];

interface Variant {
  ctx: PrecedenceContext;
  /** The policy stored for every row, or none. */
  stored: AdminPolicy | undefined;
  /** "Don't ask again" ticked on every row. */
  ticked: boolean;
}

/**
 * Every context, shared by the rows: role × plan × mode × surface × policy ×
 * switches × tick × a detected injection.
 */
const VARIANTS: Variant[] = [];
for (const role of TEAM_ROLES)
  for (const planKey of LOOP_PLANS)
    for (const mode of CHAT_MODES)
      for (const surface of CHAT_SURFACES)
        for (const stored of STORED)
          for (const switches of SWITCHES)
            for (const ticked of [false, true])
              for (const injectionDetected of [false, true]) {
                const context = ctx({
                  role,
                  planKey,
                  mode,
                  surface,
                  injectionDetected,
                  autoChoices: new Set(ticked ? LABELS : []),
                  settings: settings({
                    toolPolicies: stored
                      ? Object.fromEntries(LABELS.map((key) => [key, stored]))
                      : {},
                    ...switches,
                  }),
                });
                VARIANTS.push({ ctx: context, stored, ticked });
              }

// On brand A, on the demo brand, with untrusted content, and with a brand not found.
const CALLS = [
  call(),
  call({ brandIsDemo: true }),
  call({ tainted: true }),
  call({ brandId: null }),
];

/** Every combination's decision, decided once for the tests below. */
const DECIDED = VARIANTS.flatMap((variant) =>
  CALLS.flatMap((toolCall) =>
    ALL_ROWS.map((tool) => ({
      ...variant,
      tool,
      call: toolCall,
      decision: decideToolCall(tool, variant.ctx, toolCall),
    })),
  ),
);
type Decided = (typeof DECIDED)[number];

/** The call's brand was found, or the row is about no brand. */
const resolved = (d: Decided) => d.call.brandId !== null || d.tool.brandOf === null;

const failures = (keep: (d: Decided) => boolean) =>
  DECIDED.filter(keep).map(
    (d) =>
      `${d.tool.name} · ${d.ctx.role} · ${d.ctx.plan.planId}${d.ctx.plan.isTrial ? ' trial' : ''}` +
      ` · ${d.ctx.mode} · ${d.ctx.surface} → ${JSON.stringify(d.decision)}`,
  );

describe('CHAT-20 §21 acceptance criteria', () => {
  it("gives the model exactly the rows the person's role, plan, brand access and policy allow", () => {
    expect(DECIDED.length).toBeGreaterThan(100_000);
    // The list for a run is every row a call on the run's brand wouldn't refuse…
    for (const { ctx: context } of VARIANTS) {
      for (const brandIsDemo of [false, true]) {
        const scope = { brandId: BRAND_A, brandIsDemo };
        const listed = allowedTools(ALL_ROWS, context, scope).map((t) => t.name);
        const allowed = ALL_ROWS.filter(
          (t) => decideToolCall(t, context, { ...scope, tainted: false }).kind !== 'deny',
        ).map((t) => t.name);
        expect(listed).toEqual(allowed);
      }
      // A run about no brand yet lists what one on an accessible, ordinary brand does.
      expect(allowedTools(ALL_ROWS, context, { brandId: null, brandIsDemo: false })).toEqual(
        allowedTools(ALL_ROWS, context, { brandId: BRAND_A, brandIsDemo: false }),
      );
    }
    // Over MCP: nothing in the trial, reads only on Starter, everything from Growth.
    const overMcp = (planKey: PlanKey) =>
      allowedTools(ALL_ROWS, ctx({ role: 'admin', planKey, surface: 'mcp' }), call()).map(
        (t) => t.name,
      );
    expect(overMcp('trial')).toEqual([]);
    expect(overMcp('starter')).toEqual(['read', 'readOff', 'readSpends', 'readPlatforms']);
    expect(overMcp('growth')).toEqual(ALL_ROWS.map((t) => t.name));
    // …so for an Analyst on Starter, the reads its plan opens and daily work, and nothing else.
    expect(
      allowedTools(ALL_ROWS, ctx({ role: 'analyst', planKey: 'starter' }), call()).map(
        (t) => t.name,
      ),
    ).toEqual(['read', 'readOff', 'readPlatforms', 'draft', 'dismiss']);
    expect(
      allowedTools(ALL_ROWS, ctx({ role: 'manager', planKey: 'growth' }), call()).map(
        (t) => t.name,
      ),
    ).toEqual(ALL_ROWS.filter((t) => t.name !== 'workspaceMemory').map((t) => t.name));
  });

  it('decides with the live roles only, Admin and Manager over Analyst and Agency partner', () => {
    expect(TEAM_ROLES).toEqual(['admin', 'manager', 'analyst', 'agency_partner']);
    for (const old of ['owner', 'editor', 'viewer', 'Admin', '', null, undefined]) {
      expect(parseTeamRole(old)).toBeNull();
    }
    for (const role of TEAM_ROLES) expect(parseTeamRole(role)).toBe(role);
    // An Agency partner is decided as an Analyst (P0), except on a row that leaves them out.
    const as = (role: TeamRole) =>
      DECIDED.filter((d) => d.ctx.role === role && d.tool.excludeRoles.length === 0).map((d) =>
        JSON.stringify(d.decision).replace(role, '·'),
      );
    expect(as('agency_partner')).toEqual(as('analyst'));
    expect(roleAllowed(ROWS.dismiss, 'analyst')).toBe(true);
    expect(roleAllowed(ROWS.dismiss, 'agency_partner')).toBe(false);
    // The role a call is decided with is the context's, nothing kept: a changed role counts at once.
    expect(decideToolCall(ROWS.addPrompts, ctx({ role: 'manager' }), call()).kind).toBe('ask');
    expect(decideToolCall(ROWS.addPrompts, ctx({ role: 'analyst' }), call()).kind).toBe('deny');
  });

  it('never runs an EXECUTE without the click, in any mode, policy, role, tick or surface', () => {
    expect(
      failures(
        (d) =>
          d.tool.class === 'execute' && d.decision.kind !== 'click' && d.decision.kind !== 'deny',
      ),
    ).toEqual([]);
    const clicks = DECIDED.filter((d) => d.tool.class === 'execute' && d.decision.kind === 'click');
    expect(clicks.some((d) => d.ctx.mode === 'full_auto' && d.ticked)).toBe(true);
    expect(clicks.some((d) => d.ctx.surface === 'mcp')).toBe(true);
  });

  it('shows the card for an always_card WRITE in Full auto, whatever its stored policy', () => {
    expect(failures((d) => d.tool.flags.alwaysCard && d.decision.kind === 'run')).toEqual([]);
    const fullAuto = DECIDED.filter(
      (d) => d.tool.flags.alwaysCard && d.ctx.mode === 'full_auto' && d.decision.kind === 'ask',
    );
    expect(fullAuto.length).toBeGreaterThan(0);
    expect(
      fullAuto.every((d) => d.decision.kind === 'ask' && d.decision.reason === 'always_card'),
    ).toBe(true);
  });

  it('offers no Always for an EXECUTE or an always_card WRITE in Settings › Chat', () => {
    expect(policyChoices(ROWS.publish)).toEqual(['never']);
    expect(policyChoices(ROWS.removeCompetitor)).toEqual(['never', 'ask']);
    expect(policyChoices(ROWS.schedule)).toEqual(['never', 'ask']);
    expect(policyChoices(ROWS.draft)).toEqual(['never', 'ask', 'ask_full_auto', 'always']);
    expect(policyChoices(ROWS.read)).toEqual([]);
    expect(policyChoices(ROWS.readOff)).toEqual(['never']);
    // A stored value it doesn't offer is held at what it does.
    const stored = (tool: ChatTool, policy: AdminPolicy) =>
      effectivePolicy(tool, settings({ toolPolicies: { [tool.labelKey]: policy } }));
    expect(stored(ROWS.publish, 'always')).toBe('click');
    expect(stored(ROWS.removeCompetitor, 'always')).toBe('ask');
    expect(stored(ROWS.read, 'never')).toBe('on');
    expect(stored(ROWS.draft, 'ask')).toBe('ask');
  });

  it('locks Full auto and "Don\'t ask again" on Starter and in the trial', () => {
    const locked = (d: Decided) => d.ctx.plan.planId === 'starter' || d.ctx.plan.isTrial;
    // Nothing runs a change there without a card: not Full auto, a tick or an Admin's Always.
    expect(
      failures((d) => locked(d) && d.tool.class === 'write' && d.decision.kind === 'run'),
    ).toEqual([]);
    // Settings › Chat shows Always and auto-in-Full-auto locked there, for the same reason.
    for (const key of ['starter', 'trial'] as const) {
      expect(policyChoiceLock(PLAN[key], 'always')).toBe('full_auto_locked');
      expect(policyChoiceLock(PLAN[key], 'ask_full_auto')).toBe('full_auto_locked');
      expect(policyChoiceLock(PLAN[key], 'ask')).toBeNull();
      expect(policyChoiceLock(PLAN[key], 'never')).toBeNull();
    }
    for (const key of ['growth', 'enterprise', 'selfHosted'] as const) {
      expect(policyChoiceLock(PLAN[key], 'always')).toBeNull();
    }
    expect(
      failures((d) => locked(d) && d.decision.kind === 'ask' && d.decision.offerDontAskAgain),
    ).toEqual([]);
    // On Growth the same change runs.
    expect(decideToolCall(ROWS.addPrompts, ctx({ mode: 'full_auto' }), call()).kind).toBe('run');
  });

  it("refuses an Analyst's or Agency partner's change outside daily work with forbidden_role", () => {
    const readOnlyRoles = (d: Decided) =>
      resolved(d) &&
      (d.ctx.role === 'analyst' || d.ctx.role === 'agency_partner') &&
      d.tool.class !== 'read' &&
      !roleAllowed(d.tool, d.ctx.role);
    // Never a card, a click or a run: the refusal, or an earlier hard rule's.
    expect(failures((d) => readOnlyRoles(d) && d.decision.kind !== 'deny')).toEqual([]);
    const refusals = DECIDED.filter(readOnlyRoles).map((d) =>
      d.decision.kind === 'deny' ? d.decision.denial.code : d.decision.kind,
    );
    expect(new Set(refusals)).toEqual(
      new Set([
        'forbidden_role',
        'plan_locked',
        'policy_never',
        'subscription_inactive',
        'demo_brand',
      ]),
    );
    expect(decideToolCall(ROWS.addPrompts, ctx({ role: 'analyst' }), call())).toEqual(
      deny({ code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] }),
    );
  });

  it('gives a person without access to brand B nothing from brand B', () => {
    const scoped = ctx({ role: 'agency_partner', brandAccess: [BRAND_A] });
    for (const tool of ALL_ROWS) {
      for (const brandIsDemo of [false, true]) {
        expect(decideToolCall(tool, scoped, call({ brandId: BRAND_B, brandIsDemo }))).toEqual(
          deny({ code: 'brand_scope' }),
        );
      }
    }
    expect(allowedTools(ALL_ROWS, scoped, { brandId: BRAND_B, brandIsDemo: false })).toEqual([]);
    expect(allowedTools(ALL_ROWS, scoped, { brandId: BRAND_A, brandIsDemo: false }).length).toBe(5);
    // Even an Admin's or a self-hosted scope: a brand outside it doesn't exist for Chat.
    const admin = ctx({ role: 'admin', planKey: 'selfHosted', brandAccess: [BRAND_A] });
    expect(decideToolCall(ROWS.read, admin, call({ brandId: BRAND_B }))).toEqual(
      deny({ code: 'brand_scope' }),
    );
  });

  it("refuses every brand-bound call whose brand wasn't found in the workspace", () => {
    expect(
      failures(
        (d) =>
          !resolved(d) && !(d.decision.kind === 'deny' && d.decision.denial.code === 'brand_scope'),
      ),
    ).toEqual([]);
    expect(
      failures(
        (d) =>
          d.tool.brandOf === null &&
          d.decision.kind === 'deny' &&
          d.decision.denial.code === 'brand_scope',
      ),
    ).toEqual([]);
  });

  it('keeps a read-only workspace to reading: 402 subscription_inactive for the rest', () => {
    const readOnly = (d: Decided) => !d.ctx.plan.writable && resolved(d);
    expect(
      failures(
        (d) =>
          readOnly(d) &&
          (d.tool.class !== 'read' || d.tool.costClass === 'C2') &&
          !(d.decision.kind === 'deny' && d.decision.denial.code === 'subscription_inactive'),
      ),
    ).toEqual([]);
    expect(
      allowedTools(ALL_ROWS, ctx({ role: 'admin', planKey: 'readOnly' }), call()).map(
        (t) => t.name,
      ),
    ).toEqual(['read', 'readOff', 'readPlatforms']);
  });

  it('keeps the demo brand to reading: demo_brand for every change', () => {
    expect(
      failures(
        (d) =>
          d.call.brandIsDemo &&
          d.ctx.plan.writable &&
          (d.tool.class !== 'read' || d.tool.costClass === 'C2') &&
          !(d.decision.kind === 'deny' && d.decision.denial.code === 'demo_brand'),
      ),
    ).toEqual([]);
    expect(
      allowedTools(ALL_ROWS, ctx({ role: 'admin', mode: 'full_auto' }), {
        brandId: BRAND_A,
        brandIsDemo: true,
      }).map((t) => t.name),
    ).toEqual(['read', 'readOff', 'readShopping', 'readPlatforms']);
  });

  it('gates nothing by plan on self-hosted', () => {
    expect(
      failures(
        (d) =>
          d.ctx.plan.selfHosted &&
          d.decision.kind === 'deny' &&
          ['plan_locked', 'subscription_inactive'].includes(d.decision.denial.code),
      ),
    ).toEqual([]);
    expect(
      failures(
        (d) =>
          d.ctx.plan.selfHosted &&
          d.decision.kind === 'ask' &&
          d.decision.reason === 'full_auto_locked',
      ),
    ).toEqual([]);
  });

  it('shows a card in Full auto for a WRITE whose target came from untrusted content', () => {
    expect(
      failures((d) => d.call.tainted && d.tool.class === 'write' && d.decision.kind === 'run'),
    ).toEqual([]);
    expect(
      failures((d) => d.call.tainted && d.decision.kind === 'ask' && d.decision.offerDontAskAgain),
    ).toEqual([]);
  });

  it('never runs an MCP WRITE without an approval click, on any plan, policy or tick', () => {
    expect(
      failures(
        (d) => d.ctx.surface === 'mcp' && d.tool.class !== 'read' && d.decision.kind === 'run',
      ),
    ).toEqual([]);
    expect(
      failures(
        (d) => d.ctx.surface === 'mcp' && d.decision.kind === 'ask' && d.decision.offerDontAskAgain,
      ),
    ).toEqual([]);
  });
});

describe('MCP and the surfaces (§7, §17)', () => {
  it('keeps MCP out of the trial and to reads on Starter', () => {
    const mcp = (d: Decided) => d.ctx.surface === 'mcp' && resolved(d) && !d.ctx.plan.selfHosted;
    expect(failures((d) => mcp(d) && d.ctx.plan.isTrial && d.decision.kind !== 'deny')).toEqual([]);
    expect(
      failures(
        (d) =>
          mcp(d) &&
          d.ctx.plan.planId === 'starter' &&
          d.ctx.plan.writable &&
          d.tool.class !== 'read' &&
          d.decision.kind !== 'deny',
      ),
    ).toEqual([]);
    // Where nothing else refuses it, the refusal is the plan's.
    expect(
      decideToolCall(ROWS.addPrompts, ctx({ planKey: 'starter', surface: 'mcp' }), call()),
    ).toEqual(deny({ code: 'plan_locked', needs: 'growth' }));
  });
});

describe('the rest of the precedence', () => {
  it('runs a tick exactly where every rule it depends on allows it', () => {
    const counts = (d: Decided) =>
      d.ctx.mode === 'auto' &&
      d.ticked &&
      d.ctx.surface === 'chat' &&
      (d.ctx.role === 'admin' || d.ctx.settings.fullAutoForMembers) &&
      d.ctx.plan.fullAuto &&
      d.ctx.settings.dontAskAgain &&
      effectivePolicy(d.tool, d.ctx.settings) === 'ask_full_auto' &&
      !d.tool.flags.alwaysCard &&
      !d.call.tainted &&
      !d.ctx.injectionDetected;
    const viaTick = (d: Decided) =>
      d.decision.kind === 'run' && d.decision.via === 'dont_ask_again';
    expect(failures((d) => viaTick(d) && !counts(d))).toEqual([]);
    // …and wherever it counts, a WRITE the earlier steps allow runs by it.
    expect(
      failures(
        (d) => counts(d) && d.tool.class === 'write' && d.decision.kind !== 'deny' && !viaTick(d),
      ),
    ).toEqual([]);
    expect(DECIDED.some((d) => viaTick(d) && d.ctx.role !== 'admin')).toBe(true);
  });

  it('runs no WRITE by itself for the rest of a run that met an injection attempt', () => {
    expect(
      failures(
        (d) => d.ctx.injectionDetected && d.tool.class === 'write' && d.decision.kind === 'run',
      ),
    ).toEqual([]);
  });

  it('decides nothing but a refusal without a context', () => {
    for (const tool of ALL_ROWS) {
      expect(decideOrDeny(tool, null, call())).toEqual(deny({ code: 'no_access' }));
    }
    expect(decideOrDeny(ROWS.read, ctx(), call())).toEqual(RUN_READ);
  });

  it("shares frozen defaults, which a workspace can't change for another", () => {
    expect(Object.isFrozen(DEFAULT_CHAT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CHAT_SETTINGS.toolPolicies)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CHAT_SETTINGS.managerExecuteOff)).toBe(true);
  });

  it('runs a WRITE without a card only under Always, in Full auto or under a counted tick', () => {
    expect(
      failures(
        (d) =>
          d.decision.kind === 'run' &&
          d.tool.class === 'write' &&
          !(
            d.ctx.mode === 'full_auto' ||
            (d.ctx.mode === 'auto' && d.ticked) ||
            (d.ctx.mode === 'auto' && effectivePolicy(d.tool, d.ctx.settings) === 'always')
          ),
      ),
    ).toEqual([]);
    // A tick counts only where Full auto could run the change, and the option is on.
    expect(
      failures(
        (d) =>
          d.decision.kind === 'run' &&
          d.decision.via === 'dont_ask_again' &&
          !(
            d.ctx.plan.fullAuto &&
            d.ctx.settings.dontAskAgain &&
            effectivePolicy(d.tool, d.ctx.settings) === 'ask_full_auto' &&
            !d.tool.flags.alwaysCard
          ),
      ),
    ).toEqual([]);
  });

  it('runs an Always change in Auto and Full auto, and never in Ask me first, over MCP or tainted', () => {
    const always = (d: Decided) =>
      d.tool.class === 'write' && effectivePolicy(d.tool, d.ctx.settings) === 'always';
    expect(
      failures(
        (d) =>
          d.decision.kind === 'run' &&
          d.decision.via === 'always' &&
          (!always(d) ||
            d.ctx.mode === 'ask_first' ||
            d.ctx.surface !== 'chat' ||
            d.call.tainted ||
            d.ctx.injectionDetected),
      ),
    ).toEqual([]);
    // Wherever nothing else stops it, it runs: a card only for the person's mode, the plan
    // lock, MCP or taint. "Full auto for members" off doesn't stop it: the Admin chose Always.
    expect(
      failures(
        (d) =>
          always(d) &&
          d.ctx.mode !== 'ask_first' &&
          d.ctx.plan.fullAuto &&
          d.ctx.surface === 'chat' &&
          !d.call.tainted &&
          !d.ctx.injectionDetected &&
          d.decision.kind === 'ask',
      ),
    ).toEqual([]);
    expect(
      DECIDED.some(
        (d) =>
          !d.ctx.settings.fullAutoForMembers &&
          d.ctx.role !== 'admin' &&
          d.decision.kind === 'run' &&
          d.decision.via === 'always',
      ),
    ).toBe(true);
    // Below Growth it asks as Ask does, for the plan.
    expect(
      failures(
        (d) =>
          always(d) &&
          !d.ctx.plan.fullAuto &&
          d.ctx.mode !== 'ask_first' &&
          d.decision.kind !== 'deny' &&
          !(d.decision.kind === 'ask' && d.decision.reason === 'full_auto_locked'),
      ),
    ).toEqual([]);
    expect(
      DECIDED.some(
        (d) => d.ctx.mode === 'auto' && d.decision.kind === 'run' && d.decision.via === 'always',
      ),
    ).toBe(true);
  });

  it('offers the tick only on a card in Auto that the tick would lift', () => {
    for (const d of DECIDED) {
      if (d.decision.kind !== 'ask' || !d.decision.offerDontAskAgain) continue;
      const ticked = decideToolCall(
        d.tool,
        { ...d.ctx, autoChoices: new Set([d.tool.labelKey]) },
        d.call,
      );
      expect(ticked).toEqual({ kind: 'run', via: 'dont_ask_again' });
    }
  });

  it('refuses with policy_never only where the Admin set it and the row offers it', () => {
    expect(
      failures(
        (d) =>
          d.decision.kind === 'deny' &&
          d.decision.denial.code === 'policy_never' &&
          !(d.stored === 'never' && policyChoices(d.tool).includes('never')),
      ),
    ).toEqual([]);
  });

  it('switches a go-live group off for Managers only', () => {
    const off = DECIDED.filter(
      (d) => d.decision.kind === 'deny' && d.decision.denial.code === 'execute_off',
    );
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((d) => d.ctx.role === 'manager' && d.tool.class === 'execute')).toBe(true);
  });
});

describe('chatDefaultModeOf', () => {
  it('starts in the saved mode, Auto when none or unknown', () => {
    expect(chatDefaultModeOf('ask_first', false)).toBe('ask_first');
    expect(chatDefaultModeOf(null, false)).toBe('auto');
    expect(chatDefaultModeOf('reckless', true)).toBe('auto');
  });

  it('starts a saved Full auto as Auto once the plan no longer opens it', () => {
    expect(chatDefaultModeOf('full_auto', true)).toBe('full_auto');
    expect(chatDefaultModeOf('full_auto', false)).toBe('auto');
  });
});

describe("an Admin's go-live permission (AUTONOMOUS-GO-LIVE §5.2, step 4b)", () => {
  // A row an allowed agent may take live on its own: ids and fixed choices only (§6.3 B1).
  const sendOwn = row('sendOwn', {
    class: 'execute',
    minRole: 'manager',
    executeGroup: 'publishing',
    inputSchema: z.object({ brand_id: z.guid() }),
    fixture: { input: { brand_id: BRAND_A } },
    goLive: () => ({ kind: 'cms_draft', draftId: BRAND_A, target: 'webflow' }),
  });
  const AGENT = { id: 'agent-1', name: 'Publisher', fullAuto: true, goLive: { dailyLimit: 5 } };
  const allowed = (over: Partial<PrecedenceContext> & { planKey?: PlanKey } = {}) =>
    ctx({
      role: 'admin',
      mode: 'full_auto',
      autoGoLiveOn: true,
      agent: AGENT,
      settings: settings({ autoGoLiveGroups: ['publishing'], agentsFullAuto: true }),
      ...over,
    });
  const PASSED: GoLiveFacts = {
    runUntrusted: false,
    page: 'ready',
    text: { hold: null },
    liveItem: false,
    takenDown: false,
    gate: { pass: true, scores: { eeat: 80, trust: 82, readability: 78, average: 80 } },
    usage: { used: 0, counted: false, nextAt: null },
  };
  const NEXT = '2026-11-02T15:00:00.000Z';
  const decided = (facts: GoLiveFacts | undefined, over = {}) =>
    decideToolCall(sendOwn, allowed(over), call({ goLive: facts }));

  it('lifts the click only when every condition and guard holds', () => {
    expect(goLiveCandidate(sendOwn, allowed())).toBe(true);
    expect(decided(PASSED)).toEqual({ kind: 'run', via: 'go_live' });
    // Self-hosted passes the plan gate (§9): the operator's flag and the Admin decide.
    expect(decided(PASSED, { planKey: 'selfHosted' })).toEqual({ kind: 'run', via: 'go_live' });
    // A Manager the run acts as, with publishing on for Managers.
    expect(decided(PASSED, { role: 'manager' })).toEqual({ kind: 'run', via: 'go_live' });
  });

  it('keeps a plain click when any condition fails: no held reason, no facts read', () => {
    const failing: [string, Partial<PrecedenceContext> & { planKey?: PlanKey }][] = [
      ['the flag is off', { autoGoLiveOn: false }],
      ['the flag is unknown', { autoGoLiveOn: undefined }],
      ['MCP', { surface: 'mcp' }],
      ["a person's own chat (no agent)", { agent: null }],
      ['no switch on for any group', { settings: settings({ agentsFullAuto: true }) }],
      [
        'the switch is on for another group',
        { settings: settings({ autoGoLiveGroups: ['code_prs'], agentsFullAuto: true }) },
      ],
      ['no permission for the run’s version', { agent: { ...AGENT, goLive: null } }],
      ['Starter', { planKey: 'starter' }],
      ['the trial', { planKey: 'trial' }],
      [
        'Full auto off for agents',
        { settings: settings({ autoGoLiveGroups: ['publishing'], agentsFullAuto: false }) },
      ],
      [
        'Full auto for agents unknown',
        { settings: settings({ autoGoLiveGroups: ['publishing'] }) },
      ],
      ['the run is not in Full auto', { agent: { ...AGENT, fullAuto: false } }],
    ];
    for (const [why, over] of failing) {
      expect(goLiveCandidate(sendOwn, allowed(over)), why).toBe(false);
      expect(decided(PASSED, over), why).toEqual(CLICK);
    }
    // A row that can't go out on its own: a click, whatever the rest says.
    expect(goLiveCandidate(ROWS.publish, allowed())).toBe(false);
    expect(decideToolCall(ROWS.publish, allowed(), call({ goLive: PASSED }))).toEqual(CLICK);
  });

  it('holds the click with the first guard that fails, in their order', () => {
    const held = (facts: GoLiveFacts | undefined, over = {}) => {
      const decision = decided(facts, over);
      return decision.kind === 'click' ? decision.held : decision;
    };
    // Part A, the run.
    expect(held(PASSED, { injectionDetected: true })).toEqual({ code: 'injection' });
    expect(held(undefined, { injectionDetected: true })).toEqual({ code: 'injection' });
    expect(held({ ...PASSED, runUntrusted: true })).toEqual({ code: 'untrusted_scope' });
    // Part B, the page as it goes out, its text and links.
    expect(held({ ...PASSED, page: 'placeholders' })).toEqual({ code: 'placeholders' });
    expect(held({ ...PASSED, page: 'fields' })).toEqual({ code: 'fields' });
    for (const hold of ['instructions', 'hidden_text', 'copied'] as const) {
      expect(held({ ...PASSED, text: { hold } })).toEqual({ code: hold });
    }
    expect(held({ ...PASSED, text: { hold: 'foreign_link', host: 'rival.example' } })).toEqual({
      code: 'foreign_link',
      host: 'rival.example',
    });
    expect(held({ ...PASSED, liveItem: true })).toEqual({ code: 'live_page' });
    expect(held({ ...PASSED, takenDown: true })).toEqual({ code: 'taken_down' });
    // The quality gate, with what the card names.
    for (const hold of ['quality_off', 'placeholders', 'fields', 'suggestions'] as const) {
      expect(held({ ...PASSED, gate: { pass: false, hold } })).toEqual({ code: hold });
    }
    expect(held({ ...PASSED, gate: { pass: false, hold: 'facts_unchecked' } })).toEqual({
      code: 'facts_unchecked',
    });
    expect(
      held({ ...PASSED, gate: { pass: false, hold: 'facts', page: '$49', fact: '$59' } }),
    ).toEqual({ code: 'facts', page: '$49', fact: '$59' });
    expect(
      held({ ...PASSED, gate: { pass: false, hold: 'qualityLow', check: 'trust', score: 52 } }),
    ).toEqual({ code: 'qualityLow', check: 'trust', score: 52 });
    expect(held({ ...PASSED, gate: { pass: false, hold: 'quality', score: 71 } })).toEqual({
      code: 'quality',
      score: 71,
    });
    expect(
      held({
        ...PASSED,
        gate: { pass: false, hold: 'quality_unread', read: 'claims', why: 'run_cap' },
      }),
    ).toEqual({ code: 'quality_unread', why: 'run_cap' });
    // The daily limit, last: the agent's name, its limit and when the next slot frees.
    expect(held({ ...PASSED, usage: { used: 5, counted: false, nextAt: NEXT } })).toEqual({
      code: 'limit',
      agent: 'Publisher',
      limit: 5,
      nextAt: NEXT,
    });
    // A page and destination counted already keep their slot: no new one is needed.
    expect(decided({ ...PASSED, usage: { used: 5, counted: true, nextAt: NEXT } })).toEqual({
      kind: 'run',
      via: 'go_live',
    });
    expect(held({ ...PASSED, usage: { used: 4, counted: false, nextAt: NEXT } })).toEqual({
      kind: 'run',
      via: 'go_live',
    });

    // The earliest wins when several fail.
    const worst: GoLiveFacts = {
      runUntrusted: true,
      page: 'ready',
      text: { hold: 'instructions' },
      liveItem: true,
      takenDown: true,
      gate: { pass: false, hold: 'quality', score: 40 },
      usage: { used: 9, counted: false, nextAt: NEXT },
    };
    expect(held(worst)).toEqual({ code: 'untrusted_scope' });
    expect(held({ ...worst, runUntrusted: false })).toEqual({ code: 'instructions' });
    expect(held({ ...worst, runUntrusted: false, text: { hold: null } })).toEqual({
      code: 'live_page',
    });
    expect(held({ ...worst, runUntrusted: false, text: { hold: null }, liveItem: false })).toEqual({
      code: 'taken_down',
    });
    expect(
      held({
        ...worst,
        runUntrusted: false,
        text: { hold: null },
        liveItem: false,
        takenDown: false,
      }),
    ).toEqual({ code: 'quality', score: 40 });
  });

  it('holds on the closed side when a fact it needs is missing', () => {
    const unchecked = { kind: 'click', held: { code: 'unchecked' } };
    expect(decided(undefined)).toEqual(unchecked);
    expect(decided({ runUntrusted: false })).toEqual(unchecked);
    expect(decided({ ...PASSED, text: undefined })).toEqual(unchecked);
    expect(decided({ ...PASSED, liveItem: undefined })).toEqual(unchecked);
    expect(decided({ ...PASSED, takenDown: undefined })).toEqual(unchecked);
    expect(decided({ ...PASSED, gate: undefined })).toEqual(unchecked);
    expect(decided({ ...PASSED, usage: undefined })).toEqual(unchecked);
  });

  it('never takes a page down on its own, and a Manager takes it down with publishing off (PR 10)', () => {
    // Take down's own shape: an EXECUTE outside the go-live groups, with no goLive.
    const takeDown = row('takeDown', {
      class: 'execute',
      minRole: 'manager',
      executeGroup: null,
      inputSchema: z.object({ brand_id: z.guid() }),
      fixture: { input: { brand_id: BRAND_A } },
    });
    expect(goLiveCandidate(takeDown, allowed())).toBe(false);
    expect(decideToolCall(takeDown, allowed(), call({ goLive: PASSED }))).toEqual(CLICK);
    const off = settings({ managerExecuteOff: ['publishing'] });
    expect(decideToolCall(takeDown, ctx({ role: 'manager', settings: off }), call())).toEqual(
      CLICK,
    );
    expect(decideToolCall(takeDown, ctx({ role: 'analyst' }), call())).toMatchObject({
      kind: 'deny',
    });
  });

  it('decides every earlier step first: a denial or a deny-free click is never lifted', () => {
    // A Manager while publishing is off for Managers: refused, not held.
    const off = settings({
      autoGoLiveGroups: ['publishing'],
      agentsFullAuto: true,
      managerExecuteOff: ['publishing'],
    });
    expect(decided(PASSED, { role: 'manager', settings: off })).toEqual(
      deny({ code: 'execute_off', group: 'publishing' }),
    );
    // Read-only, the demo brand, an Admin's Never, an Analyst: refused before 4b.
    expect(decided(PASSED, { planKey: 'readOnly' })).toEqual(
      deny({ code: 'subscription_inactive' }),
    );
    expect(decideToolCall(sendOwn, allowed(), call({ brandIsDemo: true, goLive: PASSED }))).toEqual(
      deny({ code: 'demo_brand' }),
    );
    const never = settings({
      autoGoLiveGroups: ['publishing'],
      agentsFullAuto: true,
      toolPolicies: { sendOwn: 'never' },
    });
    expect(decided(PASSED, { settings: never })).toEqual(deny({ code: 'policy_never' }));
    expect(decided(PASSED, { role: 'analyst' })).toMatchObject({
      kind: 'deny',
      denial: { code: 'forbidden_role' },
    });
  });

  it('changes nothing else: Settings offers only Never, the list keeps the row, WRITE taint stands', () => {
    expect(policyChoices(sendOwn)).toEqual(['never']);
    expect(sendOwn.flags.goLiveOnOwn).toBe(true);
    expect(ROWS.publish.flags.goLiveOnOwn).toBe(false);
    const scope = { brandId: BRAND_A, brandIsDemo: false };
    expect(allowedTools([sendOwn], allowed(), scope)).toEqual([sendOwn]);
    expect(listingDenial(sendOwn, allowed(), scope)).toBeNull();
    // A WRITE in the same agent run: a card when untrusted content chose it, as before.
    expect(decideToolCall(ROWS.draft, allowed(), call({ tainted: true }))).toEqual(ask('tainted'));
    expect(decideToolCall(ROWS.draft, allowed(), call())).toEqual({
      kind: 'run',
      via: 'full_auto',
    });
  });
});
