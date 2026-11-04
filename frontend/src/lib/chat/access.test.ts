// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROLE_MATRIX,
  ROLE_ORDER,
  approvalMark,
  capabilityAreas,
  fullAutoBehaviour,
  planCardOf,
  rolesFor,
  yourAccessRows,
} from './access';
import { planFactsFromOrgRow } from './planFacts';
import { registryCatalog } from './registry/tools';

// The registry's rows import the MCP data functions, which import the admin client.
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

/** Roles & access, Your access, the plan card and "What Chat can do" (CHAT-20 §4a, §4b, §7a, §8). */

describe('ROLE_MATRIX', () => {
  it('gives every role a cell on every row, and Admins every change Chat may make', () => {
    for (const group of ROLE_MATRIX) {
      for (const row of group.rows) {
        expect(Object.keys(row.cells).sort()).toEqual([...ROLE_ORDER].sort());
        if (group.key !== 'never') expect(row.cells.admin).not.toBe('no');
      }
    }
  });

  it('keeps Analysts and Agency partners to reading, as the database does', () => {
    for (const group of ROLE_MATRIX.filter((g) => g.key === 'workspace' || g.key === 'admin')) {
      for (const row of group.rows) {
        expect(row.cells.analyst).toBe('no');
        expect(row.cells.agency_partner).toBe('no');
      }
    }
  });

  // Role model A as the app runs it (2026-11-03).
  it('lets everyone do the daily work, and keeps what spends the plan to Admins and Managers', () => {
    const row = (key: string) => ROLE_MATRIX.flatMap((g) => g.rows).find((r) => r.key === key);
    expect(ROLE_MATRIX.find((g) => g.key === 'everyone')?.rows.map((r) => r.key)).toContain(
      'dailyWork',
    );
    expect(Object.values(row('dailyWork')!.cells)).toEqual(['yes', 'yes', 'yes', 'yes']);
    for (const key of ['tracking', 'volumes', 'generate']) {
      expect(row(key)?.cells, key).toEqual({
        admin: 'yes',
        manager: 'yes',
        analyst: 'no',
        agency_partner: 'no',
      });
    }
  });
});

describe('yourAccessRows', () => {
  const value = (rows: ReturnType<typeof yourAccessRows>, key: string) =>
    rows.find((row) => row.key === key);

  it('lets an Admin change everything, going live after a click', () => {
    const rows = yourAccessRows('admin', ['publishing']);
    expect(value(rows, 'workspace')?.value).toBe('yes_card');
    expect(value(rows, 'execute')?.value).toBe('after_click');
    expect(value(rows, 'settings')?.value).toBe('yes');
  });

  it('names the go-live groups an Admin switched off for Managers, and all of them as off', () => {
    expect(value(yourAccessRows('manager', []), 'execute')?.value).toBe('after_click');
    expect(value(yourAccessRows('manager', ['publishing', 'feeds']), 'execute')).toEqual({
      key: 'execute',
      class: 'execute',
      value: 'after_click_except',
      off: ['publishing', 'feeds'],
    });
    expect(
      value(
        yourAccessRows('manager', ['publishing', 'email_outreach', 'code_prs', 'feeds']),
        'execute',
      )?.value,
    ).toBe('execute_off');
    expect(value(yourAccessRows('manager', []), 'settings')?.value).toBe('ask_admin');
  });

  it('sends Analysts and Agency partners to their Admin for any change', () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      const rows = yourAccessRows(role, []);
      expect(value(rows, 'read')?.value).toBe('yes');
      for (const key of ['workspace', 'agents', 'execute', 'settings']) {
        expect(value(rows, key)?.value).toBe('ask_admin');
      }
    }
  });
});

