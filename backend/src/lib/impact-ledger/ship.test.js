import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './__fixtures__/fakeDb.js';

// Action Center's own scope readers (basketScope, targetScope) read through
// the admin client: the test's in-memory database.
vi.mock('../../config/supabase.js', () => ({
  default: { from: (table) => globalThis.impactLedgerDb.from(table) },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { logger } = await import('../logger.js');
const { MAX_TARGET_PROMPTS } = await import('./method.js');
const { REPUBLISH_DAYS, closeTakenDown, resolveTargets, shipCmsPublish } =
  await import('./ship.js');

/**
 * A page the CMS confirmed live, into the impact ledger (CHAT-22 §2 item
 * 1): its ship event, once per send, and its Pending measurement.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const LIVE = 'https://acme.example/blog/cold-brew';
const PUBLISHED = '2026-10-20T12:00:00.000Z';

const prompt = (id, brand = 'b1') => ({
  id,
  text: `prompt ${id}`,
  topic_id: 'topic-1',
  prompt_sets: { brand_id: brand },
});

function world(overrides = {}) {
  return {
    content_draft_deliveries: [
      {
        id: 'x1',
        organization_id: ORG,
        brand_id: 'b1',
        draft_id: 'dr1',
        sent_by: 'u1',
        title: 'Cold brew guide',
        created_at: '2026-10-20T11:00:00.000Z',
      },
    ],
    content_drafts: [
      {
        id: 'dr1',
        brand_id: 'b1',
        title: 'Cold brew: the guide',
        action_id: null,
        prompt_ids: ['p1', 'p2'],
      },
    ],
    prompts: [prompt('p1'), prompt('p2'), prompt('p3')],
    actions: [],
    ship_events: [],
    impact_measurements: [],
    ...overrides,
  };
}

/** The ship event's id shipCmsPublish says, or null. */
const record = async (db, deliveryId = 'x1', publishedAt = PUBLISHED) =>
  (await shipCmsPublish({ deliveryId, url: LIVE, publishedAt, db })).id;

/** A second send of the same draft. */
const sentAgain = (id) => ({
  id,
  organization_id: ORG,
  brand_id: 'b1',
  draft_id: 'dr1',
  sent_by: 'u1',
  title: 'Cold brew guide',
});

/** The in-memory database, also the one the admin client reads. */
function useDb(tables) {
  const db = fakeDb(tables);
  globalThis.impactLedgerDb = db;
  return db;
}

beforeEach(() => {
  process.env.CHAT_AGENTIC = 'true';
  delete process.env.CHAT_AGENTIC_ORGS;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.CHAT_AGENTIC;
  delete process.env.CHAT_AGENTIC_ORGS;
});

describe('shipCmsPublish', () => {
  it('writes the publish as a shipped change, with its Pending measurement on the draft’s prompts', async () => {
    const db = useDb(world());
    const id = await record(db);
    expect(db.tables.ship_events).toEqual([
      expect.objectContaining({
        id,
        organization_id: ORG,
        brand_id: 'b1',
        kind: 'cms_publish',
        title: 'Cold brew: the guide',
        content_draft_id: 'dr1',
        url: LIVE,
        action_id: null,
        source: 'content_editor',
        change_type: 'content',
        shipped_at: PUBLISHED,
        shipped_by: 'u1',
        execution_mode: 'assisted',
        content_draft_delivery_id: 'x1',
      }),
    ]);
    expect(db.tables.impact_measurements).toEqual([
      expect.objectContaining({
        ship_event_id: id,
        next_check_at: '2026-10-28T00:00:00.000Z',
        targets: [
          { type: 'prompt', id: 'p1', label: 'prompt p1' },
          { type: 'prompt', id: 'p2', label: 'prompt p2' },
          { type: 'url', id: LIVE, label: LIVE },
        ],
      }),
    ]);
  });

  it('measures the action’s frozen targets over the draft’s, and an unsent page as automated', async () => {
    const tables = world();
    tables.content_drafts[0].action_id = 'a1';
    tables.content_draft_deliveries[0].sent_by = null;
    tables.actions = [{ id: 'a1', brand_id: 'b1', payload: { promptIds: ['p3'] } }];
    const db = useDb(tables);
    await record(db);
    expect(db.tables.ship_events[0]).toMatchObject({
      action_id: 'a1',
      execution_mode: 'automated',
      shipped_by: null,
    });
    expect(db.tables.impact_measurements[0].targets.map((t) => t.id)).toEqual(['p3', LIVE]);
  });

  it('writes one ship event per send, however often its publish is confirmed', async () => {
    const db = useDb(world());
    const first = await record(db);
    expect(await record(db)).toBe(first);
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(1);
  });

  it('writes one ship event per send when two confirmations race, by the send', async () => {
    const tables = world();
    // A send whose draft is gone: only the send tells them apart.
    tables.content_draft_deliveries[0].draft_id = null;
    tables.ship_events = [
      {
        id: 'first',
        brand_id: 'b1',
        kind: 'cms_publish',
        content_draft_delivery_id: 'x1',
        shipped_at: PUBLISHED,
      },
    ];
    const db = useDb(tables);
    expect(await record(db)).toBe('first');
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(0);
  });

  it('keeps a send noted on a ship event there once its draft is deleted', async () => {
    const tables = world();
    // The draft is gone: its sends' and its ship event's draft ids are null.
    tables.content_draft_deliveries[0].draft_id = null;
    tables.content_draft_deliveries.push({ ...sentAgain('x2'), draft_id: null });
    tables.ship_events = [
      {
        id: 'first',
        organization_id: ORG,
        brand_id: 'b1',
        kind: 'cms_publish',
        content_draft_id: null,
        content_draft_delivery_id: 'x1',
        shipped_at: PUBLISHED,
        republished_at: '2026-10-21T09:00:00.000Z',
        republished_delivery_ids: ['x2'],
      },
    ];
    const db = useDb(tables);
    expect(await record(db, 'x2', '2026-10-21T09:00:00.000Z')).toBe('first');
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(0);
  });

  it('keeps one ship event for a draft published again within 90 days, noting it', async () => {
    const tables = world();
    tables.content_draft_deliveries.push(sentAgain('x2'));
    const db = useDb(tables);
    const first = await record(db);
    const again = '2026-12-01T09:00:00.000Z';
    expect(await record(db, 'x2', again)).toBe(first);
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.ship_events[0]).toMatchObject({
      content_draft_delivery_id: 'x1',
      republished_at: again,
    });
    expect(db.tables.impact_measurements).toHaveLength(1);
  });

  it('moves the republish note only forward, never back to an older publish', async () => {
    const tables = world();
    tables.content_draft_deliveries.push(sentAgain('x2'), sentAgain('x3'));
    const db = useDb(tables);
    await record(db);
    await record(db, 'x3', '2026-12-01T09:00:00.000Z');
    // A send published in between, confirmed late: the note stays.
    await record(db, 'x2', '2026-11-10T09:00:00.000Z');
    expect(db.tables.ship_events[0].republished_at).toBe('2026-12-01T09:00:00.000Z');
    // One published before the ship event itself: no note either.
    const fresh = useDb(world());
    fresh.tables.content_draft_deliveries.push(sentAgain('x4'));
    await record(fresh);
    await record(fresh, 'x4', '2026-10-20T08:00:00.000Z');
    expect(fresh.tables.ship_events[0].republished_at ?? null).toBeNull();
  });

  it('names the agent, its run and the Chat run of a page an agent published on its own, as automated (00447)', async () => {
    const tables = world();
    tables.content_draft_deliveries[0].agent_run_id = 'ar1';
    tables.chat_agent_go_live_events = [
      {
        id: 'e1',
        agent_run_id: 'ar1',
        content_draft_id: 'dr1',
        run_id: 'cr1',
        agent_id: 'ag1',
        created_at: '2026-10-20T11:00:00.000Z',
      },
    ];
    tables.chat_agent_runs = [{ id: 'ar1', agent_id: 'ag1' }];
    const db = useDb(tables);
    await record(db);
    expect(db.tables.ship_events[0]).toMatchObject({
      shipped_by: 'u1',
      execution_mode: 'automated',
      run_id: 'cr1',
      agent_id: 'ag1',
      agent_run_id: 'ar1',
    });
    // A person's own send keeps none, assisted.
    const own = useDb(world());
    await record(own);
    expect(own.tables.ship_events[0]).toMatchObject({
      execution_mode: 'assisted',
      run_id: null,
      agent_id: null,
      agent_run_id: null,
    });
  });

  it('passes the republish window to ship_cms_publish, the one place it is set', async () => {
    const db = useDb(world());
    const calls = [];
    db.beforeShip = (args) => calls.push(args.p_republish_days);
    await record(db);
    expect(REPUBLISH_DAYS).toBe(90);
    expect(calls).toEqual([REPUBLISH_DAYS]);
  });

  it('writes a new ship event for a draft published again after 90 days', async () => {
    const tables = world();
    tables.content_draft_deliveries.push(sentAgain('x2'));
    const db = useDb(tables);
    await record(db);
    await record(db, 'x2', '2027-02-01T09:00:00.000Z');
    expect(db.tables.ship_events.map((e) => e.content_draft_delivery_id)).toEqual(['x1', 'x2']);
    expect(db.tables.impact_measurements).toHaveLength(2);
  });

  it('takes a publish into a cms_publish of its draft only, never a ship event of another kind', async () => {
    const tables = world();
    // A person marked the draft shipped from Chat the day before.
    tables.ship_events = [
      {
        id: 'marked',
        organization_id: ORG,
        brand_id: 'b1',
        kind: 'manual',
        source: 'chat',
        content_draft_id: 'dr1',
        content_draft_delivery_id: null,
        shipped_at: '2026-10-19T12:00:00.000Z',
        republished_at: null,
      },
    ];
    const db = useDb(tables);
    const id = await record(db);
    expect(id).not.toBe('marked');
    expect(db.tables.ship_events.map((e) => [e.kind, e.content_draft_delivery_id ?? null])).toEqual(
      [
        ['manual', null],
        ['cms_publish', 'x1'],
      ],
    );
    expect(db.tables.ship_events[0].republished_at).toBeNull();
    expect(db.tables.impact_measurements).toEqual([expect.objectContaining({ ship_event_id: id })]);
  });

  it('writes one ship event when two sends of one draft are confirmed at the same moment', async () => {
    const tables = world();
    tables.content_draft_deliveries.push(sentAgain('x2'));
    const db = useDb(tables);
    const again = '2026-10-21T09:00:00.000Z';
    const [first, second] = await Promise.all([record(db), record(db, 'x2', again)]);
    expect(second).toBe(first);
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.ship_events[0]).toMatchObject({
      content_draft_delivery_id: 'x1',
      republished_at: again,
      republished_delivery_ids: ['x2'],
    });
    expect(db.tables.impact_measurements).toHaveLength(1);
  });

  it('reads and writes nothing with CHAT_AGENTIC off', async () => {
    delete process.env.CHAT_AGENTIC;
    const db = useDb(world());
    expect(await record(db)).toBeNull();
    expect(db.calls).toEqual([]);
  });

  it('writes nothing for a workspace CHAT_AGENTIC_ORGS doesn’t list', async () => {
    process.env.CHAT_AGENTIC_ORGS = '22222222-2222-2222-2222-222222222222';
    const db = useDb(world());
    expect(await record(db)).toBeNull();
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('never throws: a failed write is logged by code and the page stays published', async () => {
    const db = useDb(world());
    db.fail = (table, op) => table === 'ship_events' && op === 'rpc';
    expect(await record(db)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      { err: { name: 'ImpactDbError', code: '57014' } },
      '[impact-ledger] cms publish not recorded',
    );
  });

  it('keeps the ship event when its measurement fails: the nightly job seeds it', async () => {
    const db = useDb(world());
    db.fail = (table, op) => table === 'impact_measurements' && op === 'upsert';
    expect(await record(db)).toEqual(expect.any(String));
    expect(db.tables.ship_events).toHaveLength(1);
    expect(db.tables.impact_measurements).toHaveLength(0);
  });
});

describe('closeTakenDown (AUTONOMOUS-GO-LIVE PR 10)', () => {
  const AT = '2026-11-02T12:00:00.000Z';
  const ship = (id, kind = 'cms_publish', draft = 'dr1') => ({
    id,
    organization_id: ORG,
    brand_id: 'b1',
    kind,
    content_draft_id: draft,
  });
  const measuring = (id, shipId, over = {}) => ({
    id,
    ship_event_id: shipId,
    outcome: 'pending',
    checkpoint: 'd7',
    checkpoints_json: [{ checkpoint: 'd7', outcome: 'pending' }],
    next_check_at: '2026-11-05T00:00:00.000Z',
    ...over,
  });

  it('closes the taken-down page’s measurements Not measurable, keeping what was measured', async () => {
    const db = useDb(
      world({
        ship_events: [ship('s1'), ship('s2', 'manual'), ship('s3', 'cms_publish', 'dr2')],
        impact_measurements: [
          measuring('m1', 's1'),
          measuring('m2', 's2'),
          measuring('m3', 's3'),
          measuring('m4', 's1', { outcome: 'improved', next_check_at: null }),
        ],
      }),
    );
    expect(await closeTakenDown({ draftId: 'dr1', at: AT, db })).toBe(1);
    const [m1, m2, m3, m4] = db.tables.impact_measurements;
    expect(m1).toMatchObject({
      outcome: 'not_measurable',
      confidence: null,
      not_measurable_reason: 'taken_down',
      checkpoint: 'd90',
      next_check_at: null,
      measured_at: AT,
    });
    expect(m1.checkpoints_json.map((e) => [e.checkpoint, e.outcome])).toEqual([
      ['d7', 'pending'],
      ['d90', 'not_measurable'],
    ]);
    // Another kind of ship, another page, and a measurement already done stay as they were.
    expect([m2.outcome, m3.outcome, m4.outcome]).toEqual(['pending', 'pending', 'improved']);
  });

  it('closes nothing for a page never shipped, and never throws', async () => {
    const db = useDb(world());
    expect(await closeTakenDown({ draftId: 'dr1', at: AT, db })).toBe(0);
    const broken = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: async () => ({ error: { code: 'x' } }) }) }),
      }),
    };
    expect(await closeTakenDown({ draftId: 'dr1', at: AT, db: broken })).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('resolveTargets', () => {
  it('takes only the brand’s own prompts, at most 50, and a topic’s prompts without named ones', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `q${String(i).padStart(2, '0')}`);
    const db = useDb({
      actions: [
        { id: 'a1', brand_id: 'b1', payload: { promptIds: [...many, 'theirs'] } },
        { id: 'a2', brand_id: 'b1', payload: { topicId: 'topic-9' } },
      ],
      prompts: [
        ...many.map((id) => prompt(id)),
        prompt('theirs', 'b2'),
        { ...prompt('in-topic'), topic_id: 'topic-9' },
      ],
    });
    const targets = await resolveTargets(db, [
      { id: 's1', brand_id: 'b1', action_id: 'a1' },
      { id: 's2', brand_id: 'b1', action_id: 'a2' },
    ]);
    expect(targets.get('s1')).toHaveLength(MAX_TARGET_PROMPTS);
    expect(targets.get('s1').map((t) => t.id)).not.toContain('theirs');
    expect(targets.get('s2')).toEqual([
      { type: 'prompt', id: 'in-topic', label: 'prompt in-topic' },
    ]);
  });
});

