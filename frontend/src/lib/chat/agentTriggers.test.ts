// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fakeSupabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from './testing/chatFixtures';

/**
 * An agent's triggers (CHAT-21 §E; W2-16), with an in-memory database: a
 * schedule fires at its slot in its own time zone (summer time included),
 * once, never catching up; a signal fires the triggers it matches; the noise
 * rules join, cool down and cap the fires; nothing fires with Chat off or
 * in a read-only workspace. No model is called.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fakeSupabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
const fakes = vi.hoisted(() => ({
  shares: vi.fn(),
  keyCap: vi.fn(async (): Promise<{ reached: boolean; renewsAt: string | null } | null> => null),
}));
vi.mock('./agentShares', () => ({ readAgentShares: fakes.shares }));
vi.mock('./ownKeyCap', () => ({ ownKeyCapReached: fakes.keyCap }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const triggers = await import('./agentTriggers');

const AGENT = 'abababab-0000-4000-8000-000000000001';
const BRAND_2 = '33333333-3333-4333-8333-333333333333';
const TRIGGER = 'dddddddd-0000-4000-8000-000000000001';
const SIGNAL_TRIGGER = 'dddddddd-0000-4000-8000-000000000002';
const sig = (n: number) => `cdcdcdcd-0000-4000-8000-${String(n).padStart(12, '0')}`;

const WEEKLY_ISTANBUL = {
  type: 'recurring',
  rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
  timezone: 'Europe/Istanbul',
};

const runs = () => db.tables.chat_agent_runs;
const queuedRuns = () => runs().filter((r) => r.status === 'queued');
const skipped = (reason: string) =>
  runs().filter((r) => r.status === 'skipped' && r.skipped_reason === reason);

let driver: ReturnType<typeof vi.fn>;

/** Makes the database refuse a run's insert for the rows `fails` picks, as a write that fails. */
function failRunInserts(fails: (row: Record<string, unknown>) => boolean): () => void {
  const realFrom = db.from;
  db.from = (table: string) => {
    const builder = realFrom(table);
    if (table !== 'chat_agent_runs') return builder;
    const insert = builder.insert;
    builder.insert = (rows) => {
      if (!Array.isArray(rows) && fails(rows)) throw new Error('insert failed');
      return insert(rows);
    };
    return builder;
  };
  return () => {
    db.from = realFrom;
  };
}

function startNext(args: Record<string, unknown>) {
  if (runs().filter((r) => r.status === 'running').length >= (args.p_workspace_limit as number)) {
    return null;
  }
  const next = runs().find((r) => r.status === 'queued');
  if (!next) return null;
  next.status = 'running';
  return next.id;
}

function seedAgent(over: Record<string, unknown> = {}, scope: Record<string, unknown> = {}) {
  db.tables.chat_agents = [
    {
      id: AGENT,
      organization_id: ORG,
      name: 'Citation win-back',
      status: 'active',
      paused_reason: null,
      owner_id: PEOPLE.manager,
      version: 1,
      fail_count: 0,
      max_run_share: 0.1,
      max_month_share: null,
      activated_at: '2026-10-01T00:00:00.000Z',
      ...over,
    },
  ];
  db.tables.chat_agent_versions = [
    {
      agent_id: AGENT,
      version: 1,
      skill_ids: ['winback'],
      instructions: null,
      mode: 'auto',
      connections: [],
      model: 'auto',
      effort: 'normal',
      scope: { brand_ids: [BRAND], ...scope },
      notify_user_ids: [],
      followup_days: 14,
    },
  ];
}

