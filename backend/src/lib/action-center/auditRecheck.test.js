import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Did a Site Audit fix take? Its pages audited again since it closed (learning A2). */

let tables;
const reads = [];
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const q = { table, filters: [] };
      const chain = {
        select: () => chain,
        eq: (...a) => (q.filters.push(['eq', ...a]), chain),
        gt: (...a) => (q.filters.push(['gt', ...a]), chain),
        in: (...a) => (q.filters.push(['in', ...a]), chain),
        order: () => chain,
        limit: () => chain,
        then: (resolve) => {
          reads.push(q);
          return resolve({ data: tables[table] ?? [], error: null });
        },
      };
      return chain;
    },
  },
}));

const { auditOutcome, auditRecheck } = await import('./auditRecheck.js');
const { resolve } = await import('../../config/actionEngine.js');
const LOW = resolve().detection.auditLowScore;

const action = (over = {}) => ({
  id: 'a1',
  brand_id: 'b1',
  kind: 'fix_structured_data',
  completed_at: '2026-10-01T00:00:00Z',
  payload: {
    targetEntity: 'pages',
    targets: [
      { id: 'https://acme.example/pricing', checks: ['json-ld-validity'] },
      { id: 'https://acme.example/faq', checks: ['faq-schema', 'json-ld-relevance'] },
      { id: 'https://acme.example/about', checks: ['json-ld-presence'] },
    ],
  },
  ...over,
});

beforeEach(() => {
  reads.length = 0;
  tables = {
    site_audits: [
      // The latest first, as read: /pricing's newer audit counts, not the older one.
      { id: 'au3', url: 'https://www.acme.example/pricing/', final_url: null, total_score: 0.8 },
      { id: 'au1', url: 'https://acme.example/pricing', final_url: null, total_score: 0.4 },
      {
        id: 'au2',
        url: 'http://acme.example/go',
        final_url: 'https://acme.example/faq',
        total_score: 0.5,
      },
    ],
    audit_signal_results: [
      { audit_id: 'au3', signal_key: 'json-ld-validity', status: 'pass' },
      { audit_id: 'au1', signal_key: 'json-ld-validity', status: 'fail' },
      { audit_id: 'au2', signal_key: 'faq-schema', status: 'pass' },
      // Relevance's warn: types, none from the high-value list — the issue it raised is gone.
      { audit_id: 'au2', signal_key: 'json-ld-relevance', status: 'warn' },
    ],
  };
});

describe('auditRecheck', () => {
  it('counts the pages audited again since it closed whose named checks pass', async () => {
    expect(await auditRecheck(action())).toEqual({ pages: 3, audited: 2, passed: 2 });
    const audits = reads.find((r) => r.table === 'site_audits').filters;
    expect(audits).toContainEqual(['gt', 'completed_at', '2026-10-01T00:00:00Z']);
    expect(audits).toContainEqual(['eq', 'status', 'completed']);
    // A partial audit's AI-judged checks read n/a: it never says the fix took.
    expect(audits).toContainEqual(['eq', 'partial', false]);
  });

  it('reads validity’s warn as still failing, and a check with no result as not passing', async () => {
    tables.audit_signal_results = [
      { audit_id: 'au3', signal_key: 'json-ld-validity', status: 'warn' },
      { audit_id: 'au2', signal_key: 'faq-schema', status: 'pass' },
    ];
    expect(await auditRecheck(action())).toEqual({ pages: 3, audited: 2, passed: 0 });
  });

  it('passes a low-scored page (F01) once its score is past the line the signal is raised under', async () => {
    tables.site_audits = [
      { id: 'au3', url: 'https://acme.example/pricing', total_score: LOW / 100 },
      { id: 'au2', url: 'https://acme.example/faq', total_score: LOW / 100 - 0.01 },
    ];
    const low = action({
      kind: 'fix_low_scores',
      payload: {
        targets: [{ id: 'https://acme.example/pricing' }, { id: 'https://acme.example/faq' }],
      },
    });
    expect(await auditRecheck(low)).toEqual({ pages: 2, audited: 2, passed: 1 });
    expect(reads.some((r) => r.table === 'audit_signal_results')).toBe(false);
  });

  it('is null with no page it can tell about, and says when none was audited again', async () => {
    expect(
      await auditRecheck(action({ payload: { targets: [{ id: 'https://acme.example/x' }] } })),
    ).toBeNull();
    expect(await auditRecheck(action({ completed_at: null }))).toBeNull();
    tables.site_audits = [];
    expect(await auditRecheck(action())).toEqual({ pages: 3, audited: 0, passed: 0 });
  });
});

describe('auditOutcome', () => {
  it('judges a fix by its pages audited again, and leaves it to the metrics with none', () => {
    expect(auditOutcome({ audited: 2, passed: 2 })).toBe('improved');
    // Part of the work took (learning A4).
    expect(auditOutcome({ audited: 2, passed: 1 })).toBe('mixed');
    expect(auditOutcome({ audited: 2, passed: 0 })).toBe('no_meaningful_change');
    expect(auditOutcome({ audited: 0, passed: 0 })).toBeNull();
  });
});