describe('labels and titles cut to length', () => {
  /** Whether a text holds a surrogate without its pair (Postgres takes none). */
  const loneSurrogate = (text) =>
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

  it('cuts by character, never through an emoji, in a target’s label and a ship event’s title', async () => {
    const long = `${'a'.repeat(199)}\u{1F600}tail`;
    const tables = world();
    tables.content_drafts[0].title = long;
    tables.prompts = [{ ...prompt('p1'), text: long }, prompt('p2')];
    const db = useDb(tables);
    await record(db);
    const [ship] = db.tables.ship_events;
    const label = db.tables.impact_measurements[0].targets[0].label;
    for (const text of [ship.title, label]) {
      expect(loneSurrogate(text)).toBe(false);
      expect(text).toBe(`${'a'.repeat(199)}\u{1F600}`);
    }
  });
});

describe('resolveTargets, older and night-engine actions', () => {
  const P1 = '00000000-0000-4000-8000-000000000001';
  const P2 = '00000000-0000-4000-8000-000000000002';

  it('reads an older action’s prompts from its opportunity’s clusters', async () => {
    const db = useDb({
      actions: [
        {
          id: 'a1',
          brand_id: 'b1',
          kind: 'content_opportunity',
          payload: { opportunityId: 'o1' },
        },
      ],
      content_opportunities: [
        { id: 'o1', cluster_id: 'k1', related_cluster_ids: [], prompt_id: null },
      ],
      prompt_cluster_members: [
        { cluster_id: 'k1', prompt_id: 'p1' },
        { cluster_id: 'k1', prompt_id: 'p2' },
      ],
      prompts: [prompt('p1'), prompt('p2')],
    });
    const targets = await resolveTargets(db, [{ id: 's1', brand_id: 'b1', action_id: 'a1' }]);
    expect(targets.get('s1').map((t) => t.id)).toEqual(['p1', 'p2']);
  });

  it('reads an older action’s opportunity, topic and a path page through the database it is given', async () => {
    const db = fakeDb({
      actions: [
        { id: 'a1', brand_id: 'b1', kind: 'content_opportunity', payload: { opportunityId: 'o1' } },
        { id: 'a2', brand_id: 'b1', kind: 'content_opportunity', payload: { topicId: 't9' } },
        {
          id: 'a3',
          brand_id: 'b1',
          kind: 'fix_page',
          payload: { targetEntity: 'pages', targetIds: ['/pricing'] },
        },
      ],
      content_opportunities: [
        { id: 'o1', cluster_id: 'k1', related_cluster_ids: [], prompt_id: null },
      ],
      prompt_cluster_members: [{ cluster_id: 'k1', prompt_id: 'p1' }],
      brand_domains: [{ brand_id: 'b1', domain: 'acme.example', is_primary: true }],
      prompts: [prompt('p1'), { ...prompt('p2'), topic_id: 't9' }],
    });
    // The admin client is another, empty database: nothing is read from it.
    const admin = useDb({});
    const targets = await resolveTargets(db, [
      { id: 's1', brand_id: 'b1', action_id: 'a1' },
      { id: 's2', brand_id: 'b1', action_id: 'a2' },
      { id: 's3', brand_id: 'b1', action_id: 'a3' },
    ]);
    expect(targets.get('s1').map((t) => t.id)).toEqual(['p1']);
    expect(targets.get('s2').map((t) => t.id)).toEqual(['p2']);
    expect(targets.get('s3').map((t) => t.id)).toEqual(['https://acme.example/pricing']);
    expect(admin.calls).toEqual([]);
  });

  it('reads a night-engine action’s targetEntity and targetIds', async () => {
    const db = useDb({
      actions: [
        {
          id: 'a1',
          brand_id: 'b1',
          kind: 'recover_visibility',
          payload: { targetEntity: 'prompts', targetIds: [P1, P2, 'not-an-id'] },
        },
        {
          id: 'a2',
          brand_id: 'b1',
          kind: 'fix_page',
          payload: { targetEntity: 'pages', targetIds: ['https://acme.example/pricing'] },
        },
      ],
      prompts: [prompt(P1), prompt(P2)],
    });
    const targets = await resolveTargets(db, [
      { id: 's1', brand_id: 'b1', action_id: 'a1' },
      { id: 's2', brand_id: 'b1', action_id: 'a2' },
    ]);
    expect(targets.get('s1').map((t) => t.id)).toEqual([P1, P2]);
    expect(targets.get('s2')).toEqual([
      { type: 'url', id: 'https://acme.example/pricing', label: 'https://acme.example/pricing' },
    ]);
  });
});
