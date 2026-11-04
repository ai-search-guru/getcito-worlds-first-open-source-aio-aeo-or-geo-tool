import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';

/**
 * The demo brand is read-only (00380): a signed-in person's writes that name
 * a demo brand are refused with 402 demo_brand, whatever the plan; every
 * write route under /api is either guarded or open with a reason.
 */

const reads = [];
let rows;
let failWith = null;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const read = { table };
      reads.push(read);
      const chain = {
        select: (columns) => {
          read.columns = columns;
          return chain;
        },
        in: (column, ids) => {
          read.ids = ids;
          read.wanted = new Set(ids);
          return chain;
        },
        then: (resolve, reject) =>
          Promise.resolve(
            failWith
              ? { data: null, error: { message: failWith } }
              : {
                  data: (rows[table] ?? []).filter((row) => read.wanted.has(row.id)),
                  error: null,
                },
          ).then(resolve, reject),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const {
  DEMO_BRAND,
  DEMO_GUARDED,
  DEMO_OPEN,
  MAX_CACHED_BRANDS,
  MAX_IDS,
  clearDemoBrandCache,
  demoRouteFor,
  isDemoBrand,
  isDemoBrandRow,
  refuseDemoBrandWrites,
} = await import('./demoBrand.js');

// Seeded ids, as the demo's are: GUID-shaped, not RFC 4122 versions.
const DEMO = '00000000-0000-0000-0000-00000000de30';
const REAL = '11111111-1111-1111-1111-111111111111';
const DEMO_DRAFT = '00000000-0000-0000-0000-0000000d4af7';
const REAL_DRAFT = '11111111-1111-1111-1111-1111111d4af7';
const DEMO_PROMPT = '00000000-0000-0000-0000-0000000000a1';
const DEMO_TASK = '00000000-0000-0000-0000-00000000005a';
const DEMO_OPP = '00000000-0000-0000-0000-0000000000b1';
const REAL_OPP = '11111111-1111-1111-1111-1111111111b1';
const MISSING = '22222222-2222-2222-2222-222222222222';

function makeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

async function run({ method = 'POST', path, body = {}, query = {}, log } = {}) {
  const res = makeRes();
  const next = vi.fn();
  await refuseDemoBrandWrites({ method, path, body, query, log }, res, next);
  return { res, next };
}

function expectRefused({ res, next }, label) {
  expect(next, label).not.toHaveBeenCalled();
  expect(res.status, label).toHaveBeenCalledWith(402);
  expect(res.json, label).toHaveBeenCalledWith(DEMO_BRAND);
}

function expectPassed({ res, next }, label) {
  expect(next, label).toHaveBeenCalledOnce();
  expect(res.status, label).not.toHaveBeenCalled();
}

beforeEach(() => {
  reads.length = 0;
  failWith = null;
  clearDemoBrandCache();
  rows = {
    brands: [
      { id: DEMO, is_demo: true },
      { id: REAL, is_demo: false },
    ],
    content_drafts: [
      { id: DEMO_DRAFT, brand_id: DEMO },
      { id: REAL_DRAFT, brand_id: REAL },
    ],
    content_opportunities: [
      { id: DEMO_OPP, brand_id: DEMO },
      { id: REAL_OPP, brand_id: REAL },
    ],
    prompts: [{ id: DEMO_PROMPT, prompt_sets: { brand_id: DEMO } }],
    action_tasks: [{ id: DEMO_TASK, actions: { brand_id: DEMO } }],
  };
});

describe('refuseDemoBrandWrites', () => {
  it('refuses a write naming a demo brand in the path, the body or the query', async () => {
    expectRefused(await run({ path: `/prompts/suggestions/${DEMO}/refresh` }), 'path');
    expectRefused(await run({ path: '/tracking/check', body: { brandId: DEMO } }), 'body');
    expectRefused(
      await run({ path: '/catalog/upload', query: { brandId: DEMO, format: 'csv' } }),
      'query',
    );
    expect(DEMO_BRAND).toEqual({
      success: false,
      error: 'plan_limit',
      code: 'demo_brand',
      message:
        'This is the demo brand, with sample data to explore. Choose a plan to do this for your own brand.',
    });
  });

  it("refuses a write on a demo brand's row, through its brand", async () => {
    expectRefused(
      await run({ path: `/content-drafts/${DEMO_DRAFT}/publish` }),
      'content_drafts by path',
    );
    expectRefused(
      await run({ path: '/content-pages/claims', body: { draftId: DEMO_DRAFT } }),
      'content_drafts by body',
    );
    expectRefused(await run({ path: `/prompts/${DEMO_PROMPT}/improve` }), 'prompts');
    expectRefused(await run({ path: `/action-center/tasks/${DEMO_TASK}/check` }), 'tasks');
    expectRefused(
      await run({ method: 'PATCH', path: `/content/${DEMO_OPP}/status` }),
      'opportunity',
    );
    expect(reads.find((read) => read.table === 'prompts').columns).toBe(
      'id, prompt_sets!inner(brand_id)',
    );
    expect(reads.find((read) => read.table === 'action_tasks').columns).toBe(
      'id, actions!inner(brand_id)',
    );
  });

  it('refuses a bulk write when any of its rows is a demo brand’s', async () => {
    expectRefused(
      await run({ path: '/content/bulk/status', body: { ids: [REAL_OPP, DEMO_OPP] } }),
      'bulk',
    );
    // /content/bulk/send-webhook is the bulk route, not /content/:id/send-webhook.
    expectRefused(
      await run({ path: '/content/bulk/send-webhook', body: { ids: [DEMO_OPP] } }),
      'bulk send',
    );
  });

  it('refuses a demo brand named in any form Postgres reads as its uuid', async () => {
    const bare = DEMO.replace(/-/g, '');
    for (const id of [
      DEMO.toUpperCase(),
      bare,
      `{${DEMO}}`,
      `{${bare.toUpperCase()}}`,
      `${bare.slice(0, 4)}-${bare.slice(4, 8)}-${bare.slice(8)}`,
    ]) {
      expectRefused(await run({ path: '/tracking/check', body: { brandId: id } }), id);
      expectRefused(await run({ path: `/prompts/suggestions/${id}/refresh` }), `path ${id}`);
    }
    expectRefused(
      await run({ path: '/content/bulk/delete', body: { ids: [DEMO_OPP.replace(/-/g, '')] } }),
      'bare row id',
    );
    // Not uuids, to Postgres either: left to the route.
    for (const id of [`{${DEMO}`, `${DEMO}0`, ` ${DEMO}`]) {
      expectPassed(await run({ path: '/tracking/check', body: { brandId: id } }), id);
    }
  });

  it('refuses a bulk write naming more ids than it checks, wherever the demo row is', async () => {
    const ids = [...Array.from({ length: MAX_IDS }, () => REAL_OPP), DEMO_OPP];
    const { res, next } = await run({ path: '/content/bulk/delete', body: { ids } });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(reads).toEqual([]);
    expectPassed(
      await run({ path: '/content/bulk/delete', body: { ids: ids.slice(0, MAX_IDS) } }),
      'at the cap',
    );
  });

  it('refuses when either of two sources names a demo brand', async () => {
    // A real brand in the body, a demo draft in the path.
    expectRefused(
      await run({ path: `/content-drafts/${DEMO_DRAFT}/write`, body: { brandId: REAL } }),
      'draft',
    );
    expectPassed(
      await run({ path: `/content-drafts/${REAL_DRAFT}/write`, body: { brandId: REAL } }),
      'real draft',
    );
  });

  it("lets a real brand's writes through", async () => {
    expectPassed(await run({ path: '/tracking/check', body: { brandId: REAL } }), 'body');
    expectPassed(await run({ path: `/content/${REAL_OPP}/brief` }), 'row');
    expectPassed(await run({ method: 'DELETE', path: `/cms/brands/${REAL}/webflow` }), 'path');
  });

  it('lets reads through without reading anything', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expectPassed(await run({ method, path: `/prompts/suggestions/${DEMO}/refresh` }), method);
    }
    expect(reads).toEqual([]);
  });

  it('lets the open routes and unknown routes through without reading anything', async () => {
    for (const [method, path] of [
      ['POST', '/demo'],
      ['PATCH', '/demo'],
      ['DELETE', `/brands/${DEMO}`],
      ['DELETE', `/tracking/job/${MISSING}`],
      ['POST', `/content-drafts/${DEMO_DRAFT}/stop`],
      ['POST', '/prompts/fanout-intents'],
      ['POST', '/nowhere'],
    ]) {
      expectPassed(await run({ method, path, body: { brandId: DEMO } }), `${method} ${path}`);
    }
    expect(reads).toEqual([]);
  });

  it('leaves a missing row, a missing brand or a malformed id to the route', async () => {
    expectPassed(await run({ path: `/content/${MISSING}/brief` }), 'missing row');
    expectPassed(await run({ path: '/tracking/check', body: { brandId: MISSING } }), 'missing');
    expectPassed(await run({ path: '/tracking/check', body: {} }), 'none');
    expectPassed(await run({ path: '/tracking/check', body: { brandId: 'demo' } }), 'malformed');
    expectPassed(await run({ path: '/content/bulk/delete', body: { ids: 'nope' } }), 'not ids');
    // Org-wide syncs name no brand: the sync itself skips demo brands.
    expectPassed(await run({ path: '/integrations/google-search-console/sync' }), 'org sync');
  });

  it('answers 500 and never lets the write through when it cannot tell', async () => {
    failWith = 'timeout';
    const log = { error: vi.fn() };
    const { res, next } = await run({ path: '/tracking/check', body: { brandId: DEMO }, log });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('matches paths as Express does: any case, with or without a trailing slash', async () => {
    expectRefused(await run({ path: '/Tracking/Check/', body: { brandId: DEMO } }), 'case');
  });

  it('reads a percent-encoded id in the path as Express hands it to the route', async () => {
    // %30 is "0": the route acts on the demo brand's id.
    const encoded = (id) => `%30${id.slice(1)}`;
    expectRefused(
      await run({ path: `/prompts/suggestions/${encoded(DEMO)}/refresh` }),
      'brand in the path',
    );
    expectRefused(
      await run({ path: `/content-drafts/${encoded(DEMO_DRAFT)}/publish` }),
      'row in the path',
    );
    expectPassed(
      await run({ path: `/content-drafts/${encoded(REAL_DRAFT)}/publish` }),
      'a real brand’s row',
    );
  });

  it('refuses a path param that isn’t valid percent-encoding, as Express does', async () => {
    const { res, next } = await run({ path: '/prompts/suggestions/%E0%A4%A/refresh' });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'invalid',
      message: 'Invalid path',
    });
  });
});

