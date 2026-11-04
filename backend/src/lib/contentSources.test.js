import { describe, expect, it } from 'vitest';
import {
  MAX_SOURCE_MARKS,
  MAX_SUGGESTION_SOURCES,
  NUMBER_PLACEHOLDER,
  addedNumbers,
  htmlText,
  knownNumbers,
  normalizeQuery,
  numberSources,
  placeholderNumbers,
  placeholderNumbersInHtml,
  sourceSuggestion,
  sourcesPrompt,
  stripSourceIds,
  textPieces,
  todayText,
} from './contentSources.js';

/**
 * The data the Content Agent writes from (Content Editor v1.1, CE-033):
 * numbered for the model, named and marked on each suggestion, and no number
 * without a source.
 */

const numbered = numberSources({
  prompts: [{ id: 'p1', text: 'Best LLM visibility tracker?' }],
  fanouts: [{ query: '  Best LLM  Visibility Tracker 2026 ', platforms: ['chatgpt'] }],
  pages: [{ url: 'https://profound.com/blog/ai-visibility', kind: 'competitor' }],
  queries: ['llm visibility tool'],
});

describe('numberSources', () => {
  it('numbers prompts, fan-outs, cited pages and queries, keyed as the Sources tab keys them', () => {
    expect(numbered).toEqual([
      { id: 'S1', kind: 'prompt', ref: 'p1', label: 'Best LLM visibility tracker?' },
      {
        id: 'S2',
        kind: 'fanout',
        ref: 'best llm visibility tracker 2026',
        label: '  Best LLM  Visibility Tracker 2026 ',
        detail: 'chatgpt',
      },
      {
        id: 'S3',
        kind: 'cited_page',
        ref: 'https://profound.com/blog/ai-visibility',
        label: 'https://profound.com/blog/ai-visibility',
        detail: 'competitor',
      },
      { id: 'S4', kind: 'gsc_query', ref: 'llm visibility tool', label: 'llm visibility tool' },
    ]);
    expect(normalizeQuery('  A  b ')).toBe('a b');
  });

  it('lists them for the model by number, or nothing with none', () => {
    const prompt = sourcesPrompt(numbered);
    expect(prompt).toMatch(/^Your data, numbered \(cite by number\):\n/);
    expect(prompt).toContain(
      'S3 Cited page (AI answers cite it today; answer better, never copy): https://profound.com/blog/ai-visibility (competitor)',
    );
    expect(prompt).toContain(
      'S4 Search Console query (a Google search people use): "llm visibility tool"',
    );
    expect(sourcesPrompt([])).toBe('');
  });
});

