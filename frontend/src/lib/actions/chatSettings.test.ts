import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrecedenceContext } from '@/lib/chat/precedence';

/** Settings › Chat (CHAT-20 §5, §8b): the policy an Admin sets, within each tool and the plan. */

const ME = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';

interface Call {
  table: string;
  op: string;
  row?: unknown;
  opts?: unknown;
  filters: unknown[][];
}
let calls: Call[] = [];
let writeError: { message: string } | null = null;
let ctx: PrecedenceContext | null = null;
let ctxThrows = false;
/** The workspace's go-live columns (00443), and the error reading them (before it). */
let goLiveRow: Record<string, unknown> | null = null;
let goLiveError: { code: string; message: string } | null = null;

function from(table: string) {
  const call: Call = { table, op: 'select', filters: [] };
  calls.push(call);
  const answer = () =>
    table === 'profiles'
      ? { data: { organization_id: ORG, full_name: 'Ada Admin' }, error: null }
      : table === 'organizations'
        ? { data: { name: 'Acme' }, error: null }
        : table === 'chat_settings' && call.op === 'select'
          ? { data: goLiveRow, error: goLiveError }
          : { data: null, error: call.op === 'select' ? null : writeError };
  const chain: Record<string, unknown> = {
    select: () => chain,
    upsert: (row: unknown, opts: unknown) =>
      Object.assign(call, { op: 'upsert', row, opts }) && chain,
    delete: () => Object.assign(call, { op: 'delete' }) && chain,
    eq: (...args: unknown[]) => {
      call.filters.push(['eq', ...args]);
      return chain;
    },
    maybeSingle: async () => answer(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (t: string) => from(t),
    auth: {
      admin: { getUserById: async () => ({ data: { user: { email: 'ada@acme.test' } } }) },
    },
  },
}));
vi.mock('@/lib/chat/precedenceContext', () => ({
  readPrecedenceContext: async () => {
    if (ctxThrows) throw new Error('db down');
    return ctx;
  },
}));

const {
  getChatSettingsView,
  removeAutoChoice,
  resetToolPolicies,
  setAutoGoLive,
  setChatSwitch,
  setManagerExecute,
  setToolPolicy,
} = await import('./chatSettings');
const { DEFAULT_CHAT_SETTINGS } = await import('@/lib/chat/precedence');
const { planFactsFromOrgRow } = await import('@/lib/chat/planFacts');

function context(
  plan: string,
  role: PrecedenceContext['role'] = 'admin',
  settings: Partial<PrecedenceContext['settings']> = {},
): PrecedenceContext {
  return {
    organizationId: ORG,
    role,
    plan: planFactsFromOrgRow({ plan, subscription_status: 'active' }),
    settings: { ...DEFAULT_CHAT_SETTINGS, ...settings },
    mode: 'ask_first',
    surface: 'chat',
    autoChoices: new Set(['saveDraft', 'goneTool']),
    brandAccess: 'all',
    injectionDetected: false,
  };
}
const upsert = () => calls.find((c) => c.op === 'upsert');

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  calls = [];
  writeError = null;
  ctxThrows = false;
  ctx = context('growth');
  goLiveRow = null;
  goLiveError = null;
});
afterEach(() => vi.unstubAllEnvs());

