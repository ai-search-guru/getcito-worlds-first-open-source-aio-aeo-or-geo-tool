import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Coverage arithmetic for the By-prompt view: `runsWithFanout / totalRuns` is
 * the denominator that tells "the engines never search for this prompt" apart
 * from "we barely track this prompt". It is derived from the same single pass
 * over prompt_results that builds the sub-query list, so the two views can
 * never disagree — these tests pin that contract.
 */

interface QueryState {
  table: string;
  eq: Record<string, unknown>;
  inFilter?: { column: string; values: string[] };
  range?: [number, number];
  /** The single-row lookup (lastFanoutAt): `.not(…).limit(1).maybeSingle()`. */
  single?: boolean;
}

const SET_ID = 'set-1';

type ResultRow = {
  prompt_id: string | null;
  platform: string | null;
  search_queries: unknown;
};

type PromptRow = { id: string; text: string; is_active: boolean };

let resultRows: ResultRow[] = [];
let rosterRows: PromptRow[] = [];
/** Prompts reachable only by id — e.g. moved out of the brand's sets. */
let residualRows: PromptRow[] = [];
let promptSetRows: { id: string }[] = [];
/** What the last-fan-out lookup finds, per platform. */
let lastFanoutRows: Record<string, string> = {};
/** When set, prompt_results always returns a full page (drives truncation). */
let alwaysFullPage = false;
let residualError: string | null = null;
let calls: QueryState[] = [];

function resolveQuery(state: QueryState): {
  data: unknown[] | null;
  error: { message: string } | null;
} {
  const slice = <T>(rows: T[]): T[] => {
    if (!state.range) return rows;
    const [from, to] = state.range;
    return rows.slice(from, to + 1);
  };

  if (state.table === 'prompt_results' && state.single) {
    const at = lastFanoutRows[state.eq.platform as string];
    return { data: at ? ({ created_at: at } as never) : null, error: null };
  }

  if (state.table === 'prompt_results') {
    if (alwaysFullPage) {
      const [from, to] = state.range ?? [0, 0];
      return { data: Array.from({ length: to - from + 1 }, () => resultRows[0]), error: null };
    }
    const rows = resultRows.filter(
      (r) => state.eq.prompt_id === undefined || r.prompt_id === state.eq.prompt_id,
    );
    return { data: slice(rows), error: null };
  }

  if (state.table === 'prompt_sets') return { data: promptSetRows, error: null };

  if (state.table === 'prompts') {
    if (state.inFilter?.column === 'prompt_set_id') return { data: slice(rosterRows), error: null };
    if (state.inFilter?.column === 'id') {
      if (residualError) return { data: null, error: { message: residualError } };
      const ids = new Set(state.inFilter.values);
      return { data: residualRows.filter((p) => ids.has(p.id)), error: null };
    }
  }

  return { data: [], error: null };
}

function fakeQueryBuilder(table: string) {
  const state: QueryState = { table, eq: {} };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      state.eq[column] = value;
      return builder;
    },
    gte: () => builder,
    lt: () => builder,
    not: () => builder,
    limit: () => builder,
    maybeSingle: () => {
      state.single = true;
      return builder;
    },
    order: () => builder,
    in: (column: string, values: string[]) => {
      state.inFilter = { column, values };
      return builder;
    },
    range: (from: number, to: number) => {
      state.range = [from, to];
      return builder;
    },
    // PostgREST builders are thenables — awaiting one runs the query.
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      calls.push({ ...state, eq: { ...state.eq } });
      return Promise.resolve(resolveQuery(state)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from: (table: string) => fakeQueryBuilder(table) }),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/actions/prompt', () => ({ addPromptToSet: vi.fn() }));

function answer(prompt_id: string | null, queries: unknown, platform = 'copilot'): ResultRow {
  return { prompt_id, platform, search_queries: queries };
}

const q = (query: string) => ({ query, source_platform: 'copilot' });

beforeEach(() => {
  calls = [];
  lastFanoutRows = {};
  alwaysFullPage = false;
  residualError = null;
  promptSetRows = [{ id: SET_ID }];
  rosterRows = [
    { id: 'p-loud', text: 'Best AEO monitoring tools?', is_active: true },
    { id: 'p-quiet', text: 'How do I track brand mentions?', is_active: true },
    { id: 'p-paused', text: 'Legacy prompt', is_active: false },
    { id: 'p-tracked', text: 'AEO Tools', is_active: true },
  ];
  residualRows = [{ id: 'p-external', text: 'Moved to another set', is_active: true }];
  resultRows = [
    // Searches on two of its three answers.
    answer('p-loud', [q('aeo tools'), q('best aeo software')]),
    answer('p-loud', [q('aeo tools')]),
    answer('p-loud', []),
    // Runs constantly, never triggers a search — the row that could not exist
    // before coverage, since the sub-query → prompt inversion had nothing to
    // hang it on.
    answer('p-quiet', []),
    answer('p-quiet', []),
    answer('p-quiet', [{ query: '   ' }, { query: 42 }, {}]),
    answer('p-quiet', null),
    // Same sub-query twice in one answer counts once.
    answer('p-paused', [q('legacy lookup'), q('Legacy  Lookup')]),
    // No prompt attribution: contributes fan-out, but to no coverage bucket.
    answer(null, [q('orphan query')]),
    answer('p-external', [q('aeo tools')]),
  ];
});

