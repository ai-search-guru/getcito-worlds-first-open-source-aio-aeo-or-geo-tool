import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for the Opportunities inbox: GET /api/audits/opportunities
 * reads the GA page opportunities, site pages, audits and pins/exclusions,
 * adds each page's AI visits, and PUT /api/audits/opportunities/prefs pins,
 * excludes or clears pages, for admins and managers only.
 */

let tables;
let rpcCalls;
let writes;
let server;
let baseUrl;
// The brand access check (#1888): the brand, or a refusal for a person
// without it.
let brandAccess;

function query(table) {
  const filters = {};
  let write = null;
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters[col] = val;
      return builder;
    },
    is: () => builder,
    in: (col, vals) => {
      filters[col] = vals;
      return builder;
    },
    order: () => builder,
    range: (from, to) => {
      filters.range = [from, to];
      return builder;
    },
    limit: () => builder,
    single: () => {
      builder.one = true;
      return builder;
    },
    maybeSingle: () => {
      builder.one = true;
      return builder;
    },
    upsert: (rows, opts) => {
      write = { op: 'upsert', rows, opts };
      return builder;
    },
    delete: () => {
      write = { op: 'delete' };
      return builder;
    },
    then: (resolve) => {
      if (write) {
        writes.push({ table, ...write, filters: { ...filters } });
        return resolve({ data: null, error: null });
      }
      let data = (tables[table] ?? []).filter(
        (r) => !r.brand_id || r.brand_id === filters.brand_id,
      );
      // PostgREST's max_rows: a read without a range stops at 1000 rows.
      data = filters.range
        ? data.slice(filters.range[0], filters.range[1] + 1)
        : data.slice(0, 1000);
      if (table === 'brands') data = (tables.brands ?? []).find((b) => b.id === filters.id) ?? null;
      else if (builder.one) data = data[0] ?? null;
      return resolve({ data, error: null });
    },
  };
  return builder;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({
    default: {
      from: (t) => query(t),
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'audit_competitor_cited_prompts') {
          if (tables.competitorPromptsMissing) {
            return { data: null, error: { code: 'PGRST202', message: 'not found' } };
          }
          return { data: tables.competitorPrompts ?? [], error: null };
        }
        // A test may make the AI visits step take a while.
        tables.onVisits?.();
        return {
          data: {
            analytics: [{ page: args.p_pages[0], platform: 'chatgpt', cur_sessions: 7 }],
            snippet: [],
          },
          error: null,
        };
      },
    },
  }));
  vi.doMock('../lib/access.js', () => ({ assertBrandAccess: () => brandAccess() }));
  vi.doMock('../lib/planGuard.js', () => ({
    requireFeature: () => (req, res, next) => next(),
    enforceSiteAuditQuota: vi.fn(),
    getSiteAuditQuotaStatus: vi.fn(),
    getOrgIdForUser: vi.fn(),
    PlanLimitError: class PlanLimitError extends Error {},
  }));
  vi.doMock('../lib/audit/context.js', () => ({ buildAuditContext: vi.fn() }));
  vi.doMock('../lib/audit/engine.js', () => ({ runSignals: vi.fn() }));
  vi.doMock('../lib/audit/llmSignals.js', () => ({ evaluateLlmSignals: vi.fn() }));
  vi.doMock('../lib/audit/externalSignals.js', () => ({ evaluateBrandEntity: vi.fn() }));
  vi.doMock('../lib/audit/recommendations.js', () => ({
    brandFactsFor: vi.fn(),
    generateRecommendations: vi.fn(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./audits.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/audits', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/audits`;
}

const brandId = '33333333-3333-3333-3333-333333333333';

beforeEach(async () => {
  brandAccess = async () => ({ orgId: 'org-1' });
  rpcCalls = [];
  writes = [];
  tables = {
    profiles: [{ id: 'u1', role: 'admin' }],
    brands: [{ id: brandId, ga_property_id: 'properties/1' }],
    brand_domains: [{ brand_id: brandId, domain: 'www.acme.com', is_primary: true }],
    page_opportunities: [
      {
        brand_id: brandId,
        landing_page: '/pricing',
        value_signal: 'revenue',
        value_percentile: 96,
        sessions: 800,
        citation_state: 'not_targeted',
        citations: 0,
      },
    ],
    site_pages: [
      {
        brand_id: brandId,
        url: 'https://acme.com/blog',
        title: 'Blog',
        ga_sessions: 30,
        ai_citations: 2,
      },
    ],
    site_audits: [],
    ai_traffic_logs: [],
    site_audit_page_prefs: [
      {
        brand_id: brandId,
        page_key: 'acme.com/blog',
        url: 'https://acme.com/blog',
        state: 'excluded',
      },
    ],
  };
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  vi.doUnmock('../config/supabase.js');
});

describe('GET /api/audits/opportunities', () => {
  it("lists the brand's opportunities with their AI visits, and the excluded pages apart", async () => {
    const res = await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.opportunities).toEqual([
      expect.objectContaining({
        url: 'https://acme.com/pricing',
        path: '/pricing',
        aiVisits: 7,
        reasons: [expect.objectContaining({ type: 'no_ai_traffic', percentile: 96 })],
      }),
    ]);
    expect(body.excluded.map((e) => e.path)).toEqual(['/blog']);
    // Scored once its AI visits are in (SA-005).
    expect(body.opportunities[0]).toMatchObject({
      priority: expect.any(Number),
      priorityParts: { value: 0.96, opportunity: 0.75, ease: 0.8 },
    });
    expect(body.staleDays).toBe(90);
    // How much of the site has a current audit, by the inbox's rules (item 11).
    expect(body.coverage).toEqual({
      pages: expect.any(Number),
      audited: expect.any(Number),
      never: expect.any(Number),
      stale: expect.any(Number),
    });

    // AI visits over the last 30 days, for the listed pages.
    const { name, args } = rpcCalls.find((c) => c.name === 'ae_page_traffic_evidence');
    expect(name).toBe('ae_page_traffic_evidence');
    expect(args.p_pages).toEqual(['https://acme.com/pricing']);
  });

  it('says which step a slow read spent its time on, and nothing for a quick one', async () => {
    const { default: logger } = await import('../lib/logger.js');
    await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    expect(logger.warn).not.toHaveBeenCalled();

    // The clock moves 2.5 s while the AI visits are read.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    tables.onVisits = () => {
      offset += 2500;
    };
    try {
      await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    } finally {
      clock.mockRestore();
    }
    const call = logger.warn.mock.calls.find(
      ([, msg]) => msg === '[audit] slow opportunities inbox read',
    );
    expect(call[0]).toMatchObject({ brandId, rows: 1 });
    expect(call[0].ms.aiVisits).toBeGreaterThanOrEqual(2500);
    expect(call[0].ms.total).toBeGreaterThanOrEqual(call[0].ms.aiVisits);
    expect(call[0].ms).toEqual({
      reads: expect.any(Number),
      competitorsAndTemplates: expect.any(Number),
      aiVisits: expect.any(Number),
      total: expect.any(Number),
    });
  });

  it("leaves out pages under the brand's exclude patterns (SA-006)", async () => {
    tables.site_audit_brand_settings = [{ brand_id: brandId, exclude_patterns: ['/pri*'] }];
    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    expect(body.opportunities).toEqual([]);
  });

  it('reads every GA page past the first 1000', async () => {
    tables.page_opportunities = Array.from({ length: 1200 }, (_, i) => ({
      brand_id: brandId,
      landing_page: `/p${i}`,
      value_signal: 'engagement',
      value_percentile: 75,
      sessions: 20,
      citation_state: null,
      citations: 0,
    }));
    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    expect(body.opportunities).toHaveLength(1200);
  });

  it('leaves AI visits unknown for a brand with neither Analytics nor the snippet', async () => {
    tables.brands = [{ id: brandId, ga_property_id: null }];
    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    expect(body.opportunities[0].aiVisits).toBeNull();
    expect(rpcCalls.map((c) => c.name)).not.toContain('ae_page_traffic_evidence');
  });

  it("adds the pages closest to the prompts a competitor wins and the brand doesn't", async () => {
    tables.competitors = [
      { brand_id: brandId, name: 'Crema Club', domain: 'https://www.Crema.example/' },
      { brand_id: brandId, name: 'No domain', domain: '' },
    ];
    tables.site_pages.push({
      brand_id: brandId,
      url: 'https://acme.com/subscriptions',
      title: 'Coffee subscription plans',
      h1: 'Coffee subscriptions',
      description: null,
      ga_sessions: 5,
      ai_citations: 0,
    });
    tables.competitorPrompts = [
      {
        prompt_id: 'p1',
        prompt_text: 'best coffee subscription plans',
        results: 6,
        competitor_results: 4,
        own_results: 0,
        competitor_domains: ['crema.example'],
      },
      // Cited on this one too: not a gap.
      {
        prompt_id: 'p2',
        prompt_text: 'coffee subscription plans for offices',
        results: 6,
        competitor_results: 2,
        own_results: 1,
        competitor_domains: ['crema.example'],
      },
    ];
    tables.prompt_target_urls = [];

    const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
    const page = body.opportunities.find((o) => o.path === '/subscriptions');
    expect(page.reasons).toContainEqual({
      type: 'competitor_cited',
      prompts: 1,
      competitors: ['Crema Club'],
    });

    const { args } = rpcCalls.find((c) => c.name === 'audit_competitor_cited_prompts');
    expect(args).toMatchObject({
      p_brand_id: brandId,
      p_own_domains: ['acme.com'],
      p_competitor_domains: ['crema.example'],
    });
  });

  it('lists the other sources on a database without migration 00166', async () => {
    tables.competitors = [{ brand_id: brandId, name: 'Crema Club', domain: 'crema.example' }];
    tables.competitorPromptsMissing = true;
    const res = await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).opportunities.map((o) => o.path)).toEqual(['/pricing']);
  });

  it('asks for no citations without competitor domains', async () => {
    await fetch(`${baseUrl}/opportunities?brandId=${brandId}`);
    expect(rpcCalls.map((c) => c.name)).not.toContain('audit_competitor_cited_prompts');
  });

  describe('templates (SA-007)', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const blogAudit = (id, path, score) => ({
      id,
      brand_id: brandId,
      url: `https://acme.com${path}`,
      final_url: `https://acme.com${path}`,
      status: 'completed',
      total_score: score,
      created_at: recent,
    });
    beforeEach(() => {
      tables.site_pages.push(
        ...['/blog/a', '/blog/b', '/blog/c'].map((path) => ({
          brand_id: brandId,
          url: `https://acme.com${path}`,
          title: null,
          ga_sessions: 10,
          ai_citations: 0,
        })),
      );
      tables.site_audits = [blogAudit('a1', '/blog/a', '0.5'), blogAudit('b1', '/blog/b', '0.6')];
      tables.audit_signal_results = [
        { audit_id: 'a1', signal_key: 'author-byline', status: 'fail' },
        { audit_id: 'b1', signal_key: 'author-byline', status: 'warn' },
      ];
    });

    it('lists a template whose pages share gaps as a row, and eases its pages', async () => {
      const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
      const template = body.opportunities.find((o) => o.key === 'template:/blog/*');
      expect(template).toMatchObject({
        url: null,
        path: '/blog/*',
        reasons: [
          { type: 'template_gaps', gaps: [{ key: 'author-byline', label: 'Author byline' }] },
        ],
        sessions: 30,
        // The AI visits of its pages added up (the stub gives /blog/c 7).
        aiVisits: 7,
        template: { pages: 3, audited: 2, toAudit: ['https://acme.com/blog/c'] },
        priority: expect.any(Number),
      });
      // /blog/c, never audited, gets the template fix on its ease.
      const page = body.opportunities.find((o) => o.path === '/blog/c');
      expect(page.priorityParts.ease).toBe(0.9);
      // The AI visits were asked for the template's pages too, once each.
      const { args } = rpcCalls.find((c) => c.name === 'ae_page_traffic_evidence');
      expect(new Set(args.p_pages).size).toBe(args.p_pages.length);
      expect(args.p_pages).toEqual(expect.arrayContaining(['https://acme.com/blog/a']));
    });

    it('leaves the template row out under an exclude pattern', async () => {
      tables.site_audit_brand_settings = [{ brand_id: brandId, exclude_patterns: ['/blog/*'] }];
      const body = await (await fetch(`${baseUrl}/opportunities?brandId=${brandId}`)).json();
      expect(body.opportunities.map((o) => o.path)).toEqual(['/pricing']);
    });

    it('GET /templates lists the templates with their shared gaps', async () => {
      const res = await fetch(`${baseUrl}/templates?brandId=${brandId}`);
      expect(res.status).toBe(200);
      expect((await res.json()).templates).toEqual([
        expect.objectContaining({
          template: '/blog/*',
          pages: 3,
          audited: 2,
          sharedGaps: [
            { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 2 },
          ],
        }),
      ]);
    });
  });

  it('needs a brand', async () => {
    expect((await fetch(`${baseUrl}/opportunities`)).status).toBe(400);
  });
});

