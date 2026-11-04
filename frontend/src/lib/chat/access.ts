import { PLANS, PLAN_ORDER, type PlanId, type PlanLimits } from '@/config/plans';
import type { TeamRole } from '@/components/context/RoleProvider';
import type { ExecuteGroup, ToolArea, ToolClass, ToolPolicy } from './registry/defineTool';
import type { ToolCatalogEntry } from './registry/tools';
import { planGateLock, type PlanFacts } from './planFacts';

/**
 * What each role may do, and what the workspace's plan includes, as Settings
 * › Team › Roles & access, Settings › Account › Your access and "What Chat
 * can do" show it (CHAT-20 §4a, §4b, §7a, §8). Pure: the server action
 * (lib/actions/chatAccess.ts) reads the facts, the pages draw them.
 *
 * Agency partners use every brand for now and act as Analysts (P0 decision
 * 7): sharing chosen brands with them is Team's, in Wave 2.
 */

export const ROLE_ORDER: readonly TeamRole[] = ['admin', 'manager', 'analyst', 'agency_partner'];

/** The class badge a row wears: CHAT-20 §3's classes, and NEVER for what isn't a Chat tool. */
export type AccessClass = ToolClass | 'never';

/**
 * A role's cell in "What each role can do": `yes`; `approves` / `request`
 * for workspace memory and shared skills (an Admin approves what a Manager
 * requests); `after_click` for EXECUTE; `no`; `not_tool` for what Chat
 * never does.
 */
export type RoleCell = 'yes' | 'approves' | 'request' | 'after_click' | 'no' | 'not_tool';

export interface RoleMatrixRow {
  /** `chatAccess.matrix.rows.{key}` names it and its scope. */
  key: string;
  class: AccessClass;
  cells: Record<TeamRole, RoleCell>;
}

export interface RoleMatrixGroup {
  /** `chatAccess.matrix.groups.{key}`. */
  key: 'everyone' | 'workspace' | 'admin' | 'never';
  rows: RoleMatrixRow[];
}

const every = (cell: RoleCell): Record<TeamRole, RoleCell> => ({
  admin: cell,
  manager: cell,
  analyst: cell,
  agency_partner: cell,
});
const adminsAndManagers: Record<TeamRole, RoleCell> = {
  admin: 'yes',
  manager: 'yes',
  analyst: 'no',
  agency_partner: 'no',
};
const adminsOnly: Record<TeamRole, RoleCell> = {
  admin: 'yes',
  manager: 'no',
  analyst: 'no',
  agency_partner: 'no',
};

/**
 * CHAT-20 §4's role matrix, as the Roles & access page groups it (mockup
 * #g-roles). The live Team roles; RLS lets Admins and Managers write and
 * the others read, and Chat follows the same split. Two things the app
 * does differently (role model A, 2026-11-03): daily work (the Action
 * Center, writing in the Content Editor, running a Site Audit) is every
 * member's, and running tracking, volume analyses and AI generation, which
 * spend the plan, is Admins' and Managers'.
 */
export const ROLE_MATRIX: readonly RoleMatrixGroup[] = [
  {
    key: 'everyone',
    rows: [
      { key: 'readApp', class: 'read', cells: every('yes') },
      { key: 'askChat', class: 'read', cells: every('yes') },
      { key: 'personal', class: 'write', cells: every('yes') },
      { key: 'dailyWork', class: 'write', cells: every('yes') },
    ],
  },
  {
    key: 'workspace',
    rows: [
      { key: 'actions', class: 'write', cells: adminsAndManagers },
      { key: 'tracking', class: 'write', cells: adminsAndManagers },
      { key: 'volumes', class: 'write', cells: adminsAndManagers },
      { key: 'generate', class: 'write', cells: adminsAndManagers },
      { key: 'drafts', class: 'write', cells: adminsAndManagers },
      { key: 'agents', class: 'write', cells: adminsAndManagers },
      {
        key: 'shared',
        class: 'write',
        cells: { admin: 'approves', manager: 'request', analyst: 'no', agency_partner: 'no' },
      },
      {
        key: 'execute',
        class: 'execute',
        cells: {
          admin: 'after_click',
          manager: 'after_click',
          analyst: 'no',
          agency_partner: 'no',
        },
      },
    ],
  },
  {
    key: 'admin',
    rows: [
      { key: 'billing', class: 'write', cells: adminsOnly },
      { key: 'team', class: 'write', cells: adminsOnly },
      { key: 'policy', class: 'write', cells: adminsOnly },
      { key: 'keys', class: 'write', cells: adminsOnly },
    ],
  },
  { key: 'never', rows: [{ key: 'never', class: 'never', cells: every('not_tool') }] },
];