describe('getQueryFanout — prompt coverage', () => {
  it('reports a prompt that ran but never triggered a search as 0 of N', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage } = await getQueryFanout('brand-1');

    expect(promptCoverage).toContainEqual({
      id: 'p-quiet',
      text: 'How do I track brand mentions?',
      totalRuns: 4,
      runsWithFanout: 0,
      platforms: ['copilot'],
      fanoutPlatforms: [],
    });
  });

  it('counts blank and non-string sub-queries toward the denominator only', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage, subQueries } = await getQueryFanout('brand-1');

    // The row with '   ' / 42 / {} is a run, but not a run with fan-out.
    const quiet = promptCoverage.find((p) => p.id === 'p-quiet')!;
    expect(quiet.totalRuns).toBe(4);
    expect(quiet.runsWithFanout).toBe(0);
    // …and none of that junk leaked into the sub-query list.
    expect(subQueries.map((s) => s.query)).not.toContain('');
  });

  it('splits a partially-searched prompt as runs-with-fanout over total runs', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage } = await getQueryFanout('brand-1');

    expect(promptCoverage.find((p) => p.id === 'p-loud')).toMatchObject({
      totalRuns: 3,
      runsWithFanout: 2,
    });
  });

  it('counts an answer once when it repeats the same sub-query', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage, subQueries } = await getQueryFanout('brand-1');

    expect(promptCoverage.find((p) => p.id === 'p-paused')).toMatchObject({
      totalRuns: 1,
      runsWithFanout: 1,
    });
    // 'legacy lookup' and 'Legacy  Lookup' normalize to one row, one answer.
    expect(subQueries.find((s) => s.query === 'legacy lookup')?.timesSearched).toBe(1);
  });

  it('excludes answers with no prompt attribution from coverage but not from fan-out', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage, subQueries } = await getQueryFanout('brand-1');

    expect(promptCoverage.map((p) => p.id)).not.toContain(null);
    expect(promptCoverage).toHaveLength(4); // loud, quiet, paused, external
    expect(subQueries.map((s) => s.query)).toContain('orphan query');
  });

  it('gives every sourced prompt a coverage entry', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage, subQueries } = await getQueryFanout('brand-1');

    const covered = new Set(promptCoverage.map((p) => p.id));
    const sourced = subQueries.flatMap((s) => s.sourcedPrompts.map((p) => p.id));
    expect(sourced.length).toBeGreaterThan(0);
    for (const id of sourced) expect(covered).toContain(id);
  });

  it('never reports more searched runs than total runs', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage } = await getQueryFanout('brand-1');

    for (const p of promptCoverage) {
      expect(p.runsWithFanout).toBeLessThanOrEqual(p.totalRuns);
    }
  });

  it('includes paused prompts that ran inside the window', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { promptCoverage, subQueries } = await getQueryFanout('brand-1');

    expect(promptCoverage.map((p) => p.id)).toContain('p-paused');
    // …but a paused prompt must not make its text read as "Tracked ✓".
    expect(subQueries.find((s) => s.query === 'legacy lookup')?.tracked).toBe(false);
  });
});

describe('getQueryFanout — prompt lookups', () => {
  it('serves text and the tracked-prompt map from one roster read', async () => {
    const { getQueryFanout } = await import('./fanout');

    await getQueryFanout('brand-1');

    const promptReads = calls.filter((c) => c.table === 'prompts');
    // One paged roster read + exactly one residual chunk for p-external.
    expect(promptReads.filter((c) => c.inFilter?.column === 'prompt_set_id')).toHaveLength(1);
    expect(promptReads.filter((c) => c.inFilter?.column === 'id')).toHaveLength(1);
  });

  it('skips the residual lookup entirely when the roster covers every prompt', async () => {
    resultRows = resultRows.filter((r) => r.prompt_id !== 'p-external');
    const { getQueryFanout } = await import('./fanout');

    await getQueryFanout('brand-1');

    expect(calls.filter((c) => c.inFilter?.column === 'id')).toHaveLength(0);
  });

  it('matches tracked prompts case- and whitespace-insensitively', async () => {
    const { getQueryFanout } = await import('./fanout');

    const { subQueries } = await getQueryFanout('brand-1');

    // Roster text 'AEO Tools' vs observed sub-query 'aeo tools'.
    expect(subQueries.find((s) => s.query === 'aeo tools')).toMatchObject({
      tracked: true,
      trackedPromptId: 'p-tracked',
    });
  });

  it('fails loudly when a prompt-text chunk errors instead of dropping rows', async () => {
    residualError = 'connection reset';
    const { getQueryFanout } = await import('./fanout');

    // Silently swallowing this would delete p-external from both views, and an
    // under-reported table is indistinguishable from a correct smaller one.
    await expect(getQueryFanout('brand-1')).rejects.toThrow('connection reset');
  });
});

