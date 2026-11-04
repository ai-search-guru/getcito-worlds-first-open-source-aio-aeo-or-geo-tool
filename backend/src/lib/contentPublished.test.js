import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page marked Published at its live address (CE-013), by a person or a
 * CMS: the draft, its History version, and a linked action's measured pages
 * and Publish task. The tables live in memory, their filters applied.
 */

let tables;
const clone = (value) => JSON.parse(JSON.stringify(value));
const rpcs = [];
const events = [];

function query(name) {
  const filters = [];
  let write = null;
  let returning = false;
  const rows = () => tables[name].filter((row) => filters.every((f) => f(row)));
  const run = () => {
    if (write?.insert) {
      tables[name].push(write.insert);
      return { data: null, error: null };
    }
    if (write?.update) {
      const hit = rows();
      for (const row of hit) Object.assign(row, clone(write.update));
      return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    return { data: rows().map((r) => clone(r)), error: null };
  };
  const chain = {
    select: () => ((returning = true), chain),
    // A JSON field's text too (`payload->>draftId`), as PostgREST reads it.
    eq: (col, value) => {
      const [column, field] = col.split('->>');
      filters.push((row) => (field ? row[column]?.[field] : row[column]) === value);
      return chain;
    },
    neq: (col, value) => (filters.push((row) => row[col] !== value), chain),
    is: (col, value) => (filters.push((row) => (row[col] ?? null) === value), chain),
    in: (col, values) => (filters.push((row) => values.includes(row[col])), chain),
    // The latest delivery is the only one these tests give a draft.
    order: () => chain,
    limit: () => chain,
    update: (row) => ((write = { update: row }), chain),
    insert: (row) => ((write = { insert: row }), chain),
    maybeSingle: async () => {
      const { data } = run();
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error: null };
    },
    then: (resolve) => resolve(run()),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => query(name),
    rpc: async (fn, args) => {
      rpcs.push({ fn, args });
      return { data: 'v1', error: null };
    },
  },
}));
const assertBrandAccess = vi.fn(async () => ({ orgId: 'org1' }));
vi.mock('./access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('./logger.js', () => ({
  logger: { warn: (...args) => events.push(args), error: () => {} },
}));
const shipped = [];
const closed = [];
vi.mock('./impact-ledger/ship.js', () => ({
  shipCmsPublish: async (args) => {
    shipped.push(args);
    return { id: 'ship-1', created: true, failed: false };
  },
  closeTakenDown: async (args) => {
    closed.push(args);
    return 1;
  },
}));

const {
  liveAddress,
  markDeliveryPublished,
  markDeliveryTakenDown,
  publishDraft,
  publishDraftForKeyUser,
} = await import('./contentPublished.js');

const LIVE = 'https://www.acme.example/blog/cold-brew';

const draft = (over = {}) => ({
  id: 'dr1',
  brand_id: 'b1',
  action_id: null,
  method: 'create',
  source_url: null,
  status: 'ready',
  archived_at: null,
  ...over,
});
const task = (id, key, status = 'todo') => ({ id, action_id: 'a1', task_key: key, status });

beforeEach(() => {
  tables = {
    content_drafts: [draft()],
    actions: [
      {
        id: 'a1',
        brand_id: 'b1',
        deleted_at: null,
        updated_at: '2026-10-20T10:00:00Z',
        payload: { source: 'content_draft', pages: [] },
      },
    ],
    action_tasks: [],
    action_events: [],
    brand_domains: [{ brand_id: 'b1', domain: 'acme.example' }],
    content_draft_deliveries: [],
  };
  rpcs.length = 0;
  events.length = 0;
  shipped.length = 0;
  closed.length = 0;
});

describe('liveAddress', () => {
  it('takes an http(s) address as the browser reads it, without sign-in details', () => {
    expect(liveAddress('  https://Acme.example/blog/x  ')).toBe('https://acme.example/blog/x');
    expect(liveAddress('http://acme.example')).toBe('http://acme.example/');
    expect(liveAddress('ftp://acme.example/x')).toBeNull();
    expect(liveAddress('https://user:pw@acme.example/x')).toBeNull();
    expect(liveAddress('acme.example/x')).toBeNull();
    expect(liveAddress(`https://acme.example/${'a'.repeat(2100)}`)).toBeNull();
    expect(liveAddress(null)).toBeNull();
  });
});

