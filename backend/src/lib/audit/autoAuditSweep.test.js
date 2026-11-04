import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The daily auto-audit sweep (SA-006): which orgs run, how many pages, which
 * ones, and what the run records and e-mails.
 */

const NOW = new Date('2026-10-10T06:00:00Z');

let quotas;
let brandRows;
let claimed;
let ops;
let auditRows;
let triedRows;
let failCounts;
let fixedActions;
let actionsError;
let recentAudits;
let domainRows;
let prefRows;
let settingRows;

class PlanLimitError extends Error {}

function query(table) {
  const op = { table, filters: [] };
  const builder = {
    select: (cols, opts) => {
      op.select = cols;
      op.head = opts?.head ?? false;
      return builder;
    },
    upsert: (row, opts) => {
      op.upsert = row;
      op.opts = opts;
      return builder;
    },
    update: (row) => {
      op.update = row;
      return builder;
    },
    eq: (col, val) => {
      op.filters.push(['eq', col, val]);
      return builder;
    },
    in: (col, val) => {
      op.filters.push(['in', col, val]);
      return builder;
    },
    gte: (col, val) => {
      op.filters.push(['gte', col, val]);
      return builder;
    },
    is: (col, val) => {
      op.filters.push(['is', col, val]);
      return builder;
    },
    order: (col) => {
      op.order = [...(op.order ?? []), col];
      return builder;
    },
    limit: () => builder,
    range: (from, to) => {
      op.range = [from, to];
      return builder;
    },
    then: (resolve) => {
      ops.push(op);
      // Fix actions completed lately (learning B7), and the audits since.
      if (table === 'actions') {
        return resolve(actionsError ? { data: null, error: actionsError } : { data: fixedActions });
      }
      if (table === 'brand_domains') return resolve({ data: domainRows, error: null });
      if (table === 'site_audit_page_prefs') {
        return resolve({ data: prefRows.slice(op.range[0], op.range[1] + 1), error: null });
      }
      if (table === 'site_audit_brand_settings') return resolve({ data: settingRows, error: null });
      if (table === 'site_audits' && op.select === 'brand_id, url, final_url, created_at') {
        return resolve({ data: recentAudits.slice(op.range[0], op.range[1] + 1), error: null });
      }
      if (table === 'site_audit_auto_runs' && op.upsert) {
        return resolve({ data: claimed ? [{ id: 'run-1' }] : [], error: null });
      }
      if (table === 'site_audits') {
        // The pages runs tried in the last 30 days, else the run's own audits.
        return resolve({ data: op.select === 'url' ? triedRows : auditRows, error: null });
      }
      if (table === 'audit_signal_results') {
        const ids = op.filters.find(([, col]) => col === 'audit_id')[2];
        return resolve({ count: ids.reduce((n, id) => n + (failCounts[id] ?? 0), 0), error: null });
      }
      return resolve({ data: null, error: null });
    },
  };
  return builder;
}

const auto = (over = {}) => ({
  enabled: true,
  emailAfterRun: true,
  perRun: 5,
  due: { day: 7 },
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  runs: [
    { day: 1, at: '2026-10-01T00:00:00.000Z', done: true },
    { day: 7, at: '2026-10-07T00:00:00.000Z', done: false },
    { day: 14, at: '2026-10-14T00:00:00.000Z', done: false },
    { day: 21, at: '2026-10-21T00:00:00.000Z', done: false },
    { day: 28, at: '2026-10-28T00:00:00.000Z', done: false },
  ],
  ...over,
});

const row = (path, priority, over = {}) => ({
  key: `acme.com${path}`,
  url: `https://acme.com${path}`,
  path,
  pinned: false,
  running: false,
  priority,
  lastAudit: null,
  ...over,
});

const inboxes = {
  'brand-a': [row('/pinned', 10, { pinned: true }), row('/a-90', 90), row('/a-40', 40)],
  'brand-b': [row('/b-80', 80), row('/b-70', 70), row('/b-20', 20)],
};

let sweep;
let sendAutoAuditEmail;
let readInbox;
let startAudits;

