import { describe, expect, it } from 'vitest';
import type { MentionRow } from './mentionsList';
import { mentionsCsv, mentionsExportFileName, utcMinute } from './mentionsExport';

const row = (over: Partial<MentionRow> = {}): MentionRow => ({
  id: 'r1',
  createdAt: '2026-10-16T11:28:06Z',
  promptId: 'p1',
  promptText: 'Best espresso beans?',
  topicId: 't1',
  topicName: 'Beans',
  platform: 'gemini-web',
  model: 'gemini-2.5-flash',
  region: 'DE',
  sentiment: 'negative',
  occurrences: 2,
  position: 2,
  brandsNamed: 4,
  coMentioned: [
    { competitorId: 'c1', name: 'Crema Club', position: 1 },
    { competitorId: 'c2', name: 'Origin Box', position: 3 },
  ],
  excerpt: 'Try Crema Club first. Acme Coffee is pricier, "but fresh".',
  groupKey: null,
  groupCount: null,
  ...over,
});

describe('mentionsCsv', () => {
  it('writes the facts, a blank line, then a row per mention', () => {
    const csv = mentionsCsv(
      [
        { label: 'Mentions & Sentiment', value: 'Acme Coffee' },
        { label: 'Search', value: 'price, "deals"' },
        { label: 'Mentions (n)', value: 107 },
      ],
      [
        row(),
        row({
          id: 'r2',
          topicName: null,
          model: null,
          region: null,
          sentiment: null,
          position: null,
          brandsNamed: null,
          coMentioned: [],
          excerpt: '=SUM(A1) Acme Coffee',
        }),
      ],
    );
    expect(csv.split('\n')).toEqual([
      'Mentions & Sentiment,Acme Coffee',
      'Search,"price, ""deals"""',
      'Mentions (n),107',
      '',
      'date_utc,prompt,topic,platform,model,country,sentiment,times_named,position,brands_named,co_mentioned,excerpt',
      '2026-10-16 11:28,Best espresso beans?,Beans,Gemini,gemini-2.5-flash,DE,negative,2,2,4,' +
        'Crema Club; Origin Box,"Try Crema Club first. Acme Coffee is pricier, ""but fresh""."',
      // A formula-looking excerpt gets a leading ' so a spreadsheet won't run it.
      "2026-10-16 11:28,Best espresso beans?,,Gemini,,,,2,,,,'=SUM(A1) Acme Coffee",
    ]);
  });
});

describe('mentionsExportFileName', () => {
  it("names the file after the brand and the day, as the other pages' exports", () => {
    const day = new Date('2026-10-17T09:00:00Z');
    expect(mentionsExportFileName('acme-coffee', day)).toBe(
      'getcito_acme-coffee_mentions_2026-10-17.csv',
    );
    expect(mentionsExportFileName('', day)).toBe('getcito_brand_mentions_2026-10-17.csv');
  });

  it('starts with a white label kit’s word instead, or none', () => {
    const day = new Date('2026-10-17T09:00:00Z');
    expect(mentionsExportFileName('acme-coffee', day, 'acme-agency')).toBe(
      'acme-agency_acme-coffee_mentions_2026-10-17.csv',
    );
    expect(mentionsExportFileName('acme-coffee', day, null)).toBe(
      'acme-coffee_mentions_2026-10-17.csv',
    );
  });
});

describe('utcMinute', () => {
  it('states a moment to the minute in UTC, and nothing for an invalid one', () => {
    expect(utcMinute('2026-10-16T11:28:06+03:00')).toBe('2026-10-16 08:28');
    expect(utcMinute(new Date('2026-10-17T00:05:59Z'))).toBe('2026-10-17 00:05');
    expect(utcMinute('')).toBe('');
  });
});
