import { describe, expect, it } from 'vitest';
import {
  MAX_DATA_BYTES,
  NO_INPUTS,
  draftInputsSchema,
  inputsGiven,
  inputsUsed,
  jsonbBytes,
  keptInputs,
  keptRows,
  pastedRows,
  tableThatFits,
  type DraftInputs,
} from './draftInputs';

/**
 * Brief › Your input (CE-048): kept as the person gave it, and counted only
 * once the page can be read to use it.
 */

const inputs = (over: Partial<DraftInputs>): DraftInputs => ({ ...NO_INPUTS, ...over });

describe('inputsUsed', () => {
  it('reads a quote as used only word for word', () => {
    const quote = {
      name: 'Ada Lovelace',
      title: 'Head of Research, Acme',
      text: 'We cut our forecast misses in half.',
      sourceUrl: 'https://acme.example/talk',
    };
    expect(
      inputsUsed(
        'As Ada put it: “We cut our forecast misses in half.”',
        inputs({ quotes: [quote] }),
      ).quote,
    ).toBe(true);
    expect(inputsUsed('Ada says misses were halved.', inputs({ quotes: [quote] })).quote).toBe(
      false,
    );
  });

  it('reads data as used by a number from it, however its thousands are written', () => {
    const data = [
      {
        name: 'Survey',
        rows: [
          ['Teams', 'Share'],
          ['1,250', '42%'],
        ],
      },
    ];
    expect(inputsUsed('We asked 1250 teams.', inputs({ data })).data).toBe(true);
    expect(inputsUsed('42% of them said so.', inputs({ data })).data).toBe(true);
    // One digit says little.
    expect(inputsUsed('In 3 steps.', inputs({ data: [{ name: 'x', rows: [['3']] }] })).data).toBe(
      false,
    );
    const getcito = [
      {
        promptId: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
        prompt: 'best pour-over grinder',
        answers: 825,
        mentioned: 28,
        asOf: '2026-10-24',
        days: 30,
      },
    ];
    expect(inputsUsed('Named in 28 of 825 answers.', inputs({ getcitoData: getcito })).data).toBe(
      true,
    );
    // Its two numbers in different sentences are anyone's.
    expect(
      inputsUsed('Try it for 28 days. Over 825 people did.', inputs({ getcitoData: getcito })).data,
    ).toBe(false);
  });

  it("doesn't read years, dates or small counts as the person's data", () => {
    const data = [
      {
        name: 'Visits',
        rows: [
          ['2026-01', '12', '01.02.2026'],
          ['2025', '7%', '3.5'],
        ],
      },
    ];
    for (const page of ['The best CRMs in 2026.', 'In 12 steps.', 'Up 7% on 01.02.']) {
      expect(inputsUsed(page, inputs({ data })).data).toBe(false);
    }
    // A decimal is someone's.
    expect(inputsUsed('It took 3.5 hours.', inputs({ data })).data).toBe(true);
    expect(
      inputsUsed('Up %42 this year.', inputs({ data: [{ name: 'x', rows: [['42%']] }] })).data,
    ).toBe(true);
  });

  it('reads a quote as said whatever marks end it, and dashes alike', () => {
    const quote = (text: string) => ({
      name: 'Ada',
      title: 'CTO, Acme',
      text,
      sourceUrl: 'https://a.example',
    });
    expect(
      inputsUsed(
        '“It changed how we work,” says Ada.',
        inputs({ quotes: [quote('It changed how we work.')] }),
      ).quote,
    ).toBe(true);
    expect(
      inputsUsed(
        'She said: “Fast — and cheap.”',
        inputs({ quotes: [quote('"Fast – and cheap!"')] }),
      ).quote,
    ).toBe(true);
  });

  it('reads experience as used by its own words, and none given as unused', () => {
    const experience =
      'We tested three grinders for six weeks in our roastery and the burr grinder kept the grind steadiest.';
    expect(
      inputsUsed(
        'In our roastery we tested grinders for six weeks: the burr grinder kept the grind steadiest.',
        inputs({ experience }),
      ).experience,
    ).toBe(true);
    expect(inputsUsed('Grinders differ.', inputs({ experience })).experience).toBe(false);
    // Its topic and common words alone aren't it.
    expect(
      inputsUsed(
        'Their results were better with clients.',
        inputs({ experience: 'We used it with our clients and their results were better.' }),
      ).experience,
    ).toBe(false);
    expect(
      inputsUsed(
        'Sales teams forecast pipeline every week.',
        inputs({ experience: 'We tested weekly forecasts with twelve small sales teams.' }),
      ).experience,
    ).toBe(false);
    expect(inputsUsed('Anything', NO_INPUTS)).toEqual({
      experience: false,
      data: false,
      quote: false,
    });
  });
});

