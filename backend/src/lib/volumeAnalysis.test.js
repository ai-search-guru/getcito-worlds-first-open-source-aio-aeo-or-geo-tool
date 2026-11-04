import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A minimal stand-in for the supabase query builder.
 *
 * It records every filter each query was built with, which is half the point:
 * the failures this file guards against were never wrong results, they were
 * queries shaped so that PostgREST truncated them or refused to carry them.
 */
const MAX_ROWS = 1000;

function makeSupabase(db) {
  const queries = [];

  function builder(table) {
    const state = { table, filters: [], range: null, count: null, head: false };
    queries.push(state);

    const resolve = () => {
      let rows = (db[table] || []).filter((row) =>
        state.filters.every((f) => matches(table, row, f, db)),
      );
      if (state.count === 'exact') {
        const count = rows.length;
        return { data: state.head ? null : rows, count, error: null };
      }
      // PostgREST answers an un-paginated select with its first MAX_ROWS and
      // no indication that more exist. Reproducing that here is what makes the
      // pagination test mean anything.
      rows = state.range ? rows.slice(state.range[0], state.range[1] + 1) : rows.slice(0, MAX_ROWS);
      return { data: rows, count: null, error: null };
    };

    const api = {
      select(cols, opts = {}) {
        state.cols = cols;
        state.count = opts.count ?? null;
        state.head = opts.head ?? false;
        return api;
      },
      eq(col, val) {
        state.filters.push(['eq', col, val]);
        return api;
      },
      in(col, vals) {
        state.filters.push(['in', col, vals]);
        return api;
      },
      order() {
        return api;
      },
      range(from, to) {
        state.range = [from, to];
        return api;
      },
      maybeSingle() {
        const { data, error } = resolve();
        return Promise.resolve({ data: data[0] ?? null, error });
      },
      single() {
        const { data, error } = resolve();
        return Promise.resolve({ data: data[0] ?? null, error });
      },
      upsert(row) {
        state.upserted = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: `v-${row.prompt_id}`, ...row },
                error: null,
              }),
          }),
        };
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { client: { from: builder }, queries };
}

/** Resolves `prompts.is_active`-style embedded columns against the joined row. */
function matches(table, row, [op, col, val], db) {
  let target = row;
  let column = col;

  if (col.includes('.')) {
    const [embed, embedCol] = col.split('.');
    if (table !== 'prompt_volumes' || embed !== 'prompts') {
      throw new Error(`test fake cannot resolve embed ${table}.${col}`);
    }
    target = db.prompts.find((p) => p.id === row.prompt_id) || {};
    column = embedCol;
  }

  return op === 'eq' ? target[column] === val : val.includes(target[column]);
}

function seed({ activeCount = 0, inactiveCount = 0, withVolumes = [] } = {}) {
  const prompts = [];
  for (let i = 0; i < activeCount; i += 1) {
    prompts.push({ id: `p${i}`, text: `prompt ${i}`, prompt_set_id: 's1', is_active: true });
  }
  for (let i = 0; i < inactiveCount; i += 1) {
    prompts.push({ id: `off${i}`, text: `off ${i}`, prompt_set_id: 's1', is_active: false });
  }
  return {
    brands: [{ id: 'b1', region: 'US', language: 'en', organization_id: 'o1' }],
    prompt_sets: [{ id: 's1', brand_id: 'b1' }],
    prompts,
    prompt_volumes: withVolumes.map((id) => ({
      prompt_id: id,
      intent: 'saved intent',
      keywords: ['saved keyword'],
    })),
  };
}

const extractIntentKeywords = vi.fn();
const getSearchVolumes = vi.fn();
const isOrgActive = vi.fn();

async function load(db) {
  const { client, queries } = makeSupabase(db);
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: client }));
  vi.doMock('./dataforseo.js', () => ({ getSearchVolumes }));
  vi.doMock('./activeSubscriptions.js', () => ({ isOrgActive }));
  vi.doMock('./aiProvider.js', () => ({ resolveModel: () => 'model' }));
  vi.doMock('./intentExtraction.js', () => ({
    AI_VOLUME_MULTIPLIER: 0.15,
    extractIntentKeywords,
  }));
  vi.doMock('./logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });
  const mod = await import('./volumeAnalysis.js');
  return { ...mod, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  extractIntentKeywords.mockResolvedValue({ intent: 'informational', keywords: ['a', 'b'] });
  // Every organization on a plan unless a test says otherwise.
  isOrgActive.mockResolvedValue(true);
  getSearchVolumes.mockResolvedValue({
    a: { volume: 10, competitionIndex: 50, competition: 'MEDIUM' },
  });
});

