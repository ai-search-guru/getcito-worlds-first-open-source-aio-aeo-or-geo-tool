import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { AI_SOURCES_VERSION } from '../lib/aiSources.js';

/**
 * POST /track/:trackingCode (AT-003): each pageview is stored with the visit
 * it belongs to, and a failed visit lookup still stores the pageview; with
 * the landing page's status, for Broken AI links (AT-012), and the surface
 * it came through (ChatGPT Shopping, #1283).
 */

const inserted = [];
const findVisitOf = vi.fn();
let insertError = null;
// The not-found mark (k: "nf"): the filters of its lookup, what it finds, what it updates.
const filters = [];
let latestPageview = null;
const updated = [];
// The brand's conversions setting as its own read answers it (CE-017,
// 00286): the visit's read asks for the id only, and never sees it.
let conversionsRead = { data: { conversions_enabled: false }, error: null };
let eventInsertError = null;
// The brands reads' filters, to tell which brand the setting was read for.
const brandFilters = [];
// A visitor's earlier events as the limit read finds them, and its filters.
let earlierEvents = 0;
const eventFilters = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const filter = (op) => (col, val) => {
        if (table === 'ai_traffic_logs') filters.push([op, col, val]);
        if (table === 'brands') brandFilters.push([chain.columns, op, col, val]);
        if (table === 'ai_traffic_events') eventFilters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select: (columns) => {
          chain.columns = columns;
          return chain;
        },
        eq: filter('eq'),
        is: filter('is'),
        gte: filter('gte'),
        order: () => chain,
        limit: (n) =>
          table === 'ai_traffic_events'
            ? Promise.resolve({
                data: Array.from({ length: Math.min(earlierEvents, n) }, (_, i) => ({ id: i })),
                error: null,
              })
            : chain,
        single: async () =>
          chain.columns === 'conversions_enabled'
            ? conversionsRead
            : { data: { id: 'b1', organization_id: 'o1' }, error: null },
        maybeSingle: async () => ({ data: latestPageview, error: null }),
        insert: async (row) => {
          inserted.push({ table, row });
          return { error: table === 'ai_traffic_events' ? eventInsertError : insertError };
        },
        update: (fields) => ({
          eq: async (col, val) => {
            updated.push({ table, fields, [col]: val });
            return { error: null };
          },
        }),
      };
      return chain;
    },
  },
}));
vi.mock('../middleware/rateLimiter.js', () => ({
  trafficLimiter: (req, res, next) => next(),
  journeyEventLimiter: (req, res, next) => next(),
}));
vi.mock('../lib/logger.js', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { default: logger, logger };
});
vi.mock('../lib/trafficVisits.js', () => ({ findVisitOf: (...args) => findVisitOf(...args) }));
const isOrgActiveCached = vi.fn();
vi.mock('../lib/activeSubscriptions.js', () => ({
  isOrgActiveCached: (...args) => isOrgActiveCached(...args),
}));
// The visitor key stands in for the IP address (00250).
const visitorKey = vi.fn();
vi.mock('../lib/visitorKey.js', () => ({ visitorKey: (...args) => visitorKey(...args) }));

let server;
let baseUrl;

