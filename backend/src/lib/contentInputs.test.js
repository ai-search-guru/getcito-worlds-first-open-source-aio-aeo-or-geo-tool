import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Brief › Your input as the Content Agent reads it (CE-048): numbered after
 * the draft's other sources, each as the person gave it, with Quality's
 * second phase only.
 */

let row;
const reads = [];
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: (col, value) => (reads.push([table, col, value]), chain),
        maybeSingle: async () => ({ data: row, error: null }),
      };
      return chain;
    },
  },
}));

const { TABLE_CHARS, inputSources, readDraftInputs } = await import('./contentInputs.js');
const { knownNumbers, numberSources, sourceWords, sourcesPrompt } =
  await import('./contentSources.js');
const { guardPeople, knownPeople } = await import('./contentPeople.js');

const QUOTE = {
  name: 'Ada Lovelace',
  title: 'Head of Research, Acme',
  text: 'We cut our forecast misses in half.',
  sourceUrl: 'https://acme.example/talk',
};

let phase;
beforeEach(() => {
  phase = process.env.CONTENT_QUALITY_PHASE;
  row = null;
  reads.length = 0;
});
afterEach(() => {
  if (phase === undefined) delete process.env.CONTENT_QUALITY_PHASE;
  else process.env.CONTENT_QUALITY_PHASE = phase;
});

describe('readDraftInputs', () => {
  it("reads nothing before Quality's second phase", async () => {
    row = { experience: 'We tested it.' };
    process.env.CONTENT_QUALITY_PHASE = '1';
    expect(await readDraftInputs('d1')).toBeNull();
    expect(reads).toEqual([]);
  });

  it("reads the draft's input in it", async () => {
    row = { experience: 'We tested it.' };
    process.env.CONTENT_QUALITY_PHASE = '2';
    expect(await readDraftInputs('d1')).toEqual(row);
    expect(reads).toEqual([['content_draft_inputs', 'draft_id', 'd1']]);
  });
});

describe('inputSources', () => {
  it('lists the experience, each table, each prompt’s GetCito data and each quote, in order', () => {
    const sources = inputSources(
      {
        experience: `We tested three grinders for six weeks in our roastery. ${'More. '.repeat(20)}`,
        data: [
          {
            name: 'Survey',
            rows: [
              ['Teams', 'Share'],
              ['1,250', '42%'],
            ],
          },
        ],
        getcito_data: [
          {
            promptId: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
            prompt: 'best pour-over grinder',
            answers: 825,
            mentioned: 28,
            asOf: '2026-10-03',
            days: 30,
          },
        ],
        quotes: [QUOTE],
      },
      'Acme Coffee',
    );
    expect(sources.map((s) => [s.kind, s.ref, s.label])).toEqual([
      [
        'input',
        'experience',
        'We tested three grinders for six weeks in our roastery. More. More. More. More.…',
      ],
      ['input', 'data:1', 'Survey'],
      ['input', 'getcito:5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29', 'best pour-over grinder'],
      ['input', 'quote:1', 'Ada Lovelace, Head of Research, Acme'],
    ]);
    expect(sources[1].detail).toBe('Their own data, a table: Teams | Share; 1,250 | 42%');
    expect(sources[2].detail).toBe(
      'GetCito data: Acme Coffee was named in 28 of 825 AI answers to this prompt over the last 30 days (3.4%). Cite it as "GetCito data, October 2026"',
    );
    expect(sources[2].note).toBe('to 2026-10-03');
    expect(sources[3].detail).toContain('"We cut our forecast misses in half."');
    expect(sources[3].note).toBe('said at https://acme.example/talk');
  });

  it('gives no number from where a source was said or when: its address and date are notes', () => {
    // The days are the data the person chose: a page may say them.
    const [getcito, quote] = inputSources(
      {
        getcito_data: [
          {
            promptId: 'p1',
            prompt: 'crm for teams',
            answers: 825,
            mentioned: 28,
            asOf: '2026-10-03',
            days: 30,
          },
        ],
        quotes: [{ ...QUOTE, sourceUrl: 'https://acme.example/blog/2024/05/report-500-teams' }],
      },
      'Acme',
    );
    expect(knownNumbers(sourceWords(quote)).has('500')).toBe(false);
    expect(knownNumbers(sourceWords(getcito)).has('10')).toBe(false);
    expect(knownNumbers(sourceWords(getcito)).has('03')).toBe(false);
    expect(knownNumbers(sourceWords(getcito)).has('30')).toBe(true);
    expect(knownNumbers(sourceWords(getcito)).has('825')).toBe(true);
    // The model still reads them.
    expect(sourcesPrompt(numberSources({ inputs: [quote] }))).toContain(
      '— said at https://acme.example/blog/2024/05/report-500-teams',
    );
  });

  it('keeps the person’s words on one line, its quotes closed, never half of an emoji', () => {
    const [experience, table, quote] = inputSources({
      experience: `We tested it.\n\n- Then we ${'😀'.repeat(80)}`,
      data: [{ name: 'Visits', rows: [['Oct', '3,400\n(est.)']] }],
      quotes: [{ ...QUOTE, text: 'It "just works".' }],
    });
    expect(experience.detail).toBe(
      `Their experience, first-hand: We tested it. - Then we ${'😀'.repeat(80)}`,
    );
    expect(experience.label.endsWith('😀…')).toBe(true);
    expect(experience.label).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(table.detail).toBe('Their own data, a table: Oct | 3,400 (est.)');
    expect(quote.detail).toContain(`"It 'just works'."`);
  });

  it('leaves out what isn’t whole: a quote without its parts, a table without rows', () => {
    expect(
      inputSources({
        experience: '  ',
        data: [{ name: 'Empty', rows: [] }, { rows: [['1']] }],
        getcito_data: [{ promptId: 'p', prompt: 'x', answers: 1, mentioned: 0 }],
        quotes: [
          { ...QUOTE, title: '' },
          { ...QUOTE, sourceUrl: 'javascript:alert(1)' },
        ],
      }),
    ).toEqual([]);
    expect(inputSources(null)).toEqual([]);
  });

  it('gives the model a table only up to its cap', () => {
    const rows = Array.from({ length: 100 }, () =>
      Array.from({ length: 12 }, () => 'x'.repeat(50)),
    );
    const [table] = inputSources({ data: [{ name: 'Big', rows }] });
    expect(table.detail).toHaveLength(
      'Their own data, a table: '.length + TABLE_CHARS + '… (first rows)'.length,
    );
    expect(table.detail.endsWith('… (first rows)')).toBe(true);
  });

  it('numbers them last, tells the model what to do with them, and lets their numbers and people in', () => {
    const inputs = inputSources({ data: [{ name: 'Survey', rows: [['1,250']] }], quotes: [QUOTE] });
    const numbered = numberSources({
      fanouts: [{ query: 'pour over ratio', platforms: [] }],
      inputs,
    });
    expect(numbered.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
    const prompt = sourcesPrompt(numbered);
    expect(prompt).toContain(`S2 Your input (the person's own, given for this page): "Survey"`);
    expect(prompt).toContain('add nothing to it');
    expect(
      sourcesPrompt(numberSources({ fanouts: [{ query: 'q', platforms: [] }] })),
    ).not.toContain('Your input is');
    expect(knownNumbers(sourceWords(numbered[1])).has('1250')).toBe(true);
    const people = knownPeople(...numbered.map(sourceWords));
    expect(
      guardPeople('“We cut our forecast misses in half,” says Ada Lovelace.', people).text,
    ).toBe('“We cut our forecast misses in half,” says Ada Lovelace.');
  });
});