describe('isDemoBrand', () => {
  it('remembers each brand for good: a brand never turns into a demo brand or back', async () => {
    expect(await isDemoBrand([REAL, DEMO])).toBe(true);
    expect(await isDemoBrand(REAL)).toBe(false);
    expect(await isDemoBrand(DEMO)).toBe(true);
    expect(reads).toHaveLength(1);
    // A missing brand isn't remembered.
    expect(await isDemoBrand(MISSING)).toBe(false);
    expect(await isDemoBrand(MISSING)).toBe(false);
    expect(reads).toHaveLength(3);
  });

  it('reads nothing for no ids or malformed ones', async () => {
    expect(await isDemoBrand([])).toBe(false);
    expect(await isDemoBrand([null, 'x'])).toBe(false);
    expect(reads).toEqual([]);
  });

  it('forgets the oldest brand first once full', async () => {
    const ids = Array.from(
      { length: MAX_CACHED_BRANDS },
      (_, i) => `33333333-3333-3333-3333-${String(i).padStart(12, '0')}`,
    );
    rows.brands.push(...ids.map((id) => ({ id, is_demo: false })));
    await isDemoBrand(DEMO);
    // A call looks at 500 ids at most.
    for (let i = 0; i < ids.length; i += 500) await isDemoBrand(ids.slice(i, i + 500));
    reads.length = 0;
    await isDemoBrand(ids[ids.length - 1]);
    expect(reads).toHaveLength(0);
    await isDemoBrand(DEMO);
    expect(reads).toHaveLength(1);
  });
});