/**
 * The Prompts page used to send its prompts inline and the route refused more
 * than 50 of them, so a 100-prompt brand had a button that could not succeed
 * The brand is now the unit of work, and nothing about its size is a
 * reason to refuse it.
 */
describe('analyzeBrandVolumes', () => {
  /**
   * Once the plan has ended (2026-10-27): no model call, no DataForSEO
   * request, nothing written, whoever asks (the internal trigger has no 402
   * in front of it).
   */
  it("looks up nothing for a brand whose organization's plan has ended", async () => {
    isOrgActive.mockResolvedValue(false);
    const { analyzeBrandVolumes, queries } = await load(seed({ activeCount: 3 }));

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toEqual([]);
    expect(isOrgActive).toHaveBeenCalledWith('o1');
    expect(extractIntentKeywords).not.toHaveBeenCalled();
    expect(getSearchVolumes).not.toHaveBeenCalled();
    expect(queries.map((q) => q.table)).toEqual(['brands']);
  });

  it('looks up nothing for a demo brand (00380), whose volumes are sample data', async () => {
    const db = seed({ activeCount: 3 });
    db.brands[0].is_demo = true;
    const { analyzeBrandVolumes, queries } = await load(db);

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toEqual([]);
    expect(extractIntentKeywords).not.toHaveBeenCalled();
    expect(getSearchVolumes).not.toHaveBeenCalled();
    expect(queries.map((q) => q.table)).toEqual(['brands']);
  });

  it("asks about the brand's own organization, and goes on when it is on a plan", async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 2 }));

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toHaveLength(2);
    expect(isOrgActive).toHaveBeenCalledWith('o1');
    expect(getSearchVolumes).toHaveBeenCalled();
  });

  it('analyzes a brand far past the old 50-prompt refusal', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 100 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(100);
    expect(results.every((r) => !r.error)).toBe(true);
  });

  // PostgREST returns 1000 rows for an un-paginated select and says nothing
  // about the rest, which is how #714 and #740 each lost data silently. A brand
  // is allowed up to 1000 prompts today, so this sits exactly on the edge.
  it('pages past the 1000-row cap instead of truncating', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1500 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(1500);
  });

  it('leaves inactive prompts alone', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3, inactiveCount: 4 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.promptId).sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('skips prompts that already have volumes when only filling gaps', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 4, withVolumes: ['p0', 'p2'] }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results.map((r) => r.promptId)).toEqual(['p1', 'p3']);
  });

  it('reuses saved keywords rather than paying for the LLM again', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 2, withVolumes: ['p0', 'p1'] }));

    await analyzeBrandVolumes('b1');

    expect(extractIntentKeywords).not.toHaveBeenCalled();
    expect(getSearchVolumes).toHaveBeenCalledWith(['saved keyword'], expect.anything());
  });

  it('re-generates keywords for every active prompt under force', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3, withVolumes: ['p0'] }));

    const results = await analyzeBrandVolumes('b1', { force: true });

    expect(results).toHaveLength(3);
    expect(extractIntentKeywords).toHaveBeenCalledTimes(3);
  });

  // Keyword extraction is still per prompt, so its failures still are: one
  // prompt whose LLM call fails does not take the rest of the brand with it.
  it('records a keyword-extraction failure against that prompt alone', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3 }));
    extractIntentKeywords.mockRejectedValueOnce(new Error('model overloaded'));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.error)).toHaveLength(1);
    expect(results.filter((r) => !r.error)).toHaveLength(2);
  });

  it('returns nothing for a brand with no prompt sets', async () => {
    const db = seed({ activeCount: 2 });
    db.prompt_sets = [];
    const { analyzeBrandVolumes } = await load(db);

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toEqual([]);
  });

  /**
   * DataForSEO bills per request and takes up to 1000 keywords in one. Asking
   * per prompt cost $0.09 each — $9.00 for a 100-prompt brand doing work a
   * single request covers. These pin the request count, which is the bill.
   */
  it('looks up a 100-prompt brand in one request, not a hundred', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 100 }));
    extractIntentKeywords.mockImplementation((text) =>
      Promise.resolve({ intent: 'informational', keywords: [`${text} a`, `${text} b`] }),
    );

    await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(getSearchVolumes).toHaveBeenCalledTimes(1);
    expect(getSearchVolumes.mock.calls[0][0]).toHaveLength(200);
  });

  it('splits into one request per 1000 keywords and no more', async () => {
    // 600 prompts x 5 distinct keywords = 3000 keywords = 3 requests.
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 600 }));
    extractIntentKeywords.mockImplementation((text) =>
      Promise.resolve({
        intent: 'informational',
        keywords: Array.from({ length: 5 }, (_, i) => `${text} kw${i}`),
      }),
    );

    await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(getSearchVolumes).toHaveBeenCalledTimes(3);
    for (const [chunk] of getSearchVolumes.mock.calls) {
      expect(chunk.length).toBeLessThanOrEqual(1000);
    }
  });

  it('sends a keyword shared by several prompts only once', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 10 }));
    extractIntentKeywords.mockResolvedValue({ intent: 'informational', keywords: ['same', 'kw'] });

    await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(getSearchVolumes).toHaveBeenCalledTimes(1);
    expect(getSearchVolumes.mock.calls[0][0]).toEqual(['same', 'kw']);
  });

  // Each prompt must read only its own keywords out of a map that now holds
  // the whole brand's, or every prompt would report the brand's total volume.
  it('gives each prompt only its own keywords out of the shared answer', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 2 }));
    extractIntentKeywords
      .mockResolvedValueOnce({ intent: 'i', keywords: ['alpha'] })
      .mockResolvedValueOnce({ intent: 'i', keywords: ['beta'] });
    getSearchVolumes.mockResolvedValue({
      alpha: { volume: 100, competitionIndex: 10, competition: 'LOW' },
      beta: { volume: 7, competitionIndex: 90, competition: 'HIGH' },
    });

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results.map((r) => r.totalGoogleVolume).sort((a, b) => a - b)).toEqual([7, 100]);
    expect(results.map((r) => r.googleVolumes)).toEqual([{ alpha: 100 }, { beta: 7 }]);
  });

  // The response echoes keywords in its own normalised form, so a prompt whose
  // keyword differs only by case must still find its volume.
  it('matches keywords back case-insensitively', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1 }));
    extractIntentKeywords.mockResolvedValue({ intent: 'i', keywords: ['Best CRM Software'] });
    getSearchVolumes.mockResolvedValue({
      'best crm software': { volume: 500, competitionIndex: 40, competition: 'MEDIUM' },
    });

    const [row] = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(row.totalGoogleVolume).toBe(500);
  });

  // The five keywords are overlapping head terms for the prompt's category,
  // so their sum counted the same searchers several times, and one product
  // name (5M a month) set a prompt at ~755k. The median leaves it out.
  it("takes the median of a prompt's keyword volumes, not their sum", async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1 }));
    extractIntentKeywords.mockResolvedValue({
      intent: 'how-to',
      keywords: [
        'generative engine optimization',
        'ai seo',
        'google gemini',
        'content strategy',
        'search optimization',
      ],
    });
    getSearchVolumes.mockResolvedValue({
      'generative engine optimization': { volume: 4400, competitionIndex: 20, competition: 'LOW' },
      'ai seo': { volume: 8100, competitionIndex: 30, competition: 'LOW' },
      'google gemini': { volume: 5000000, competitionIndex: 10, competition: 'LOW' },
      'content strategy': { volume: 3600, competitionIndex: 40, competition: 'MEDIUM' },
      'search optimization': { volume: 18100, competitionIndex: 50, competition: 'MEDIUM' },
    });

    const [row] = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(row.totalGoogleVolume).toBe(8100);
    expect(row.estAiVolume).toBe(1215);
    // Every keyword's own volume is still kept for the UI.
    expect(Object.keys(row.googleVolumes)).toHaveLength(5);
  });

  it('leaves keywords Google cannot measure out of the median', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1 }));
    extractIntentKeywords.mockResolvedValue({ intent: 'i', keywords: ['rare', 'mid', 'big'] });
    getSearchVolumes.mockResolvedValue({
      rare: { volume: 0, competitionIndex: null, competition: null },
      mid: { volume: 1000, competitionIndex: null, competition: null },
      big: { volume: 3000, competitionIndex: null, competition: null },
    });

    const [row] = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(row.totalGoogleVolume).toBe(2000);
    expect(row.estAiVolume).toBe(300);
  });

  it('reads 0 when none of the keywords has a volume', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1 }));
    extractIntentKeywords.mockResolvedValue({ intent: 'i', keywords: ['rare', 'rarer'] });
    getSearchVolumes.mockResolvedValue({
      rare: { volume: 0, competitionIndex: null, competition: null },
    });

    const [row] = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(row.totalGoogleVolume).toBe(0);
    expect(row.estAiVolume).toBe(0);
  });

  it('counts a keyword listed twice, in any case, once', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1 }));
    extractIntentKeywords.mockResolvedValue({ intent: 'i', keywords: ['CRM', 'crm', 'tools'] });
    getSearchVolumes.mockResolvedValue({
      crm: { volume: 100, competitionIndex: 20, competition: 'LOW' },
      tools: { volume: 300, competitionIndex: 80, competition: 'HIGH' },
    });

    const [row] = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(row.googleVolumes).toEqual({ crm: 100, tools: 300 });
    expect(row.totalGoogleVolume).toBe(200);
    // The duplicate doesn't weigh twice in the competition average either.
    expect(row.competitionIndex).toBe(65);
  });

  // One request now stands in for up to two hundred prompts, so a blip that
  // used to cost one prompt would cost all of them. It is retried first.
  it('retries a failed request before giving up on the batch', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 5 }));
    getSearchVolumes
      .mockRejectedValueOnce(new Error('DataForSEO API error (429)'))
      .mockResolvedValue({ a: { volume: 10, competitionIndex: 50, competition: 'MEDIUM' } });

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(getSearchVolumes).toHaveBeenCalledTimes(2);
    expect(results.filter((r) => r.error)).toHaveLength(0);
  });

  it('fails every prompt the request covered when it cannot be retried through', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 5 }));
    getSearchVolumes.mockRejectedValue(new Error('DataForSEO down'));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(5);
    expect(results.every((r) => r.error)).toBe(true);
  });

  // An `.in()` filter travels in the query string, so a list of prompt ids is a
  // request-line overflow waiting for a big enough brand — the failure #741 was
  // opened for. Scoping through prompt_sets keeps the filter one id wide.
  it('never filters by a list of prompt ids', async () => {
    const { analyzeBrandVolumes, queries } = await load(seed({ activeCount: 1200 }));

    await analyzeBrandVolumes('b1', { onlyMissing: true });

    const idFilters = queries.flatMap((q) =>
      q.filters.filter(([op, col]) => op === 'in' && col === 'prompt_id'),
    );
    expect(idFilters).toEqual([]);
  });
});