function seedTrigger(
  kind: 'schedule' | 'signal',
  config: unknown,
  over: Record<string, unknown> = {},
) {
  db.tables.chat_agent_triggers.push({
    id: kind === 'schedule' ? TRIGGER : SIGNAL_TRIGGER,
    agent_id: AGENT,
    kind,
    config_json: config,
    enabled: true,
    last_fired_at: null,
    cooldown_until: null,
    created_at: '2026-10-01T00:00:00.000Z',
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.keyCap.mockReset().mockResolvedValue(null);
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  seedWorkspace(db);
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A', is_demo: false },
    { id: BRAND_2, organization_id: ORG, name: 'Brand B', is_demo: false },
  ];
  db.tables.chat_agent_triggers = [];
  db.tables.chat_agent_runs = [];
  db.defaults = { ...db.defaults, chat_agent_runs: () => ({ skipped_reason: null }) };
  db.rpcs = { chat_start_next_agent_run: startNext };
  fakes.shares.mockResolvedValue(null);
  driver = vi.fn(async () => {});
  seedAgent();
});

afterEach(() => vi.unstubAllEnvs());

describe('when a schedule is due', () => {
  const times = { lastFiredAt: null, createdAt: '2026-10-01T00:00:00.000Z', activatedAt: null };

  it('fires at the slot in its own time zone, not before', () => {
    // Monday 09:00 in Istanbul (UTC+3) is 06:00 UTC.
    expect(triggers.dueSlot(WEEKLY_ISTANBUL, times, new Date('2026-11-02T05:59:00Z'))).toBeNull();
    expect(triggers.dueSlot(WEEKLY_ISTANBUL, times, new Date('2026-11-02T06:00:20Z'))).toBe(
      '2026-11-02T06:00:00.000Z',
    );
  });

  it('keeps the local hour across a summer-time change', () => {
    const daily = {
      type: 'recurring',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      timezone: 'America/New_York',
    };
    // New York leaves summer time on Sunday 1 November 2026: 09:00 is 13:00 UTC before, 14:00 after.
    const fired = { ...times, lastFiredAt: '2026-10-31T13:00:05.000Z' };
    expect(triggers.dueSlot(daily, fired, new Date('2026-11-01T13:30:00Z'))).toBeNull();
    expect(triggers.dueSlot(daily, fired, new Date('2026-11-01T14:00:10Z'))).toBe(
      '2026-11-01T14:00:00.000Z',
    );
    // Berlin left it a week earlier: Monday 09:00 is 07:00 UTC, then 08:00.
    const berlin = { ...WEEKLY_ISTANBUL, timezone: 'Europe/Berlin' };
    expect(triggers.dueSlot(berlin, times, new Date('2026-10-19T07:00:30Z'))).toBe(
      '2026-10-19T07:00:00.000Z',
    );
    expect(
      triggers.dueSlot(
        berlin,
        { ...times, lastFiredAt: '2026-10-19T07:00:30Z' },
        new Date('2026-10-26T07:30:00Z'),
      ),
    ).toBeNull();
    expect(
      triggers.dueSlot(
        berlin,
        { ...times, lastFiredAt: '2026-10-19T07:00:30Z' },
        new Date('2026-10-26T08:00:30Z'),
      ),
    ).toBe('2026-10-26T08:00:00.000Z');
  });

  it('fires a slot once, and never catches up on old ones or ones from before a Resume', () => {
    const after = { ...times, lastFiredAt: '2026-11-02T06:00:20.000Z' };
    expect(triggers.dueSlot(WEEKLY_ISTANBUL, after, new Date('2026-11-02T06:01:00Z'))).toBeNull();
    // The cron was down for 3 hours: that slot is passed over.
    expect(triggers.dueSlot(WEEKLY_ISTANBUL, times, new Date('2026-11-02T09:00:00Z'))).toBeNull();
    // Resumed after the slot: the schedule goes on from then.
    const resumed = { ...times, activatedAt: '2026-11-02T06:10:00.000Z' };
    expect(triggers.dueSlot(WEEKLY_ISTANBUL, resumed, new Date('2026-11-02T06:20:00Z'))).toBeNull();
  });

  it('fires a one-time schedule at its time, once', () => {
    const once = { type: 'once', at: '2026-11-03T10:00:00+03:00' };
    expect(triggers.dueSlot(once, times, new Date('2026-11-03T06:59:00Z'))).toBeNull();
    expect(triggers.dueSlot(once, times, new Date('2026-11-03T07:00:05Z'))).toBe(
      '2026-11-03T07:00:00.000Z',
    );
    const fired = { ...times, lastFiredAt: '2026-11-03T07:00:05.000Z' };
    expect(triggers.dueSlot(once, fired, new Date('2026-11-03T07:01:00Z'))).toBeNull();
  });
});

