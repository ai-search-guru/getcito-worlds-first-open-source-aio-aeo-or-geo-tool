/**
 * improveOutcome.test.ts  (PROMPT-008)
 *
 * Reading an Improve action's stored position outcome.
 */

import { describe, expect, test } from 'vitest';
import {
  improvePlatformLabels,
  parseImproveOutcome,
  pickImprovingAction,
  readLabel,
  type PlatformRead,
} from './improveOutcome';

const read = (over: Partial<PlatformRead> = {}): PlatformRead => ({
  platform: 'google-aimode',
  state: 'mentioned_late',
  runs: 7,
  mentionedRuns: 7,
  mentionPosition: 2,
  ...over,
});

const stored = {
  measuredAt: '2026-10-14T06:00:00.000Z',
  window: { from: '2026-10-07T06:00:00.000Z', to: '2026-10-14T06:00:00.000Z' },
  final: false,
  platforms: [
    {
      platform: 'google-aimode',
      before: read(),
      after: read({ mentionPosition: 1.2 }),
      verdict: 'improved',
    },
    { platform: 'gemini-web', before: read({ runs: 0 }), after: null, verdict: 'not_enough_data' },
  ],
  summary: { total: 2, measurable: 1, improved: 1, declined: 0, avgBefore: 2, avgAfter: 1.2 },
};

describe('parseImproveOutcome', () => {
  test('reads the stored outcome', () => {
    const outcome = parseImproveOutcome(stored);
    expect(outcome?.platforms.map((p) => p.verdict)).toEqual(['improved', 'not_enough_data']);
    expect(outcome?.summary.improved).toBe(1);
  });

  test('null when missing or not an outcome', () => {
    expect(parseImproveOutcome(null)).toBeNull();
    expect(parseImproveOutcome({})).toBeNull();
  });

  test('drops rows with an unknown verdict instead of guessing', () => {
    const outcome = parseImproveOutcome({
      ...stored,
      platforms: [...stored.platforms, { ...stored.platforms[0], verdict: 'great' }],
    });
    expect(outcome?.platforms).toHaveLength(2);
  });
});

describe('readLabel', () => {
  test('a position, not mentioned, mentioned without a position, or no runs', () => {
    expect(readLabel(read({ mentionPosition: 1.24 }))).toEqual({ kind: 'position', value: '#1.2' });
    expect(readLabel(read({ mentionedRuns: 0, mentionPosition: null }))).toEqual({
      kind: 'not_mentioned',
    });
    expect(
      readLabel(read({ runs: 10, mentionedRuns: 1, mentionPosition: 1, state: 'not_mentioned' })),
    ).toEqual({ kind: 'not_mentioned' });
    expect(readLabel(read({ mentionPosition: null }))).toEqual({ kind: 'mentioned' });
    expect(readLabel(read({ runs: 0 }))).toEqual({ kind: 'no_runs' });
    expect(readLabel(null)).toEqual({ kind: 'no_runs' });
  });
});

describe('improvePlatformLabels', () => {
  test('maps the payload platforms to their names', () => {
    expect(
      improvePlatformLabels({
        platforms: [
          { id: 'google-aimode', label: 'Google AI Mode', state: 'mentioned_late' },
          { id: 1 },
        ],
      }),
    ).toEqual({ 'google-aimode': 'Google AI Mode' });
    expect(improvePlatformLabels(null)).toEqual({});
  });
});

describe('pickImprovingAction', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    action_no: 61,
    status: 'in_progress',
    position_outcome: stored,
    ...over,
  });

  test('the newest tracked action, with the delta across platforms', () => {
    expect(pickImprovingAction([row()])).toEqual({
      actionId: 'a1',
      actionNo: 61,
      avgBefore: 2,
      avgAfter: 1.2,
    });
  });

  test('skips dismissed actions and ones whose 30 days are over', () => {
    expect(
      pickImprovingAction([
        row({ id: 'd', status: 'dismissed' }),
        row({ id: 'f', status: 'completed', position_outcome: { ...stored, final: true } }),
        row({ id: 'c', status: 'completed' }),
      ])?.actionId,
    ).toBe('c');
    expect(pickImprovingAction([row({ status: 'dismissed' })])).toBeNull();
  });
});
