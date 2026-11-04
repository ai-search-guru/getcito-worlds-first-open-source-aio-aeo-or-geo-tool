import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  FIGURE_CONTEXT,
  PLACEHOLDER,
  checkFigures,
  figureHold,
  figuresOfRun,
  knownFigures,
  parseFigure,
} from './facts';

/**
 * Chat's fact check (W1-21; CHAT-05 item 11, CHAT-20 §19): a figure the
 * run's data doesn't hold, or can't be worked out of, is replaced; what was
 * read, rounded or worked out inside a row or a column, stays; counts,
 * numbering, dates and names' versions aren't claims.
 */

const NOW = new Date('2026-10-30T12:00:00.000Z');
const check = (text: string, sources: unknown[]) =>
  checkFigures(text, knownFigures(sources), { now: NOW });

describe('knownFigures', () => {
  it('reads numbers, numbers in texts, list lengths and each column’s total and average', () => {
    const known = knownFigures([
      'Up 1,234 since Oct 1',
      { rows: [{ citations: 10 }, { citations: 30 }], note: 'score 42.5' },
    ]);
    for (const n of [1234, 1, 10, 30, 40, 20, 2, 42.5]) expect(known.values.has(n)).toBe(true);
    expect(known.groups).toContainEqual([10, 30, 40]);
  });

  it('parses thousands and decimal commas', () => {
    expect(parseFigure('1,234')).toBe(1234);
    expect(parseFigure('1.234.567')).toBe(1234567);
    expect(parseFigure('12,5')).toBe(12.5);
    expect(parseFigure('12.5')).toBe(12.5);
  });
});