/** Whether a role may change workspace data: Admins and Managers (RLS, CHAT-20 §4). */
export const canWrite = (role: TeamRole) => role === 'admin' || role === 'manager';

/**
 * A row of the Your access card (mockup #g-my-access): what the person may
 * do through Chat. `ask_admin` where their role can't (Ask your Admin, B2);
 * `after_click_except` when an Admin switched some EXECUTE groups off for
 * Managers.
 */
export interface YourAccessRow {
  /** `chatAccess.yourAccess.rows.{key}`. */
  key: 'read' | 'personal' | 'workspace' | 'agents' | 'execute' | 'settings';
  class: AccessClass;
  value: 'yes' | 'yes_card' | 'after_click' | 'after_click_except' | 'execute_off' | 'ask_admin';
  /** For `after_click_except`: the groups switched off. */
  off?: ExecuteGroup[];
}

/** The Your access rows for a role, with the Manager EXECUTE switches an Admin set. */
export function yourAccessRows(
  role: TeamRole,
  managerExecuteOff: readonly ExecuteGroup[],
): YourAccessRow[] {
  const writes = canWrite(role);
  const execute = (): YourAccessRow => {
    if (!writes) return { key: 'execute', class: 'execute', value: 'ask_admin' };
    if (role === 'admin' || managerExecuteOff.length === 0) {
      return { key: 'execute', class: 'execute', value: 'after_click' };
    }
    if (managerExecuteOff.length >= 4) {
      return { key: 'execute', class: 'execute', value: 'execute_off' };
    }
    return {
      key: 'execute',
      class: 'execute',
      value: 'after_click_except',
      off: [...managerExecuteOff],
    };
  };
  return [
    { key: 'read', class: 'read', value: 'yes' },
    { key: 'personal', class: 'write', value: 'yes' },
    { key: 'workspace', class: 'write', value: writes ? 'yes_card' : 'ask_admin' },
    { key: 'agents', class: 'write', value: writes ? 'yes' : 'ask_admin' },
    execute(),
    { key: 'settings', class: 'write', value: role === 'admin' ? 'yes' : 'ask_admin' },
  ];
}

/**
 * The plan card's features (CHAT-20 §7a item 2): included, or locked with
 * the plan that has it. `platforms` carries how many AI platforms are
 * tracked; `mcp` is `read` on Starter and in the free trial, `read_write`
 * from Growth, paid (DECISIONS S, 2026-10-30).
 */
export type PlanChip =
  | { key: 'platforms'; count: number; locked: null }
  | { key: 'fullAuto' | 'ownKeys' | 'openPr' | 'claude'; locked: PlanId | null }
  | { key: 'mcp'; access: 'read' | 'read_write'; locked: PlanId | null };

/** A line of "With {next plan} you'd also get" (§7a item 5), with its numbers. */
export type PlanBenefit =
  | { key: 'morePlatforms'; count: number }
  | { key: 'fullAuto' | 'mcpWrite' | 'claude' | 'ownKeys' | 'contract' }
  | { key: 'aiLimit'; times: number }
  | { key: 'keepEverything' | 'monthlyLimit' | 'packs' };

