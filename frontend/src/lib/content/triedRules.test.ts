import { afterEach, describe, expect, it } from 'vitest';
import { activeRules, checkRule, readPage, ruleSet } from './rules';
import {
  NO_TRIED,
  readTried,
  runDecided,
  triedAfter,
  triedOpen,
  triedStill,
  writeTried,
} from './triedRules';

/**
 * The rules the Content Agent tried and couldn't close (editor test
 * 2026-11-03): Rules shows them amber, the person's to decide.
 */

const checked = (html: string) => {
  const page = readPage(html, html.length);
  return activeRules(ruleSet('feature_page'), { overrides: {} }).map((rule) => ({
    rule,
    status: checkRule(rule, page, { brandDomains: [], competitorDomains: [], fanouts: [] }),
  }));
};

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

afterEach(() => localStorage.clear());

describe('runDecided', () => {
  const run = { batch: 'b1' };
  it('waits for the run and its suggestions, and reads a run that found nothing as decided', () => {
    expect(runDecided(run, { batch: 'b2', open: 0, busy: true })).toBe(false);
    expect(runDecided(run, { batch: 'b2', open: 2, busy: false })).toBe(false);
    expect(runDecided(run, { batch: 'b2', open: 0, busy: false })).toBe(true);
    // The batch from before it is no answer of its.
    expect(runDecided(run, { batch: 'b1', open: 0, busy: false })).toBe(false);
    expect(runDecided({ ...run, ended: true }, { batch: 'b1', open: 0, busy: false })).toBe(true);
    expect(runDecided({ batch: null }, { batch: 'b1', open: 0, busy: false })).toBe(true);
    expect(runDecided(null, { batch: 'b1', open: 0, busy: false })).toBe(false);
  });
});

describe('the tried rules', () => {
  // "seamless" is banned; the page has no summary under its H1.
  const open = checked('<h1>Pipeline forecasting</h1><p>A seamless way to forecast.</p>');
  const fixed = checked('<h1>Pipeline forecasting</h1><p>A way to forecast.</p>');

  it('joins a decided run’s rules to those tried before', () => {
    const store = { pending: { keys: ['bannedWords'], batch: 'b1' }, tried: ['summary'] };
    expect(triedAfter(store, ['bannedWords', 'summary'])).toEqual({
      pending: null,
      tried: ['bannedWords', 'summary'],
    });
  });

  it('shows only those still open, and drops one met since', () => {
    expect(triedOpen(['bannedWords'], open)).toEqual(new Set(['bannedWords']));
    expect(triedOpen(['bannedWords'], fixed)).toEqual(new Set());
    const tried = ['bannedWords'];
    // Nothing met: the same list, so nothing is saved again.
    expect(triedStill(tried, open)).toBe(tried);
    expect(triedStill(tried, fixed)).toEqual([]);
    // A rule no longer in the set leaves too.
    expect(triedStill(['gone'], open)).toEqual([]);
  });

  it('keeps the tried rules per draft, not a run under way', () => {
    expect(readTried('d1')).toEqual(NO_TRIED);
    writeTried('d1', { pending: { keys: ['faq'], batch: null }, tried: ['bannedWords'] });
    expect(readTried('d1')).toEqual({ pending: null, tried: ['bannedWords'] });
    expect(readTried('d2')).toEqual(NO_TRIED);
    writeTried('d1', NO_TRIED);
    expect(localStorage.getItem('aeo:agent-tried-rules:d1')).toBeNull();
  });
});