describe('firing schedules', () => {
  const AT = new Date('2026-11-02T06:00:20Z');

  it('queues a run per brand of its scope, as its owner, and starts what the workspace has room for', async () => {
    seedAgent({}, { brand_ids: [BRAND, BRAND_2] });
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    const counts = await triggers.fireDueSchedules(AT, driver);
    expect(counts).toEqual({ fired: 1, queued: 2, coalesced: 0, skipped: 0, failed: 0 });
    expect(runs()).toEqual([
      expect.objectContaining({
        agent_id: AGENT,
        brand_id: BRAND,
        trigger_kind: 'schedule',
        trigger_id: TRIGGER,
        trigger_ref: 'schedule:2026-11-02T06:00:00.000Z',
        acting_user_id: PEOPLE.manager,
        max_share: 0.1,
        evidence_json: {
          fires: [
            {
              kind: 'schedule',
              ref: 'schedule:2026-11-02T06:00:00.000Z',
              at: AT.toISOString(),
              timezone: 'Europe/Istanbul',
            },
          ],
          earlier: [],
        },
      }),
      expect.objectContaining({ brand_id: BRAND_2 }),
    ]);
    expect(db.tables.chat_agent_triggers[0].last_fired_at).toBe(AT.toISOString());
    // Growth runs 5 at once: both start, each handed to the driver.
    expect(runs().map((r) => r.status)).toEqual(['running', 'running']);
    expect(driver).toHaveBeenCalledTimes(2);

    // The next minute: claimed already, nothing more.
    expect(await triggers.fireDueSchedules(new Date('2026-11-02T06:01:00Z'), driver)).toEqual({
      fired: 0,
      queued: 0,
      coalesced: 0,
      skipped: 0,
      failed: 0,
    });
    expect(runs()).toHaveLength(2);
  });

  it('queues on the brands its owner may use: All brands is all of theirs (BRAND-ACCESS)', async () => {
    seedAgent({}, { brand_ids: undefined, all_brands: true });
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'selected';
    db.tables.member_brands = [{ user_id: PEOPLE.manager, organization_id: ORG, brand_id: BRAND }];
    const counts = await triggers.fireDueSchedules(AT, driver);
    expect(counts).toMatchObject({ fired: 1, queued: 1 });
    expect(runs().map((r) => r.brand_id)).toEqual([BRAND]);
    expect(db.tables.chat_agents[0].status).toBe('active');
  });

  it('pauses an agent whose owner may use none of its brands, as for brands gone', async () => {
    seedAgent({}, { brand_ids: [BRAND, BRAND_2] });
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'selected';
    db.tables.member_brands = [];
    const counts = await triggers.fireDueSchedules(AT, driver);
    expect(counts).toMatchObject({ queued: 0 });
    expect(runs()).toEqual([]);
    expect(db.tables.chat_agents[0]).toMatchObject({
      status: 'paused',
      paused_reason: 'brand_gone',
    });
  });

  it('fires a slot once when two crons find it due together', async () => {
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    const [a, b] = await Promise.all([
      triggers.fireDueSchedules(AT, driver),
      triggers.fireDueSchedules(AT, driver),
    ]);
    expect(a.fired + b.fired).toBe(1);
    expect(runs()).toHaveLength(1);
  });

  it('reads past PostgREST’s 1000 rows: every trigger, and the agent’s current version among many', async () => {
    db.maxRows = 1000;
    try {
      // 1,100 versions: the current one, 1,100, would be past a plain read's first 1,000.
      seedAgent({ version: 1100 });
      const v1 = db.tables.chat_agent_versions[0];
      db.tables.chat_agent_versions = Array.from({ length: 1100 }, (_, i) => ({
        ...v1,
        version: i + 1,
        scope: i === 1099 ? { brand_ids: [BRAND] } : { brand_ids: [] },
      }));
      // 1,099 triggers of agents that aren't there, read first; the due one last, by id.
      for (let i = 0; i < 1099; i++) {
        const n = String(i).padStart(12, '0');
        seedTrigger('schedule', WEEKLY_ISTANBUL, {
          id: `dddddddd-1000-4000-8000-${n}`,
          agent_id: `abababab-1000-4000-8000-${n}`,
        });
      }
      seedTrigger('schedule', WEEKLY_ISTANBUL, { id: 'dddddddd-ffff-4000-8000-000000000001' });

      const counts = await triggers.fireDueSchedules(AT, driver);
      expect(counts).toMatchObject({ fired: 1, queued: 1, failed: 0 });
      expect(runs()).toEqual([
        expect.objectContaining({ agent_id: AGENT, agent_version: 1100, brand_id: BRAND }),
      ]);
    } finally {
      db.maxRows = undefined;
    }
  });

  it('queues the other brands when one brand fails, and counts it', async () => {
    seedAgent({}, { brand_ids: [BRAND, BRAND_2] });
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    const restore = failRunInserts((row) => row.brand_id === BRAND);
    try {
      const counts = await triggers.fireDueSchedules(AT, driver);
      expect(counts).toEqual({ fired: 1, queued: 1, coalesced: 0, skipped: 0, failed: 1 });
      expect(runs().map((r) => r.brand_id)).toEqual([BRAND_2]);
      // Claimed: the next minute doesn't fire it again.
      expect(db.tables.chat_agent_triggers[0].last_fired_at).toBe(AT.toISOString());
    } finally {
      restore();
    }
  });

  it('fires nothing with Chat off, in a read-only workspace, for a paused agent or a disabled trigger', async () => {
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect((await triggers.fireDueSchedules(AT, driver)).fired).toBe(0);
    vi.stubEnv('CHAT_AGENTIC', 'true');

    db.tables.organizations[0].subscription_status = 'canceled';
    expect((await triggers.fireDueSchedules(AT, driver)).fired).toBe(0);
    db.tables.organizations[0].subscription_status = 'active';

    db.tables.chat_agents[0].status = 'paused';
    expect((await triggers.fireDueSchedules(AT, driver)).fired).toBe(0);
    db.tables.chat_agents[0].status = 'active';

    db.tables.chat_agent_triggers[0].enabled = false;
    expect((await triggers.fireDueSchedules(AT, driver)).fired).toBe(0);
    expect(runs()).toEqual([]);
    expect(db.tables.chat_agent_triggers[0].last_fired_at).toBeNull();
    expect(driver).not.toHaveBeenCalled();
  });

  it('pauses an agent whose monthly cap is used instead of queuing', async () => {
    seedAgent({ max_month_share: 0.2 });
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    fakes.shares.mockResolvedValue({
      unlimited: false,
      byAgent: new Map([[AGENT, { share: 0.15, ownKeyShare: 0.05, runs: 3 }]]),
    });
    await triggers.fireDueSchedules(AT, driver);
    expect(runs()).toEqual([]);
    expect(db.tables.chat_agents[0]).toMatchObject({ status: 'paused', paused_reason: 'cap' });
  });

  it('pauses an agent once all agents used the month’s limit on the own key, queuing nothing', async () => {
    seedAgent();
    seedTrigger('schedule', WEEKLY_ISTANBUL);
    fakes.keyCap.mockResolvedValue({ reached: true, renewsAt: '2026-11-20T09:00:00.000Z' });
    await triggers.fireDueSchedules(AT, driver);
    expect(runs()).toEqual([]);
    expect(db.tables.chat_agents[0]).toMatchObject({
      status: 'paused',
      paused_reason: 'own_key_cap',
    });
    expect(fakes.keyCap).toHaveBeenCalledWith(ORG);
  });
});

