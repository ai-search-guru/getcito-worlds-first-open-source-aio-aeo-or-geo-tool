import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_AGENT_SETTINGS,
  agentActDenial,
  agentPlanLimits,
  agentTriggersSchema,
  canSeeAgent,
  copyName,
  createAgentInput,
  enginesDenial,
  enginesNamed,
  firstVersion,
  lifecycleTarget,
  modeDenial,
  monthCapDenial,
  nextVersion,
  triggerTimeProblem,
  updateAgentInput,
  visibilityDenial,
  type AgentFacts,
  type AgentViewer,
} from './agentRules';
import { planFactsFromOrgRow } from './planFacts';

/**
 * Chat's agents without the database (CHAT-21; CHAT-27 §E): what a request
 * may hold, who sees and changes an agent, which state follows which, what
 * the plan allows, the budget shares and the names.
 */

const BRAND = '22222222-2222-4222-8222-222222222222';
const ME = 'aaaaaaaa-0000-4000-8000-000000000002';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000004';

const base = {
  name: 'Win back citations',
  skills: ['winback'],
  scope: { brand_ids: [BRAND] },
};

const viewer = (role: AgentViewer['role'], userId = ME): AgentViewer => ({
  userId,
  role,
  brandAccess: 'all',
});
const agent = (over: Partial<AgentFacts> = {}): AgentFacts => ({
  ownerId: ME,
  visibility: 'private',
  scope: { brand_ids: [BRAND] },
  ...over,
});

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true'));
afterEach(() => vi.unstubAllEnvs());

const plan = (planId: string, status = 'active', overrides: unknown = null) =>
  planFactsFromOrgRow({ plan: planId, subscription_status: status, plan_overrides: overrides });

describe('what a new agent may hold', () => {
  it('fills the defaults: private, Auto, Normal, 14 days, no triggers, no monthly cap', () => {
    const input = createAgentInput.parse(base);
    expect(input).toMatchObject({
      visibility: 'private',
      mode: 'auto',
      model: 'auto',
      effort: 'normal',
      followupDays: 14,
      triggers: [],
      connections: [],
      maxMonthShare: null,
      instructions: null,
    });
    expect(input.maxRunShare).toBeUndefined();
  });

  it('folds a name’s spaces and keeps it to 1–60 characters', () => {
    expect(createAgentInput.parse({ ...base, name: '  Win   back  ' }).name).toBe('Win back');
    expect(createAgentInput.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, name: 'x'.repeat(61) }).success).toBe(false);
  });

  it('takes 1–3 skills, none twice, and instructions up to 2,000 characters', () => {
    expect(createAgentInput.safeParse({ ...base, skills: [] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, skills: ['a', 'b', 'c', 'd'] }).success).toBe(
      false,
    );
    expect(createAgentInput.safeParse({ ...base, skills: ['faq', 'faq'] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, skills: ['Not A Slug'] }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, instructions: 'x'.repeat(2001) }).success).toBe(
      false,
    );
    expect(createAgentInput.parse({ ...base, instructions: '   ' }).instructions).toBeNull();
  });

  it('caps a run at 1–50% and a month at 1–100%, in whole percents, as shares', () => {
    expect(createAgentInput.parse({ ...base, maxRunShare: 0.07 }).maxRunShare).toBe(0.07);
    expect(createAgentInput.parse({ ...base, maxRunShare: 0.5 }).maxRunShare).toBe(0.5);
    for (const share of [0, 0.005, 0.51, 1, 0.125]) {
      expect(createAgentInput.safeParse({ ...base, maxRunShare: share }).success, `${share}`).toBe(
        false,
      );
    }
    expect(createAgentInput.parse({ ...base, maxMonthShare: 1 }).maxMonthShare).toBe(1);
    expect(createAgentInput.safeParse({ ...base, maxMonthShare: 1.01 }).success).toBe(false);
  });

  it('takes brands or all brands, never both or neither, and known engines only', () => {
    expect(createAgentInput.safeParse({ ...base, scope: { all_brands: true } }).success).toBe(true);
    expect(
      createAgentInput.safeParse({ ...base, scope: { all_brands: true, brand_ids: [BRAND] } })
        .success,
    ).toBe(false);
    expect(createAgentInput.safeParse({ ...base, scope: {} }).success).toBe(false);
    expect(createAgentInput.safeParse({ ...base, scope: { brand_ids: [] } }).success).toBe(false);
    expect(
      createAgentInput.safeParse({
        ...base,
        scope: { brand_ids: [BRAND], engines: ['chatgpt-web', 'claude-sonnet-5'] },
      }).success,
    ).toBe(true);
    expect(
      createAgentInput.safeParse({ ...base, scope: { brand_ids: [BRAND], engines: ['bard'] } })
        .success,
    ).toBe(false);
    expect(
      createAgentInput.safeParse({ ...base, scope: { brand_ids: [BRAND], urls: ['ftp://x.y'] } })
        .success,
    ).toBe(false);
  });

  it('takes a model preference, never a key, and connections each Required or Optional', () => {
    expect(
      createAgentInput.safeParse({ ...base, model: 'anthropic/claude-sonnet-5.5' }).success,
    ).toBe(true);
    expect(createAgentInput.safeParse({ ...base, model: 'sk-ant-api03-secret' }).success).toBe(
      false,
    );
    expect(
      createAgentInput.safeParse({
        ...base,
        connections: [
          { key: 'webflow', required: true },
          { key: 'webflow', required: false },
        ],
      }).success,
    ).toBe(false);
    expect(createAgentInput.safeParse({ ...base, apiKey: 'x' }).success).toBe(false);
  });
});