beforeAll(async () => {
  const { default: router } = await import('./traffic.js');
  const app = express();
  app.use(router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/track/abcdef123`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  // Every organization on a plan unless a test says otherwise.
  isOrgActiveCached.mockReset().mockResolvedValue(true);
  inserted.length = 0;
  insertError = null;
  findVisitOf.mockReset();
  visitorKey.mockReset();
  visitorKey.mockImplementation(async ({ brandId, ip }) => (ip ? `vk-${brandId}` : null));
  filters.length = 0;
  latestPageview = null;
  updated.length = 0;
  conversionsRead = { data: { conversions_enabled: false }, error: null };
  eventInsertError = null;
  brandFilters.length = 0;
  earlierEvents = 0;
  eventFilters.length = 0;
});

const beacon = (body = {}) =>
  fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Forwarded-For': '203.0.113.7' },
    body: JSON.stringify({
      u: 'https://acme.example/menu',
      r: 'https://gemini.google.com/',
      s: 'gemini.google.com',
      a: 'Mozilla/5.0',
      ...body,
    }),
  });

describe('POST /track/:trackingCode', () => {
  it('stores a repeat pageview under the visit it continues', async () => {
    findVisitOf.mockResolvedValue('p1');
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(visitorKey).toHaveBeenCalledWith({ brandId: 'b1', ip: '203.0.113.7' });
    expect(findVisitOf).toHaveBeenCalledWith({
      brandId: 'b1',
      sourcePlatform: 'gemini.google.com',
      visitorKey: 'vk-b1',
      userAgent: 'Mozilla/5.0',
    });
    expect(inserted[0].table).toBe('ai_traffic_logs');
    expect(inserted[0].row).toMatchObject({
      url: 'https://acme.example/menu',
      visitor_key: 'vk-b1',
      user_agent: 'Mozilla/5.0',
      visit_of: 'p1',
    });
  });

  it('never stores the IP address, and still stores the pageview when the key fails', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon();
    expect(inserted[0].row).not.toHaveProperty('ip_address');
    expect(JSON.stringify(inserted[0].row)).not.toContain('203.0.113.7');

    visitorKey.mockRejectedValue(new Error('traffic_salt returned no salt'));
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(inserted[1].row).toMatchObject({ visitor_key: null, visit_of: null });
    expect(findVisitOf).toHaveBeenLastCalledWith(expect.objectContaining({ visitorKey: null }));
  });

  it('stores a first pageview as a new visit', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon();
    expect(inserted[0].row.visit_of).toBeNull();
  });

  it('still stores the pageview, as a new visit, when the lookup fails', async () => {
    findVisitOf.mockRejectedValue(new Error('timeout'));
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].row.visit_of).toBeNull();
  });

  it('stores nothing for a beacon without a platform', async () => {
    const res = await beacon({ s: '' });
    expect(res.status).toBe(204);
    expect(findVisitOf).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("stores an older snippet's host under the AI source list's key (AT-004)", async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ s: 'chat.openai.com' });
    expect(findVisitOf).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePlatform: 'chatgpt.com' }),
    );
    expect(inserted[0].row.source_platform).toBe('chatgpt.com');
    // No list version from a snippet that predates it.
    expect(inserted[0].row.source_list_version).toBeNull();
  });

  it('stores the list version the snippet counted the visit with', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ v: AI_SOURCES_VERSION });
    expect(inserted[0].row.source_list_version).toBe(AI_SOURCES_VERSION);
  });

  it('ignores a version the list has never had', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ v: AI_SOURCES_VERSION + 1 });
    await beacon({ v: '2' });
    expect(inserted.map((i) => i.row.source_list_version)).toEqual([null, null]);
  });

  // #1283: ChatGPT Shopping's product cards link to feed URLs tagged utm_medium=feed.
  it('stores a ChatGPT visit from a feed link as ChatGPT, surface shopping, with the list version', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({
      u: 'https://acme.example/p/mug?utm_source=chatgpt.com&utm_medium=feed',
      r: '',
      s: 'chatgpt.com',
      v: AI_SOURCES_VERSION,
    });
    expect(inserted[0].row).toMatchObject({
      url: 'https://acme.example/p/mug?utm_source=chatgpt.com&utm_medium=feed',
      source_platform: 'chatgpt.com',
      source_surface: 'shopping',
      source_list_version: AI_SOURCES_VERSION,
    });
    // Still ChatGPT's visit: a reload continues it like any other.
    expect(findVisitOf).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePlatform: 'chatgpt.com' }),
    );
  });

  it("reads the surface from the landing URL, so an older snippet's feed visits count too", async () => {
    findVisitOf.mockResolvedValue(null);
    // A cached older snippet: the host it matched, no list version.
    await beacon({ u: 'https://acme.example/p?UTM_MEDIUM=Feed', s: 'chat.openai.com' });
    // A ChatGPT answer's link.
    await beacon({ u: 'https://acme.example/p?utm_source=chatgpt.com', s: 'chatgpt.com' });
    // Another medium, or a feed link from another source.
    await beacon({ u: 'https://acme.example/p?utm_medium=email', s: 'chatgpt.com' });
    await beacon({ u: 'https://acme.example/p?utm_medium=feed', s: 'perplexity.ai' });
    expect(inserted.map((i) => [i.row.source_platform, i.row.source_surface])).toEqual([
      ['chatgpt.com', 'shopping'],
      ['chatgpt.com', null],
      ['chatgpt.com', null],
      ['perplexity.ai', null],
    ]);
  });

  it('keeps a platform the list does not know as it was sent', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ s: 'some-new-assistant.example' });
    expect(inserted[0].row.source_platform).toBe('some-new-assistant.example');
  });

  it("stores the landing page's status, or whether its title said not found (AT-012)", async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ st: 404, nf: 0 });
    // Safari: no status, and the title said "not found".
    await beacon({ st: 0, nf: 1 });
    // A 2xx whose title said not found: a soft 404 (00200).
    await beacon({ st: 200, nf: 1 });
    // Any other status wins over the title.
    await beacon({ st: 301, nf: 1 });
    await beacon({ st: 404, nf: 1 });
    // An older snippet sends neither.
    await beacon();
    expect(inserted.map((i) => [i.row.http_status, i.row.not_found_title])).toEqual([
      [404, false],
      [null, true],
      [200, true],
      [301, false],
      [404, false],
      [null, false],
    ]);
  });

  it('ignores a status no response could have', async () => {
    findVisitOf.mockResolvedValue(null);
    await beacon({ st: 99 });
    await beacon({ st: 600 });
    await beacon({ st: '404' });
    await beacon({ st: 404.5, nf: 'yes' });
    expect(inserted.map((i) => [i.row.http_status, i.row.not_found_title])).toEqual([
      [null, false],
      [null, false],
      [null, false],
      [null, false],
    ]);
  });

  it('logs a write the database refuses', async () => {
    const { default: logger } = await import('../lib/logger.js');
    findVisitOf.mockResolvedValue(null);
    insertError = { message: 'column "source_list_version" does not exist' };
    const res = await beacon();
    expect(res.status).toBe(204);
    expect(logger.error).toHaveBeenCalledWith({ err: insertError }, 'traffic track insert failed');
  });

  // gkhngyk on #1247: the visit's beacon goes at once again; a single-page
  // app's not-found title, read after load, marks that pageview.
  it("marks the visit's pageview when the app shows its not-found page later, without counting a visit", async () => {
    latestPageview = { id: 'pv9' };
    const res = await beacon({ k: 'nf', st: 200 });
    expect(res.status).toBe(204);
    expect(inserted).toEqual([]);
    expect(findVisitOf).not.toHaveBeenCalled();
    expect(filters).toEqual(
      expect.arrayContaining([
        ['eq', 'url', 'https://acme.example/menu'],
        ['eq', 'visitor_key', 'vk-b1'],
        ['eq', 'user_agent', 'Mozilla/5.0'],
        ['eq', 'http_status', 200],
        ['eq', 'not_found_title', false],
      ]),
    );
    expect(filters.find(([op]) => op === 'gte')?.[1]).toBe('created_at');
    expect(updated).toEqual([
      { table: 'ai_traffic_logs', fields: { not_found_title: true }, id: 'pv9' },
    ]);
  });

  it('marks nothing without a recent pageview to mark, or for a status that says it all', async () => {
    await beacon({ k: 'nf', st: 200 });
    expect(updated).toEqual([]);

    // A 404 says it all: no lookup at all.
    latestPageview = { id: 'pv9' };
    const lookedUp = filters.length;
    await beacon({ k: 'nf', st: 404 });
    expect(updated).toEqual([]);
    expect(filters).toHaveLength(lookedUp);

    // Safari reports no status: the pageview has none either.
    filters.length = 0;
    await beacon({ k: 'nf', st: 0 });
    expect(filters).toContainEqual(['is', 'http_status', null]);
    expect(updated).toHaveLength(1);
    expect(inserted).toEqual([]);
  });

  it('reads an application/json beacon itself, as text, without the server-wide JSON parser', async () => {
    findVisitOf.mockResolvedValue(null);
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.7' },
      body: JSON.stringify({
        u: 'https://acme.example/menu',
        s: 'gemini.google.com',
        a: 'Mozilla/5.0',
      }),
    });
    expect(res.status).toBe(204);
    expect(inserted[0].row).toMatchObject({ url: 'https://acme.example/menu' });
  });

  it('refuses a body over 64 KB, whatever its type, before reading it all', async () => {
    for (const type of ['text/plain', 'application/json']) {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': type, 'X-Forwarded-For': '203.0.113.7' },
        body: JSON.stringify({
          u: 'https://acme.example/',
          s: 'gemini.google.com',
          pad: 'x'.repeat(70_000),
        }),
      });
      expect(res.status, type).toBe(413);
    }
    expect(inserted).toEqual([]);
  });
});

/**
 * Once the plan has ended (2026-10-27): a beacon is answered as a stored one
 * is, so the site's snippet never errors, and nothing is written.
 */
describe('POST /track/:trackingCode once the plan has ended', () => {
  it('stores no visit, no not-found mark and no journey event, and answers 204', async () => {
    isOrgActiveCached.mockResolvedValue(false);
    conversionsRead = { data: { conversions_enabled: true }, error: null };
    latestPageview = { id: 'pv1' };

    expect((await beacon()).status).toBe(204);
    expect((await beacon({ k: 'nf', nf: 1 })).status).toBe(204);
    expect((await beacon({ k: 'cv', id: 'Vq3xT0mZ8kLp2RwYbN5sQa', g: 'demo' })).status).toBe(204);

    expect(isOrgActiveCached).toHaveBeenCalledWith('o1');
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
    expect(findVisitOf).not.toHaveBeenCalled();
    expect(visitorKey).not.toHaveBeenCalled();
    // Only the brand's own read: not its conversions setting.
    expect(brandFilters.filter(([columns]) => columns === 'conversions_enabled')).toEqual([]);
    expect(brandFilters).toContainEqual([
      'id, organization_id',
      'eq',
      'tracking_code',
      'abcdef123',
    ]);
  });

  it('stores the visit for an organization on a plan', async () => {
    expect((await beacon()).status).toBe(204);
    expect(inserted.map(({ table }) => table)).toEqual(['ai_traffic_logs']);
  });

  it('stores the visit as usual when it cannot tell: a beacon is never sent again', async () => {
    isOrgActiveCached.mockRejectedValue(new Error('organizations read: timeout'));
    expect((await beacon()).status).toBe(204);
    expect(inserted.map(({ table }) => table)).toEqual(['ai_traffic_logs']);
  });

  it('answers a bad body alike whether the plan is on or not, asking nothing', async () => {
    const post = (body) =>
      fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
      });
    const answers = async () => [
      (await post('{not json')).status,
      (await post(JSON.stringify({ s: 'chatgpt.com' }))).status,
    ];

    const onPlan = await answers();
    isOrgActiveCached.mockResolvedValue(false);
    const ended = await answers();

    expect(onPlan).toEqual([400, 400]);
    expect(ended).toEqual(onPlan);
    expect(isOrgActiveCached).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });
});

describe('POST /track/:trackingCode: a journey’s events (CE-017)', () => {
  const ID = 'Vq3xT0mZ8kLp2RwYbN5sQa';
  const event = (body) =>
    fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'X-Forwarded-For': '203.0.113.7' },
      body: JSON.stringify({
        id: ID,
        u: 'https://acme.example/thanks?email=ann@example.com',
        f: { s: 'chatgpt.com', u: 'https://acme.example/blog/crm', at: Date.now() - 60_000 },
        ...body,
      }),
    });

  it('stores a pageview and a conversion for a brand with conversions on, never as a visit', async () => {
    conversionsRead = { data: { conversions_enabled: true }, error: null };
    expect((await event({ k: 'pv' })).status).toBe(204);
    expect((await event({ k: 'cv', g: 'demo', o: 'form', n: 'pricing-demo' })).status).toBe(204);
    expect(inserted.map(({ table }) => table)).toEqual(['ai_traffic_events', 'ai_traffic_events']);
    expect(inserted[0].row).toMatchObject({
      brand_id: 'b1',
      visitor_id: ID,
      kind: 'page',
      // No query string: the email never gets in.
      url: 'https://acme.example/thanks',
      first_source: 'chatgpt.com',
    });
    expect(inserted[1].row).toMatchObject({
      kind: 'conversion',
      goal: 'demo',
      origin: 'form',
      label: 'pricing-demo',
    });
    // Neither is an AI landing: no visit lookup, no visitor key.
    expect(findVisitOf).not.toHaveBeenCalled();
    expect(visitorKey).not.toHaveBeenCalled();
    // The setting is read for this brand, by its own read.
    expect(brandFilters).toContainEqual(['conversions_enabled', 'eq', 'id', 'b1']);
  });

  it('fails only the events when the setting can’t be read (a server before 00286), never the visits', async () => {
    conversionsRead = {
      data: null,
      error: { message: 'column brands.conversions_enabled does not exist' },
    };
    const { default: logger } = await import('../lib/logger.js');
    vi.mocked(logger.error).mockClear();
    expect((await event({ k: 'cv', g: 'signup' })).status).toBe(204);
    expect(inserted).toEqual([]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    // A visit reads the brand's id only, and is stored as ever.
    expect((await beacon()).status).toBe(204);
    expect(inserted.map(({ table }) => table)).toEqual(['ai_traffic_logs']);
  });

  it('stores nothing while the brand has conversions off', async () => {
    expect((await event({ k: 'cv', g: 'signup' })).status).toBe(204);
    expect(inserted).toEqual([]);
  });

  it('stores nothing it can’t credit to an AI visit, and doesn’t read the brand for it', async () => {
    conversionsRead = { data: { conversions_enabled: true }, error: null };
    await event({ k: 'pv', f: { s: 'google.com', u: 'https://acme.example/', at: Date.now() } });
    await event({ k: 'cv' });
    expect(inserted).toEqual([]);
    expect(brandFilters.filter(([columns]) => columns === 'conversions_enabled')).toEqual([]);
  });

  it('stores no more for a visitor id past its limits: pageviews in the window, conversions a day', async () => {
    conversionsRead = { data: { conversions_enabled: true }, error: null };
    earlierEvents = 299;
    await event({ k: 'pv' });
    expect(inserted).toHaveLength(1);
    // Read for this brand, visitor and kind, over the attribution window.
    expect(eventFilters).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id', 'b1'],
        ['eq', 'visitor_id', ID],
        ['eq', 'kind', 'page'],
      ]),
    );
    const since = Date.parse(eventFilters.find(([op]) => op === 'gte')[2]);
    expect(Date.now() - since).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    earlierEvents = 300;
    await event({ k: 'pv' });
    expect(inserted).toHaveLength(1);

    eventFilters.length = 0;
    earlierEvents = 10;
    await event({ k: 'cv', g: 'signup' });
    expect(inserted).toHaveLength(1);
    expect(eventFilters).toContainEqual(['eq', 'kind', 'conversion']);
    earlierEvents = 9;
    await event({ k: 'cv', g: 'signup' });
    expect(inserted).toHaveLength(2);
  });

  it('counts an order sent again once, without logging it as a failure', async () => {
    conversionsRead = { data: { conversions_enabled: true }, error: null };
    const { default: logger } = await import('../lib/logger.js');
    vi.mocked(logger.error).mockClear();
    eventInsertError = { code: '23505', message: 'duplicate key value' };
    expect(
      (await event({ k: 'cv', g: 'order', o: 'shopify', ref: '1001', val: 59, cur: 'USD' })).status,
    ).toBe(204);
    expect(logger.error).not.toHaveBeenCalled();
    eventInsertError = { code: '42501', message: 'permission denied' };
    await event({ k: 'cv', g: 'order', o: 'shopify', ref: '1002' });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