/**
 * Progress reporting.
 *
 * Batching moved every write to the end of the run, so a progress figure taken
 * from the table sat at zero for the whole wait and then jumped. These pin the
 * report to the work itself, one prompt at a time.
 */
describe('analyzeBrandVolumes progress', () => {
  it('reports the total before any prompt has been worked on', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 12 }));
    const seen = [];

    await analyzeBrandVolumes('b1', { onlyMissing: true, onProgress: (p) => seen.push(p) });

    expect(seen[0]).toEqual({ done: 0, total: 12 });
  });

  it('advances once per prompt rather than all at once at the end', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 5 }));
    const seen = [];

    await analyzeBrandVolumes('b1', { onlyMissing: true, onProgress: (p) => seen.push(p) });

    expect(seen.map((p) => p.done)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(seen.every((p) => p.total === 5)).toBe(true);
  });

  // A prompt whose keyword extraction failed is still a prompt the run has
  // finished with; leaving it out would stall the count short of the total.
  it('counts a failed prompt as done', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3 }));
    extractIntentKeywords.mockRejectedValueOnce(new Error('model overloaded'));
    const seen = [];

    await analyzeBrandVolumes('b1', { onlyMissing: true, onProgress: (p) => seen.push(p) });

    expect(seen[seen.length - 1]).toEqual({ done: 3, total: 3 });
  });

  it('runs without a listener at all', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 2 }));

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toHaveLength(2);
  });

  // The listener belongs to the UI. A broken one must not cost the run, which
  // by then may be most of a quarter-hour of work.
  it('survives a listener that throws', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3 }));

    const results = await analyzeBrandVolumes('b1', {
      onlyMissing: true,
      onProgress: () => {
        throw new Error('listener blew up');
      },
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.error)).toBe(true);
  });
});