describe('getChatSettingsView', () => {
  it('lists every tool by its label key, with what an Admin may pick and the plan locks', async () => {
    ctx = context('starter', 'manager', { toolPolicies: { saveDraft: 'ask' } });
    const result = await getChatSettingsView();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { view } = result;
    expect(view).toMatchObject({ role: 'manager', fullAutoLocked: 'growth' });
    expect(JSON.stringify(view.rows)).not.toMatch(/create_draft|get_profile/);
    const draft = view.rows.find((r) => r.key === 'saveDraft')!;
    expect(draft).toMatchObject({ class: 'write', policy: 'ask', changed: true });
    expect(draft.choices).toEqual([
      { policy: 'never', locked: false },
      { policy: 'ask', locked: false },
      { policy: 'ask_full_auto', locked: true },
      { policy: 'always', locked: true },
    ]);
    // Ask your Admin is a card in every mode: never Always.
    expect(view.rows.find((r) => r.key === 'askAdmin')!.choices.map((c) => c.policy)).toEqual([
      'never',
      'ask',
    ]);
    // A tick on a tool the registry no longer has isn't listed.
    expect(view.autoChoices).toEqual(['saveDraft']);
  });

  it('says it failed, never throws, when the facts can’t be read', async () => {
    ctxThrows = true;
    expect(await getChatSettingsView()).toEqual({ ok: false, failure: 'failed' });
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await getChatSettingsView()).toEqual({ ok: false, failure: 'chat_off' });
  });
});

describe('setToolPolicy', () => {
  it("saves an Admin's choice, keeping the other settings, and who made it", async () => {
    ctx = context('growth', 'admin', {
      toolPolicies: { dismissSuggestion: 'never' },
      managerExecuteOff: ['feeds'],
    });
    expect(await setToolPolicy('saveDraft', 'always')).toEqual({ ok: true });
    expect(upsert()).toMatchObject({
      table: 'chat_settings',
      row: {
        organization_id: ORG,
        tool_policies: { dismissSuggestion: 'never', saveDraft: 'always' },
        full_auto_for_members: true,
        dont_ask_again: true,
        manager_execute_off: ['feeds'],
        updated_by: ME,
      },
      opts: { onConflict: 'organization_id' },
    });
  });

  it('gives a tool back its default', async () => {
    ctx = context('growth', 'admin', { toolPolicies: { saveDraft: 'never' } });
    await setToolPolicy('saveDraft', 'default');
    expect((upsert()!.row as { tool_policies: object }).tool_policies).toEqual({});
  });

  it("refuses what the row doesn't offer, an unknown tool, and what the plan locks", async () => {
    expect(await setToolPolicy('askAdmin', 'always')).toEqual({ ok: false, failure: 'invalid' });
    expect(await setToolPolicy('create_draft', 'never')).toEqual({ ok: false, failure: 'invalid' });
    ctx = context('starter');
    expect(await setToolPolicy('saveDraft', 'ask_full_auto')).toEqual({
      ok: false,
      failure: 'locked',
    });
    expect(upsert()).toBeUndefined();
  });

  it('is an Admin’s, on an active plan', async () => {
    ctx = context('growth', 'manager');
    expect(await setToolPolicy('saveDraft', 'never')).toEqual({ ok: false, failure: 'forbidden' });
    ctx = { ...context('growth'), plan: { ...context('growth').plan, writable: false } };
    expect(await resetToolPolicies()).toEqual({ ok: false, failure: 'read_only' });
    expect(upsert()).toBeUndefined();
  });

  it('says the save failed, never throws', async () => {
    writeError = { message: 'db down' };
    expect(await setToolPolicy('saveDraft', 'never')).toEqual({ ok: false, failure: 'failed' });
  });
});

describe('the switches and the ticks', () => {
  it('keeps Full auto and "Don\'t ask again" to Growth and up', async () => {
    ctx = context('starter');
    expect(await setChatSwitch('dontAskAgain', false)).toEqual({ ok: false, failure: 'locked' });
    ctx = context('growth');
    expect(await setChatSwitch('fullAutoForMembers', false)).toEqual({ ok: true });
    expect(upsert()!.row).toMatchObject({ full_auto_for_members: false });
  });

  it("switches a go-live group for Managers, in the groups' order", async () => {
    ctx = context('growth', 'admin', { managerExecuteOff: ['feeds'] });
    await setManagerExecute('publishing', false);
    expect(upsert()!.row).toMatchObject({ manager_execute_off: ['publishing', 'feeds'] });
    calls = [];
    await setManagerExecute('feeds', true);
    expect(upsert()!.row).toMatchObject({ manager_execute_off: [] });
    expect(await setManagerExecute('nope' as never, true)).toEqual({
      ok: false,
      failure: 'invalid',
    });
  });

  it("removes only the person's own tick, whatever their role", async () => {
    ctx = context('starter', 'analyst');
    expect(await removeAutoChoice('saveDraft')).toEqual({ ok: true });
    const removed = calls.find((c) => c.op === 'delete')!;
    expect(removed.table).toBe('chat_auto_choices');
    expect(removed.filters).toEqual([
      ['eq', 'user_id', ME],
      ['eq', 'organization_id', ORG],
      ['eq', 'tool_key', 'saveDraft'],
    ]);
    expect(await removeAutoChoice('Bad Key')).toEqual({ ok: false, failure: 'invalid' });
  });
});

