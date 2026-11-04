import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * An agent's going-live step on its own (AUTONOMOUS-GO-LIVE §5.4, PR 4):
 * every condition read again from the database before the page goes, sent
 * as the run's person with the agent run kept, the step finished done or
 * failed. A refusal sends nothing and frees only this step's own slot.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555';
const AGENT_RUN = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const ACTOR = '88888888-8888-4888-8888-888888888888';
const STEP = '99999999-9999-4999-8999-999999999999';

const db = vi.hoisted(() => ({ tables: {}, rpc: [] }));
const sendContentPages = vi.hoisted(() => vi.fn());
const flags = vi.hoisted(() => ({ chatOn: true, demo: false, cloud: true }));
const access = vi.hoisted(() => ({ value: null }));

/** A query on the in-memory tables: eq filters and one row. */
function query(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      // brands!inner(organization_id) is read as the draft's brand's organization.
      filters.push((row) =>
        col === 'brands.organization_id' ? row.brands?.organization_id === val : row[col] === val,
      );
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () => ({
      data: (db.tables[table] ?? []).find((row) => filters.every((f) => f(row))) ?? null,
      error: null,
    }),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    rpc: async (name, args) => {
      db.rpc.push([name, args]);
      return { data: true, error: null };
    },
  },
}));
vi.mock('../config/plans.js', () => ({ isCloud: () => flags.cloud }));
vi.mock('../lib/chatFlag.js', () => ({ chatAgenticEnabled: () => flags.chatOn }));
vi.mock('../lib/access.js', () => ({ brandAccessOf: async () => access.value }));
vi.mock('../middleware/demoBrand.js', () => ({ isDemoBrand: async () => flags.demo }));
vi.mock('../lib/contentDelivery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendContentPages: (...args) => sendContentPages(...args),
}));

/** Content Quality's reads, for the gate's endpoint. */
const reads = vi.hoisted(() => ({
  claims: vi.fn(),
  page: vi.fn(),
  classes: vi.fn(),
  links: vi.fn(),
  facts: vi.fn(),
  siteTrust: vi.fn(),
  reserve: vi.fn(),
  phase: { value: 2 },
}));
vi.mock('../lib/contentQuality.js', async (importOriginal) => ({
  ...(await importOriginal()),
  qualityPhase: () => reads.phase.value,
}));
vi.mock('../lib/contentQualityClaims.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readDraftClaims: (...args) => reads.claims(...args),
}));
vi.mock('../lib/contentQualityPage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPage: (...args) => reads.page(...args),
}));
vi.mock('../lib/contentSourceClass.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readSourceClasses: (...args) => reads.classes(...args),
}));
vi.mock('../lib/linkCheck.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkLinks: (...args) => reads.links(...args),
}));
vi.mock('../lib/brandFacts.js', () => ({
  readBrandFacts: (...args) => reads.facts(...args),
}));
vi.mock('../lib/siteTrust.js', () => ({
  readSiteTrust: (...args) => reads.siteTrust(...args),
}));
const tellWentLive = vi.fn(async () => ({ notices: 1, emails: 1, history: false }));
const publishContentPage = vi.fn();
vi.mock('../lib/cmsPublish.js', () => ({
  publishContentPage: (...args) => publishContentPage(...args),
}));
vi.mock('../lib/chat-notices/goLive.js', () => ({
  tellWentLive: (...args) => tellWentLive(...args),
}));
vi.mock('../lib/contentPageContext.js', () => ({
  pageReadContext: async () => ({ siteType: 'b2b', brandName: 'Acme', facts: ['Founded 2019'] }),
}));
vi.mock('../lib/chatBudget.js', async (importOriginal) => ({
  ...(await importOriginal()),
  agentRunReserve: (...args) => {
    reads.reserve(...args);
    return 'the run’s meter';
  },
}));

const { default: router } = await import('./internalChatGoLive.js');
const { ChatBudgetError } = await import('../lib/chatBudget.js');
const { PlanLimitError } = await import('../lib/planGuard.js');
const { DeliveryError } = await import('../lib/contentDelivery.js');