/**
 * The "Your plan" card (CHAT-20 §7a), without a dollar of AI budget: the
 * plan's price is shown, AI usage only as a percentage (DECISIONS R). Null
 * off the cloud, where there is no plan.
 */
export interface PlanCard {
  planId: PlanId;
  planName: string;
  /** Its monthly price; null when set per contract (Enterprise). */
  priceMonthly: number | null;
  isTrial: boolean;
  chips: PlanChip[];
  /** Null on Enterprise: no upsell. */
  next: {
    planId: PlanId;
    planName: string;
    priceMonthly: number | null;
    priceDiff: number | null;
    afterTrial: boolean;
    benefits: PlanBenefit[];
  } | null;
}

const rank = (id: PlanId) => PLAN_ORDER.indexOf(id);

/** Whether a plan's limits track Claude's answers: no model list, or one with models. */
const tracksClaude = (limits: PlanLimits) =>
  limits.allowedModels === undefined || limits.allowedModels.length > 0;

/** What the plan after `from` adds, in the card's benefit lines. */
function benefitsOf(from: PlanId, to: PlanId, afterTrial: boolean): PlanBenefit[] {
  if (afterTrial) {
    // MCP reads in the trial already: paying adds its writes, from Growth.
    const mcpWrite: PlanBenefit[] = rank(to) >= rank('growth') ? [{ key: 'mcpWrite' }] : [];
    return [{ key: 'keepEverything' }, ...mcpWrite, { key: 'monthlyLimit' }, { key: 'packs' }];
  }
  const own = PLANS[from].limits;
  const next = PLANS[to].limits;
  const out: PlanBenefit[] = [];
  if (next.maxPlatforms > own.maxPlatforms) {
    out.push({ key: 'morePlatforms', count: next.maxPlatforms - own.maxPlatforms });
  }
  if (rank(from) < rank('growth') && rank(to) >= rank('growth')) {
    out.push({ key: 'fullAuto' }, { key: 'mcpWrite' });
  }
  // Claude's answers are tracked on Enterprise, set per contract (plan_overrides).
  if (!tracksClaude(own) && (to === 'enterprise' || tracksClaude(next))) {
    out.push({ key: 'claude' });
  }
  if (to === 'enterprise') {
    out.push({ key: 'ownKeys' }, { key: 'contract' });
  } else if (
    own.improveMonthlyBudgetUsd > 0 &&
    next.improveMonthlyBudgetUsd > own.improveMonthlyBudgetUsd
  ) {
    out.push({
      key: 'aiLimit',
      times: Math.round(next.improveMonthlyBudgetUsd / own.improveMonthlyBudgetUsd),
    });
  }
  return out.slice(0, 4);
}

/** The plan card for the workspace's plan facts; null off the cloud. */
export function planCardOf(facts: PlanFacts): PlanCard | null {
  if (facts.selfHosted) return null;
  // The entitled limits: an Enterprise contract's overrides included.
  const limits = facts.limits;
  const growthLock = planGateLock(facts, { minPlan: 'growth' });
  // MCP reads on every plan; writes are Growth's, paid (the MCP server's own gate).
  const mcpAccess: 'read' | 'read_write' = growthLock ? 'read' : 'read_write';
  const all: PlanChip[] = [
    { key: 'platforms', count: limits.maxPlatforms, locked: null },
    { key: 'fullAuto', locked: facts.fullAuto ? null : 'growth' },
    // Own AI keys are Enterprise's only (CHAT-16 item 19, lib/chat/key.ts).
    { key: 'ownKeys', locked: facts.planId === 'enterprise' ? null : 'enterprise' },
    { key: 'mcp', access: mcpAccess, locked: growthLock },
    { key: 'openPr', locked: growthLock },
    { key: 'claude', locked: tracksClaude(limits) ? null : 'enterprise' },
  ];
  // Enterprise shows what it includes and no lock lines (§7a).
  const chips = facts.planId === 'enterprise' ? all.filter((chip) => !chip.locked) : all;
  const next = facts.nextPlan;
  return {
    planId: facts.planId,
    planName: facts.planName,
    priceMonthly: PLANS[facts.planId].pricing?.monthly ?? null,
    isTrial: facts.isTrial,
    chips,
    next: next
      ? {
          planId: next.id,
          planName: next.name,
          priceMonthly: next.priceMonthly,
          priceDiff: next.priceDiff,
          afterTrial: next.afterTrial,
          benefits: benefitsOf(facts.planId, next.id, next.afterTrial),
        }
      : null,
  };
}