describe('agents that publish on their own (AUTONOMOUS-GO-LIVE §7.1)', () => {
  const MISSING = {
    code: '42703',
    message: 'column chat_settings.auto_go_live_groups does not exist',
  };
  const goLive = async () => {
    const result = await getChatSettingsView();
    if (!result.ok) throw new Error(result.failure);
    return result.view.goLive;
  };

  beforeEach(() => {
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'true');
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
  });

  it('shows the switch, and who turned it on when, only with its flag on', async () => {
    expect(await goLive()).toEqual({
      on: false,
      since: null,
      byName: null,
      qualityOff: false,
      workspace: 'Acme',
    });
    goLiveRow = {
      auto_go_live_groups: ['publishing'],
      auto_go_live_at: '2026-11-01T09:00:00Z',
      auto_go_live_by: ME,
    };
    expect(await goLive()).toMatchObject({
      on: true,
      since: '2026-11-01T09:00:00Z',
      byName: 'Ada Admin',
    });

    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'false');
    expect(await goLive()).toBeNull();
  });

  it('hides it before 00443, and says when Content Quality is off', async () => {
    goLiveError = MISSING;
    expect(await goLive()).toBeNull();
    goLiveError = null;
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    expect(await goLive()).toMatchObject({ qualityOff: true });
  });

  it('turns it on for an Admin with the accepted terms, keeping who and when', async () => {
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: true });
    const row = upsert()!.row as Record<string, unknown>;
    expect(row).toMatchObject({
      organization_id: ORG,
      auto_go_live_groups: ['publishing'],
      auto_go_live_by: ME,
      auto_go_live_terms: 1,
      updated_by: ME,
    });
    expect(Date.parse(row.auto_go_live_at as string)).not.toBeNaN();
    // Nothing else of the settings is written.
    expect(row).not.toHaveProperty('tool_policies');
  });

  it('turns it off with no terms, keeping who turned it on last', async () => {
    expect(await setAutoGoLive(false, 0)).toEqual({ ok: true });
    expect(upsert()!.row).toEqual({
      organization_id: ORG,
      auto_go_live_groups: [],
      updated_by: ME,
    });
  });

  it('refuses everyone but an Admin, below Growth, with Quality off, or other terms', async () => {
    ctx = context('growth', 'manager');
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: false, failure: 'forbidden' });
    ctx = context('starter');
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: false, failure: 'locked' });
    ctx = context('growth');
    expect(await setAutoGoLive(true, 2)).toEqual({ ok: false, failure: 'invalid' });
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: false, failure: 'quality_off' });
    vi.stubEnv('CHAT_AUTO_GO_LIVE', 'false');
    expect(await setAutoGoLive(false, 0)).toEqual({ ok: false, failure: 'unavailable' });
    expect(upsert()).toBeUndefined();
  });

  it('says unavailable before 00443, and never throws', async () => {
    writeError = MISSING;
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: false, failure: 'unavailable' });
    writeError = { message: 'boom' } as typeof MISSING;
    expect(await setAutoGoLive(true, 1)).toEqual({ ok: false, failure: 'failed' });
  });
});