const PAGE = {
  draftId: DRAFT,
  title: 'Pour-over guide',
  slug: 'pour-over-guide',
  metaTitle: 'Pour-over guide',
  metaDescription: 'Brew it slowly.',
  html: '<p>Brew it slowly.</p>',
  author: null,
  reviewer: null,
  featuredImage: null,
};
const BODY = {
  orgId: ORG,
  agentRunId: AGENT_RUN,
  runId: RUN,
  actingUserId: ACTOR,
  draftId: DRAFT,
  target: 'webflow',
  kind: 'cms_draft',
  reservationId: STEP,
  page: PAGE,
};

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  tellWentLive.mockClear();
  publishContentPage.mockReset();
  flags.chatOn = true;
  flags.demo = false;
  flags.cloud = true;
  access.value = { orgId: ORG, role: 'admin', all: true, brandIds: new Set() };
  db.rpc = [];
  db.tables = {
    organizations: [{ id: ORG, plan: 'growth', subscription_status: 'active' }],
    chat_settings: [
      { organization_id: ORG, auto_go_live_groups: ['publishing'], manager_execute_off: [] },
    ],
    chat_agent_runs: [
      {
        id: AGENT_RUN,
        organization_id: ORG,
        agent_id: AGENT,
        agent_version: 3,
        acting_user_id: ACTOR,
        status: 'running',
      },
    ],
    chat_agent_go_live: [{ agent_id: AGENT, organization_id: ORG, version: 3 }],
    content_drafts: [
      { id: DRAFT, brand_id: BRAND, archived_at: null, brands: { organization_id: ORG } },
    ],
    chat_agent_go_live_events: [
      {
        id: STEP,
        organization_id: ORG,
        agent_id: AGENT,
        agent_run_id: AGENT_RUN,
        content_draft_id: DRAFT,
        target: 'webflow',
        kind: 'cms_draft',
        status: 'reserved',
        created_at: new Date().toISOString(),
      },
    ],
  };
  sendContentPages.mockReset().mockResolvedValue({
    batchId: null,
    deliveries: [{ id: 'd1', draftId: DRAFT, status: 'sent', external_id: 'wf-1', error: null }],
    skipped: 0,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/', router);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (body = BODY, secret = 'shh') =>
  fetch(`${baseUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
const finished = () => db.rpc.filter(([name]) => name === 'finish_agent_go_live').map(([, a]) => a);

describe('POST /api/internal/chat/go-live/send', () => {
  it('sends the page as the run’s person, keeps the agent run, and marks the step done', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      delivery: { id: 'd1', status: 'sent' },
    });
    expect(sendContentPages).toHaveBeenCalledWith({
      orgId: ORG,
      brandId: BRAND,
      userId: ACTOR,
      pages: [expect.objectContaining({ draftId: DRAFT, slug: 'pour-over-guide' })],
      target: 'webflow',
      agentRunId: AGENT_RUN,
    });
    expect(finished()).toEqual([
      expect.objectContaining({
        p_id: STEP,
        p_status: 'done',
        p_delivery_id: 'd1',
        p_external_id: 'wf-1',
        p_error: null,
      }),
    ]);
    // Who should know is told once the step is done (AUTONOMOUS-GO-LIVE §6.4).
    await vi.waitFor(() => expect(tellWentLive).toHaveBeenCalledWith({ eventId: STEP }));
  });

  it('answers only the web, and refuses a body it can’t read', async () => {
    expect((await send(BODY, 'nope')).status).toBe(401);
    expect((await send({ ...BODY, kind: 'webhook' })).status).toBe(400);
    expect((await send({ ...BODY, target: 'webhook' })).status).toBe(400);
    expect((await send({ ...BODY, page: { ...PAGE, draftId: STEP } })).status).toBe(400);
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([]);
  });

  /** Each check that fails: nothing goes, and the step's own slot is freed. */
  const refusals = [
    ['chat_off', () => (flags.chatOn = false)],
    ['plan', () => (db.tables.organizations[0].plan = 'starter')],
    ['plan', () => (db.tables.organizations[0].subscription_status = 'canceled')],
    ['plan', () => Object.assign(db.tables.organizations[0], { subscription_status: 'trialing' })],
    ['switch_off', () => (db.tables.chat_settings[0].auto_go_live_groups = [])],
    ['permission', () => (db.tables.chat_agent_go_live[0].version = 2)],
    ['permission', () => (db.tables.chat_agent_go_live = [])],
    ['permission', () => (db.tables.chat_agent_runs[0].status = 'done')],
    ['permission', () => (db.tables.chat_agent_runs[0].acting_user_id = STEP)],
    ['role', () => (access.value = { ...access.value, role: 'analyst' })],
    ['role', () => (access.value = { ...access.value, orgId: STEP })],
    [
      'publishing_off',
      () => {
        access.value = { ...access.value, role: 'manager' };
        db.tables.chat_settings[0].manager_execute_off = ['publishing'];
      },
    ],
    ['brand', () => (access.value = { ...access.value, all: false, brandIds: new Set() })],
    ['demo_brand', () => (flags.demo = true)],
  ];
  it.each(refusals)('refuses with %s, sends nothing and frees its own slot', async (code, set) => {
    set();
    const res = await send();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, code });
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([
      expect.objectContaining({ p_id: STEP, p_status: 'failed', p_error: `refused: ${code}` }),
    ]);
  });

  it('lets a Manager send while publishing is on for Managers, and self-hosted needs no plan', async () => {
    access.value = { ...access.value, role: 'manager' };
    expect((await send()).status).toBe(200);
    flags.cloud = false;
    db.tables.organizations[0].plan = 'starter';
    expect((await send()).status).toBe(200);
  });

  it('never sends a page someone took down: a click does it (PR 10)', async () => {
    db.tables.content_draft_deliveries = [{ id: 'd0', draft_id: DRAFT, status: 'taken_down' }];
    const res = await send();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'taken_down' });
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it('answers 404 for a run or a draft that isn’t the workspace’s', async () => {
    db.tables.content_drafts[0].archived_at = new Date().toISOString();
    expect((await send()).status).toBe(404);
    db.tables.chat_agent_runs = [];
    expect((await send()).status).toBe(404);
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it('never frees or uses a slot that isn’t this step’s', async () => {
    const step = db.tables.chat_agent_go_live_events[0];
    for (const change of [
      { agent_run_id: RUN },
      { content_draft_id: STEP },
      { target: 'wordpress' },
      { organization_id: STEP },
      { status: 'taken_down' },
      { status: 'failed' },
    ]) {
      db.tables.chat_agent_go_live_events = [{ ...step, ...change }];
      const res = await send();
      expect(res.status, JSON.stringify(change)).toBe(403);
      expect(await res.json()).toEqual({ success: false, code: 'reservation' });
    }
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([]);
  });

  it('sends a page again on the slot it had in the last 24 hours, and not after', async () => {
    const step = db.tables.chat_agent_go_live_events[0];
    db.tables.chat_agent_go_live_events = [{ ...step, status: 'done', agent_run_id: RUN }];
    expect((await send()).status).toBe(200);

    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.tables.chat_agent_go_live_events = [{ ...step, status: 'done', created_at: old }];
    expect((await send()).status).toBe(403);
  });

  it('marks the step failed when the CMS refuses or the send can’t go, and never retries', async () => {
    sendContentPages.mockResolvedValueOnce({
      batchId: null,
      deliveries: [{ id: 'd2', draftId: DRAFT, status: 'failed', error: 'Webflow said no' }],
      skipped: 0,
    });
    const refused = await send();
    expect(refused.status).toBe(200);
    expect(finished().at(-1)).toMatchObject({
      p_status: 'failed',
      p_delivery_id: 'd2',
      p_error: 'Webflow said no',
    });

    sendContentPages.mockRejectedValueOnce(
      new DeliveryError('daily_limit', 'This workspace has sent 200 pages', 429),
    );
    const full = await send();
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ code: 'daily_limit' });
    expect(finished().at(-1)).toMatchObject({
      p_status: 'failed',
      p_error: 'This workspace has sent 200 pages',
    });

    sendContentPages.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await send()).status).toBe(502);
    expect(finished().at(-1)).toMatchObject({ p_error: 'The page could not be sent' });
    expect(sendContentPages).toHaveBeenCalledTimes(3);
    // Nothing went out: nobody is told it did.
    expect(tellWentLive).not.toHaveBeenCalled();
  });

  it('puts a new page live for a publish step, and keeps its address on the step (PR 9)', async () => {
    db.tables.chat_agent_go_live_events[0].kind = 'publish';
    publishContentPage.mockResolvedValueOnce({
      delivery: {
        id: 'd9',
        status: 'published',
        external_id: 'wf-9',
        published_url: 'https://acme.example/blog/pour-over-guide',
      },
      published: true,
      url: 'https://acme.example/blog/pour-over-guide',
    });
    const res = await send({ ...BODY, kind: 'publish' });
    expect(res.status).toBe(200);
    expect(publishContentPage).toHaveBeenCalledWith({
      orgId: ORG,
      brandId: BRAND,
      userId: ACTOR,
      target: 'webflow',
      agentRunId: AGENT_RUN,
      page: expect.objectContaining({ draftId: DRAFT }),
    });
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([
      expect.objectContaining({
        p_id: STEP,
        p_status: 'done',
        p_delivery_id: 'd9',
        p_published_url: 'https://acme.example/blog/pour-over-guide',
      }),
    ]);
    await vi.waitFor(() => expect(tellWentLive).toHaveBeenCalledWith({ eventId: STEP }));

    // A page live already, or Framer: refused before anything went, its slot freed.
    db.tables.chat_agent_go_live_events[0].status = 'reserved';
    publishContentPage.mockRejectedValueOnce(
      new DeliveryError('live_item', 'This page is live already.', 409),
    );
    const live = await send({ ...BODY, kind: 'publish' });
    expect(live.status).toBe(409);
    expect(await live.json()).toMatchObject({ code: 'live_item' });
    expect(finished().at(-1)).toMatchObject({ p_status: 'failed' });
  });

  it('answers the step even when telling people fails', async () => {
    tellWentLive.mockRejectedValueOnce(new Error('mail down'));
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });
});

describe('POST /api/internal/chat/go-live/quality-reads', () => {
  const HTML =
    '<p>Read <a href="https://sca.coffee/guide">the SCA</a>, <a href="https://blog.example/a">a blog</a> and <a href="https://kept.example/x">one kept</a>.</p>';
  const READS = {
    orgId: ORG,
    agentRunId: AGENT_RUN,
    runId: RUN,
    actingUserId: ACTOR,
    draftId: DRAFT,
    sites: ['blog.example', 'kept.example', 'not-linked.example'],
  };
  const ask = (body = READS, secret = 'shh') =>
    fetch(`${baseUrl}/quality-reads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    reads.phase.value = 2;
    Object.assign(db.tables.content_drafts[0], {
      body_html: HTML,
      page_type: 'guide',
      kept_sources: ['https://kept.example/x'],
    });
    reads.links.mockReset().mockResolvedValue({
      reads: new Map([['https://sca.coffee/guide', { status: 'ok', httpStatus: 200, date: null }]]),
      skipped: [],
    });
    reads.claims.mockReset().mockResolvedValue({ paragraphs: [], pending: 0, limited: false });
    reads.page.mockReset().mockResolvedValue({ spots: [], proofs: [], checks: null });
    reads.classes.mockReset().mockResolvedValue({ classes: [], limited: false });
    reads.facts.mockReset().mockResolvedValue({ facts: [], pages: [] });
    reads.siteTrust.mockReset().mockResolvedValue({ score: 4 });
    reads.reserve.mockReset();
  });

  it('reads the draft as saved on the run’s own meter, each read on its own', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      links: {
        ok: true,
        value: {
          links: [{ href: 'https://sca.coffee/guide', status: 'ok', httpStatus: 200, date: null }],
          skipped: [],
        },
      },
      claims: { ok: true, value: { paragraphs: [], pending: 0, limited: false } },
      page: { ok: true, value: { spots: [], proofs: [], checks: null } },
      classes: { ok: true, value: { classes: [], limited: false } },
      facts: { ok: true, value: { facts: [], pages: [] } },
      siteTrust: { ok: true, value: { score: 4 } },
    });
    expect(reads.facts).toHaveBeenCalledWith(BRAND, { orgId: ORG });
    expect(reads.siteTrust).toHaveBeenCalledWith(BRAND, { refresh: false, keptOnly: false });
    expect(reads.reserve).toHaveBeenCalledWith(ORG, { runId: RUN, agentRunId: AGENT_RUN });
    expect(reads.links.mock.calls[0][0]).toEqual([
      'https://sca.coffee/guide',
      'https://blog.example/a',
      'https://kept.example/x',
    ]);
    const meter = 'the run’s meter';
    expect(reads.claims).toHaveBeenCalledWith({
      orgId: ORG,
      draftId: DRAFT,
      html: HTML,
      reserve: meter,
    });
    expect(reads.page).toHaveBeenCalledWith({
      orgId: ORG,
      draftId: DRAFT,
      html: HTML,
      pageType: 'guide',
      siteType: 'b2b',
      brandName: 'Acme',
      facts: ['Founded 2019'],
      reserve: meter,
    });
    // Only a site the draft links, and not one whose every link the person kept.
    expect(reads.classes).toHaveBeenCalledWith({
      orgId: ORG,
      draftId: DRAFT,
      sites: ['blog.example'],
      reserve: meter,
    });
  });

  it('says which read couldn’t be made, and why, keeping the others', async () => {
    reads.claims.mockRejectedValue(
      new ChatBudgetError('run_cap', 429, 'This run reached its limit.'),
    );
    reads.page.mockRejectedValue(new PlanLimitError('Budget used up', 429));
    reads.classes.mockRejectedValue(new Error('provider down'));
    const body = await (await ask()).json();
    expect(body.links.ok).toBe(true);
    expect(body.claims).toEqual({ ok: false, code: 'run_cap' });
    expect(body.page).toEqual({ ok: false, code: 'ai_budget' });
    expect(body.classes).toEqual({ ok: false, code: 'failed' });
  });

  it('reads only the links before Quality’s phase 2', async () => {
    reads.phase.value = 1;
    const body = await (await ask()).json();
    expect(body.links.ok).toBe(true);
    expect(body.siteTrust.ok).toBe(true);
    for (const read of ['claims', 'page', 'classes', 'facts']) {
      expect(body[read]).toEqual({ ok: false, code: 'off' });
    }
    expect(reads.claims).not.toHaveBeenCalled();
  });

  it('reads nothing for a run that isn’t this person’s, or a draft they can’t read', async () => {
    expect((await ask(READS, 'nope')).status).toBe(401);
    expect((await ask({ ...READS, sites: 'x' })).status).toBe(400);
    db.tables.chat_agent_runs[0].status = 'done';
    expect(await (await ask()).json()).toEqual({ success: false, code: 'permission' });
    db.tables.chat_agent_runs[0].status = 'running';
    access.value = { ...access.value, role: 'analyst' };
    expect(await (await ask()).json()).toEqual({ success: false, code: 'role' });
    access.value = { ...access.value, role: 'admin' };
    flags.demo = true;
    expect(await (await ask()).json()).toEqual({ success: false, code: 'demo_brand' });
    flags.demo = false;
    db.tables.content_drafts[0].archived_at = new Date().toISOString();
    expect((await ask()).status).toBe(404);
    expect(reads.links).not.toHaveBeenCalled();
    expect(reads.reserve).not.toHaveBeenCalled();
  });
});
