import { describe, expect, it } from 'vitest';
import type { Json } from '@/types/supabase';
import { TEXT_FIELD_CHARS, cutText, fitResult, restOf } from './fit';

/**
 * Chat's data budgets on a tool's result (W1-18; CHAT-04 items 5–6): what
 * fits stays as it is; a result over its budget is made smaller on the
 * server, long texts first, then lists with a rest line, then text, and
 * always says it was cut.
 */

const rows = (n: number, extra: Record<string, Json> = {}) =>
  Array.from({ length: n }, (_, i) => ({ domain: `site-${i}.com`, citations: 10, ...extra }));

describe('fitResult', () => {
  it('leaves a result that fits as it is', () => {
    const value = { items: rows(3) };
    expect(fitResult(value, 10_000)).toEqual({
      value,
      chars: JSON.stringify(value).length,
      cut: false,
    });
  });

  it('shortens long texts first, and says so', () => {
    const value = { answers: [{ id: 1, answer: 'x'.repeat(5_000) }] };
    const fitted = fitResult(value, 1_000);
    expect(fitted.cut).toBe(true);
    expect(fitted.value).toMatchObject({ truncated: true, texts_shortened: true });
    const answer = (fitted.value as { answers: { answer: string }[] }).answers[0].answer;
    expect(answer).toHaveLength(TEXT_FIELD_CHARS);
    expect(answer.endsWith('…')).toBe(true);
    expect(fitted.chars).toBeLessThanOrEqual(1_000);
  });

  it('keeps the first rows of a long list and adds up the rest', () => {
    const fitted = fitResult({ top_domains: rows(200), window: '30d' }, 2_000);
    expect(fitted.chars).toBeLessThanOrEqual(2_000);
    const value = fitted.value as Record<string, Json>;
    const kept = (value.top_domains as Json[]).length;
    expect(kept).toBeGreaterThan(0);
    expect(value.top_domains_more).toBe(200 - kept);
    expect(value.top_domains_rest).toEqual({
      citations: { sum: (200 - kept) * 10, share_pct: Math.round(((200 - kept) / 200) * 100) },
    });
    expect(value).toMatchObject({ window: '30d', truncated: true });
  });

  it('adds to what an earlier row cut left out, and keeps an unknown count unknown', () => {
    const known = fitResult({ items: rows(100), items_more: 12 }, 1_500).value as Record<
      string,
      Json
    >;
    expect(known.items_more).toBe(12 + 100 - (known.items as Json[]).length);
    const unknown = fitResult({ items: rows(100), items_more: null }, 1_500).value as Record<
      string,
      Json
    >;
    expect(unknown.items_more).toBeNull();
  });

  it('cuts a top-level list into items, more and rest', () => {
    const fitted = fitResult(rows(100), 1_500);
    expect(fitted.value).toMatchObject({ truncated: true, rest: { citations: expect.anything() } });
    const value = fitted.value as { items: Json[]; more: number };
    expect(value.more).toBe(100 - value.items.length);
  });

  it('cuts what has no list as text', () => {
    const fitted = fitResult({ a: { b: { c: 'y'.repeat(300).split('').join(' ') } } }, 600);
    expect(fitted.value).toMatchObject({ truncated: true });
    expect(fitted.chars).toBeLessThanOrEqual(600);
  });
});

describe('restOf', () => {
  it('adds up count-like fields only: never a score, a rate or a position', () => {
    const list = [
      { mentions: 5, visibility_score: 80, position: 1, mention_rate: 0.5 },
      { mentions: 3, visibility_score: 60, position: 2, mention_rate: 0.3 },
      { mentions: 2, visibility_score: 40, position: 3, mention_rate: 0.2 },
    ];
    expect(restOf(list, 1)).toEqual({ mentions: { sum: 5, share_pct: 50 } });
    expect(restOf(list, 3)).toBeNull();
    expect(restOf([{ name: 'a' }, { name: 'b' }], 1)).toBeNull();
  });
});

describe('cuts that stay valid', () => {
  const wellFormed = (text: string) =>
    !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);

  it('never leaves half an emoji at the end of a cut', () => {
    expect(cutText('ab😀c', 3)).toBe('ab');
    expect(cutText('ab😀c', 4)).toBe('ab😀');
    expect(cutText('abc', 5)).toBe('abc');
  });

  it('shortens a long text with an emoji at the cut and keeps it well formed', () => {
    const answer = `${'x'.repeat(TEXT_FIELD_CHARS - 2)}😀${'y'.repeat(2_000)}`;
    const out = fitResult({ answers: [{ text: answer }, { text: answer }] }, 1_200);
    expect(out.cut).toBe(true);
    expect(wellFormed(JSON.stringify(out.value))).toBe(true);
    expect(JSON.stringify(out.value)).not.toMatch(/\\ud83d/);
  });

  it('keeps a result cut as text within its budget, quotes and all', () => {
    const value = {
      data: { rows: Array.from({ length: 400 }, (_, i) => ({ q: `"asked ${i}"`, n: i })) },
    };
    const out = fitResult(value, 2_000);
    expect(out.value).toMatchObject({ truncated: true });
    expect(out.chars).toBeLessThanOrEqual(2_000);
    expect(JSON.stringify(out.value).length).toBe(out.chars);
  });
});

describe('a series by date', () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
      mentions: 1,
    }));

  it('keeps the latest rows of a series oldest first, and sums the older ones', () => {
    const out = fitResult({ daily: days(300) }, 2_000);
    const value = out.value as Record<string, Json>;
    const kept = value.daily as { date: string }[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(300);
    expect(kept[kept.length - 1].date).toBe(days(300)[299].date);
    expect(value.daily_more).toBe(300 - kept.length);
    expect(value.daily_rest).toEqual({
      mentions: {
        sum: 300 - kept.length,
        share_pct: Math.round(((300 - kept.length) / 300) * 100),
      },
    });
  });

  it('keeps the latest rows of a top-level series too, and the first of a newest-first one', () => {
    const top = fitResult(days(300), 2_000).value as { items: { date: string }[] };
    expect(top.items[top.items.length - 1].date).toBe(days(300)[299].date);
    const newest = fitResult({ daily: days(300).reverse() }, 2_000).value as Record<
      string,
      { date: string }[]
    >;
    expect(newest.daily[0].date).toBe(days(300)[299].date);
  });
});