describe('publishDraft', () => {
  it('publishes the page at its address, in History, saying whether it’s on the brand’s domains', async () => {
    expect(await publishDraft(tables.content_drafts[0], LIVE, 'u1')).toMatchObject({
      publishedUrl: LIVE,
      taskCompleted: false,
      onBrandDomain: true,
    });
    expect(tables.content_drafts[0]).toMatchObject({ status: 'published', published_url: LIVE });
    expect(rpcs).toEqual([
      { fn: 'content_draft_snapshot', args: { p_draft_id: 'dr1', p_origin: 'publish' } },
    ]);
    expect(
      (await publishDraft(tables.content_drafts[0], 'https://medium.com/@acme/x', 'u1'))
        .onBrandDomain,
    ).toBe(false);
  });

  it('measures the live page with the action, beside the pages it names, and moves it when published again', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.actions[0].payload.pages = ['https://www.acme.example/old'];
    await publishDraft(tables.content_drafts[0], LIVE, 'u1');
    expect(tables.actions[0].payload).toEqual({
      source: 'content_draft',
      // The pages the action works through stay as they were.
      pages: ['https://www.acme.example/old'],
      publishedPages: { dr1: LIVE },
    });
    await publishDraft(tables.content_drafts[0], 'https://www.acme.example/blog/cold-brew-2', 'u1');
    expect(tables.actions[0].payload.publishedPages).toEqual({
      dr1: 'https://www.acme.example/blog/cold-brew-2',
    });
    // Off the brand's domains, its numbers can't be read: it leaves the measurement.
    await publishDraft(tables.content_drafts[0], 'https://medium.com/@acme/x', 'u1');
    expect(tables.actions[0].payload.publishedPages).toEqual({});
  });

  it('completes the Publish task once the action’s work is live, in its History', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.action_tasks = [
      task('t0', 'create_content_draft', 'completed'),
      task('t1', 'publish_content'),
    ];
    expect((await publishDraft(tables.content_drafts[0], LIVE, 'u1')).taskCompleted).toBe(true);
    expect(tables.action_tasks[1]).toMatchObject({ status: 'completed', skip_reason: null });
    expect(tables.action_events).toEqual([
      {
        action_id: 'a1',
        event: 'task_status',
        data: { taskId: 't1', to: 'completed', draftId: 'dr1', publishedUrl: LIVE },
        actor_id: 'u1',
      },
    ]);
  });

  it('completes the page’s own task too, as Mark ready does, so Publish doesn’t wait on it', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.action_tasks = [task('t0', 'create_content_draft'), task('t1', 'publish_content')];
    expect((await publishDraft(tables.content_drafts[0], LIVE, 'u1')).taskCompleted).toBe(true);
    expect(tables.action_tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    // Each change names the draft: taking the page back reopens them.
    expect(tables.action_events.map((e) => e.data)).toEqual([
      { taskId: 't0', to: 'completed', draftId: 'dr1' },
      { taskId: 't1', to: 'completed', draftId: 'dr1', publishedUrl: LIVE },
    ]);
  });

  it('completes an Optimize task naming several pages once each has a ready draft', async () => {
    const pages = ['https://www.acme.example/a', 'https://www.acme.example/b'];
    tables.actions[0].payload.pages = pages;
    tables.content_drafts = [
      draft({ id: 'dr1', action_id: 'a1', method: 'optimize', source_url: pages[0] }),
    ];
    tables.action_tasks = [task('t0', 'optimize_content'), task('t1', 'publish_content')];
    await publishDraft(tables.content_drafts[0], pages[0], 'u1');
    expect(tables.action_tasks.map((t) => t.status)).toEqual(['todo', 'todo']);
    // Page b's draft is ready, not live: the work is done, Publish waits.
    tables.content_drafts.push(
      draft({ id: 'dr2', action_id: 'a1', method: 'optimize', source_url: pages[1] }),
    );
    await publishDraft(tables.content_drafts[0], pages[0], 'u1');
    expect(tables.action_tasks.map((t) => t.status)).toEqual(['completed', 'todo']);
    expect((await publishDraft(tables.content_drafts[1], pages[1], 'u1')).taskCompleted).toBe(true);
  });

  it('leaves a task changed meanwhile as it is, with nothing in its History', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.action_tasks = [task('t1', 'publish_content')];
    // Skipped in the drawer between the read and the write.
    const realFilter = tables.action_tasks.filter.bind(tables.action_tasks);
    let reads = 0;
    tables.action_tasks.filter = (fn) => {
      reads += 1;
      if (reads === 2) tables.action_tasks[0].status = 'skipped';
      return realFilter(fn);
    };
    expect((await publishDraft(tables.content_drafts[0], LIVE, 'u1')).taskCompleted).toBe(false);
    expect(tables.action_tasks[0].status).toBe('skipped');
    expect(tables.action_events).toEqual([]);
  });

  it('reads only the brand pages an action names, once each', async () => {
    const page = 'https://www.acme.example/a';
    tables.actions[0].payload.pages = [page, page, 'not a page', 42];
    tables.content_drafts = [draft({ action_id: 'a1', method: 'optimize', source_url: page })];
    tables.action_tasks = [task('t0', 'optimize_content'), task('t1', 'publish_content')];
    expect((await publishDraft(tables.content_drafts[0], page, 'u1')).taskCompleted).toBe(true);
  });

  it('doesn’t wait for work someone skipped', async () => {
    tables.content_drafts = [draft({ action_id: 'a1', method: 'optimize', source_url: LIVE })];
    tables.action_tasks = [
      task('t0', 'create_content_draft', 'skipped'),
      task('t1', 'optimize_content'),
      task('t2', 'publish_content'),
    ];
    expect((await publishDraft(tables.content_drafts[0], LIVE, 'u1')).taskCompleted).toBe(true);
    expect(tables.action_tasks.map((t) => t.status)).toEqual(['skipped', 'completed', 'completed']);
  });

  it('waits for every page an Optimize task names, a draft each, before Publish is done', async () => {
    const pages = ['https://www.acme.example/a', 'https://www.acme.example/b'];
    tables.actions[0].payload.pages = pages;
    tables.content_drafts = [
      draft({ id: 'dr1', action_id: 'a1', method: 'optimize', source_url: pages[0] }),
    ];
    tables.action_tasks = [
      task('t0', 'optimize_content', 'completed'),
      task('t1', 'publish_content'),
    ];
    // Page b has no draft yet.
    expect((await publishDraft(tables.content_drafts[0], pages[0], 'u1')).taskCompleted).toBe(
      false,
    );
    tables.content_drafts.push(
      draft({ id: 'dr2', action_id: 'a1', method: 'optimize', source_url: pages[1] }),
    );
    expect((await publishDraft(tables.content_drafts[1], pages[1], 'u1')).taskCompleted).toBe(true);
    // An archived draft doesn't count.
    tables.action_tasks[1].status = 'todo';
    tables.content_drafts[0].status = 'ready';
    tables.content_drafts[0].archived_at = '2026-10-24T10:00:00Z';
    expect((await publishDraft(tables.content_drafts[1], pages[1], 'u1')).taskCompleted).toBe(
      false,
    );
  });

  it('leaves a Publish task someone skipped, and a deleted action, as they are', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.action_tasks = [task('t1', 'publish_content', 'skipped')];
    expect((await publishDraft(tables.content_drafts[0], LIVE, 'u1')).taskCompleted).toBe(false);
    expect(tables.action_tasks[0].status).toBe('skipped');
    tables.actions[0].deleted_at = '2026-10-24T10:00:00Z';
    tables.actions[0].payload = { pages: [] };
    await publishDraft(tables.content_drafts[0], LIVE, 'u1');
    expect(tables.actions[0].payload).toEqual({ pages: [] });
    // Another brand's action isn't touched either.
    tables.actions[0] = { ...tables.actions[0], deleted_at: null, brand_id: 'b2' };
    await publishDraft(tables.content_drafts[0], LIVE, 'u1');
    expect(tables.actions[0].payload).toEqual({ pages: [] });
  });

  it('keeps the page published when the action’s part fails, saying so in the log', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.actions[0].payload = null;
    tables.action_tasks = null;
    const published = await publishDraft(tables.content_drafts[0], LIVE, 'u1');
    expect(published.taskCompleted).toBe(false);
    expect(tables.content_drafts[0].status).toBe('published');
    expect(events.length).toBe(1);
  });
});