beforeEach(async () => {
  vi.resetModules();
  quotas = { 'org-1': { limit: 100, used: 10, running: 0, auto: auto() } };
  brandRows = [
    { id: 'brand-a', name: 'Acme Coffee', organization_id: 'org-1' },
    { id: 'brand-b', name: 'Acme Tea', organization_id: 'org-1' },
  ];
  claimed = true;
  ops = [];
  auditRows = [];
  triedRows = [];
  failCounts = {};
  fixedActions = [];
  actionsError = null;
  recentAudits = [];
  domainRows = [
    { brand_id: 'brand-a', domain: 'acme.com' },
    { brand_id: 'brand-b', domain: 'https://www.acme.com/' },
  ];
  prefRows = [];
  settingRows = [];
  sendAutoAuditEmail = vi.fn().mockResolvedValue(true);
  readInbox = vi.fn(async (brandId) => ({ opportunities: inboxes[brandId] ?? [] }));
  startAudits = vi.fn(async (brandId, urls) => ({
    auditIds: urls.map((u) => `${brandId}:${u.slice('https://acme.com'.length)}`),
    done: Promise.resolve(),
  }));

  vi.doMock('../../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  // The brands stand in; every other read goes through the real paging loop.
  vi.doMock('../rpcPages.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      readAllRpcRows: async (name, page) => {
        if (name !== 'brands') return actual.readAllRpcRows(name, page);
        // The brands' query is built (and recorded) but answered here.
        await page(0, 999);
        return { data: brandRows, error: null };
      },
    };
  });
  vi.doMock('../planGuard.js', () => ({
    PlanLimitError,
    getSiteAuditQuotaStatus: vi.fn(async (orgId) => {
      const quota = quotas[orgId];
      if (quota instanceof Error) throw quota;
      return quota;
    }),
  }));
  vi.doMock('./autoAuditEmail.js', () => ({ sendAutoAuditEmail }));
  ({ sweepAutoAudits: sweep } = await import('./autoAuditSweep.js'));
});

afterEach(() => {
  vi.doUnmock('../../config/supabase.js');
  vi.doUnmock('../rpcPages.js');
  vi.doUnmock('../planGuard.js');
  vi.doUnmock('./autoAuditEmail.js');
});

const run = () => sweep({ readInbox, startAudits, now: NOW });
const runOps = () => ops.filter((op) => op.table === 'site_audit_auto_runs');