/**
 * Refreshing re-reads Google volumes for prompts that already have keywords.
 * It never calls the LLM, so after batching the whole refresh is one request
 * per 1000 keywords — it used to be one request per prompt.
 */
describe('refreshBrandVolumes', () => {
  it('refreshes a brand in one request and never calls the LLM', async () => {
    const withVolumes = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const { refreshBrandVolumes } = await load(seed({ activeCount: 40, withVolumes }));

    const results = await refreshBrandVolumes('b1');

    expect(results).toHaveLength(40);
    expect(getSearchVolumes).toHaveBeenCalledTimes(1);
    expect(extractIntentKeywords).not.toHaveBeenCalled();
  });

  it('reuses the saved keywords rather than inventing new ones', async () => {
    const { refreshBrandVolumes } = await load(seed({ activeCount: 2, withVolumes: ['p0', 'p1'] }));

    await refreshBrandVolumes('b1');

    expect(getSearchVolumes.mock.calls[0][0]).toEqual(['saved keyword']);
  });

  it('skips rows that carry no keywords to look up', async () => {
    const db = seed({ activeCount: 2, withVolumes: ['p0', 'p1'] });
    db.prompt_volumes[1].keywords = [];
    const { refreshBrandVolumes } = await load(db);

    expect(await refreshBrandVolumes('b1')).toHaveLength(1);
  });

  it('returns nothing for a brand with no prompt sets', async () => {
    const db = seed({ activeCount: 2, withVolumes: ['p0'] });
    db.prompt_sets = [];
    const { refreshBrandVolumes } = await load(db);

    expect(await refreshBrandVolumes('b1')).toEqual([]);
    expect(getSearchVolumes).not.toHaveBeenCalled();
  });
});

