import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/suggestions/:brandId/refresh with relevance (VIS-011).
 * Rating rides along in the same model call only once its worst case is
 * reserved against the org's monthly allowance (0.1% of the plan price), and
 * the reservation is then settled to every attempt made, so the month can't
 * pass the budget.
 */

const reserveRelevanceAllowance = vi.fn();
const settleRelevanceUsage = vi.fn();
const generateObject = vi.fn();
let db;

function table(name) {
  let op = 'select';
  let row = null;
  const filters = {};
  const result = (single = false) => {
    if (op === 'insert') {
      db.inserts.push({ table: name, row });
      if (name !== 'prompt_suggestions') return { data: null, error: null };
      if (db.insertError) return { data: null, error: db.insertError };
      return { data: row.map((r, i) => ({ id: `new-${i}`, ...r })), error: null };
    }
    if (op === 'update') {
      db.updates.push({ table: name, row, filters });
      return { data: { ...row, id: filters.id }, error: null };
    }
    if (op === 'delete') {
      db.deletes.push({ table: name, filters });
      return { data: null, error: null };
    }
    // The undecided batch the refresh replaces.
    if (name === 'prompt_suggestions') return { data: db.current, error: null };
    if (name === 'brands') {
      const brand = { id: 'b1', name: 'Acme', language: 'en', organization_id: 'o1' };
      return { data: brand, error: null };
    }
    if (name === 'profiles') return { data: { organization_id: 'o1', role: 'admin' }, error: null };
    // The topic lookup for each suggestion finds one (none for a brand
    // without topics); the topic list is empty.
    if (name === 'topics') {
      return { data: single && !db.noTopics ? { id: 't1' } : single ? null : [], error: null };
    }
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result(true);
        if (prop === 'insert') {
          return (r) => {
            op = 'insert';
            row = r;
            return chain;
          };
        }
        if (prop === 'delete') {
          return () => {
            op = 'delete';
            return chain;
          };
        }
        if (prop === 'update') {
          return (r) => {
            op = 'update';
            row = r;
            return chain;
          };
        }
        if (prop === 'eq' || prop === 'in') {
          return (column, value) => {
            filters[column] = value;
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/planGuard.js', () => ({
  PlanLimitError: class extends Error {},
  enforceFeature: vi.fn(),
  reserveAiBudget: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (req, res, next) => next(),
  reserveRelevanceAllowance,
  settleRelevanceUsage,
}));
vi.mock('ai', () => ({ generateObject, NoObjectGeneratedError: class extends Error {} }));
vi.mock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn(() => 'model') }));
vi.mock('../lib/gscSuggestions.js', () => ({ getGscSuggestionCandidates: async () => [] }));
vi.mock('../lib/gaSuggestions.js', () => ({ getGaSuggestionCandidates: async () => [] }));
const getCatalogSuggestionCandidates = vi.fn();
vi.mock('../lib/catalogSuggestions.js', () => ({ getCatalogSuggestionCandidates }));
// Retries without the real backoff delay.
vi.mock('../lib/retry.js', () => ({
  withRetry: async (fn, { attempts }) => {
    let last;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        last = err;
      }
    }
    throw last;
  },
}));

const { ratingCostUsd } = await import('../lib/suggestionRelevance.js');
const { default: router } = await import('./prompts.js');

const MODEL = 'google/gemini-3-flash-preview';
const suggestion = (i, extra = {}) => ({
  text: `how do teams track brand visibility in ai answers ${i}`,
  topic: 'AI visibility',
  reason: 'Competitors are already cited for this question in AI answers.',
  estVolume: 1000 + i,
  ...extra,
});
const answer = (extra) => ({
  object: { suggestions: Array.from({ length: 15 }, (_, i) => suggestion(i, extra)) },
  usage: { inputTokens: 5000, outputTokens: 2400 },
});