describe('planCardOf', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  const card = (plan: string, subscription_status = 'active', plan_overrides: unknown = null) =>
    planCardOf(planFactsFromOrgRow({ plan, subscription_status, plan_overrides }))!;
  const chip = (c: ReturnType<typeof card>, key: string) => c.chips.find((x) => x.key === key);

  it("shows Starter's locks against Growth, and what Growth adds for its price", () => {
    const starter = card('starter');
    expect(starter).toMatchObject({ planId: 'starter', planName: 'Starter', priceMonthly: 49 });
    expect(chip(starter, 'platforms')).toEqual({ key: 'platforms', count: 2, locked: null });
    expect(chip(starter, 'fullAuto')?.locked).toBe('growth');
    expect(chip(starter, 'mcp')).toEqual({ key: 'mcp', access: 'read', locked: 'growth' });
    expect(chip(starter, 'openPr')?.locked).toBe('growth');
    expect(chip(starter, 'ownKeys')?.locked).toBe('enterprise');
    expect(starter.next).toEqual({
      planId: 'growth',
      planName: 'Growth',
      priceMonthly: 249,
      priceDiff: 200,
      afterTrial: false,
      benefits: [
        { key: 'morePlatforms', count: 6 },
        { key: 'fullAuto' },
        { key: 'mcpWrite' },
        { key: 'aiLimit', times: 5 },
      ],
    });
  });

  it("offers Enterprise's Claude tracking and contract from Growth, at a contract price", () => {
    const growth = card('growth');
    expect(chip(growth, 'fullAuto')?.locked).toBeNull();
    expect(chip(growth, 'mcp')).toEqual({ key: 'mcp', access: 'read_write', locked: null });
    expect(chip(growth, 'claude')?.locked).toBe('enterprise');
    // Own AI keys are Enterprise's (owner decision 2026-10-30).
    expect(chip(growth, 'ownKeys')?.locked).toBe('enterprise');
    expect(growth.next).toMatchObject({
      planId: 'enterprise',
      priceDiff: null,
      benefits: [{ key: 'claude' }, { key: 'ownKeys' }, { key: 'contract' }],
    });
  });

  it('upsells nothing on Enterprise and shows no lock there', () => {
    const enterprise = card('enterprise');
    expect(enterprise.next).toBeNull();
    expect(enterprise.chips.every((c) => c.locked === null)).toBe(true);
    expect(chip(enterprise, 'ownKeys')).toEqual({ key: 'ownKeys', locked: null });
    expect(chip(enterprise, 'claude')).toBeUndefined();
    const withClaude = card('enterprise', 'active', { allowedModels: ['claude-sonnet-5'] });
    expect(chip(withClaude, 'claude')).toEqual({ key: 'claude', locked: null });
  });

  it('reads over MCP in the trial, and reads paying as the next step', () => {
    const trial = card('growth', 'trialing');
    expect(trial.isTrial).toBe(true);
    // MCP reads on every plan (DECISIONS S, 2026-10-30); writes wait for Growth, paid.
    expect(chip(trial, 'mcp')).toEqual({ key: 'mcp', access: 'read', locked: 'growth' });
    expect(chip(trial, 'fullAuto')?.locked).toBe('growth');
    expect(trial.next).toMatchObject({
      planId: 'growth',
      afterTrial: true,
      benefits: [
        { key: 'keepEverything' },
        { key: 'mcpWrite' },
        { key: 'monthlyLimit' },
        { key: 'packs' },
      ],
    });
    // Paying for Starter after its trial adds no MCP writes.
    expect(card('starter', 'trialing').next?.benefits).toEqual([
      { key: 'keepEverything' },
      { key: 'monthlyLimit' },
      { key: 'packs' },
    ]);
  });

  it('has no card off the cloud', () => {
    vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', '');
    expect(planCardOf(planFactsFromOrgRow(null))).toBeNull();
  });

  it('carries no AI budget in dollars, only plan prices', () => {
    expect(JSON.stringify(card('starter'))).not.toMatch(/Budget|Usd/);
  });
});