describe('the input as kept', () => {
  it('needs all four fields of a quote, and an http(s) source', () => {
    const quote = {
      name: 'Ada',
      title: 'CTO, Acme',
      text: 'Hi there.',
      sourceUrl: 'https://a.example',
    };
    expect(draftInputsSchema.safeParse(inputs({ quotes: [quote] })).success).toBe(true);
    for (const over of [
      { name: '' },
      { title: ' ' },
      { text: '' },
      { sourceUrl: 'javascript:x' },
      { sourceUrl: 'https://' },
    ]) {
      expect(draftInputsSchema.safeParse(inputs({ quotes: [{ ...quote, ...over }] })).success).toBe(
        false,
      );
    }
  });

  it('keeps a table’s first rows and columns, each cell cut', () => {
    const rows = Array.from({ length: 150 }, () =>
      Array.from({ length: 20 }, () => 'x'.repeat(300)),
    );
    const kept = keptRows(rows);
    expect(kept).toHaveLength(100);
    expect(kept[0]).toHaveLength(12);
    expect(kept[0][0]).toHaveLength(200);
  });

  it('measures a value as Postgres writes jsonb as text, which its size checks read', () => {
    // `select octet_length('…'::jsonb::text)` reads 105 for it.
    expect(
      jsonbBytes([
        {
          name: 'Anket ğüş',
          rows: [
            ['1,250', '42%'],
            ['a"b', ''],
          ],
        },
        { name: 'x', rows: [['日本']] },
      ]),
    ).toBe(105);
  });

  it('keeps a new table to the rows that fit beside the others, and none when none do', () => {
    const row = Array.from({ length: 12 }, () => 'x'.repeat(200));
    const big = { name: 'Big', rows: Array.from({ length: 100 }, () => row) };
    const first = tableThatFits([], big);
    expect(first.rows.length).toBeLessThan(100);
    expect(first.rows.length).toBeGreaterThan(0);
    expect(jsonbBytes([first])).toBeLessThanOrEqual(MAX_DATA_BYTES);
    expect(tableThatFits([first], big).rows.length).toBe(0);
    // What the database would turn away isn't kept.
    expect(draftInputsSchema.safeParse(inputs({ data: [big] })).success).toBe(false);
    expect(draftInputsSchema.safeParse(inputs({ data: [first] })).success).toBe(true);
  });

  it('tells what was given from what the page uses', () => {
    expect(inputsGiven(NO_INPUTS)).toEqual({ experience: false, data: false, quote: false });
    expect(
      inputsGiven(
        inputs({
          experience: '  ',
          getcitoData: [
            {
              promptId: '5e8cd4c2-2bc4-4fb7-8711-bc0ad1bb4a29',
              prompt: 'p',
              answers: 1,
              mentioned: 0,
              asOf: '2026-10-24',
              days: 30,
            },
          ],
        }),
      ),
    ).toEqual({ experience: false, data: true, quote: false });
  });

  it('cuts a cell by characters, never half of one, and drops NUL, which the database refuses', () => {
    const [[cell]] = keptRows([['\0' + '😀'.repeat(250)]]);
    expect(Array.from(cell)).toHaveLength(200);
    expect(cell).not.toContain('\0');
    expect(
      draftInputsSchema.safeParse(inputs({ data: [{ name: 'x', rows: [[cell]] }] })).success,
    ).toBe(true);
  });

  it('reads numbers pasted from a spreadsheet by their tabs', () => {
    expect(pastedRows('Month\tVisits\nOctober\t3,400\n')).toEqual([
      ['Month', 'Visits'],
      ['October', '3,400'],
    ]);
    expect(pastedRows('Month,Visits\nOctober,3400')).toEqual([
      ['Month', 'Visits'],
      ['October', '3400'],
    ]);
  });

  it('keeps what still reads of a row, item by item', () => {
    const quote = { name: 'Ada', title: 'CTO', text: 'Hi.', sourceUrl: 'https://a.example' };
    expect(
      keptInputs({
        experience: 'x'.repeat(5000),
        data: 'nope',
        getcitoData: [{ promptId: 'x' }],
        quotes: [quote, { ...quote, sourceUrl: 'https://' }],
      }),
    ).toEqual({ experience: 'x'.repeat(4000), data: [], getcitoData: [], quotes: [quote] });
  });
});
