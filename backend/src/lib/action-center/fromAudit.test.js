import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * sendAuditToActionCenter (learning D2): a Site Audit report's page and the
 * checks it fails as one Fix action. These pin that the audit is read again
 * on the server within the brand, that only failing checks go (not one that
 * isn't applicable), that an older report of a page audited since is
 * refused, that the same page sent again (or twice at once) returns the open
 * action, and that the action names its page and checks as its target and
 * takes F01's plan, its audit tasks included.
 */

let db;

function table(name) {
  const state = { name, filters: {}, op: 'select', row: null };
  const result = () => {
    if (state.op === 'insert') {
      db.inserts.push({ table: name, row: state.row });
      if (name === 'actions') {
        return db.insertError
          ? { data: null, error: db.insertError }
          : { data: { id: 'act-1', action_no: 71 }, error: null };
      }
      return { data: null, error: null };
    }
    return { data: db.rows[name]?.(state.filters) ?? null, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (row) => {
      state.op = 'insert';
      state.row = row;
      return chain;
    },
    eq: (col, val) => {
      state.filters[col] = val;
      return chain;
    },
    in: (col, val) => {
      state.filters[col] = val;
      return chain;
    },
    gt: (col, val) => {
      state.filters[`${col}>`] = val;
      return chain;
    },
    not: (col, op, val) => {
      state.filters[`${col} not ${op}`] = val;
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    maybeSingle: async () => result(),
    single: async () => result(),
    then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
  };
  return chain;
}

const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: { from: (name) => table(name), rpc: (...args) => rpc(...args) },
}));
// A brand sending from a Site Audit report has its audits: F01's audit tasks plan.
vi.mock('./sources.js', () => ({
  resolveBrandSources: async () => new Set(['tracking', 'analytics', 'ai_traffic', 'site_audits']),
}));
vi.mock('./priorityData.js', () => ({
  priorityOnCreate: async () => ({ priority_score: 61, priority_level: 'medium' }),
}));

const { AUDIT_PAGE_ACTION_KIND, auditDedupKey, auditImpact, failing, sendAuditToActionCenter } =
  await import('./fromAudit.js');

const AUDIT = '11111111-2222-4333-8444-555555555555';
const URL_ = 'https://acme.example/blog/espresso';

beforeEach(() => {
  db = {
    inserts: [],
    insertError: null,
    newer: [],
    newerRead: null,
    rows: {
      site_audits: (f) => {
        // The brand's completed audits after the sent one (newer_audit).
        if (f.id === undefined) {
          db.newerRead = f;
          return db.newer;
        }
        return f.id === AUDIT && f.brand_id === 'b1'
          ? {
              id: AUDIT,
              brand_id: 'b1',
              url: 'https://acme.example/blog/espresso?utm=x',
              final_url: URL_,
              status: 'completed',
              total_score: 0.42,
              created_at: '2026-10-20T10:00:00Z',
            }
          : null;
      },
      audit_signal_results: () => [
        { signal_key: 'faq-schema', status: 'fail' },
        { signal_key: 'tables', status: 'warn' },
        { signal_key: 'json-ld-validity', status: 'warn' },
        { signal_key: 'h1-quality', status: 'pass' },
      ],
      actions: () => null,
    },
  };
});

describe('failing', () => {
  it('reads a fail, and a warn only for JSON-LD validity, as the page check does', () => {
    expect(failing('faq-schema', 'fail')).toBe(true);
    expect(failing('tables', 'warn')).toBe(false);
    expect(failing('json-ld-validity', 'warn')).toBe(true);
    expect(failing('h1-quality', 'pass')).toBe(false);
    // Not applicable to the page: nothing to fix.
    expect(failing('faq-schema', 'na')).toBe(false);
    expect(failing('json-ld-validity', 'na')).toBe(false);
  });
});

describe('auditImpact', () => {
  it('is high below the low-score line, medium with three failures or more', () => {
    expect(auditImpact(0.42, 1)).toBe('high');
    expect(auditImpact(0.9, 3)).toBe('medium');
    expect(auditImpact(0.9, 1)).toBe('low');
  });
});