/**
 * The pair the Prompts page polls while a run is in flight. It has to agree
 * with what analyzeBrandVolumes actually does, or the progress readout stalls
 * short of the end or claims to pass it.
 */
describe('getVolumeProgress', () => {
  it('counts active prompts and how many of them carry volumes', async () => {
    const { getVolumeProgress } = await load(
      seed({ activeCount: 5, inactiveCount: 3, withVolumes: ['p0', 'p1'] }),
    );

    expect(await getVolumeProgress('b1')).toEqual({ total: 5, analyzed: 2 });
  });

  // A volume row left behind by a prompt that has since been deactivated must
  // not count towards a total that excludes it — otherwise analyzed > total and
  // the page reports progress past the end.
  it('ignores volumes belonging to deactivated prompts', async () => {
    const db = seed({ activeCount: 2, inactiveCount: 1, withVolumes: ['p0', 'off0'] });
    const { getVolumeProgress } = await load(db);

    expect(await getVolumeProgress('b1')).toEqual({ total: 2, analyzed: 1 });
  });

  it('reports zero for a brand with no prompt sets', async () => {
    const db = seed({ activeCount: 3 });
    db.prompt_sets = [];
    const { getVolumeProgress } = await load(db);

    expect(await getVolumeProgress('b1')).toEqual({ total: 0, analyzed: 0 });
  });
});

describe('medianVolume', () => {
  it('takes the middle volume, or the mean of the middle two', async () => {
    const { medianVolume } = await load(seed());
    expect(medianVolume([18100, 9900, 6600, 4400])).toBe(8250);
    expect(medianVolume([2400, 4400, 880])).toBe(2400);
  });

  it('ignores zeros and reads 0 for nothing measured', async () => {
    const { medianVolume } = await load(seed());
    expect(medianVolume([0, 0, 500])).toBe(500);
    expect(medianVolume([])).toBe(0);
  });
});