describe('signals', () => {
  const signal = (n: number, over: Partial<import('./agentTriggers').FiredSignal> = {}) => ({
    id: sig(n),
    kind: 'lost_citation',
    definitions: [{ id: 'recover_lost_citations', category: 'recover' }],
    urls: ['/pricing'],
    engines: ['chatgpt'],
    ...over,
  });

  describe('matching a trigger', () => {
    const match = (config: Record<string, unknown>, s = signal(1)) =>
      triggers.signalMatches(config as never, s);

    it('matches a definition of its category, and of its definitions when it names some', () => {
      expect(match({ category: 'recover' })).toBe(true);
      expect(match({ category: 'growth' })).toBe(false);
      expect(match({ category: 'recover', definition_ids: ['recover_lost_citations'] })).toBe(true);
      expect(match({ category: 'recover', definition_ids: ['recover_visibility'] })).toBe(false);
    });

    it('matches a page by its address or its path, and an engine', () => {
      const filter = (entity_filter: Record<string, unknown>) =>
        match({ category: 'recover', entity_filter });
      expect(filter({ urls: ['https://www.example.com/pricing/'] })).toBe(true);
      expect(filter({ urls: ['https://example.com/blog'] })).toBe(false);
      expect(
        triggers.signalMatches(
          { category: 'recover', entity_filter: { urls: ['https://example.com/pricing'] } },
          signal(1, { urls: ['http://example.com/pricing?utm=x'] }),
        ),
      ).toBe(true);
      expect(filter({ engines: ['chatgpt'] })).toBe(true);
      expect(filter({ engines: ['perplexity'] })).toBe(false);
      // A signal that names no page doesn't pass a page filter.
      expect(
        triggers.signalMatches(
          { category: 'recover', entity_filter: { urls: ['https://example.com/pricing'] } },
          signal(1, { urls: [] }),
        ),
      ).toBe(false);
    });

    it('matches nothing on prompt tags, which prompts don’t keep yet', () => {
      expect(match({ category: 'recover', entity_filter: { prompt_tags: ['pricing'] } })).toBe(
        false,
      );
    });
  });

  const T0 = new Date('2026-11-02T10:00:00Z');
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  const fire = (n: number, when: Date, brandId = BRAND) =>
    triggers.fireSignals({ brandId, signals: [signal(n)] }, when, driver);

  beforeEach(() => {
    seedTrigger('signal', { category: 'recover' });
  });

  it('queues a run with the signal as its evidence, as the owner, and starts its cooldown', async () => {
    const counts = await triggers.fireSignals(
      { brandId: BRAND, signals: [signal(1), signal(2, { definitions: [] })] },
      T0,
      null,
    );
    expect(counts).toEqual({ fired: 1, queued: 1, coalesced: 0, skipped: 0, failed: 0 });
    expect(queuedRuns()).toEqual([
      expect.objectContaining({
        trigger_kind: 'signal',
        trigger_ref: sig(1),
        acting_user_id: PEOPLE.manager,
        evidence_json: {
          fires: [
            {
              kind: 'signal',
              ref: sig(1),
              at: T0.toISOString(),
              signalKind: 'lost_citation',
              definitions: ['recover_lost_citations'],
            },
          ],
          earlier: [],
        },
      }),
    ]);
    expect(db.tables.chat_agent_triggers[0]).toMatchObject({
      last_fired_at: T0.toISOString(),
      cooldown_until: new Date(T0.getTime() + triggers.COOLDOWN_MS).toISOString(),
    });
  });

  it('fires nothing on a brand its owner may no longer use, and pauses with none left (BRAND-ACCESS)', async () => {
    seedAgent({}, { brand_ids: [BRAND, BRAND_2] });
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.brand_scope = 'selected';
    // Brand B is still theirs: a signal on Brand A fires nothing, and the agent stays on.
    db.tables.member_brands = [
      { user_id: PEOPLE.manager, organization_id: ORG, brand_id: BRAND_2 },
    ];
    expect((await fire(1, T0)).fired).toBe(0);
    expect(db.tables.chat_agents[0].status).toBe('active');
    // None of them left: it pauses.
    db.tables.member_brands = [];
    expect((await fire(2, T0)).fired).toBe(0);
    expect(runs()).toEqual([]);
    expect(db.tables.chat_agents[0]).toMatchObject({
      status: 'paused',
      paused_reason: 'brand_gone',
    });
  });

  it('fires nothing for a brand outside its scope, the demo brand, or with Chat off', async () => {
    expect((await fire(1, T0, BRAND_2)).fired).toBe(0);
    db.tables.brands[0].is_demo = true;
    expect((await fire(1, T0)).fired).toBe(0);
    db.tables.brands[0].is_demo = false;
    vi.stubEnv('CHAT_AGENTIC_ORGS', 'ffffffff-0000-4000-8000-000000000000');
    expect((await fire(1, T0)).fired).toBe(0);
    expect(runs()).toEqual([]);
  });

  it('joins fires within 15 minutes into one run: three signals, one run with all three', async () => {
    // No driver: the run waits queued, so the next fires join it.
    await triggers.fireSignals({ brandId: BRAND, signals: [signal(1)] }, T0, null);
    await triggers.fireSignals({ brandId: BRAND, signals: [signal(2)] }, at(5), null);
    await triggers.fireSignals({ brandId: BRAND, signals: [signal(3)] }, at(12), null);
    expect(queuedRuns()).toHaveLength(1);
    const evidence = queuedRuns()[0].evidence_json as { fires: { ref: string }[] };
    expect(evidence.fires.map((f) => f.ref)).toEqual([sig(1), sig(2), sig(3)]);
    expect(skipped('coalesced')).toHaveLength(2);
  });

  it('keeps a fire after the run started as joined, then cools down for 6 hours and lists those fires in the next run', async () => {
    await fire(1, T0);
    expect(runs()[0].status).toBe('running');
    // Started 5 minutes ago: this fire is part of its burst.
    expect(await fire(2, at(5))).toMatchObject({ coalesced: 1 });
    // An hour later, inside the cooldown: kept for the next run.
    expect(await fire(3, at(60))).toMatchObject({ skipped: 1 });
    expect(skipped('cooldown')).toHaveLength(1);
    // The first run ended; past the cooldown the next run lists the fire it kept.
    runs()[0].status = 'done';
    expect(await fire(4, at(6 * 60 + 1))).toMatchObject({ queued: 1 });
    const next = runs().find((r) => r.trigger_ref === sig(4))!;
    const evidence = next.evidence_json as { earlier: { ref: string; skipped: string }[] };
    expect(evidence.earlier).toEqual([
      expect.objectContaining({ ref: sig(3), skipped: 'cooldown' }),
    ]);
  });

  it('stops at the plan’s event runs a day (a trial’s 2), per agent, and counts schedules out', async () => {
    db.tables.organizations[0].subscription_status = 'trialing';
    seedAgent({}, { brand_ids: [BRAND, BRAND_2] });
    // A schedule run today doesn't count toward the event runs.
    runs().push({
      id: 'sched',
      agent_id: AGENT,
      brand_id: BRAND_2,
      trigger_kind: 'schedule',
      status: 'done',
      skipped_reason: null,
      queued_at: at(-120).toISOString(),
      evidence_json: {},
    });
    await fire(1, T0, BRAND);
    runs().find((r) => r.trigger_ref === sig(1))!.status = 'done';
    await fire(2, at(1), BRAND_2);
    runs().find((r) => r.trigger_ref === sig(2))!.status = 'done';
    // A third brand-free moment, past both cooldowns, still the same day: the limit.
    expect(await fire(3, at(7 * 60), BRAND)).toMatchObject({ skipped: 1 });
    expect(skipped('daily_limit')).toHaveLength(1);
    // The next UTC day it runs again.
    expect(await fire(4, new Date('2026-11-03T00:30:00Z'), BRAND)).toMatchObject({ queued: 1 });
  });

  it('fires the other triggers when one fails, and counts it', async () => {
    const OTHER = 'abababab-0000-4000-8000-000000000002';
    db.tables.chat_agents.push({ ...db.tables.chat_agents[0], id: OTHER, name: 'Other' });
    db.tables.chat_agent_versions.push({ ...db.tables.chat_agent_versions[0], agent_id: OTHER });
    seedTrigger(
      'signal',
      { category: 'recover' },
      {
        id: 'dddddddd-0000-4000-8000-000000000003',
        agent_id: OTHER,
      },
    );
    const restore = failRunInserts((row) => row.agent_id === AGENT);
    try {
      const counts = await triggers.fireSignals({ brandId: BRAND, signals: [signal(1)] }, T0, null);
      expect(counts).toEqual({ fired: 2, queued: 1, coalesced: 0, skipped: 0, failed: 1 });
      expect(queuedRuns().map((r) => r.agent_id)).toEqual([OTHER]);
    } finally {
      restore();
    }
  });

  it('counts the day’s event runs past 1000 rows read', async () => {
    db.maxRows = 1000;
    try {
      db.tables.organizations[0].subscription_status = 'trialing';
      // 1,200 runs kept today on other brands, read first; two of them ran.
      for (let i = 0; i < 1200; i++) {
        runs().push({
          id: `old${i}`,
          agent_id: AGENT,
          brand_id: BRAND_2,
          trigger_kind: 'signal',
          status: i >= 1198 ? 'done' : 'skipped',
          skipped_reason: i >= 1198 ? null : 'cooldown',
          queued_at: new Date(T0.getTime() - (1200 - i) * 1000).toISOString(),
          evidence_json: {},
        });
      }
      // The trial's 2 a day are used: the fire is kept as skipped, not run.
      expect(await fire(1, T0)).toMatchObject({ skipped: 1 });
      expect(skipped('daily_limit')).toHaveLength(1);
    } finally {
      db.maxRows = undefined;
    }
  });

  it('never has more than 3 runs waiting on a brand: a fourth joins the last', async () => {
    for (const [i, when] of [T0, at(20), at(40)].entries()) {
      runs().push({
        id: `wait${i}`,
        agent_id: AGENT,
        brand_id: BRAND,
        trigger_kind: 'manual',
        status: 'queued',
        skipped_reason: null,
        queued_at: when.toISOString(),
        evidence_json: {},
      });
    }
    expect(
      await triggers.fireSignals({ brandId: BRAND, signals: [signal(9)] }, at(60), null),
    ).toMatchObject({ coalesced: 1, queued: 0 });
    const last = runs().find((r) => r.id === 'wait2')!;
    expect((last.evidence_json as { fires: { ref: string }[] }).fires[0].ref).toBe(sig(9));
  });
});

describe('a run’s evidence', () => {
  it('reads what it can and leaves the rest out', () => {
    expect(triggers.evidenceOf(null)).toEqual({ fires: [], earlier: [] });
    expect(
      triggers.evidenceOf({
        fires: [{ kind: 'signal', ref: 'x', at: 'y' }],
        earlier: 'nope',
        extra: 1,
      }),
    ).toEqual({ fires: [{ kind: 'signal', ref: 'x', at: 'y' }], earlier: [] });
  });
});