describe('sourceSuggestion', () => {
  const known = knownNumbers('Trackers compared in 2026.');
  const one = (text) => [{ text, start: 0 }];

  it('gives a number two sources have to the one it used, then the first', () => {
    const both = numberSources({
      fanouts: [{ query: 'crm for 50 users', platforms: [] }],
      inputs: [
        { kind: 'input', ref: 'data:1', label: 'Seats', detail: 'Their own data, a table: 50' },
      ],
    });
    const text = 'Teams of 50 forecast weekly.';
    expect(
      sourceSuggestion({ named: ['S2'], marks: [], pieces: one(text), numbered: both, known })
        .sources,
    ).toEqual([{ kind: 'input', ref: 'data:1', label: 'Seats' }]);
    // Named by none: the first that has it.
    expect(
      sourceSuggestion({ named: [], marks: [], pieces: one(text), numbered: both, known }).sources,
    ).toEqual([{ kind: 'fanout', ref: 'crm for 50 users', label: 'crm for 50 users' }]);
  });

  it('keeps the sources named and each mark where its words are, marked ones first', () => {
    const text = 'Trackers cover AI answers, per Profound, for the llm visibility tool.';
    expect(
      sourceSuggestion({
        named: ['S2', 's2', 'S3'],
        marks: [
          { words: 'per Profound', source: 'S3' },
          { words: '<b>llm visibility tool</b>', source: 'S4' },
        ],
        pieces: one(text),
        numbered,
        known,
      }),
    ).toEqual({
      sources: [
        {
          kind: 'cited_page',
          ref: 'https://profound.com/blog/ai-visibility',
          label: 'https://profound.com/blog/ai-visibility',
        },
        { kind: 'gsc_query', ref: 'llm visibility tool', label: 'llm visibility tool' },
        {
          kind: 'fanout',
          ref: 'best llm visibility tracker 2026',
          label: '  Best LLM  Visibility Tracker 2026 ',
        },
      ],
      marks: [
        { start: 27, end: 39, source: 0 },
        { start: 49, end: 68, source: 1 },
      ],
    });
  });

  it('drops ids it doesn’t have, words not in the text and overlaps', () => {
    const text = 'Trackers cover AI answers, per Profound.';
    expect(
      sourceSuggestion({
        named: ['S9'],
        marks: [
          { words: 'nowhere', source: 'S3' },
          { words: 'AI answers', source: 'S9' },
          { words: 'AI answers, per Profound', source: 'S3' },
          { words: 'per Profound', source: 'S2' },
        ],
        pieces: one(text),
        numbered,
        known,
      }).marks,
    ).toEqual([{ start: 15, end: 39, source: 0 }]);
  });

  it('keeps no number but the page’s, today’s or a source’s own words’, marked to it', () => {
    // 2026 is the page's; 87% is no one's: not kept, marked or not.
    expect(
      sourceSuggestion({
        named: ['S3'],
        marks: [{ words: '87% of buyers', source: 'S3' }],
        pieces: one('In 2026, 87% of buyers ask AI.'),
        numbered,
        known,
      }),
    ).toBeNull();
    // A number in a fan-out's own words is marked to it, unasked.
    const fanout = numberSources({ fanouts: [{ query: 'pour over ratio 1:16' }] });
    expect(
      sourceSuggestion({
        named: [],
        marks: [],
        pieces: one('Use a 1:16 ratio.'),
        numbered: fanout,
        known: new Set(),
      }),
    ).toEqual({
      sources: [{ kind: 'fanout', ref: 'pour over ratio 1:16', label: 'pour over ratio 1:16' }],
      marks: [{ start: 8, end: 10, source: 0 }],
    });
  });

  it('sources a claim only from a number with its unit, and never from a cited page’s address', () => {
    // "crm for 50 users" has 50 users, not 50%.
    const fanout = numberSources({ fanouts: [{ query: 'crm for 50 users' }] });
    const suggest = (text, numbered) =>
      sourceSuggestion({ named: [], marks: [], pieces: one(text), numbered, known: new Set() });
    expect(suggest('50% of teams use one.', fanout)).toBeNull();
    expect(suggest('Plans for 50 users.', fanout)).toMatchObject({
      marks: [{ start: 10, end: 12, source: 0 }],
    });
    // A dated address is no words of the page's.
    const page = numberSources({
      pages: [{ url: 'https://blog.example/2024/03/15/post-1234', kind: 'blog' }],
    });
    expect(suggest('Over 1234 teams switched in 2024.', page)).toBeNull();
  });

  it('reads an insert node by node: numbers in two items never run together', () => {
    const pieces = textPieces('<ul><li>Option 1</li><li>2 seats</li></ul>');
    expect(pieces).toEqual([
      { text: 'Option 1', start: 0 },
      { text: '2 seats', start: 8 },
    ]);
    expect(
      sourceSuggestion({ named: [], marks: [], pieces, numbered: [], known: new Set() }),
    ).toEqual({ sources: [], marks: [] });
  });

  it('keeps at most so many sources and marks', () => {
    const many = numberSources({
      fanouts: Array.from({ length: 20 }, (_, i) => ({ query: `q${String.fromCharCode(97 + i)}` })),
    });
    const long = many.map((s) => `${s.label} `.repeat(2)).join('');
    const result = sourceSuggestion({
      named: many.map((s) => s.id),
      marks: many.flatMap((s) => [
        { words: s.label, source: s.id },
        { words: s.label, source: s.id },
      ]),
      pieces: one(long),
      numbered: many,
      known: new Set(),
    });
    expect(result.sources).toHaveLength(MAX_SUGGESTION_SOURCES);
    expect(result.marks).toHaveLength(MAX_SOURCE_MARKS);
  });
});