describe('sendAuditToActionCenter', () => {
  it("sends the page and its failing checks as a Fix action, with F01's plan", async () => {
    expect(await sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).toEqual({
      actionId: 'act-1',
      actionNo: 71,
      created: true,
    });
    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action).toMatchObject({
      brand_id: 'b1',
      category: 'fix',
      kind: AUDIT_PAGE_ACTION_KIND,
      impact: 'high',
      kpi_keys: ['citations', 'ai_referral_traffic'],
      baseline: { score: 0.42, failing: 2 },
      dedup_key: auditDedupKey(URL_),
    });
    expect(action.payload).toMatchObject({
      auditId: AUDIT,
      url: URL_,
      pages: [URL_],
      targetEntity: 'pages',
      targetCount: 1,
      // What an audit run on the page again reads.
      targets: [{ id: URL_, label: '/blog/espresso', checks: ['faq-schema', 'json-ld-validity'] }],
    });
    expect(action.payload.checks.map((c) => c.key)).toEqual(['faq-schema', 'json-ld-validity']);
    expect(action.payload.checks[0].label).toEqual(expect.any(String));
    // F01's plan, its audit tasks included: the page's audit read first, the fix checked by the next.
    const tasks = db.inserts.find((i) => i.table === 'action_tasks').row;
    expect(tasks.map((task) => task.task_key)).toEqual([
      'analyze_site_audit',
      'prioritize_targets',
      'fix_technical_issue',
      'validate_technical_fix',
      'measure_action_outcome',
    ]);
    expect(tasks.map((task) => task.position)).toEqual([1, 2, 3, 4, 5]);
    expect(tasks.every((task) => task.action_id === 'act-1' && task.status === 'todo')).toBe(true);
    expect(db.inserts.find((i) => i.table === 'action_events').row).toMatchObject({
      event: 'created',
      actor_id: 'u1',
      data: { source: AUDIT_PAGE_ACTION_KIND, checks: 2, taskCount: 5 },
    });
  });

  it('leaves out a check that is not applicable to the page', async () => {
    db.rows.audit_signal_results = () => [
      { signal_key: 'faq-schema', status: 'na' },
      { signal_key: 'json-ld-validity', status: 'na' },
      { signal_key: 'tables', status: 'fail' },
    ];
    await sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' });
    const action = db.inserts.find((i) => i.table === 'actions').row;
    expect(action.payload.checks.map((c) => c.key)).toEqual(['tables']);
    expect(action.baseline).toEqual({ score: 0.42, failing: 1 });

    db.inserts = [];
    db.rows.audit_signal_results = () => [
      { signal_key: 'faq-schema', status: 'na' },
      { signal_key: 'h1-quality', status: 'pass' },
    ];
    await expect(
      sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' }),
    ).rejects.toMatchObject({ status: 409, code: 'nothing_to_fix' });
    expect(db.inserts).toEqual([]);
  });

  it('returns the action the other of two sends at once opened', async () => {
    // Not open when read, open once the insert hits the open-action dedup index.
    let reads = 0;
    db.rows.actions = () => (reads++ === 0 ? null : { id: 'act-0', action_no: 70 });
    db.insertError = { code: '23505', message: 'duplicate key value' };
    expect(await sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).toEqual({
      actionId: 'act-0',
      actionNo: 70,
      created: false,
    });
    expect(reads).toBe(2);
    // Its plan and trail are the other send's.
    expect(db.inserts.map((i) => i.table)).toEqual(['actions']);
  });

  it('fails when the insert is refused for another reason, or no action is open after all', async () => {
    db.insertError = { code: '23505', message: 'duplicate key value' };
    await expect(sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).rejects.toThrow(
      'duplicate key value',
    );
    // Another refusal isn't a send racing this one: no second read.
    db.insertError = { code: '23502', message: 'null value' };
    let reads = 0;
    db.rows.actions = () => (reads++ === 0 ? null : { id: 'act-0', action_no: 70 });
    await expect(sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).rejects.toThrow(
      'null value',
    );
    expect(reads).toBe(1);
  });

  it('returns the action open for the page', async () => {
    db.rows.actions = () => ({ id: 'act-0', action_no: 70 });
    expect(await sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).toEqual({
      actionId: 'act-0',
      actionNo: 70,
      created: false,
    });
    expect(db.inserts).toEqual([]);
  });

  it('refuses an older report of a page audited since, naming its latest audit', async () => {
    db.newer = [
      // Another page, audited later still: not this page's.
      { id: 'a-other', url: 'https://acme.example/blog/latte', final_url: null },
      // The same page, read with www. and a trailing slash, as the Pages list groups it.
      { id: 'a-new', url: 'http://www.acme.example/blog/espresso/', final_url: null },
      { id: 'a-mid', url: URL_, final_url: URL_ },
    ];
    await expect(
      sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'newer_audit',
      extra: { latestAuditId: 'a-new' },
    });
    // Read within the brand: completed, scored, and after the sent one.
    expect(db.newerRead).toMatchObject({
      brand_id: 'b1',
      status: 'completed',
      'total_score not is': null,
      'created_at>': '2026-10-20T10:00:00Z',
    });
    expect(db.inserts).toEqual([]);
  });

  it('sends a report when only other pages were audited since', async () => {
    db.newer = [{ id: 'a-other', url: 'https://acme.example/blog/latte', final_url: null }];
    expect(await sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' })).toMatchObject({
      created: true,
    });
  });

  it("refuses another brand's audit, one not finished, and a page with nothing to fix", async () => {
    await expect(
      sendAuditToActionCenter('b2', { auditId: AUDIT, userId: 'u1' }),
    ).rejects.toMatchObject({ status: 404 });
    const completed = db.rows.site_audits;
    db.rows.site_audits = (f) => ({ ...completed(f), status: 'running' });
    await expect(
      sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' }),
    ).rejects.toMatchObject({ status: 409, code: 'not_completed' });
    db.rows.site_audits = completed;
    db.rows.audit_signal_results = () => [{ signal_key: 'faq-schema', status: 'pass' }];
    await expect(
      sendAuditToActionCenter('b1', { auditId: AUDIT, userId: 'u1' }),
    ).rejects.toMatchObject({ status: 409, code: 'nothing_to_fix' });
  });
});