describe('publishDraftForKeyUser', () => {
  // The fake database reads the embedded organization as a column of its own.
  const ofOrg = (org) => Object.assign(tables.content_drafts[0], { 'brands.organization_id': org });

  it('publishes the organization’s draft as the key’s user, as the route does', async () => {
    ofOrg('org1');
    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).toMatchObject({ publishedUrl: LIVE, taskCompleted: false, onBrandDomain: true });
    expect(tables.content_drafts[0]).toMatchObject({ status: 'published', published_url: LIVE });
  });

  it('leaves a draft of a brand the key’s user wasn’t given alone, as not there', async () => {
    ofOrg('org1');
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      }),
    );
    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).toBeNull();
    expect(assertBrandAccess).toHaveBeenLastCalledWith(tables.content_drafts[0].brand_id, 'u1');
    expect(tables.content_drafts[0].status).not.toBe('published');

    assertBrandAccess.mockRejectedValueOnce(new Error('connection reset'));
    await expect(
      publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).rejects.toThrow('connection reset');
  });

  it('leaves another organization’s draft, and an archived one, alone', async () => {
    ofOrg('org2');
    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).toBeNull();
    ofOrg('org1');
    tables.content_drafts[0].archived_at = '2026-10-20T10:00:00Z';
    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).toBeNull();
    expect(tables.content_drafts[0].published_url ?? null).toBeNull();
  });

  it('changes nothing for a page already published at the address, its live-since kept', async () => {
    ofOrg('org1');
    const since = '2026-10-21T08:00:00Z';
    Object.assign(tables.content_drafts[0], {
      status: 'published',
      published_url: LIVE,
      published_at: since,
      action_id: 'a1',
    });
    tables.action_tasks = [task('t1', 'publish_content')];
    const before = clone(tables);

    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: LIVE, userId: 'u1', orgId: 'org1' }),
    ).toEqual({
      publishedUrl: LIVE,
      publishedAt: since,
      taskCompleted: false,
      onBrandDomain: true,
    });
    expect(tables).toEqual(before);
    expect(rpcs).toEqual([]);

    // At another address, it moves, as the editor's Mark published moves it.
    const moved = 'https://www.acme.example/blog/cold-brew-at-home';
    expect(
      await publishDraftForKeyUser({ draftId: 'dr1', url: moved, userId: 'u1', orgId: 'org1' }),
    ).toMatchObject({ publishedUrl: moved });
    expect(tables.content_drafts[0].published_url).toBe(moved);
    expect(tables.content_drafts[0].published_at).not.toBe(since);
  });
});

