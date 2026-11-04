/**
 * promptImprove.test.ts  (PROMPT-003)
 *
 * Tests the Improve tab's draft helpers: the footer summary, the unsent-edits
 * check that guards range changes and Regenerate, and the source chip labels.
 */

import { describe, expect, test } from 'vitest';
import {
  hasUnsentEdits,
  mentionRateLabel,
  selectionSummary,
  sourceChipLabel,
  toDrafts,
  type ImproveSuggestion,
} from './promptImprove';

const s = (id: string, platform: string): ImproveSuggestion => ({
  id,
  platform,
  state: 'not_mentioned',
  title: `Title ${id}`,
  body: 'Body',
  sources: [{ type: 'domain', ref: 'reddit.com' }],
  confidence: 'high',
});

const original = [s('a', 'chatgpt-web'), s('b', 'chatgpt-web'), s('c', 'perplexity-web')];

describe('selectionSummary', () => {
  test('counts selected over live suggestions and distinct selected platforms', () => {
    const drafts = toDrafts(original);
    expect(selectionSummary(drafts)).toEqual({ selected: 3, total: 3, platforms: 2 });
    drafts[2] = { ...drafts[2], checked: false };
    drafts[1] = { ...drafts[1], removed: true };
    expect(selectionSummary(drafts)).toEqual({ selected: 1, total: 2, platforms: 1 });
  });
});

describe('hasUnsentEdits', () => {
  test('a fresh draft has none', () => {
    expect(hasUnsentEdits(toDrafts(original), original)).toBe(false);
  });

  test('an edit, an uncheck or a removal counts', () => {
    const edited = toDrafts(original).map((d) => (d.id === 'a' ? { ...d, body: 'Changed' } : d));
    expect(hasUnsentEdits(edited, original)).toBe(true);
    const unchecked = toDrafts(original).map((d) => (d.id === 'b' ? { ...d, checked: false } : d));
    expect(hasUnsentEdits(unchecked, original)).toBe(true);
    const removed = toDrafts(original).map((d) => (d.id === 'c' ? { ...d, removed: true } : d));
    expect(hasUnsentEdits(removed, original)).toBe(true);
  });

  test('an own suggestion counts until it is removed', () => {
    const own = { ...s('own:1', 'chatgpt-web'), checked: true, removed: false, own: true };
    expect(hasUnsentEdits([...toDrafts(original), own], original)).toBe(true);
    expect(hasUnsentEdits([...toDrafts(original), { ...own, removed: true }], original)).toBe(
      false,
    );
  });
});

describe('sourceChipLabel', () => {
  test('labels each source type', () => {
    expect(sourceChipLabel({ type: 'fanout', ref: 'best coffee' })).toBe('Fan-out: best coffee');
    expect(sourceChipLabel({ type: 'answer', ref: 'a quote' })).toBe('AI answer');
    expect(sourceChipLabel({ type: 'competitor_url', ref: 'https://www.rival.com/plans' })).toBe(
      'rival.com/plans',
    );
    expect(sourceChipLabel({ type: 'brand_page', ref: 'https://acme.com/' })).toBe(
      'Your page: acme.com',
    );
    expect(sourceChipLabel({ type: 'domain', ref: 'reddit.com' })).toBe('reddit.com');
  });
});

describe('mentionRateLabel', () => {
  test('says how many runs mention the brand', () => {
    expect(mentionRateLabel({ runs: 120, mentionedRuns: 8 })).toBe('mentioned in 8 of 120 runs');
    expect(mentionRateLabel({ runs: 1, mentionedRuns: 0 })).toBe('mentioned in 0 of 1 run');
  });
});
