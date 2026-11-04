// @vitest-environment node
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import type { TeamRole } from '@/components/context/RoleProvider';
import { buildDenial, type ChatDenial } from './denial';
import { planFactsFromOrgRow, type OrgPlanRow, type PlanFacts } from './planFacts';
import { TEAM_ROLES, type ToolDenial } from './precedence';
import { defineTool, type ChatTool, type ToolDefinition } from './registry/defineTool';

/**
 * The out-of-permission answer (CHAT-20 §4c): four parts built on the
 * server, the words from en.json, nothing outside the person's scope.
 */

const base = {
  area: 'content' as const,
  description: 'fixture',
  planGate: null,
  brandOf: null,
  costClass: 'C1' as const,
  route: null,
  mcpTool: null,
  specRow: '0',
  inputSchema: z.object({}),
  run: async () => null,
  fixture: { input: {} },
};
type Def = ToolDefinition<z.ZodObject>;
// Label keys from en.json, so "what was asked" reads as the app names the tool.
const dismiss = defineTool({
  ...base,
  name: 'dismiss_prompt_suggestion',
  labelKey: 'dismissSuggestion',
  class: 'write',
  minRole: 'manager',
  defaultPolicy: 'ask_full_auto',
  maxPolicy: 'always',
} as Def);
const draft = defineTool({
  ...base,
  name: 'create_draft',
  labelKey: 'saveDraft',
  class: 'write',
  minRole: 'analyst',
  defaultPolicy: 'ask_full_auto',
  maxPolicy: 'always',
} as Def);
const memory = defineTool({
  ...base,
  name: 'workspace_memory',
  labelKey: 'saveDraft',
  class: 'write',
  minRole: 'admin',
  defaultPolicy: 'ask',
  maxPolicy: 'ask',
  flags: { alwaysCard: true },
} as Def);

function factsFor(row: OrgPlanRow): PlanFacts {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  try {
    return planFactsFromOrgRow(row);
  } finally {
    vi.unstubAllEnvs();
  }
}
const STARTER = factsFor({ plan: 'starter', subscription_status: 'active' });
const GROWTH = factsFor({ plan: 'growth', subscription_status: 'active' });
const TRIAL = factsFor({ plan: 'growth', subscription_status: 'trialing' });
const ENDED = factsFor({ plan: 'growth', subscription_status: 'canceled' });

const build = (
  denial: ToolDenial,
  role: TeamRole,
  opts: { tool?: ChatTool; plan?: PlanFacts; target?: string } = {},
): ChatDenial =>
  buildDenial(denial, {
    tool: opts.tool ?? dismiss,
    role,
    plan: opts.plan ?? GROWTH,
    target: opts.target,
  });

const ALL_DENIALS: ToolDenial[] = [
  { code: 'no_access' },
  { code: 'brand_scope' },
  { code: 'subscription_inactive' },
  { code: 'demo_brand' },
  { code: 'policy_never' },
  { code: 'plan_locked', needs: 'growth' },
  { code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] },
  { code: 'execute_off', group: 'publishing' },
];