describe('checkFigures', () => {
  it('keeps a figure that was read, as the answer rounds it', () => {
    const read = { visibility: 42.857, share: 0.4286, mentions: 1180 };
    expect(check('Visibility is 42.9, about 43%, with 1.2k mentions.', [read])).toEqual({
      text: 'Visibility is 42.9, about 43%, with 1.2k mentions.',
      checked: 3,
      replaced: [],
    });
  });

  it('replaces a figure the data does not hold, with the placeholder for its kind', () => {
    const result = check('Perplexity cites you 37% of the time; it costs $99 and grew in 2019.', [
      { citations: 12 },
    ]);
    expect(result.text).toBe(
      `Perplexity cites you ${PLACEHOLDER.metric} of the time; it costs ${PLACEHOLDER.price} and grew in ${PLACEHOLDER.date}.`,
    );
    expect(result.replaced).toEqual(['37%', '$99', '2019']);
  });

  it('keeps what is worked out inside a row or a column, not across unrelated reads', () => {
    const row = { current: 50, previous: 40 };
    expect(check('Up 10 points, 25% more than before.', [row]).replaced).toEqual([]);
    const column = { rows: [{ citations: 30 }, { citations: 70 }] };
    expect(check('100 citations in all; the top page has 70%.', [column]).replaced).toEqual([]);
    // 100 − 55 = 45, but they are two reads' numbers.
    expect(check('A gap of 45.', [{ a: 100, b: 7 }, { c: 55 }]).replaced).toEqual(['45']);
  });

  it('leaves counts, numbering, dates, times, this year and names’ versions alone', () => {
    const text = [
      '1. Step 12 of the plan: 3 prompts on Oct 14, 2026-10-01 at 09:14.',
      'Top 20 pages in 2026, read with Claude 3.5.',
    ].join('\n');
    expect(check(text, [])).toEqual({ text, checked: 0, replaced: [] });
  });

  it('leaves links, domains and placeholders alone', () => {
    const text =
      'See https://acme.com/2024/report and site-2024.com; we have [customer count] users.';
    expect(check(text, []).text).toBe(text);
  });

  it('reads what comes before and after for context, without changing it', () => {
    const known = knownFigures([]);
    expect(checkFigures('12 of the plan', known, { before: 'Step ' }).replaced).toEqual([]);
    expect(checkFigures('Up 15', known, { after: '% this week' }).text).toBe(
      `Up ${PLACEHOLDER.metric}`,
    );
  });

  it('reads a link, "#12" or a date cut across two chunks as one', () => {
    const known = knownFigures([]);
    const after = (before: string, text: string) =>
      checkFigures(text, known, { before, now: NOW }).text;
    expect(after('Read https://example.com/blog/', '98765 for more.')).toBe('98765 for more.');
    expect(after('Ranked #', '12 overall.')).toBe('12 overall.');
    expect(after('Since Oct ', '17 traffic rose.')).toBe('17 traffic rose.');
    // What was sent is context only: its figures are neither changed nor counted.
    expect(checkFigures(' and up.', known, { before: 'Visits were 7,777' })).toEqual({
      text: ' and up.',
      checked: 0,
      replaced: [],
    });
  });

  it('keeps a period the app sets, two read dates span or a read date’s age, with its unit', () => {
    // NOW is 2026-10-30: 623 days after February 14, 2025, about 20.5 months.
    const known = knownFigures(
      [
        'Is our FAQ page stale?',
        { input: { date_from: '2026-10-01', date_to: '2026-10-15' }, rows: [] },
        { page: 'Last updated February 14, 2025' },
      ],
      { periods: [30], now: NOW },
    );
    const text = [
      "I'll use the last 30 days, a 30-day window; son 30 gün, 30 günlük veri.",
      '"Last updated February 14, 2025" is almost 21 months old, over 20 months.',
      'From Oct 1 to Oct 15 is 14 days, 15 counting both, about 2 weeks.',
    ].join('\n');
    expect(checkFigures(text, known, { now: NOW })).toMatchObject({ text, replaced: [] });
  });

  it('still replaces metrics, and a period nothing read spans', () => {
    const known = knownFigures(
      [{ input: { date_from: '2026-10-01', date_to: '2026-10-15' } }, 'Updated Feb 14, 2025'],
      { periods: [30], now: NOW },
    );
    const result = checkFigures(
      'A 23% drop, 1,200 customers, 30 visits, cited within 45 days, 37 months old, 3 ayrı sayfa için 45 ayrı soru.',
      known,
      { now: NOW },
    );
    expect(result.replaced).toEqual(['23%', '1,200', '30', '45', '37', '45']);
    // Two sources' dates aren't a span: Oct 1 to Feb 14, 2025 is 594 days.
    expect(checkFigures('594 days apart.', known, { now: NOW }).replaced).toEqual(['594']);
  });

  it('keeps what the run was given besides: a loaded skill’s targets and the page’s scope', () => {
    const known = figuresOfRun({
      question: 'Write an FAQ for our pricing page\nToday is 2026-10-30.',
      history: [],
      reads: [],
      given: [{ dateRange: { from: '2026-10-16', to: '2026-10-30', label: 'Last 14 days' } }],
      skills: [
        'Answers of 40 to 80 words each. A meta description of about 155 characters. FAQ pages earn 23% more citations; aim for 1,200 visits.',
      ],
      now: NOW,
    });
    const text =
      'The answers are under the 80-word target, at least 40 words; write about 155 characters for the last 14 days.';
    expect(checkFigures(text, known, { now: NOW })).toMatchObject({ text, replaced: [] });
    expect(checkFigures('Aim for 120 words.', known, { now: NOW }).replaced).toEqual(['120']);
    // A skill's other numbers, and its targets as anything but a length, aren't the brand's.
    expect(
      checkFigures('Visibility dropped 23%, from 1,200 visits to 155 visits.', known, { now: NOW })
        .replaced,
    ).toEqual(['23%', '1,200', '155']);
  });

  it('takes from a daily series its first to last date only, never every pair', () => {
    const series = Array.from({ length: 60 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
      visibility: 40,
    }));
    // 2026-09-01 to 2026-10-30: 59 days apart, 59 and 0 days old on NOW.
    const known = knownFigures([{ series }], { now: NOW });
    const kept = 'Over these 59 days, 60 counting both, about 2 months.';
    expect(checkFigures(kept, known, { now: NOW })).toMatchObject({ text: kept, replaced: [] });
    expect(
      checkFigures('Pages get cited within 45 days, results in 33 weeks.', known, {
        now: NOW,
      }).replaced,
    ).toEqual(['45', '33']);
  });

  it('rounds a span to its unit down or up, never a unit further', () => {
    // 2025-02-14 is 623 days, about 20.5 months, before NOW.
    const known = knownFigures(['Updated 2025-02-14'], { now: NOW });
    const kept = 'Almost 21 months old, over 20 months, 89 weeks, 2 years.';
    expect(checkFigures(kept, known, { now: NOW })).toMatchObject({ text: kept, replaced: [] });
    expect(
      checkFigures('It is 19 months old, or 22 months, or 87 weeks.', known, { now: NOW }).replaced,
    ).toEqual(['19', '22', '87']);
  });

  it('stays linear on a long text', () => {
    const known = knownFigures([]);
    const text = `${'A-'.repeat(100_000)}${' 12'.repeat(30_000)}`;
    const started = performance.now();
    const result = checkFigures(text, known);
    expect(result.replaced).toHaveLength(30_000);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});

describe('figureHold', () => {
  it('holds a figure near the end until the text after it comes', () => {
    expect(figureHold('Visibility is up 12')).toBe('Visibility is up '.length);
    expect(figureHold('between 10 – 1')).toBe('between '.length);
    expect(figureHold('No figures here.')).toBeNull();
    expect(figureHold(`Up 12%${' '.repeat(FIGURE_CONTEXT)}`)).toBeNull();
  });
});

describe('the Site Audit guard it mirrors', () => {
  it('uses the same placeholders and figure patterns', () => {
    const server = readFileSync(
      join(__dirname, '../../../../backend/src/lib/audit/recommendationGuard.js'),
      'utf8',
    );
    // The audit drops an unsupported metric with its sentence (#1816), so only
    // the price and date placeholders are still shared.
    expect(server).toContain(`price: '${PLACEHOLDER.price}'`);
    expect(server).toContain(`date: '${PLACEHOLDER.date}'`);
    expect(server).toContain(
      String.raw`const NUM = String.raw` + '`' + String.raw`\d+(?:[.,]\d+)*` + '`',
    );
    expect(server).toContain(
      String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`,
    );
  });
});
