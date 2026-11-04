// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The evidence drawer (CHAT-22 §1 item 4): the answer behind a row of the
 * run's n-th analysis, read by its places, only of the analysis's brand; a
 * row whose evidence isn't an answer opens none. Its passage: a short cut of
 * the engine's answer around the brand's first mention, the name marked.
 */

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, filters: [] as unknown[][] }));

/** A small client: eq filters, rows in order; brands has no domain column, as the database. */
const client = () => ({
  from: (table: string) => {
    const filters: [string, unknown][] = [];
    let columns = '';
    const rows = () =>
      (db.tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));
    const result = () =>
      table === 'brands' && /\bdomain\b/.test(columns)
        ? { data: null, error: { message: 'column brands.domain does not exist' } }
        : null;
    const chain = {
      select: (cols: string) => ((columns = cols), chain),
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        db.filters.push([table, column, value]);
        return chain;
      },
      order: () => chain,
      maybeSingle: async () => result() ?? { data: rows()[0] ?? null, error: null },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(result() ?? { data: rows(), error: null }).then(resolve),
    };
    return chain;
  },
});
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: client() }));

const { passageAround, readWhyAnswer } = await import('./answer');

const RUN = 'run-1';
const analysis = (brandId: string, answerId: string, type = 'answer') => ({
  run_id: RUN,
  brand_id: brandId,
  result_json: {
    causes: [
      {
        rows: [{ prompt: 'p', answer: { type, id: answerId, date: '2026-10-24', period: 'b' } }],
      },
    ],
  },
});

beforeEach(() => {
  db.filters = [];
  db.tables = {
    chat_why_analyses: [analysis('b1', 'ans-first'), analysis('b1', 'ans-second')],
    prompt_results: [
      {
        id: 'ans-second',
        brand_id: 'b1',
        platform: 'google-aio',
        model_used: null,
        created_at: '2026-10-24T08:00:00Z',
        response: 'For AEO, Acme and Lumora are cited most.',
        citations: [
          { url: 'https://www.acme.example/pricing' },
          { url: 'https://lumora.example/x' },
        ],
      },
      // Another brand's answer, with the same id a crafted analysis could name.
      { id: 'ans-other', brand_id: 'b2', response: 'secret', citations: [] },
    ],
    brands: [{ id: 'b1', name: 'Acme' }],
    brand_domains: [{ brand_id: 'b1', domain: 'acme.example' }],
  };
});

describe('readWhyAnswer', () => {
  it('opens the row’s answer in the run’s n-th analysis, its brand marked, its own pages known', async () => {
    const answer = await readWhyAnswer(RUN, 2, 0, 0);
    expect(answer).toEqual({
      engine: 'google-aio',
      date: '2026-10-24',
      passage: [
        { text: 'For AEO, ', mark: false },
        { text: 'Acme', mark: true },
        { text: ' and Lumora are cited most.', mark: false },
      ],
      citations: [
        { url: 'acme.example/pricing', own: true },
        { url: 'lumora.example/x', own: false },
      ],
    });
    // Only the analysis's brand's answers.
    expect(db.filters).toContainEqual(['prompt_results', 'brand_id', 'b1']);
  });

  it('opens nothing for a place that isn’t one, an audit row, or another brand’s answer', async () => {
    expect(await readWhyAnswer(RUN, 3, 0, 0)).toBeNull();
    expect(await readWhyAnswer(RUN, 1, 0, 0)).toBeNull();
    expect(await readWhyAnswer(RUN, 2, 1, 0)).toBeNull();
    db.tables.chat_why_analyses = [analysis('b1', 'ans-second', 'audit')];
    expect(await readWhyAnswer(RUN, 1, 0, 0)).toBeNull();
    db.tables.chat_why_analyses = [analysis('b1', 'ans-other')];
    expect(await readWhyAnswer(RUN, 1, 0, 0)).toBeNull();
  });
});

describe('passageAround', () => {
  it('marks every mention of the name, whatever its case', () => {
    expect(passageAround('Acme and  lumora.\nACME again.', 'acme')).toEqual([
      { text: 'Acme', mark: true },
      { text: ' and lumora. ', mark: false },
      { text: 'ACME', mark: true },
      { text: ' again.', mark: false },
    ]);
  });

  it('cuts a long answer around the first mention, with an ellipsis each side', () => {
    const text = `${'a '.repeat(300)}Acme is cited.${' b'.repeat(300)}`;
    const passage = passageAround(text, 'Acme');
    expect(passage[0]).toEqual({ text: '…', mark: false });
    expect(passage.at(-1)).toEqual({ text: '…', mark: false });
    expect(passage.filter((p) => p.mark).map((p) => p.text)).toEqual(['Acme']);
    expect(passage.map((p) => p.text).join('').length).toBeLessThanOrEqual(322);
  });

  it('shows the start, unmarked, when the brand isn’t named', () => {
    const passage = passageAround(`Lumora leads. ${'x'.repeat(400)}`, 'Acme');
    expect(passage).toHaveLength(2);
    expect(passage[0].text.startsWith('Lumora leads.')).toBe(true);
    expect(passage.some((p) => p.mark)).toBe(false);
    expect(passageAround('Lumora leads.', '')).toEqual([{ text: 'Lumora leads.', mark: false }]);
  });
});