describe('isDemoBrandRow', () => {
  it('tells whether a row belongs to a demo brand, through its brand', async () => {
    expect(await isDemoBrandRow('content_opportunities', DEMO_OPP)).toBe(true);
    expect(await isDemoBrandRow('content_opportunities', REAL_OPP)).toBe(false);
    expect(await isDemoBrandRow('prompts', DEMO_PROMPT)).toBe(true);
    expect(await isDemoBrandRow('content_opportunities', MISSING)).toBe(false);
  });
});

/**
 * The internal endpoints the MCP calls trust CRON_SECRET and never meet the
 * middleware (server.js mounts them before /api). server.js can't be
 * imported here, so each one is read: it answers a demo brand with 402
 * demo_brand before it starts its work.
 */
describe("the MCP's internal endpoints", () => {
  it('refuse a demo brand before the work starts', async () => {
    const source = await readFile(new URL('../apiServer.js', import.meta.url), 'utf8');
    const handler = (route) => {
      const start = source.indexOf(`app.post('${route}'`);
      expect(start, route).toBeGreaterThan(0);
      return source.slice(start, source.indexOf('\n});\n', start));
    };
    for (const [route, check, work] of [
      [
        '/api/internal/content/:id/brief',
        "isDemoBrandRow('content_opportunities', id)",
        'generateBriefForOpportunity(',
      ],
      ['/api/internal/site-audits', 'isDemoBrand(brandId)', 'startSiteAuditForBrand('],
      [
        '/api/internal/prompts/:promptId/improve/action',
        "isDemoBrandRow('prompts', req.params.promptId)",
        'sendImproveActionForKeyUser(',
      ],
      [
        '/api/internal/content-drafts/:draftId/publish',
        "isDemoBrandRow('content_drafts', draftId.data)",
        'publishDraftForKeyUser(',
      ],
    ]) {
      const body = handler(route);
      expect(body.indexOf(check), route).toBeGreaterThan(0);
      expect(body.indexOf(check), route).toBeLessThan(body.indexOf(work));
      expect(body, route).toMatch(/res\.status\(402\)\.json\(DEMO_BRAND\)/);
    }
  });
});

