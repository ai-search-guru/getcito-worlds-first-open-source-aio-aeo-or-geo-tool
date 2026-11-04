import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An audit's run, from its `running` row to the monthly quota: a completed
 * audit uses one of the month's audits; a partial one, whose AI checks
 * didn't run and kept no earlier verdicts (00430), uses none.
 */

let writes;
let llm;
let nextId;

const BRAND = '33333333-3333-3333-3333-333333333333';
const PAGE = 'https://acme.com/pricing';

/** Records every insert and update; reads come back empty. */
function query(table) {
  let op = 'select';
  let values = null;
  let one = false;
  const builder = {
    select: () => builder,
    insert: (rows) => ((op = 'insert'), (values = rows), builder),
    update: (v) => ((op = 'update'), (values = v), builder),
    eq: () => builder,
    in: () => builder,
    lt: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => ((one = true), builder),
    maybeSingle: () => ((one = true), builder),
    then: (resolve, reject) =>
      Promise.resolve()
        .then(() => {
          if (op === 'select') return { data: one ? null : [], error: null };
          writes.push({ table, op, values });
          if (op === 'update') return { data: null, error: null };
          const rows = (Array.isArray(values) ? values : [values]).map((row) => ({
            id: `audit-${(nextId += 1)}`,
            created_at: new Date().toISOString(),
            ...row,
          }));
          return { data: one ? rows[0] : rows, error: null };
        })
        .then(resolve, reject),
  };
  return builder;
}

async function loadAudits() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: { from: (t) => query(t) } }));
  vi.doMock('../lib/planGuard.js', () => ({
    requireFeature: () => (req, res, next) => next(),
    enforceSiteAuditQuota: vi.fn(async () => ({ remaining: 10 })),
    getSiteAuditQuotaStatus: vi.fn(),
    getOrgIdForUser: vi.fn(),
    PlanLimitError: class PlanLimitError extends Error {},
  }));
  vi.doMock('../lib/audit/context.js', async (importOriginal) => ({
    ...(await importOriginal()),
    buildAuditContext: async (url) => ({ url }),
  }));
  vi.doMock('../lib/audit/engine.js', () => ({ runSignals: async () => [] }));
  vi.doMock('../lib/audit/llmSignals.js', () => ({
    LLM_SIGNAL_KEYS: [],
    evaluateLlmSignals: async () => llm,
  }));
  vi.doMock('../lib/audit/llmVerdicts.js', () => ({ lastPageVerdicts: vi.fn() }));
  vi.doMock('../lib/audit/externalSignals.js', () => ({
    evaluateBrandEntity: async () => ({ key: 'brand_entity_wikidata', status: 'na', score: null }),
  }));
  vi.doMock('../lib/audit/recommendations.js', () => ({
    brandFactsFor: () => null,
    generateRecommendations: async () => [],
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });
  return import('./audits.js');
}

/** Starts an audit of PAGE and waits for its run to mark it completed. */
async function runAudit() {
  const { createAndRunAudit } = await loadAudits();
  await createAndRunAudit(BRAND, PAGE, 'org-1');
  await vi.waitFor(() => {
    expect(writes.some((w) => w.op === 'update' && w.values.status === 'completed')).toBe(true);
  });
  // The quota is charged right after the completion update.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    completed: writes.find((w) => w.op === 'update' && w.values.status === 'completed').values,
    charged: writes.filter((w) => w.table === 'site_audit_usage'),
  };
}

beforeEach(() => {
  writes = [];
  nextId = 0;
});

describe('an audit run and the monthly quota', () => {
  it('uses one of the month’s audits once the audit completes', async () => {
    llm = { results: [], partial: false };
    const { completed, charged } = await runAudit();

    expect(completed.partial).toBe(false);
    expect(charged).toHaveLength(1);
    expect(charged[0].values).toMatchObject({ organization_id: 'org-1' });
  });

  it('uses none for a partial audit, whose AI checks didn’t run', async () => {
    llm = { results: [], partial: true };
    const { completed, charged } = await runAudit();

    expect(completed.partial).toBe(true);
    expect(charged).toHaveLength(0);
  });
});