describe('buildDenial', () => {
  it("answers an Analyst's change with all four parts (§21: forbidden_role)", () => {
    expect(
      build({ code: 'forbidden_role', role: 'analyst', roles: ['admin', 'manager'] }, 'analyst', {
        target: 'Pricing prompts',
      }),
    ).toEqual({
      code: 'forbidden_role',
      status: 403,
      asked: 'You asked: Dismiss prompt suggestions · Pricing prompts.',
      rule: {
        kind: 'role',
        detail: "Your role is Analyst, and Analysts can't do this.",
        source: 'Settings › Team › Roles & access',
      },
      whoCanRoles: ['admin', 'manager'],
      whoCan: 'Admins and Managers can do this.',
      nextActions: ['ask_admin', 'see_access'],
    });
    const partner = build(
      { code: 'forbidden_role', role: 'agency_partner', roles: ['admin', 'manager'] },
      'agency_partner',
    );
    expect(partner.rule.detail).toBe(
      "Your role is Agency Partner, and Agency Partners can't do this.",
    );
    expect(partner.asked).toBe('You asked: Dismiss prompt suggestions.');
  });

  it('names the roles a row allows, when it leaves one out', () => {
    const denial = build(
      { code: 'forbidden_role', role: 'agency_partner', roles: ['admin', 'manager', 'analyst'] },
      'agency_partner',
    );
    expect(denial.whoCanRoles).toEqual(['admin', 'manager', 'analyst']);
    expect(denial.whoCan).toBe('Admins, Managers, and Analysts can do this.');
  });

  it('names Admins alone for an Admin-only change', () => {
    const denial = build({ code: 'forbidden_role', role: 'manager', roles: ['admin'] }, 'manager', {
      tool: memory,
    });
    expect(denial.whoCanRoles).toEqual(['admin']);
    expect(denial.whoCan).toBe('Admins can do this.');
    expect(denial.rule.detail).toBe("Your role is Manager, and Managers can't do this.");
  });

  it('words a plan gate against the current plan, with the step up (§7a)', () => {
    const member = build({ code: 'plan_locked', needs: 'growth' }, 'manager', { plan: STARTER });
    expect(member).toMatchObject({
      code: 'plan_locked',
      status: 403,
      rule: {
        kind: 'plan',
        detail: "This needs the Growth plan. You're on Starter.",
        source: 'Settings › Billing',
      },
      whoCanRoles: ['admin'],
      whoCan: 'Admins can do this.',
      nextActions: ['ask_admin', 'compare_plans'],
      plan: {
        needs: 'growth',
        current: 'starter',
        isTrial: false,
        nextPlan: { id: 'growth', name: 'Growth', priceMonthly: 249, priceDiff: 200 },
      },
    });
    const admin = build({ code: 'plan_locked', needs: 'growth' }, 'admin', { plan: STARTER });
    expect(admin.nextActions).toEqual(['upgrade', 'compare_plans']);

    const trial = build({ code: 'plan_locked', needs: 'growth' }, 'admin', { plan: TRIAL });
    expect(trial.rule.detail).toBe("This isn't in the trial. It needs the Growth plan.");
    expect(trial.nextActions).toEqual(['choose_plan', 'compare_plans']);
    expect(trial.plan?.nextPlan).toMatchObject({ id: 'growth', afterTrial: true });
  });

  it('names the policy and says Admins can change it', () => {
    const member = build({ code: 'policy_never' }, 'manager', { tool: draft });
    expect(member.rule).toEqual({
      kind: 'policy',
      detail: 'An Admin turned “Save drafts in Content” off for Chat.',
      source: 'Settings › Chat',
    });
    expect(member.whoCan).toBe('Admins can do this.');
    expect(member.nextActions).toEqual(['ask_admin', 'see_access']);
    expect(build({ code: 'policy_never' }, 'admin').nextActions).toEqual(['open_policy']);

    expect(build({ code: 'execute_off', group: 'publishing' }, 'manager').rule.detail).toBe(
      'An Admin turned publishing off for Managers.',
    );
    expect(build({ code: 'execute_off', group: 'feeds' }, 'manager').rule.detail).toBe(
      'An Admin turned feed pushes off for Managers.',
    );
  });

  it('answers a read-only workspace and the demo brand with 402', () => {
    const ended = build({ code: 'subscription_inactive' }, 'analyst', { plan: ENDED });
    expect(ended).toMatchObject({
      status: 402,
      rule: { kind: 'workspace', source: 'Settings › Billing' },
      whoCanRoles: ['admin'],
      whoCan: 'Admins can choose a plan.',
      nextActions: ['ask_admin'],
    });
    expect(build({ code: 'subscription_inactive' }, 'admin').nextActions).toEqual(['choose_plan']);

    expect(build({ code: 'demo_brand' }, 'admin', { target: 'Brewline Coffee' })).toMatchObject({
      status: 402,
      asked: 'You asked: Dismiss prompt suggestions · Brewline Coffee.',
      rule: { kind: 'demo', source: null },
      whoCanRoles: [],
      nextActions: [],
    });
  });

  it('answers a person who is not a member now, without a role or a plan', () => {
    const denial = buildDenial({ code: 'no_access' }, { tool: dismiss, role: null, plan: null });
    expect(denial).toEqual({
      code: 'no_access',
      status: 403,
      asked: 'You asked: Dismiss prompt suggestions.',
      rule: {
        kind: 'workspace',
        detail: "You're not a member of this workspace now, so I can't act in it.",
        source: null,
      },
      whoCanRoles: ['admin'],
      whoCan: 'Its Admins can add you to it.',
      nextActions: [],
    });
  });

  it("names nothing of a brand outside the person's scope", () => {
    const denial = build({ code: 'brand_scope' }, 'agency_partner', {
      target: 'Northwind CRM · Pricing FAQ',
    });
    expect(denial).toEqual({
      code: 'brand_scope',
      status: 403,
      asked: 'You asked: Dismiss prompt suggestions.',
      rule: { kind: 'brand', detail: 'I can only see the brands shared with you.', source: null },
      whoCanRoles: ['admin'],
      whoCan: 'Admins can share more brands with you.',
      nextActions: ['ask_admin', 'see_access'],
    });
    expect(JSON.stringify(denial)).not.toMatch(/Northwind|Pricing FAQ/);
  });

  it('builds every denial for every role in plain words, offering Admins no "Ask your Admin"', () => {
    for (const denial of ALL_DENIALS) {
      for (const role of TEAM_ROLES) {
        const built = build(denial, role, { plan: STARTER });
        for (const text of [built.asked, built.rule.detail, built.whoCan]) {
          expect(text.trim()).not.toBe('');
          // A key en.json lacks comes back as its path; a value left out keeps its braces.
          expect(text).not.toMatch(/chatDenial\.|chatTools\.|[{}]/);
        }
        if (role === 'admin') expect(built.nextActions).not.toContain('ask_admin');
        expect(built.whoCanRoles.every((r) => TEAM_ROLES.includes(r))).toBe(true);
      }
    }
  });
});
