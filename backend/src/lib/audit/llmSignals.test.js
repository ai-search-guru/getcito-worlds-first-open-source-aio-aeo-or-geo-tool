import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Score stability: the AI-judged signals' verdicts are kept by their input,
 * so an unchanged page gets the same score with no AI call, a changed one is
 * judged again only on the signals whose input changed, and a failed call
 * never re-scores the page silently.
 */

const generateObject = vi.fn();
vi.mock('ai', () => ({ generateObject: (...args) => generateObject(...args) }));
vi.mock('../aiProvider.js', () => ({ resolveModel: (model) => ({ model }) }));
vi.mock('../retry.js', () => ({ withRetry: (fn) => fn() }));
const logger = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock('../logger.js', () => ({ logger, default: logger }));

// site_audit_llm_verdicts, in memory: the first verdict kept for a key stays.
const kept = new Map();
const keyOf = (inputHash, signalKey, { model, promptVersion }) =>
  [inputHash, signalKey, model, promptVersion].join('|');
vi.mock('./llmVerdicts.js', () => ({
  readVerdicts: async (pairs, options) => {
    const found = new Map();
    for (const { inputHash, signalKey } of pairs) {
      const v = kept.get(keyOf(inputHash, signalKey, options));
      if (v) found.set(`${inputHash}|${signalKey}`, v);
    }
    return found;
  },
  saveVerdicts: async (verdicts, options) => {
    for (const { inputHash, signalKey, status, score, reason } of verdicts) {
      const key = keyOf(inputHash, signalKey, options);
      if (!kept.has(key)) kept.set(key, { status, score, reason });
    }
  },
}));

const { DEFAULT_MODEL, LLM_SIGNAL_KEYS, LLM_SIGNAL_VIEWS, OPENING_CHARS, evaluateLlmSignals } =
  await import('./llmSignals.js');
const { auditContextOf } = await import('./context.js');
const { scoreAudit } = await import('./scorer.js');

const URL = 'https://getcito.com/blog/ai-visibility';
const intro = 'AI visibility is how often answer engines name your brand. '.repeat(40);
const rest = 'Track prompts weekly and compare platforms over time. '.repeat(40);

function page({ title = 'AI visibility guide', body = `${intro} ${rest}`, url = URL } = {}) {
  return auditContextOf({
    url,
    statusCode: 200,
    html: `<html><head><title>${title}</title></head><body><h1>AI visibility</h1><p>${body}</p></body></html>`,
    robotsTxt: null,
    llmsTxt: null,
    now: Date.UTC(2026, 9, 31),
  });
}

/** The keys a call asked for, in its schema. */
const askedKeys = (call) => Object.keys(call[0].schema.shape);

// The model answers each call a little differently, as an unpinned one would.
let calls = 0;
function modelAnswers() {
  generateObject.mockImplementation(async ({ schema }) => {
    calls += 1;
    const score = calls % 2 ? 0.5 : 1;
    return {
      object: Object.fromEntries(
        Object.keys(schema.shape).map((k) => [
          k,
          { status: score === 1 ? 'pass' : 'warn', score, reason: `Judged in call ${calls}.` },
        ]),
      ),
    };
  });
}

const verdictsOf = ({ results }) =>
  results.map(({ key, status, score }) => ({ key, status, score }));
const totalOf = ({ results }) => scoreAudit(results).totalScore;