/**
 * Every write route under /api, read from the route files as routes/index.js
 * mounts them: each is guarded or open with a reason, never both, and each
 * entry names a route that exists.
 */
describe('coverage of the write routes', () => {
  const routesDir = new URL('../routes/', import.meta.url);

  async function writeRoutes() {
    const index = await readFile(new URL('index.js', routesDir), 'utf8');
    const files = new Map(
      [...index.matchAll(/^import (\w+) from '\.\/([\w-]+\.js)';$/gm)].map((m) => [m[1], m[2]]),
    );
    const mounts = [...index.matchAll(/^router\.use\('([^']+)', (\w+)\);$/gm)];
    expect(mounts.length).toBeGreaterThan(15);
    const routes = [];
    for (const [, prefix, name] of mounts) {
      const source = await readFile(new URL(files.get(name), routesDir), 'utf8');
      // Every route is router.<method>(path, …): no router.all or router.route
      // this reading would miss.
      expect(source, files.get(name)).not.toMatch(/router\.(all|route)\(/);
      for (const m of source.matchAll(/^router\.(post|put|patch|delete)\(\s*'([^']*)'/gm)) {
        const path = m[2] === '/' ? prefix : `${prefix}${m[2]}`;
        routes.push(`${m[1].toUpperCase()} ${path}`);
      }
    }
    return routes;
  }

  it('names every write route once, as guarded or as open', async () => {
    const routes = await writeRoutes();
    const guarded = DEMO_GUARDED.map((entry) => entry.route);
    const opened = DEMO_OPEN.map((entry) => entry.route);

    const unnamed = routes.filter((route) => !guarded.includes(route) && !opened.includes(route));
    expect(unnamed, 'write routes neither guarded nor open: add them to demoBrand.js').toEqual([]);
    const stale = [...guarded, ...opened].filter((route) => !routes.includes(route));
    expect(stale, 'entries naming no route').toEqual([]);
    expect(guarded.filter((route) => opened.includes(route))).toEqual([]);
    expect(new Set(guarded).size).toBe(guarded.length);
    expect(new Set(opened).size).toBe(opened.length);
    expect(routes.length).toBe(guarded.length + opened.length);
  });

  it('gives every open route a reason', () => {
    for (const entry of DEMO_OPEN) expect(entry.why.length, entry.route).toBeGreaterThan(20);
  });

  it('reads each guarded brand from a part of the request the route has', () => {
    for (const { route, sources } of DEMO_GUARDED) {
      expect(sources.length, route).toBeGreaterThan(0);
      for (const source of sources) {
        expect(['path', 'body', 'query'], route).toContain(source.where);
        if (source.where === 'path') expect(route, route).toContain(`/:${source.key}`);
      }
    }
  });

  it('reaches, for each route, its own entry', async () => {
    const routes = await writeRoutes();
    const sample = (route) => route.replace(/:\w+/g, MISSING).split(' ');
    for (const route of routes) {
      const [method, path] = sample(route);
      expect(demoRouteFor({ method, path })?.entry.route, route).toBe(route);
    }
  });

  it('leaves the routes of webhooks, callbacks and public beacons to their own mounts', async () => {
    const files = (await readdir(routesDir)).filter(
      (file) => file.endsWith('.js') && !file.endsWith('.test.js'),
    );
    const index = await readFile(new URL('index.js', routesDir), 'utf8');
    const outside = files.filter(
      (file) => file !== 'index.js' && !index.includes(`from './${file}'`),
    );
    expect(outside.sort()).toEqual([
      'botIngest.js',
      'cloroCallback.js',
      // Chat's budget holds (CRON_SECRET, called by the web's engine): keyed by run, no brand.
      'internalChatBudget.js',
      // An agent's go-live step (CRON_SECRET, called by the web's engine): refuses a demo brand itself.
      'internalChatGoLive.js',
      // Chat's model menu (CRON_SECRET, called by the web's Chat): a read, no brand.
      'internalChatModels.js',
      // Chat's notices to Admins (CRON_SECRET, called by the web): a workspace's key, no brand.
      'internalChatNotices.js',
      // Chat's page reads (CRON_SECRET, called by the web's engine): a public URL, no brand.
      'internalChatPages.js',
      // The first run after a payment (CRON_SECRET): refuses a demo brand itself.
      'internalTriggerTracking.js',
      // The free report card's form on www.getcito.com: no sign-in and no brand (00472).
      'publicReportCard.js',
      'traffic.js',
      'webhookContentCallback.js',
      'webhookContentDraftCallback.js',
    ]);
  });
});