let server;
let baseUrl;
const modelEnv = process.env.PROMPT_SUGGESTION_MODEL;

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.PROMPT_SUGGESTION_MODEL;
  db = { inserts: [], updates: [], deletes: [], current: [], insertError: null, noTopics: false };
  reserveRelevanceAllowance.mockResolvedValue({ unlimited: false, id: 'r1' });
  getCatalogSuggestionCandidates.mockResolvedValue([]);
  settleRelevanceUsage.mockResolvedValue();
  generateObject.mockResolvedValue(answer({ relevance: 8 }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/prompts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/prompts`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (modelEnv === undefined) delete process.env.PROMPT_SUGGESTION_MODEL;
  else process.env.PROMPT_SUGGESTION_MODEL = modelEnv;
});

const refresh = () => fetch(`${baseUrl}/suggestions/b1/refresh`, { method: 'POST' });
const insertsInto = (name) => db.inserts.filter((i) => i.table === name).map((i) => i.row);
const askedForRelevance = (call = 0) => {
  const { schema, system } = generateObject.mock.calls[call][0];
  return {
    schema: 'relevance' in schema.shape.suggestions.element.shape,
    rule: /- relevance:/.test(system),
  };
};

describe('suggestion refresh relevance', () => {
  it('reserves the worst case, rates in the same call, then settles to what it cost', async () => {
    const res = await refresh();

    expect(res.status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(askedForRelevance()).toEqual({ schema: true, rule: true });
    expect(reserveRelevanceAllowance).toHaveBeenCalledWith('o1', {
      brandId: 'b1',
      modelId: MODEL,
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 3 }),
    });

    const [rows] = insertsInto('prompt_suggestions');
    expect(rows.every((r) => r.relevance === 0.8)).toBe(true);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 1,
      usage: { inputTokens: 5000, outputTokens: 2400 },
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 1 }),
    });
  });

  it('leaves relevance out when the allowance can’t cover a refresh', async () => {
    reserveRelevanceAllowance.mockResolvedValue({ unlimited: false, id: null });
    generateObject.mockResolvedValue(answer());

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: false, rule: false });
    const [rows] = insertsInto('prompt_suggestions');
    expect(rows.every((r) => r.relevance === null)).toBe(true);
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('rates nothing when the allowance can’t be reserved', async () => {
    reserveRelevanceAllowance.mockRejectedValue(new Error('db down'));
    generateObject.mockResolvedValue(answer());

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: false, rule: false });
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('rates without charging anything on an unlimited plan', async () => {
    reserveRelevanceAllowance.mockResolvedValue({ unlimited: true, id: null });

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: true, rule: true });
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('settles every attempt, a failed one too', async () => {
    generateObject
      .mockRejectedValueOnce(new Error('No object generated'))
      .mockResolvedValueOnce(answer({ relevance: 7 }));

    expect((await refresh()).status).toBe(200);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 2,
      usage: { inputTokens: 5000, outputTokens: 2400 },
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 2 }),
    });
  });

  it('settles the attempts of a refresh that failed outright', async () => {
    generateObject.mockRejectedValue(new Error('No object generated'));

    expect((await refresh()).status).toBe(500);
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 3,
      usage: undefined,
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 3 }),
    });
  });

  it('still answers when settling fails, leaving the worst case charged', async () => {
    settleRelevanceUsage.mockRejectedValue(new Error('db down'));
    expect((await refresh()).status).toBe(200);
  });
});

describe('suggestion refresh from the catalog (ECOM-003)', () => {
  const packs = {
    category: 'Bags > Hiking backpacks',
    products: 18,
    priceLow: 60,
    priceHigh: 180,
    priceUnder: 150,
    currency: 'USD',
  };

  it('asks for shopping questions from the categories, and keeps the one each came from', async () => {
    getCatalogSuggestionCandidates.mockResolvedValue([packs]);
    const suggestions = Array.from({ length: 15 }, (_, i) => suggestion(i));
    suggestions[0] = suggestion(0, { sourceCategory: 'bags > hiking backpacks ' });
    // A category the catalog never offered: a plain suggestion.
    suggestions[1] = suggestion(1, { sourceCategory: 'Tents' });
    generateObject.mockResolvedValue({ object: { suggestions }, usage: {} });

    expect((await refresh()).status).toBe(200);
    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('WHAT THE BRAND SELLS');
    expect(system).toContain('Derive at least 1 shopping suggestions');
    expect(prompt).toContain(
      '"Bags > Hiking backpacks" — 18 products, 60–180 USD (most under 150 USD)',
    );
    const [rows] = insertsInto('prompt_suggestions');
    expect(rows[0]).toMatchObject({ source: 'catalog', source_data: packs });
    expect(rows[1]).toMatchObject({ source: 'llm', source_data: null });
  });

  it('leaves the catalog out of the prompt for a brand without one', async () => {
    expect((await refresh()).status).toBe(200);
    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).not.toContain('WHAT THE BRAND SELLS');
    expect(prompt).not.toContain('product catalog categories');
  });
});

describe('suggestion refresh for a brand without topics', () => {
  it('asks for a topic first, before anything is generated, reserved or written', async () => {
    db.noTopics = true;
    const res = await refresh();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Add a topic first: prompts are grouped under topics.',
      code: 'no_topics',
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(reserveRelevanceAllowance).not.toHaveBeenCalled();
    expect(db.inserts).toEqual([]);
  });
});

describe('suggestion refresh keeps the list', () => {
  const old = (id, text) => ({ id, brand_id: 'b1', suggested_text: text, status: 'new' });
  const deletedIds = () =>
    db.deletes.filter((d) => d.table === 'prompt_suggestions').flatMap((d) => d.filters.id);

  it('adds the new batch first, then removes the old one', async () => {
    db.current = [old('o1', 'an old question'), old('o2', 'another old question')];

    const res = await refresh();

    expect(res.status).toBe(200);
    const [rows] = insertsInto('prompt_suggestions');
    expect(rows).toHaveLength(15);
    expect(deletedIds()).toEqual(['o1', 'o2']);
    expect(db.deletes[0].filters).toMatchObject({ status: 'new' });
    const { suggestions } = await res.json();
    expect(suggestions).toHaveLength(15);
  });

  it('leaves the old batch in place when the insert fails', async () => {
    db.current = [old('o1', 'an old question')];
    // A database without 00362 turns down source 'catalog'.
    db.insertError = { code: '23514', message: 'violates check constraint' };

    expect((await refresh()).status).toBe(500);
    expect(db.deletes).toEqual([]);
    expect(db.updates).toEqual([]);
  });

  it('refreshes a text it already has in its own row, not a second one', async () => {
    const repeated = suggestion(3).text;
    db.current = [old('o1', repeated.toUpperCase()), old('o2', 'an old question')];

    const res = await refresh();

    expect(res.status).toBe(200);
    const [rows] = insertsInto('prompt_suggestions');
    expect(rows).toHaveLength(14);
    expect(rows.some((r) => r.suggested_text === repeated)).toBe(false);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({
      row: { suggested_text: repeated, status: 'new' },
      filters: { id: 'o1', status: 'new' },
    });
    expect(deletedIds()).toEqual(['o2']);
    const { suggestions } = await res.json();
    expect(suggestions).toHaveLength(15);
    expect(suggestions[3]).toMatchObject({ id: 'o1', suggested_text: repeated });
  });
});