/** How a WRITE or EXECUTE row is approved, as "What Chat can do" marks it. */
export type ApprovalMark = 'none' | 'card' | 'auto' | 'click';

export function approvalMark(
  entry: Pick<ToolCatalogEntry, 'class' | 'defaultPolicy' | 'flags'>,
): ApprovalMark {
  if (entry.class === 'read') return 'none';
  if (entry.class === 'execute') return 'click';
  const policy: ToolPolicy = entry.defaultPolicy;
  if (entry.flags.alwaysCard || policy === 'ask') return 'card';
  if (policy === 'always') return 'none';
  return 'auto';
}

/** The roles that may call a row: its minimum role and up, less its excluded roles. */
export function rolesFor(entry: Pick<ToolCatalogEntry, 'minRole' | 'excludeRoles'>): TeamRole[] {
  const lowest = ROLE_ORDER.indexOf(entry.minRole);
  // `analyst` opens a row to every role, Agency partners included (CHAT-20 §20).
  const allowed = entry.minRole === 'analyst' ? ROLE_ORDER : ROLE_ORDER.slice(0, lowest + 1);
  return allowed.filter((role) => !entry.excludeRoles.includes(role));
}

/** An area of "What Chat can do": its rows by class, in registry order. */
export interface CapabilityArea {
  area: ToolArea;
  read: ToolCatalogEntry[];
  write: ToolCatalogEntry[];
  execute: ToolCatalogEntry[];
  /** Who may make its changes: the roles every WRITE and EXECUTE row allows; empty when it has none. */
  writers: TeamRole[];
}

/** The catalog grouped by area, in the order the registry first names each. */
export function capabilityAreas(catalog: readonly ToolCatalogEntry[]): CapabilityArea[] {
  const areas = new Map<ToolArea, CapabilityArea>();
  for (const entry of catalog) {
    let area = areas.get(entry.area);
    if (!area) {
      area = { area: entry.area, read: [], write: [], execute: [], writers: [] };
      areas.set(entry.area, area);
    }
    area[entry.class].push(entry);
  }
  for (const area of areas.values()) {
    const changes = [...area.write, ...area.execute];
    area.writers = changes.length
      ? ROLE_ORDER.filter((role) => changes.every((entry) => rolesFor(entry).includes(role)))
      : [];
  }
  return [...areas.values()];
}

/**
 * What a tool does in Full auto, as Settings › Chat's last column says it
 * (mockup #g-policy): a read runs, an EXECUTE waits for the click, a WRITE
 * by its policy. Below Growth, Full auto isn't open: a WRITE always asks.
 */
export type FullAutoBehaviour =
  'off' | 'runs' | 'click' | 'card' | 'always_card' | 'auto_full_auto' | 'auto_always';

export function fullAutoBehaviour(
  row: {
    class: ToolClass;
    policy: ToolPolicy;
    flags: Pick<ToolCatalogEntry['flags'], 'alwaysCard'>;
  },
  fullAutoOpen: boolean,
): FullAutoBehaviour {
  if (row.policy === 'never') return 'off';
  if (row.class === 'read') return 'runs';
  if (row.class === 'execute') return 'click';
  if (row.flags.alwaysCard) return 'always_card';
  if (!fullAutoOpen || row.policy === 'ask') return 'card';
  return row.policy === 'always' ? 'auto_always' : 'auto_full_auto';
}