describe('getQueryFanout — window truncation', () => {
  it('reports a complete read as untruncated', async () => {
    const { getQueryFanout } = await import('./fanout');

    await expect(getQueryFanout('brand-1')).resolves.toMatchObject({ truncated: false });
  });

  it('flags the read when the window exceeds the row ceiling', async () => {
    alwaysFullPage = true;
    const { getQueryFanout } = await import('./fanout');

    // Every page comes back full, so the loop exits on the ceiling rather than
    // on the end of the window — the newest answers are missing and the ratios
    // are a lower bound.
    await expect(getQueryFanout('brand-1')).resolves.toMatchObject({ truncated: true });
  });
});

describe('getQueryFanout — engines', () => {
  it("counts each engine's answers, answers with fan-out and distinct sub-queries", async () => {
    resultRows = [
      answer('p-loud', [{ query: 'aeo tools', source_platform: 'copilot-web' }], 'copilot-web'),
      answer('p-loud', [], 'copilot-web'),
      answer('p-loud', [], 'chatgpt-web'),
      answer('p-loud', [], 'google-aio'),
    ];
    const { getQueryFanout } = await import('./fanout');

    const { engines, promptCoverage } = await getQueryFanout('brand-1');

    expect(engines).toEqual([
      {
        platform: 'copilot-web',
        answers: 2,
        answersWithFanout: 1,
        subQueries: 1,
        lastFanoutAt: null,
      },
      {
        platform: 'chatgpt-web',
        answers: 1,
        answersWithFanout: 0,
        subQueries: 0,
        lastFanoutAt: null,
      },
      {
        platform: 'google-aio',
        answers: 1,
        answersWithFanout: 0,
        subQueries: 0,
        lastFanoutAt: null,
      },
    ]);
    expect(promptCoverage.find((p) => p.id === 'p-loud')).toMatchObject({
      platforms: ['chatgpt-web', 'copilot-web', 'google-aio'],
      fanoutPlatforms: ['copilot-web'],
    });
  });

  it('says when an engine that shares its searches last did, and only for such an engine', async () => {
    resultRows = [
      ...Array.from({ length: 20 }, () => answer('p-loud', [], 'perplexity-web')),
      ...Array.from({ length: 20 }, () => answer('p-loud', [], 'gemini-web')),
      ...Array.from({ length: 20 }, () => answer('p-loud', [], 'chatgpt-web')),
    ];
    lastFanoutRows = {
      'perplexity-web': '2026-09-29T05:12:00Z',
      'gemini-web': '2026-09-01T00:00:00Z',
      'chatgpt-web': '2026-09-29T05:12:00Z',
    };
    const { getQueryFanout } = await import('./fanout');

    const { engines } = await getQueryFanout('brand-1');

    expect(engines.find((e) => e.platform === 'perplexity-web')?.lastFanoutAt).toBe(
      '2026-09-29T05:12:00Z',
    );
    // Gemini never shares searches, and ChatGPT no longer does (#1119), so
    // there is nothing to look back for.
    expect(engines.find((e) => e.platform === 'gemini-web')?.lastFanoutAt).toBeNull();
    expect(engines.find((e) => e.platform === 'chatgpt-web')?.lastFanoutAt).toBeNull();
    expect(calls.filter((c) => c.single).map((c) => c.eq.platform)).toEqual(['perplexity-web']);
  });

  it('does not look back for an engine with too few answers to tell', async () => {
    resultRows = Array.from({ length: 4 }, () => answer('p-loud', [], 'perplexity-web'));
    lastFanoutRows = { 'perplexity-web': '2026-09-29T05:12:00Z' };
    const { getQueryFanout } = await import('./fanout');

    const { engines } = await getQueryFanout('brand-1');

    expect(engines[0]).toMatchObject({
      platform: 'perplexity-web',
      answers: 4,
      lastFanoutAt: null,
    });
    expect(calls.filter((c) => c.single)).toHaveLength(0);
  });
});
