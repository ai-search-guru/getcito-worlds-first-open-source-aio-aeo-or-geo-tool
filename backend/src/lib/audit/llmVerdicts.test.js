import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The kept AI verdicts (00430): read back, kept, a page's last ones, and the daily prune. */

let tables;
let ops;
const rpc = vi.fn();
vi.mock('../../config/supabase.js', () => ({
  default: {
    rpc: (...a) => rpc(...a),
    from: (table) => {
      const q = { table, filters: [], op: 'select' };
      const chain = {
        select: () => chain,
        eq: (...a) => (q.filters.push(['eq', ...a]), chain),
        in: (...a) => (q.filters.push(['in', ...a]), chain),
        order: () => chain,
        limit: () => chain,
        update: (values) => ((q.op = 'update'), (q.values = values), chain),
        upsert: (rows, options) => (
          (q.op = 'upsert'),
          (q.rows = rows),
          (q.options = options),
          chain
        ),
        then: (resolve) => {
          ops.push(q);
          if (q.op !== 'select') return resolve({ data: null, error: null });
          const rows = (tables[table] ?? []).filter((row) =>
            q.filters.every(([kind, col, val]) =>
              kind === 'eq' ? row[col] === val : val.includes(row[col]),
            ),
          );
          return resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  },
}));
const warn = vi.fn();
vi.mock('../logger.js', () => ({ logger: { warn: (...a) => warn(...a) } }));

const {
  lastPageVerdicts,
  MAX_VERDICT_PRUNE_CALLS,
  pruneLlmVerdicts,
  readVerdicts,
  saveVerdicts,
  VERDICT_PRUNE_BATCH,
} = await import('./llmVerdicts.js');

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const options = { model: 'google/gemini-3.8-flash', promptVersion: 'v1.1/2' };
const row = (over) => ({
  id: 'v1',
  input_hash: H1,
  signal_key: 'direct-answer',
  model: options.model,
  prompt_version: options.promptVersion,
  status: 'pass',
  score: '1',
  reason: 'Answers it first.',
  ...over,
});

beforeEach(() => {
  ops = [];
  rpc.mockReset();
  warn.mockReset();
  tables = { site_audit_llm_verdicts: [], site_audits: [], audit_signal_results: [] };
});

describe('readVerdicts', () => {
  it('reads only the asked pairs under the model and prompt version, and marks them used', async () => {
    tables.site_audit_llm_verdicts = [
      row({ id: 'v1' }),
      // Same signal, another input: not asked for.
      row({ id: 'v2', input_hash: H2 }),
      row({ id: 'v3', input_hash: H2, signal_key: 'info-density', status: 'na', score: null }),
      row({ id: 'v4', input_hash: H2, signal_key: 'definitions', model: 'openai/gpt-5-mini' }),
    ];
    const now = new Date('2026-10-31T10:00:00.000Z');
    const found = await readVerdicts(
      [
        { inputHash: H1, signalKey: 'direct-answer' },
        { inputHash: H2, signalKey: 'info-density' },
        { inputHash: H2, signalKey: 'definitions' },
      ],
      { ...options, now },
    );

    expect([...found.entries()]).toEqual([
      [`${H1}|direct-answer`, { status: 'pass', score: 1, reason: 'Answers it first.' }],
      [`${H2}|info-density`, { status: 'na', score: null, reason: 'Answers it first.' }],
    ]);
    const touch = ops.find((q) => q.op === 'update');
    expect(touch.values).toEqual({ used_at: '2026-10-31T10:00:00.000Z' });
    expect(touch.filters).toEqual([['in', 'id', ['v1', 'v3']]]);
  });
});

describe('saveVerdicts', () => {
  it('keeps new verdicts, never replacing one already kept', async () => {
    await saveVerdicts(
      [
        {
          inputHash: H1,
          signalKey: 'bluf-answer',
          status: 'warn',
          score: 0.5,
          reason: 'x'.repeat(600),
        },
      ],
      options,
    );
    const [upsert] = ops;
    expect(upsert.options).toEqual({
      onConflict: 'input_hash,signal_key,model,prompt_version',
      ignoreDuplicates: true,
    });
    expect(upsert.rows).toEqual([
      {
        input_hash: H1,
        signal_key: 'bluf-answer',
        model: options.model,
        prompt_version: options.promptVersion,
        status: 'warn',
        score: 0.5,
        reason: 'x'.repeat(500),
      },
    ]);
  });
});

describe('lastPageVerdicts', () => {
  it("reads the brand's latest complete audit of the same page, leaving out what it couldn't judge", async () => {
    tables.site_audits = [
      {
        id: 'other',
        url: 'https://acme.com/blog',
        final_url: null,
        brand_id: 'b1',
        status: 'completed',
        partial: false,
      },
      {
        id: 'a2',
        url: 'https://www.acme.com/pricing/?utm=x',
        final_url: null,
        brand_id: 'b1',
        status: 'completed',
        partial: false,
      },
      {
        id: 'a1',
        url: 'https://acme.com/pricing',
        final_url: null,
        brand_id: 'b1',
        status: 'completed',
        partial: false,
      },
    ];
    tables.audit_signal_results = [
      {
        audit_id: 'a2',
        signal_key: 'direct-answer',
        status: 'fail',
        score: '0',
        evidence: { reason: 'No answer.' },
      },
      {
        audit_id: 'a2',
        signal_key: 'bluf-answer',
        status: 'na',
        score: null,
        evidence: { error: 'LLM evaluation unavailable' },
      },
      {
        audit_id: 'a1',
        signal_key: 'direct-answer',
        status: 'pass',
        score: '1',
        evidence: { reason: 'Old.' },
      },
    ];

    const verdicts = await lastPageVerdicts('b1', 'https://acme.com/pricing', [
      'direct-answer',
      'bluf-answer',
    ]);
    expect([...verdicts.entries()]).toEqual([
      ['direct-answer', { status: 'fail', score: 0, reason: 'No answer.', auditId: 'a2' }],
    ]);
    const audits = ops.find((q) => q.table === 'site_audits');
    expect(audits.filters).toEqual([
      ['eq', 'brand_id', 'b1'],
      ['eq', 'status', 'completed'],
      ['eq', 'partial', false],
    ]);
  });

  it('is empty for a page never audited in full', async () => {
    expect((await lastPageVerdicts('b1', 'https://acme.com/new', ['direct-answer'])).size).toBe(0);
  });
});

describe('pruneLlmVerdicts', () => {
  const NOW = Date.parse('2026-10-31T10:00:00.000Z');

  it('deletes verdicts unread for 180 days in batches until a call deletes fewer', async () => {
    rpc
      .mockResolvedValueOnce({ data: VERDICT_PRUNE_BATCH, error: null })
      .mockResolvedValueOnce({ data: 3, error: null });
    await pruneLlmVerdicts(NOW);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('site_audit_llm_verdicts_prune', {
      p_before: '2026-05-04T10:00:00.000Z',
      p_limit: VERDICT_PRUNE_BATCH,
    });
  });

  it('stops after its call budget, and on an error', async () => {
    rpc.mockResolvedValue({ data: VERDICT_PRUNE_BATCH, error: null });
    await pruneLlmVerdicts(NOW);
    expect(rpc).toHaveBeenCalledTimes(MAX_VERDICT_PRUNE_CALLS);
    expect(warn).toHaveBeenCalledWith(
      { calls: MAX_VERDICT_PRUNE_CALLS },
      '[audit] AI verdicts prune stopped early; the rest goes tomorrow',
    );

    rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await pruneLlmVerdicts(NOW);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