describe('no number without a source', () => {
  const known = knownNumbers('Trackers in 2026 cost $1,299 a year.', 'llm visibility tool');

  it('finds the numbers a text adds, not those known, in a placeholder, or a lone count', () => {
    expect(
      addedNumbers(
        'In 2026, 3 tools cost 1299 dollars; 40% more, 2× faster, $9 plans, 5 million users [figure, 2025].',
        known,
      ).map((n) => n.value),
    ).toEqual(['40', '2', '9', '5']);
  });

  it('knows this year, not today’s day or month, and takes the source numbers out of the words', () => {
    const today = new Date('2026-10-23T12:00:00Z');
    expect(todayText(today)).toBe('2026');
    // On Oct 23, "23%" is no fact of the date's.
    expect(
      addedNumbers('23% of buyers in 2026, 10x faster', knownNumbers(todayText(today))).map(
        (n) => n.value,
      ),
    ).toEqual(['23', '10']);
    expect(stripSourceIds('Trackers (S2) cover AI [S1, S3]. Amazon S3 stays.')).toBe(
      'Trackers cover AI. Amazon S3 stays.',
    );
    // Only the numbers given: a name with one stays.
    expect(stripSourceIds('Grinders (S1) for the Galaxy (S23) [S1, S9]', 2)).toBe(
      'Grinders for the Galaxy (S23) [S1, S9]',
    );
  });

  it('reads no figure in words with digits, and matches a claim to its unit', () => {
    expect(addedNumbers('B2B software for H2 teams on Web3', new Set())).toEqual([]);
    expect(placeholderNumbers('B2B software, 2B users', new Set())).toBe(
      `B2B software, ${NUMBER_PLACEHOLDER} users`,
    );
    const units = knownNumbers('Save 40% and $49 a month, 3x faster, 2M users');
    expect(addedNumbers('40% off, $49, 3× faster, 2 million users', units)).toEqual([]);
    expect(addedNumbers('$40, 49%, 3 million', units).map((n) => n.value)).toEqual([
      '40',
      '49',
      '3',
    ]);
  });

  it('reads a decimal comma as a point, once thousands separators are gone', () => {
    // GetCito data's share is written "3.4%"; a Turkish or a German page writes it with a comma.
    const share = knownNumbers('named in 28 of 825 AI answers over the last 30 days (3.4%)');
    expect(addedNumbers('825 yanıtın 28 tanesinde anıldı (%3,4).', share)).toEqual([]);
    expect(addedNumbers('in 28 von 825 Antworten genannt (3,4 %).', share)).toEqual([]);
    expect(addedNumbers('Son 30 günde 825 yanıtın 28 tanesinde.', share)).toEqual([]);
    expect(addedNumbers('in 3,5 % der Antworten', share).map((n) => n.value)).toEqual(['3.5']);
    // Thousands still read as thousands, both ways.
    const counts = knownNumbers('1,250 teams and 1250.5 hours');
    expect(addedNumbers('1.250 Teams, 1.250,5 Stunden, 1,250 teams', counts)).toEqual([]);
  });

  it('puts a placeholder where a page written whole adds one, sign and unit with it', () => {
    expect(placeholderNumbers('Teams see 40% more, at $49 a month, in 2026.', known)).toBe(
      `Teams see ${NUMBER_PLACEHOLDER} more, at ${NUMBER_PLACEHOLDER} a month, in 2026.`,
    );
    expect(
      placeholderNumbersInHtml(
        '<h1>Guide 2026</h1><p>Up <b>35%</b> in <a href="/r/77">77 days</a>.</p><pre>port 8080</pre>',
        known,
      ),
    ).toBe(
      `<h1>Guide 2026</h1><p>Up <b>${NUMBER_PLACEHOLDER}</b> in <a href="/r/77">${NUMBER_PLACEHOLDER} days</a>.</p><pre>port 8080</pre>`,
    );
  });

  it('reads a page’s numbers from all its text, a table’s too, each cell apart', () => {
    expect(htmlText('<p>Ratio</p><table><tr><td>1:16</td><td>2026</td></tr></table>')).toBe(
      'Ratio 1:16 2026',
    );
    expect([...knownNumbers(htmlText('<td>1:16</td><td>2026</td>'))]).toEqual(['1', '16', '2026']);
  });
});

describe('long input read quickly (#1544 review)', () => {
  const known = knownNumbers('Trackers in 2026 cost $1,299 a year.');
  const time = (read) => {
    const started = Date.now();
    read();
    return Date.now() - started;
  };

  it('puts thousands of numbers on one line, and reads an opening bracket with no closing one, in time near its length', () => {
    // A character past Latin-1 (Ü) in each: V8 skips no position then.
    // 20,000 numbers: the text rebuilt per number took over a second (main,
    // 2026-10-26); built once, under 10 ms.
    const line = `Ürün: ${'Teams see 40% more. '.repeat(20_000)}`;
    placeholderNumbers('Teams see 40% more.', known);
    let out;
    expect(time(() => (out = placeholderNumbers(line, known)))).toBeLessThan(400);
    expect(out).toBe(`Ürün: ${`Teams see ${NUMBER_PLACEHOLDER} more. `.repeat(20_000)}`);
    const open = `Ürün ${'[a '.repeat(20_000)}40% more.`;
    addedNumbers(open.slice(0, 40), known);
    expect(time(() => addedNumbers(open, known))).toBeLessThan(150);
    expect(addedNumbers(open, known).map((n) => n.value)).toEqual(['40']);
    // A unit that runs into the next number's sign is that one's: the space stays.
    expect(placeholderNumbers('Teams 40 %50 more.', known)).toBe(
      `Teams ${NUMBER_PLACEHOLDER} ${NUMBER_PLACEHOLDER} more.`,
    );
    expect(placeholderNumbers('%40 %50 more.', known)).toBe(
      `${NUMBER_PLACEHOLDER} ${NUMBER_PLACEHOLDER} more.`,
    );
  });
});