describe('sweepAutoAudits', () => {
  it("claims the due run, audits the top pages across the org's brands, records and e-mails it", async () => {
    auditRows = [
      { id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' },
      { id: 'brand-a:/a-90', brand_id: 'brand-a', status: 'completed' },
      { id: 'brand-a:/a-40', brand_id: 'brand-a', status: 'failed' },
      { id: 'brand-b:/b-80', brand_id: 'brand-b', status: 'completed' },
      { id: 'brand-b:/b-70', brand_id: 'brand-b', status: 'completed' },
    ];
    failCounts = { 'brand-a:/pinned': 2, 'brand-a:/a-90': 1, 'brand-b:/b-80': 3 };

    expect(await run()).toEqual({ runs: 1 });

    // Five slots: the pinned page, then priority 90, 80, 70, 40.
    expect(startAudits.mock.calls).toEqual([
      [
        'brand-a',
        ['https://acme.com/pinned', 'https://acme.com/a-90', 'https://acme.com/a-40'],
        'org-1',
      ],
      ['brand-b', ['https://acme.com/b-80', 'https://acme.com/b-70'], 'org-1'],
    ]);
    const [claim, ids, done] = runOps();
    expect(claim.upsert).toEqual({
      organization_id: 'org-1',
      period_start: '2026-10-01T00:00:00.000Z',
      run_day: 7,
      slots: 5,
      started_at: NOW.toISOString(),
    });
    expect(claim.opts).toMatchObject({ ignoreDuplicates: true });
    expect(ids.update.audit_ids).toHaveLength(5);
    // Never a demo brand (00380).
    expect(ops.find((op) => op.table === 'brands').filters).toContainEqual([
      'eq',
      'is_demo',
      false,
    ]);
    expect(done.update).toMatchObject({ status: 'completed', finished_at: expect.any(String) });

    expect(sendAutoAuditEmail).toHaveBeenCalledWith('org-1', {
      brands: [
        // Each brand by its id too: the e-mail lists to each person the brands they see.
        { id: 'brand-a', name: 'Acme Coffee', pages: 3, completed: 2, criticalIssues: 3 },
        { id: 'brand-b', name: 'Acme Tea', pages: 2, completed: 2, criticalIssues: 3 },
      ],
      nextRunAt: '2026-10-14T00:00:00.000Z',
    });
  });

  it("starts every org's run before any of them finishes", async () => {
    brandRows = [
      { id: 'brand-a', name: 'Acme Coffee', organization_id: 'org-1' },
      { id: 'brand-b', name: 'Beta Beans', organization_id: 'org-2' },
    ];
    quotas['org-2'] = { limit: 500, used: 0, running: 0, auto: auto({ perRun: 25 }) };
    let finishFirst;
    startAudits.mockImplementationOnce(async (brandId, urls) => ({
      auditIds: urls,
      done: new Promise((resolve) => {
        finishFirst = resolve;
      }),
    }));

    const sweeping = run();
    await vi.waitFor(() => expect(startAudits).toHaveBeenCalledTimes(2));
    expect(startAudits.mock.calls.map(([brandId]) => brandId)).toEqual(['brand-a', 'brand-b']);
    finishFirst();
    expect(await sweeping).toEqual({ runs: 2 });
  });

  it("skips the pages the org's runs tried in the last 30 days", async () => {
    triedRows = [{ url: 'https://acme.com/a-90' }, { url: 'https://www.acme.com/b-80/' }];
    await run();
    const tried = ops.find((op) => op.table === 'site_audits' && op.select === 'url');
    expect(tried.filters).toEqual(
      expect.arrayContaining([
        ['in', 'brand_id', ['brand-a', 'brand-b']],
        ['eq', 'source', 'auto'],
      ]),
    );
    expect(startAudits.mock.calls.flatMap(([, urls]) => urls)).toEqual([
      'https://acme.com/pinned',
      'https://acme.com/a-40',
      'https://acme.com/b-70',
      'https://acme.com/b-20',
    ]);
  });

  it('starts nothing when auto-audit is off, no run is due, or another sweep claimed it', async () => {
    quotas['org-1'].auto = auto({ enabled: false });
    await run();
    quotas['org-1'].auto = auto({ due: null });
    await run();
    expect(runOps()).toEqual([]);

    quotas['org-1'].auto = auto();
    claimed = false;
    expect(await run()).toEqual({ runs: 0 });
    expect(readInbox).not.toHaveBeenCalled();
    expect(startAudits).not.toHaveBeenCalled();
  });

  it("caps the run at what's left of the quota, and records an empty run without e-mail", async () => {
    quotas['org-1'].used = 98;
    auditRows = [{ id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' }];
    await run();
    expect(runOps()[0].upsert.slots).toBe(2);
    expect(startAudits.mock.calls.map(([brand, urls]) => [brand, urls.length])).toEqual([
      ['brand-a', 2],
    ]);

    ops = [];
    startAudits.mockClear();
    quotas['org-1'].used = 100;
    await run();
    expect(runOps().map((op) => op.upsert?.slots ?? op.update?.status)).toEqual([0, 'completed']);
    expect(startAudits).not.toHaveBeenCalled();
    expect(sendAutoAuditEmail).toHaveBeenCalledTimes(1);
  });

  it('e-mails only when the org asked, and skips an org without a subscription', async () => {
    quotas['org-1'].auto = auto({ emailAfterRun: false });
    auditRows = [{ id: 'brand-a:/pinned', brand_id: 'brand-a', status: 'completed' }];
    await run();
    expect(runOps().at(-1).update).toMatchObject({ status: 'completed' });
    expect(sendAutoAuditEmail).not.toHaveBeenCalled();

    ops = [];
    quotas['org-1'] = new PlanLimitError('An active subscription or free trial is required.');
    expect(await run()).toEqual({ runs: 0 });
    expect(runOps()).toEqual([]);
  });
});

/**
 * Pages a Site Audit fix was completed on lately and no audit has read
 * since (learning B7): the run takes them first.
 */
describe('fixedPages', () => {
  it("reads the fixes' pages not audited since, the newest fix first, and the run takes them first", async () => {
    fixedActions = [
      {
        brand_id: 'brand-b',
        completed_at: '2026-10-09T10:00:00Z',
        payload: { targets: [{ id: 'https://acme.com/b-fixed' }, { id: 'acme.com' }] },
      },
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-05T10:00:00Z',
        payload: {
          targets: [{ id: 'https://acme.com/a-fixed' }],
          targetIds: ['https://acme.com/a-checked', 'https://acme.com/a-fixed'],
        },
      },
    ];
    // Audited after its fix: done. Audited before it: still due.
    recentAudits = [
      {
        brand_id: 'brand-a',
        url: 'https://acme.com/a-checked',
        final_url: null,
        created_at: '2026-10-06T00:00:00Z',
      },
      {
        brand_id: 'brand-a',
        url: 'https://acme.com/a-fixed',
        final_url: null,
        created_at: '2026-10-04T00:00:00Z',
      },
    ];
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect(await fixedPages(brandRows, NOW)).toEqual([
      {
        brandId: 'brand-b',
        key: 'acme.com/b-fixed',
        url: 'https://acme.com/b-fixed',
        path: '/b-fixed',
      },
      {
        brandId: 'brand-a',
        key: 'acme.com/a-fixed',
        url: 'https://acme.com/a-fixed',
        path: '/a-fixed',
      },
    ]);
    const read = ops.find((op) => op.table === 'actions');
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'completed'],
        ['eq', 'category', 'fix'],
        ['is', 'deleted_at', null],
      ]),
    );

    ops = [];
    await sweep({ readInbox, startAudits, now: NOW });
    // Five slots: the two fixed pages first, then the inboxes' best three, by brand.
    expect(startAudits.mock.calls.map(([brandId, urls]) => [brandId, urls])).toEqual([
      ['brand-a', ['https://acme.com/a-fixed', 'https://acme.com/pinned', 'https://acme.com/a-90']],
      ['brand-b', ['https://acme.com/b-fixed', 'https://acme.com/b-80']],
    ]);
  });

  it("takes only the brand's own pages: another site's is left, a subdomain kept", async () => {
    brandRows = [...brandRows, { id: 'brand-c', name: 'No Domain', organization_id: 'org-1' }];
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-09T10:00:00Z',
        payload: {
          targets: [
            { id: 'https://rival.com/a-fixed' },
            { id: 'https://acme.com.rival.io/a-fixed' },
            { id: 'https://shop.acme.com/a-fixed' },
            { id: 'https://acme.com/a-fixed' },
          ],
        },
      },
      // A brand without a domain has no page of its own.
      {
        brand_id: 'brand-c',
        completed_at: '2026-10-09T09:00:00Z',
        payload: { targets: [{ id: 'https://acme.com/c-fixed' }] },
      },
    ];
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect((await fixedPages(brandRows, NOW)).map((p) => [p.brandId, p.url])).toEqual([
      ['brand-a', 'https://shop.acme.com/a-fixed'],
      ['brand-a', 'https://acme.com/a-fixed'],
    ]);
    const read = ops.find((op) => op.table === 'brand_domains');
    expect(read.filters).toEqual([['in', 'brand_id', ['brand-a', 'brand-b', 'brand-c']]]);
  });

  it('reads nothing more when no fix was completed lately', async () => {
    const { fixedPages } = await import('./autoAuditSweep.js');
    expect(await fixedPages(brandRows, NOW)).toEqual([]);
    expect(ops.map((op) => op.table)).toEqual(['actions']);
  });

  it('leaves out the pages the team excluded, or put under an exclude pattern and not pinned', async () => {
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-09T10:00:00Z',
        payload: {
          targets: [
            { id: 'https://acme.com/a-excluded' },
            { id: 'https://acme.com/Legal/terms' },
            { id: 'https://acme.com/legal/pinned' },
            { id: 'https://acme.com/a-kept' },
          ],
        },
      },
      // Another brand's prefs and patterns are its own.
      {
        brand_id: 'brand-b',
        completed_at: '2026-10-09T09:00:00Z',
        payload: { targets: [{ id: 'https://acme.com/legal/b-terms' }] },
      },
    ];
    prefRows = [
      { brand_id: 'brand-a', page_key: 'acme.com/a-excluded', state: 'excluded' },
      { brand_id: 'brand-a', page_key: 'acme.com/legal/pinned', state: 'pinned' },
    ];
    settingRows = [{ brand_id: 'brand-a', exclude_patterns: ['/legal/*'] }];
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect((await fixedPages(brandRows, NOW)).map((p) => [p.brandId, p.path])).toEqual([
      ['brand-a', '/legal/pinned'],
      ['brand-a', '/a-kept'],
      ['brand-b', '/legal/b-terms'],
    ]);
    for (const table of ['site_audit_page_prefs', 'site_audit_brand_settings']) {
      expect(ops.find((op) => op.table === table).filters).toEqual([
        ['in', 'brand_id', ['brand-a', 'brand-b']],
      ]);
    }
  });

  it("keeps brands sharing a domain apart: one brand's audit doesn't count for another's fix", async () => {
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-05T10:00:00Z',
        payload: { targets: [{ id: 'https://acme.com/shared' }, { id: 'https://acme.com/both' }] },
      },
      {
        brand_id: 'brand-b',
        completed_at: '2026-10-04T10:00:00Z',
        payload: { targets: [{ id: 'https://acme.com/shared' }, { id: 'https://acme.com/both' }] },
      },
    ];
    // Brand B audited /shared after both fixes: B's is done, A's still due.
    recentAudits = [
      {
        brand_id: 'brand-b',
        url: 'https://acme.com/shared',
        final_url: null,
        created_at: '2026-10-06T00:00:00Z',
      },
    ];
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect((await fixedPages(brandRows, NOW)).map((p) => [p.brandId, p.path])).toEqual([
      ['brand-a', '/shared'],
      ['brand-a', '/both'],
      ['brand-b', '/both'],
    ]);
  });

  it('reads every audit since the oldest fix, past the 1000-row page', async () => {
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-05T10:00:00Z',
        payload: {
          targets: [{ id: 'https://acme.com/a-fixed' }, { id: 'https://acme.com/a-due' }],
        },
      },
    ];
    // A thousand other audits first; the fixed page's comes 1,001st.
    recentAudits = Array.from({ length: 1000 }, (_, i) => ({
      brand_id: 'brand-a',
      url: `https://acme.com/other-${i}`,
      final_url: null,
      created_at: '2026-10-06T00:00:00Z',
    }));
    recentAudits.push({
      brand_id: 'brand-a',
      url: 'https://acme.com/a-fixed',
      final_url: null,
      created_at: '2026-10-07T00:00:00Z',
    });
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect((await fixedPages(brandRows, NOW)).map((p) => p.path)).toEqual(['/a-due']);
    const reads = ops.filter((op) => op.table === 'site_audits');
    expect(reads.map((op) => op.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(reads[0].order).toEqual(['created_at', 'id']);
  });

  it('caps a fix at 20 pages once the ones audited since are left out', async () => {
    const paths = Array.from({ length: 25 }, (_, i) => `/page-${i + 1}`);
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-05T10:00:00Z',
        payload: { targets: paths.map((path) => ({ id: `https://acme.com${path}` })) },
      },
    ];
    // Its first five pages were audited since.
    recentAudits = paths.slice(0, 5).map((path) => ({
      brand_id: 'brand-a',
      url: `https://acme.com${path}`,
      final_url: null,
      created_at: '2026-10-06T00:00:00Z',
    }));
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect((await fixedPages(brandRows, NOW)).map((p) => p.path)).toEqual(paths.slice(5));
  });

  it('counts an audit by the address it ended at, and the same page however its address is written', async () => {
    fixedActions = [
      {
        brand_id: 'brand-a',
        completed_at: '2026-10-05T10:00:00Z',
        payload: {
          targets: [
            { id: 'https://www.acme.com/a-due/?utm_source=mail' },
            { id: 'http://acme.com/a-due' },
            { id: 'HTTPS://ACME.COM/a-due#top' },
            { id: 'https://acme.com/a-fixed' },
            { id: 'https://acme.com/a-moved' },
          ],
        },
      },
    ];
    recentAudits = [
      // The same page, written another way.
      {
        brand_id: 'brand-a',
        url: 'http://www.acme.com/a-fixed/?ref=1',
        final_url: null,
        created_at: '2026-10-06T00:00:00Z',
      },
      // Asked for another address, redirected to the fixed page.
      {
        brand_id: 'brand-a',
        url: 'https://acme.com/old-address',
        final_url: 'https://www.acme.com/a-moved/',
        created_at: '2026-10-06T00:00:00Z',
      },
    ];
    const { fixedPages } = await import('./autoAuditSweep.js');

    expect(await fixedPages(brandRows, NOW)).toEqual([
      {
        brandId: 'brand-a',
        key: 'acme.com/a-due',
        url: 'https://www.acme.com/a-due/?utm_source=mail',
        path: '/a-due',
      },
    ]);
  });

  it('runs on the inboxes, as before, when the fixed pages cannot be read', async () => {
    actionsError = { message: 'connection reset' };
    await run();
    expect(ops.some((op) => op.table === 'actions')).toBe(true);
    expect(startAudits.mock.calls.map(([brandId, urls]) => [brandId, urls])).toEqual([
      ['brand-a', ['https://acme.com/pinned', 'https://acme.com/a-90', 'https://acme.com/a-40']],
      ['brand-b', ['https://acme.com/b-80', 'https://acme.com/b-70']],
    ]);
    expect(runOps().at(-1).update).toMatchObject({ status: 'completed' });
  });
});