describe('markDeliveryPublished', () => {
  it('tells the action of a page its CMS published, as a person’s publish does', async () => {
    tables.content_drafts[0].action_id = 'a1';
    tables.action_tasks = [task('t1', 'publish_content')];
    tables.content_draft_deliveries = [{ id: 'x1', draft_id: 'dr1', status: 'sent' }];
    await markDeliveryPublished(
      { id: 'x1', draft_id: 'dr1', status: 'sent', published_url: null },
      LIVE,
    );
    expect(tables.content_drafts[0]).toMatchObject({ status: 'published', published_url: LIVE });
    expect(tables.actions[0].payload.publishedPages).toEqual({ dr1: LIVE });
    expect(tables.action_tasks[0].status).toBe('completed');
    expect(tables.action_events[0].actor_id).toBeNull();
  });

  it('puts the publish into the impact ledger once the delivery is published, and not again', async () => {
    tables.content_draft_deliveries = [{ id: 'x1', draft_id: 'dr1', status: 'sent' }];
    await markDeliveryPublished(
      { id: 'x1', draft_id: 'dr1', status: 'sent', published_url: null },
      LIVE,
    );
    expect(shipped).toEqual([
      { deliveryId: 'x1', url: LIVE, publishedAt: tables.content_draft_deliveries[0].published_at },
    ]);
    // Confirmed again at the same address: nothing new shipped.
    await markDeliveryPublished(
      { id: 'x1', draft_id: 'dr1', status: 'published', published_url: LIVE },
      LIVE,
    );
    expect(shipped).toHaveLength(1);
  });
});