describe('triggers', () => {
  const schedule = {
    kind: 'schedule',
    config: { type: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', timezone: 'UTC' },
  };
  const signal = { kind: 'signal', config: { category: 'recover' } };
  const kpi = {
    kind: 'kpi',
    config: {
      kpi: 'ai_visibility',
      direction: 'down',
      threshold: 5,
      unit: 'percent',
      period: 'week',
    },
  };
  const watch = { kind: 'watch_rule', config: { watch_rule_id: BRAND } };

  it('takes up to 5, each of the four kinds, switched on unless said', () => {
    const parsed = agentTriggersSchema.parse([schedule, signal, kpi, watch]);
    expect(parsed.map((t) => [t.kind, t.enabled])).toEqual([
      ['schedule', true],
      ['signal', true],
      ['kpi', true],
      ['watch_rule', true],
    ]);
    const six = [0, 1, 2, 3, 4, 5].map((h) => ({
      kind: 'schedule',
      config: { type: 'recurring', rrule: `FREQ=DAILY;BYHOUR=${h}`, timezone: 'UTC' },
    }));
    expect(agentTriggersSchema.safeParse(six.slice(0, 5)).success).toBe(true);
    expect(agentTriggersSchema.safeParse(six).success).toBe(false);
    expect(agentTriggersSchema.safeParse([signal, signal]).success).toBe(false);
  });

  it('refuses a kind it doesn’t know and settings that don’t fit theirs', () => {
    for (const bad of [
      { kind: 'manual', config: {} },
      { kind: 'webhook', config: {} },
      { kind: 'signal', config: { category: 'growthy' } },
      { kind: 'signal', config: { category: 'fix', definition_ids: ['Bad Id'] } },
      { kind: 'kpi', config: { ...kpi.config, kpi: 'toString' } },
      { kind: 'kpi', config: { ...kpi.config, threshold: 0 } },
      { kind: 'kpi', config: { ...kpi.config, threshold: 5000 } },
      { kind: 'watch_rule', config: { watch_rule_id: 'nope' } },
      { kind: 'schedule', config: { type: 'recurring', rrule: 'FREQ=HOURLY', timezone: 'UTC' } },
    ]) {
      expect(agentTriggersSchema.safeParse([bad]).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('keeps a one-off schedule within the coming year', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const once = (at: string) =>
      agentTriggersSchema.parse([{ kind: 'schedule', config: { type: 'once', at } }])[0];
    expect(triggerTimeProblem(once('2026-11-02T09:00:00Z'), now)).toBeNull();
    expect(triggerTimeProblem(once('2026-10-29T11:00:00Z'), now)).toBe('schedule_past');
    expect(triggerTimeProblem(once('2028-01-01T00:00:00Z'), now)).toBe('schedule_too_far');
  });

  it('names the engines of the scope and of Signal filters', () => {
    const [withEngines] = agentTriggersSchema.parse([
      { kind: 'signal', config: { category: 'fix', entity_filter: { engines: ['grok-web'] } } },
    ]);
    expect(
      enginesNamed({ brand_ids: [BRAND], engines: ['chatgpt-web'] }, [withEngines]).sort(),
    ).toEqual(['chatgpt-web', 'grok-web']);
  });
});

describe('versions', () => {
  const current = firstVersion(createAgentInput.parse(base));

  it('makes a new version only when what the agent does changes', () => {
    expect(nextVersion(current, updateAgentInput.parse({ name: 'New name' }))).toBeNull();
    expect(
      nextVersion(current, updateAgentInput.parse({ skills: ['winback'], mode: 'auto' })),
    ).toBeNull();
    const next = nextVersion(current, updateAgentInput.parse({ mode: 'ask_first' }));
    expect(next).toEqual({ ...current, mode: 'ask_first' });
    // What it didn't name stays as it was.
    expect(next?.scope).toEqual(current.scope);
  });

  it('refuses an empty change', () => {
    expect(updateAgentInput.safeParse({}).success).toBe(false);
    expect(updateAgentInput.safeParse({ expectedVersion: 2 }).success).toBe(false);
  });
});

describe('names', () => {
  it('copies as “{name} copy”, then 2, 3, within 60 characters', () => {
    expect(copyName('Brief', new Set())).toBe('Brief copy');
    expect(copyName('Brief', new Set(['brief copy']))).toBe('Brief copy 2');
    expect(copyName('Brief', new Set(['brief copy', 'brief copy 2']))).toBe('Brief copy 3');
    const long = copyName('x'.repeat(60), new Set());
    expect(long).toHaveLength(60);
    expect(long.endsWith(' copy')).toBe(true);
  });
});

describe('states', () => {
  it('goes draft → active ⇄ paused → archived → deleted, and back to paused from archived', () => {
    expect(lifecycleTarget('activate', 'draft')).toBe('active');
    expect(lifecycleTarget('pause', 'active')).toBe('paused');
    expect(lifecycleTarget('resume', 'paused')).toBe('active');
    expect(lifecycleTarget('archive', 'paused')).toBe('archived');
    expect(lifecycleTarget('archive', 'draft')).toBe('archived');
    expect(lifecycleTarget('restore', 'archived')).toBe('paused');
    expect(lifecycleTarget('delete', 'archived')).toBeNull();
  });

  it('refuses what doesn’t follow', () => {
    expect(lifecycleTarget('activate', 'paused')).toBeUndefined();
    expect(lifecycleTarget('pause', 'draft')).toBeUndefined();
    expect(lifecycleTarget('resume', 'active')).toBeUndefined();
    expect(lifecycleTarget('delete', 'active')).toBeUndefined();
    expect(lifecycleTarget('restore', 'paused')).toBeUndefined();
    expect(lifecycleTarget('archive', 'archived')).toBeUndefined();
  });
});

describe('who sees and changes an agent', () => {
  const settings = DEFAULT_AGENT_SETTINGS;

  it('shows a private agent to its owner and the Admins, a workspace one to everyone', () => {
    expect(canSeeAgent(agent(), viewer('manager'))).toBe(true);
    expect(canSeeAgent(agent(), viewer('manager', OTHER))).toBe(false);
    expect(canSeeAgent(agent(), viewer('analyst', OTHER))).toBe(false);
    expect(canSeeAgent(agent(), viewer('admin', OTHER))).toBe(true);
    expect(canSeeAgent(agent({ visibility: 'workspace' }), viewer('analyst', OTHER))).toBe(true);
  });

  it('shows an Agency partner only agents on brands shared with them', () => {
    const partner = { ...viewer('agency_partner', OTHER), brandAccess: [BRAND] };
    expect(canSeeAgent(agent({ visibility: 'workspace' }), partner)).toBe(true);
    expect(
      canSeeAgent(agent({ visibility: 'workspace', scope: { all_brands: true } }), partner),
    ).toBe(false);
    expect(
      canSeeAgent(agent({ visibility: 'workspace', scope: { brand_ids: [BRAND, ME] } }), partner),
    ).toBe(false);
  });

  it('shows a Selected-brands person their own agent on All brands, which runs on theirs only', () => {
    const narrowed = { ...viewer('manager'), brandAccess: [BRAND] };
    const allBrands = { scope: { all_brands: true as const } };
    expect(canSeeAgent(agent(allBrands), narrowed)).toBe(true);
    // Someone else's on All brands covers brands they don't have: hidden, as before.
    expect(
      canSeeAgent(agent({ ...allBrands, ownerId: OTHER, visibility: 'workspace' }), narrowed),
    ).toBe(false);
    // Their own on a brand taken from them since: hidden until it comes back (§9 Q4).
    expect(canSeeAgent(agent({ scope: { brand_ids: [OTHER] } }), narrowed)).toBe(false);
    // With All brands, nothing changes.
    expect(
      canSeeAgent(
        agent({ ...allBrands, ownerId: OTHER, visibility: 'workspace' }),
        viewer('analyst'),
      ),
    ).toBe(true);
  });

  it('lets Analysts and Agency partners read only, with the roles who can', () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      for (const act of ['create', 'edit', 'run', 'pause', 'duplicate'] as const) {
        expect(agentActDenial(act, viewer(role), agent(), settings)).toEqual({
          denial: { code: 'forbidden_role', role, roles: ['admin', 'manager'] },
          asked: act,
        });
      }
    }
  });

  it('lets a Manager change their own agents and run any workspace agent; an Admin anything', () => {
    const manager = viewer('manager');
    expect(agentActDenial('edit', manager, agent(), settings)).toBeNull();
    expect(agentActDenial('edit', manager, agent({ ownerId: OTHER }), settings)).toEqual({
      denial: { code: 'forbidden_role', role: 'manager', roles: ['admin'] },
      asked: 'edit',
    });
    expect(
      agentActDenial('run', manager, agent({ ownerId: OTHER, visibility: 'workspace' }), settings),
    ).toBeNull();
    expect(
      agentActDenial(
        'pause',
        manager,
        agent({ ownerId: OTHER, visibility: 'workspace' }),
        settings,
      ),
    ).not.toBeNull();
    expect(
      agentActDenial('archive', viewer('admin', OTHER), agent({ ownerId: ME }), settings),
    ).toBeNull();
  });

  it('keeps Take over to Admins, whoever owns the agent', () => {
    expect(agentActDenial('takeOver', viewer('admin', OTHER), agent(), settings)).toBeNull();
    for (const role of ['manager', 'analyst', 'agency_partner'] as const) {
      expect(agentActDenial('takeOver', viewer(role), agent(), settings)).toEqual({
        denial: { code: 'forbidden_role', role, roles: ['admin'] },
        asked: 'takeOver',
      });
    }
  });

  it('keeps workspace agents to Admins when Settings › Chat says so', () => {
    const adminsOnly = { ...settings, workspaceAgentsAdminsOnly: true };
    const mine = agent({ visibility: 'workspace' });
    expect(agentActDenial('edit', viewer('manager'), mine, adminsOnly)).toEqual({
      denial: { code: 'policy_never' },
      asked: 'edit',
    });
    expect(agentActDenial('activate', viewer('manager'), mine, adminsOnly)).not.toBeNull();
    // Taking it down and running it stay theirs.
    expect(agentActDenial('pause', viewer('manager'), mine, adminsOnly)).toBeNull();
    expect(agentActDenial('run', viewer('manager'), mine, adminsOnly)).toBeNull();
    expect(visibilityDenial('workspace', viewer('manager'), adminsOnly)).toEqual({
      denial: { code: 'policy_never' },
      asked: 'workspace',
    });
    expect(visibilityDenial('workspace', viewer('admin'), adminsOnly)).toBeNull();
    expect(visibilityDenial('workspace', viewer('manager'), settings)).toBeNull();
  });

  it('keeps the monthly cap to Admins', () => {
    expect(monthCapDenial(viewer('admin'))).toBeNull();
    expect(monthCapDenial(viewer('manager'))?.denial).toEqual({
      code: 'forbidden_role',
      role: 'manager',
      roles: ['admin'],
    });
  });
});

describe('what the plan allows', () => {
  it('opens Full auto on Growth and up, paid, and where Settings › Chat allows it', () => {
    const settings = DEFAULT_AGENT_SETTINGS;
    expect(modeDenial('auto', plan('starter'), settings, 'manager')).toBeNull();
    expect(modeDenial('full_auto', plan('starter'), settings, 'admin')?.denial).toEqual({
      code: 'plan_locked',
      needs: 'growth',
    });
    expect(modeDenial('full_auto', plan('growth', 'trialing'), settings, 'admin')).not.toBeNull();
    expect(modeDenial('full_auto', plan('growth'), settings, 'manager')).toBeNull();
    expect(
      modeDenial('full_auto', plan('growth'), { ...settings, agentsFullAuto: false }, 'admin')
        ?.denial,
    ).toEqual({ code: 'policy_never' });
    expect(
      modeDenial(
        'full_auto',
        plan('growth'),
        { ...settings, fullAutoForMembers: false },
        'manager',
      ),
    ).not.toBeNull();
    expect(
      modeDenial('full_auto', plan('growth'), { ...settings, fullAutoForMembers: false }, 'admin'),
    ).toBeNull();
  });

  it('keeps engines to the plan’s: Starter’s two platforms, Claude on Enterprise', () => {
    expect(enginesDenial(plan('starter'), ['chatgpt-web', 'copilot-web'])).toBeNull();
    expect(enginesDenial(plan('starter'), ['perplexity-web'])?.denial).toEqual({
      code: 'plan_locked',
      needs: 'growth',
    });
    expect(enginesDenial(plan('growth'), ['perplexity-web'])).toBeNull();
    expect(enginesDenial(plan('growth'), ['claude-sonnet-5'])?.denial).toEqual({
      code: 'plan_locked',
      needs: 'enterprise',
    });
    expect(
      enginesDenial(plan('enterprise', 'active', { allowedModels: ['claude-sonnet-5'] }), [
        'claude-sonnet-5',
      ]),
    ).toBeNull();
  });

  it('keeps the agents on and runs at once per plan, the trial’s in the trial', () => {
    expect(agentPlanLimits(plan('starter', 'trialing'))).toEqual({
      activeAgents: 1,
      runsAtOnce: 1,
      eventRunsPerDay: 2,
    });
    expect(agentPlanLimits(plan('starter'))).toMatchObject({ activeAgents: 5, runsAtOnce: 2 });
    expect(agentPlanLimits(plan('growth'))).toMatchObject({ activeAgents: 25, runsAtOnce: 5 });
    expect(agentPlanLimits(plan('enterprise'))).toMatchObject({
      activeAgents: 100,
      runsAtOnce: 10,
      eventRunsPerDay: 12,
    });
    expect(
      agentPlanLimits(plan('enterprise', 'active', { maxActiveAgents: 250 })).activeAgents,
    ).toBe(250);
  });

  it('gives self-hosted no plan gates and no cap on agents', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'false');
    const selfHosted = plan('starter');
    expect(modeDenial('full_auto', selfHosted, DEFAULT_AGENT_SETTINGS, 'manager')).toBeNull();
    expect(enginesDenial(selfHosted, ['claude-sonnet-5'])).toBeNull();
    expect(agentPlanLimits(selfHosted).activeAgents).toBeNull();
  });
});