describe('PUT /api/audits/opportunities/prefs', () => {
  const put = (body) =>
    fetch(`${baseUrl}/opportunities/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('pins or excludes pages once per page, by their page key', async () => {
    const res = await put({
      brandId,
      urls: ['https://www.acme.com/Pricing/', 'https://acme.com/pricing', 'https://acme.com/blog'],
      state: 'pinned',
    });
    expect(res.status).toBe(200);
    const [write] = writes;
    expect(write).toMatchObject({
      table: 'site_audit_page_prefs',
      op: 'upsert',
      opts: { onConflict: 'brand_id,page_key' },
    });
    expect(write.rows.map((r) => [r.page_key, r.url, r.state, r.created_by])).toEqual([
      ['acme.com/pricing', 'https://acme.com/pricing', 'pinned', 'u1'],
      ['acme.com/blog', 'https://acme.com/blog', 'pinned', 'u1'],
    ]);
  });

  it('clears pages with a null state', async () => {
    await put({ brandId, urls: ['https://acme.com/blog'], state: null });
    expect(writes).toEqual([
      expect.objectContaining({
        op: 'delete',
        filters: { brand_id: brandId, page_key: ['acme.com/blog'] },
      }),
    ]);
  });

  it('lets a manager pin, and refuses an analyst before writing anything', async () => {
    tables.profiles = [{ id: 'u1', role: 'manager' }];
    expect((await put({ brandId, urls: ['https://acme.com/blog'], state: 'pinned' })).status).toBe(
      200,
    );
    expect(writes).toHaveLength(1);

    writes = [];
    tables.profiles = [{ id: 'u1', role: 'analyst' }];
    for (const state of ['pinned', 'excluded', null]) {
      const res = await put({ brandId, urls: ['https://acme.com/blog'], state });
      expect(res.status).toBe(403);
      expect((await res.json()).message).toBe('Only admins and managers can pin or exclude pages.');
    }
    expect(writes).toEqual([]);
  });

  it('refuses an agency partner, and a manager without access to the brand', async () => {
    tables.profiles = [{ id: 'u1', role: 'agency_partner' }];
    let res = await put({ brandId, urls: ['https://acme.com/blog'], state: 'excluded' });
    expect(res.status).toBe(403);

    tables.profiles = [{ id: 'u1', role: 'manager' }];
    brandAccess = async () => {
      throw Object.assign(new Error("You don't have access to this brand"), {
        status: 403,
        code: 'no_brand_access',
      });
    };
    res = await put({ brandId, urls: ['https://acme.com/blog'], state: 'pinned' });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toBe("You don't have access to this brand");
    expect(writes).toEqual([]);
  });

  it('refuses an unknown state, no URLs or something that is not a URL', async () => {
    expect((await put({ brandId, urls: ['https://acme.com/'], state: 'starred' })).status).toBe(
      400,
    );
    expect((await put({ brandId, urls: [], state: 'pinned' })).status).toBe(400);
    expect((await put({ brandId, urls: ['nope'], state: 'pinned' })).status).toBe(400);
    expect(writes).toEqual([]);
  });
});
