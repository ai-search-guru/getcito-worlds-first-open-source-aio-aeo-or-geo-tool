import { describe, expect, it } from 'vitest';
import { MINUTES_PER_PAGE, START_NOW_LIFT } from './rules.js';
import {
  SUMMARY_MAX_BYTES,
  SUMMARY_VERSION,
  TITLE_KEYS,
  actionPages,
  buildSummary,
  startNowOf,
  summaryBytes,
  titlePayload,
} from './summary.js';

/**
 * A suggestion's summary (CHAT-26 §3 item 5): the action's own data as
 * sent, in fields the web turns into words. No sentence is written here.
 */

const action = {
  id: 'a1',
  action_no: 2841,
  kind: 'optimize_product_pages',
  category: 'growth',
  impact: 'high',
  created_at: '2026-10-23T03:00:00Z',
  priority_score: 81,
  priority_level: 'high',
  priority_reason: { version: 1, change: 'gap', demand: 'high', searches: 4200, days: 6 },
};
const pick = { score: 92, wait: { days: 6, points: 6 }, startNow: 'optimize', variety: false };

describe('buildSummary', () => {
  it('keeps the action, its priority, its wait and the "Start now" line as fields', () => {
    const payload = {
      targetEntity: 'pages',
      targetCount: 5,
      pages: [
        'https://shop.example/ridge-45l',
        'https://shop.example/crest-30l',
        'https://shop.example/summit-60l',
        'https://shop.example/trail-22l',
        'https://shop.example/ultralight-38l',
      ],
      signalIds: ['s1', 's2'],
      internalNote: { big: 'x'.repeat(5000) },
    };
    const summary = buildSummary({ action, payload, pick });
    expect(summary).toEqual({
      version: SUMMARY_VERSION,
      action: {
        no: 2841,
        kind: 'optimize_product_pages',
        category: 'growth',
        impact: 'high',
        createdAt: '2026-10-23T03:00:00Z',
        payload: { targetEntity: 'pages', targetCount: 5 },
      },
      priority: { score: 81, level: 'high', reason: action.priority_reason },
      waitingDays: 6,
      ranking: { score: 92, waitPoints: 6, startNowPoints: START_NOW_LIFT, variety: false },
      startNow: { method: 'optimize', pages: 5, minutes: 5 * MINUTES_PER_PAGE },
      play: null,
    });
  });

  it('writes no sentence of its own: only the action’s data', () => {
    const summary = buildSummary({ action, payload: {}, pick: { ...pick, startNow: null } });
    expect(summary.startNow).toBeNull();
    expect(summary.ranking.startNowPoints).toBe(0);
    const texts = JSON.stringify(summary).match(/"[^"]* [^"]* [^"]*"/g);
    expect(texts).toBeNull();
  });

  it('keeps the action plan’s pick when the action carries one', () => {
    const payload = {
      play: {
        id: 'ecom_product_pages',
        assetType: 'product',
        reasons: [{ key: 'commercial_intent', value: 0.62 }],
        dataRow: { prompts: 14, visible: 3, competitors: [{ name: 'Summit Gear', count: 9 }] },
        supporting: ['x', 'y'],
      },
    };
    expect(buildSummary({ action, payload, pick }).play).toEqual({
      id: 'ecom_product_pages',
      assetType: 'product',
      reasons: [{ key: 'commercial_intent', value: 0.62 }],
      dataRow: payload.play.dataRow,
    });
  });

  it('stays within its size, dropping the data row, then lists, then the reason', () => {
    const huge = 'y'.repeat(SUMMARY_MAX_BYTES);
    const payload = {
      title: 'Optimize pages',
      promptIds: Array.from({ length: 100 }, (_, i) => `p-${i}-${'z'.repeat(250)}`),
      play: { id: 'p', dataRow: { note: huge } },
    };
    const summary = buildSummary({ action, payload, pick });
    expect(summaryBytes(summary)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(summary.play?.dataRow ?? null).toBeNull();
    expect(summary.action.payload.title).toBe('Optimize pages');
    expect(summary.action.payload.promptIds).toBeUndefined();

    const reasonTooBig = buildSummary({
      action: { ...action, priority_reason: { note: huge } },
      payload: {},
      pick,
    });
    expect(summaryBytes(reasonTooBig)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(reasonTooBig.priority.reason).toBeNull();
  });
});

describe('summaryBytes', () => {
  it('counts a byte more for each comma and colon, as jsonb\u2019s text writes ", " and ": "', () => {
    const value = { a: [1, 2, 3], b: 'x' };
    const json = JSON.stringify(value); // {"a":[1,2,3],"b":"x"}
    expect(summaryBytes(value)).toBe(Buffer.byteLength(json) + 5);
    const jsonbText = '{"a": [1, 2, 3], "b": "x"}';
    expect(summaryBytes(value)).toBeGreaterThanOrEqual(Buffer.byteLength(jsonbText));
  });

  it('keeps a summary of many small items within the database\u2019s check', () => {
    const many = Array.from({ length: 4000 }, (_, i) => i);
    const summary = buildSummary({
      action: { ...action, priority_reason: { many } },
      payload: {},
      pick,
    });
    expect(summaryBytes(summary)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(summary.priority.reason).toBeNull();
  });
});

describe('titlePayload', () => {
  it('keeps what a title reads and nothing else', () => {
    const got = titlePayload({
      kindOnly: 'no',
      title: 'Ridge 45L',
      gap: 1.5,
      soldOut: true,
      products: [{ id: 1, title: 'Ridge' }, { id: 2 }],
      targets: [{ label: '/ridge' }, { label: '/crest', url: 'https://x' }, { other: 1 }],
      nested: { a: 1 },
    });
    expect(got).toEqual({
      title: 'Ridge 45L',
      gap: 1.5,
      soldOut: true,
      products: [{}, {}],
      targets: [{ label: '/ridge' }, { label: '/crest' }, {}],
    });
    expect(Object.keys(got).every((key) => TITLE_KEYS.includes(key))).toBe(true);
  });

  it('cuts long texts and lists', () => {
    const got = titlePayload({
      promptText: 'q'.repeat(1000),
      why: 'w'.repeat(5000),
      removedKeys: Array.from({ length: 500 }, (_, i) => `k${i}`),
    });
    expect(got.promptText).toHaveLength(300);
    expect(got.why).toHaveLength(1000);
    expect(got.removedKeys).toHaveLength(100);
  });

  it('never cuts an emoji in half', () => {
    // An astral character across the cut: its first half alone is a lone
    // surrogate, which jsonb refuses, failing the brand's whole insert.
    const got = titlePayload({
      promptText: `${'q'.repeat(299)}😀 more`,
      why: `${'w'.repeat(999)}😀`,
      targets: [{ label: `${'l'.repeat(299)}😀` }],
    });
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(got.promptText).toBe('q'.repeat(299));
    expect(got.why).toBe('w'.repeat(999));
    expect(got.targets[0].label).toBe('l'.repeat(299));
    expect(JSON.stringify(got)).not.toMatch(/\\ud[89ab]/i);
    expect(lone.test(got.promptText + got.why + got.targets[0].label)).toBe(false);
    // A whole emoji before the cut stays.
    expect(titlePayload({ title: `${'t'.repeat(298)}😀x` }).title).toBe(`${'t'.repeat(298)}😀`);
  });

  it('reads nothing from no payload', () => {
    expect(titlePayload(null)).toEqual({});
    expect(titlePayload('x')).toEqual({});
  });
});

describe('the time estimate', () => {
  it('is about 4 minutes a page, a new page counting as one', () => {
    expect(startNowOf('create', {})).toEqual({ method: 'create', pages: 1, minutes: 4 });
    expect(
      startNowOf('optimize', {
        pages: ['https://a.example/1', 'https://a.example/2', 'https://a.example/1', 'not-a-url'],
      }),
    ).toEqual({ method: 'optimize', pages: 2, minutes: 8 });
    expect(startNowOf(null, { pages: ['https://a.example/1'] })).toBeNull();
    expect(actionPages({ pages: 'https://a.example' })).toEqual([]);
  });
});