beforeEach(() => {
  kept.clear();
  calls = 0;
  generateObject.mockReset();
  logger.error.mockReset();
  vi.stubEnv('AUDIT_LLM_MODEL', '');
  modelAnswers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('evaluateLlmSignals', () => {
  it('calls a pinned model at temperature 0 with a fixed seed, a call per view of the page', async () => {
    const first = await evaluateLlmSignals(page());

    expect(DEFAULT_MODEL).toBe('google/gemini-3.8-flash');
    expect(generateObject).toHaveBeenCalledTimes(2);
    for (const [args] of generateObject.mock.calls) {
      expect(args.model).toEqual({ model: DEFAULT_MODEL });
      expect(args.temperature).toBe(0);
      expect(Number.isInteger(args.seed)).toBe(true);
    }
    expect(generateObject.mock.calls.map(askedKeys)).toEqual([
      LLM_SIGNAL_VIEWS.opening,
      LLM_SIGNAL_VIEWS.body,
    ]);
    expect(first.partial).toBe(false);
    expect(first.results.map((r) => r.key)).toEqual(LLM_SIGNAL_KEYS);
  });

  it('reports each call’s tokens to a caller that charges them, and nothing for kept verdicts (item 9)', async () => {
    generateObject.mockImplementation(async ({ schema }) => ({
      object: Object.fromEntries(
        Object.keys(schema.shape).map((k) => [k, { status: 'pass', score: 1, reason: 'ok' }]),
      ),
      usage: { inputTokens: 2000, outputTokens: 400 },
    }));
    const onUsage = vi.fn();
    await evaluateLlmSignals(page(), { onUsage });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 2000, outputTokens: 400 });
    onUsage.mockClear();
    await evaluateLlmSignals(page(), { onUsage });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('gives an unchanged page the same verdicts and score five times, with no new AI call', async () => {
    const first = await evaluateLlmSignals(page());
    expect(generateObject).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 5; i += 1) {
      // A tracking parameter is the same page.
      const again = await evaluateLlmSignals(page({ url: `${URL}?utm_source=x` }));
      expect(verdictsOf(again)).toEqual(verdictsOf(first));
      expect(totalOf(again)).toBe(totalOf(first));
      expect(again.partial).toBe(false);
    }
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it('judges again only the signals whose input changed', async () => {
    const first = await evaluateLlmSignals(page());
    generateObject.mockClear();

    // A new title: only the opening signals read it.
    const retitled = await evaluateLlmSignals(page({ title: 'AI visibility, explained' }));
    expect(generateObject.mock.calls.map(askedKeys)).toEqual([LLM_SIGNAL_VIEWS.opening]);
    const same = (r) => LLM_SIGNAL_VIEWS.body.includes(r.key);
    expect(verdictsOf(retitled).filter(same)).toEqual(verdictsOf(first).filter(same));

    // Text past the opening: only the other signals read it.
    generateObject.mockClear();
    expect(intro.length).toBeGreaterThan(OPENING_CHARS);
    await evaluateLlmSignals(page({ body: `${intro} ${rest} One more line.` }));
    expect(generateObject.mock.calls.map(askedKeys)).toEqual([LLM_SIGNAL_VIEWS.body]);
  });

  it('asks only for the one signal with no kept verdict', async () => {
    await evaluateLlmSignals(page());
    const [byline] = [...kept.keys()].filter((k) => k.includes('|byline-depth|'));
    kept.delete(byline);
    generateObject.mockClear();

    await evaluateLlmSignals(page());
    expect(generateObject.mock.calls.map(askedKeys)).toEqual([['byline-depth']]);
  });

  it('keeps the page’s last verdicts when the call fails, so the score does not change', async () => {
    const first = await evaluateLlmSignals(page());
    generateObject.mockReset().mockRejectedValue(new Error('rate limited'));
    const last = new Map(
      first.results.map((r) => [
        r.key,
        { status: r.status, score: r.score, reason: r.evidence.reason, auditId: 'audit-1' },
      ]),
    );
    const lastVerdicts = vi.fn(async () => last);

    // The page changed, so nothing is kept for its new input.
    const failed = await evaluateLlmSignals(page({ body: `${rest} ${intro}` }), { lastVerdicts });
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(lastVerdicts).toHaveBeenCalledTimes(1);
    expect(failed.partial).toBe(false);
    expect(verdictsOf(failed)).toEqual(verdictsOf(first));
    expect(totalOf(failed)).toBe(totalOf(first));
    expect(failed.results[0].evidence.keptFrom).toBe('audit-1');
  });

  it('marks the audit partial when the call fails and the page has no verdicts to keep', async () => {
    generateObject.mockReset().mockRejectedValue(new Error('provider down'));

    const failed = await evaluateLlmSignals(page(), { lastVerdicts: async () => new Map() });
    expect(failed.partial).toBe(true);
    expect(failed.results.every((r) => r.status === 'na' && r.evidence.error)).toBe(true);
    // Nothing is kept from a failed call: the next audit asks again.
    expect(kept.size).toBe(0);
  });

  it('is partial when one view fails, keeping the verdicts of the other', async () => {
    generateObject.mockImplementationOnce(async ({ schema }) => ({
      object: Object.fromEntries(
        Object.keys(schema.shape).map((k) => [k, { status: 'pass', score: 1, reason: 'Clear.' }]),
      ),
    }));
    generateObject.mockRejectedValueOnce(new Error('timeout'));

    const result = await evaluateLlmSignals(page());
    expect(result.partial).toBe(true);
    const byKey = new Map(result.results.map((r) => [r.key, r.status]));
    expect(LLM_SIGNAL_VIEWS.opening.map((k) => byKey.get(k))).toEqual(['pass', 'pass']);
    expect(LLM_SIGNAL_VIEWS.body.every((k) => byKey.get(k) === 'na')).toBe(true);
  });

  it('keys the kept verdicts by model: another model judges the page again', async () => {
    await evaluateLlmSignals(page());
    generateObject.mockClear();
    vi.stubEnv('AUDIT_LLM_MODEL', 'anthropic/claude-haiku-4-5-20251001');

    await evaluateLlmSignals(page());
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateObject.mock.calls[0][0].model).toEqual({
      model: 'anthropic/claude-haiku-4-5-20251001',
    });
  });
});