describe('markDeliveryTakenDown (AUTONOMOUS-GO-LIVE PR 10)', () => {
  const AT = '2026-11-02T12:00:00.000Z';
  const send = (over = {}) => ({
    id: 'x1',
    draft_id: 'dr1',
    target: 'webflow',
    status: 'published',
    published_url: LIVE,
    ...over,
  });
  beforeEach(() => {
    Object.assign(tables.content_drafts[0], {
      status: 'published',
      published_url: LIVE,
      published_at: '2026-11-01T10:00:00Z',
    });
    tables.content_draft_deliveries = [send()];
    tables.chat_agent_go_live_events = [
      { id: 'e1', content_draft_id: 'dr1', target: 'webflow', kind: 'publish', status: 'done' },
      { id: 'e2', content_draft_id: 'dr1', target: 'webflow', kind: 'cms_draft', status: 'done' },
    ];
    tables.chat_notices = [
      {
        id: 'n1',
        kind: 'agent_went_live',
        payload: { draftId: 'dr1', kind: 'publish', url: LIVE },
        resolved_at: null,
      },
      {
        id: 'n2',
        kind: 'agent_went_live',
        payload: { draftId: 'dr1', kind: 'cms_draft' },
        resolved_at: null,
      },
    ];
  });

  it('marks the send taken down, the page back to Ready without its address, and tells the rest', async () => {
    expect(await markDeliveryTakenDown(send(), { userId: 'u1', at: AT })).toBe(true);
    expect(tables.content_draft_deliveries[0]).toMatchObject({
      status: 'taken_down',
      taken_down_at: AT,
      taken_down_by: 'u1',
      published_url: LIVE,
    });
    expect(tables.content_drafts[0]).toMatchObject({
      status: 'ready',
      published_url: null,
      published_at: null,
    });
    // The publish on its own is taken down; the draft it sent before stays done.
    expect(tables.chat_agent_go_live_events.map((e) => e.status)).toEqual(['taken_down', 'done']);
    expect(tables.chat_agent_go_live_events[0]).toMatchObject({
      taken_down_at: AT,
      taken_down_by: 'u1',
    });
    expect(tables.chat_notices[0].resolved_at).toBe(AT);
    expect(tables.chat_notices[1].resolved_at).toBeNull();
    expect(closed).toEqual([{ draftId: 'dr1', at: AT }]);
  });

  it('changes nothing for a send that isn’t published, and leaves a page live at another send’s address', async () => {
    tables.content_draft_deliveries[0].status = 'sent';
    expect(await markDeliveryTakenDown(send(), { userId: 'u1', at: AT })).toBe(false);
    expect(tables.content_drafts[0].published_url).toBe(LIVE);
    expect(closed).toEqual([]);

    tables.content_draft_deliveries[0].status = 'published';
    tables.content_drafts[0].published_url = 'https://www.acme.example/blog/cold-brew-2';
    expect(await markDeliveryTakenDown(send(), { userId: 'u1', at: AT })).toBe(true);
    expect(tables.content_drafts[0]).toMatchObject({
      status: 'published',
      published_url: 'https://www.acme.example/blog/cold-brew-2',
    });
  });
});