describe('the registry as "What Chat can do" shows it', () => {
  const catalog = registryCatalog();

  it('marks how each row is approved', () => {
    expect(
      approvalMark({
        class: 'read',
        defaultPolicy: 'on',
        flags: { alwaysCard: false, costCard: false, adminMayTurnOff: false, goLiveOnOwn: false },
      }),
    ).toBe('none');
    const flags = {
      alwaysCard: false,
      costCard: false,
      adminMayTurnOff: false,
      goLiveOnOwn: false,
    };
    expect(approvalMark({ class: 'write', defaultPolicy: 'ask', flags })).toBe('card');
    expect(approvalMark({ class: 'write', defaultPolicy: 'ask_full_auto', flags })).toBe('auto');
    expect(
      approvalMark({
        class: 'write',
        defaultPolicy: 'ask_full_auto',
        flags: { ...flags, alwaysCard: true },
      }),
    ).toBe('card');
    expect(approvalMark({ class: 'write', defaultPolicy: 'always', flags })).toBe('none');
    expect(approvalMark({ class: 'execute', defaultPolicy: 'click', flags })).toBe('click');
  });

  it('opens a row from its minimum role up, less its excluded roles', () => {
    expect(rolesFor({ minRole: 'analyst', excludeRoles: [] })).toEqual(ROLE_ORDER);
    expect(rolesFor({ minRole: 'analyst', excludeRoles: ['agency_partner'] })).toEqual([
      'admin',
      'manager',
      'analyst',
    ]);
    expect(rolesFor({ minRole: 'manager', excludeRoles: [] })).toEqual(['admin', 'manager']);
    expect(rolesFor({ minRole: 'admin', excludeRoles: [] })).toEqual(['admin']);
  });

  it("hands the browser no row's internals: no names, schema, code or brand lookup", () => {
    for (const entry of catalog) {
      expect(Object.keys(entry).sort()).toEqual(
        [
          'area',
          'class',
          'costClass',
          'defaultPolicy',
          'excludeRoles',
          'flags',
          'key',
          'maxPolicy',
          'minRole',
          'planGate',
          'route',
        ].sort(),
      );
    }
  });

  it("groups every row once by area, and says who may make an area's changes", () => {
    const areas = capabilityAreas(catalog);
    const rows = areas.flatMap((a) => [...a.read, ...a.write, ...a.execute]);
    expect(rows).toHaveLength(catalog.length);
    expect(new Set(areas.map((a) => a.area)).size).toBe(areas.length);
    for (const area of areas) {
      const changes = [...area.write, ...area.execute];
      if (changes.length === 0) expect(area.writers).toEqual([]);
      for (const entry of changes) {
        for (const role of area.writers) expect(rolesFor(entry)).toContain(role);
      }
    }
    const prompts = areas.find((a) => a.area === 'prompts')!;
    expect(prompts.write.map((e) => e.key)).toContain('dismissSuggestion');
    expect(prompts.writers).not.toContain('agency_partner');
  });
});

describe('fullAutoBehaviour', () => {
  const row = (cls: 'read' | 'write' | 'execute', policy: string, alwaysCard = false) => ({
    class: cls,
    policy: policy as never,
    flags: { alwaysCard },
  });

  it('says what each tool does in Full auto, by its class and policy', () => {
    expect(fullAutoBehaviour(row('read', 'on'), true)).toBe('runs');
    expect(fullAutoBehaviour(row('read', 'never'), true)).toBe('off');
    expect(fullAutoBehaviour(row('execute', 'click'), true)).toBe('click');
    expect(fullAutoBehaviour(row('write', 'ask'), true)).toBe('card');
    expect(fullAutoBehaviour(row('write', 'ask', true), true)).toBe('always_card');
    expect(fullAutoBehaviour(row('write', 'ask_full_auto'), true)).toBe('auto_full_auto');
    expect(fullAutoBehaviour(row('write', 'always'), true)).toBe('auto_always');
  });

  it('asks for every WRITE below Growth, where Full auto is closed', () => {
    expect(fullAutoBehaviour(row('write', 'always'), false)).toBe('card');
    expect(fullAutoBehaviour(row('write', 'ask_full_auto'), false)).toBe('card');
  });
});
