import { describe, expect, it } from 'vitest';
import { endOfDayIn } from '@/lib/timeZone';
import {
  awaitsFirstAnswers,
  reachesToday,
  cellShade,
  locationAverages,
  matrixInsights,
  matrixLocations,
  metricValue,
  rowGap,
  type PromptLocationCell,
  type PromptLocationMatrix,
} from './promptLocationMatrix';

/** The Tracked Prompts Locations view (PROMPT-015b). */

const cell = (
  score: number | null,
  over: Partial<PromptLocationCell> = {},
): PromptLocationCell => ({
  score,
  mentions: score === null ? 0 : Math.round(score / 2),
  citations: 1,
  position: score ? 3.5 : null,
  runs: score === null ? 0 : 7,
  ...over,
});

const matrix: PromptLocationMatrix = {
  p1: { TR: cell(35), 'TR~istanbul': cell(41), US: cell(62) },
  p2: { TR: cell(26), 'TR~istanbul': cell(47), US: cell(20) },
  p3: { US: cell(70) },
};
const prompts = [
  { id: 'p1', text: 'best specialty coffee subscription', regions: ['US', 'TR', 'TR~istanbul'] },
  { id: 'p2', text: 'same day coffee delivery near me', regions: ['US', 'TR', 'TR~istanbul'] },
  { id: 'p3', text: 'single origin vs blend coffee', regions: ['US'] },
];
const regions = ['US', 'TR', 'TR~istanbul'];

describe('metricValue', () => {
  it("reads the metric, and nothing where there are no answers or it's never named", () => {
    expect(metricValue(matrix.p1.US, 'visibility')).toBe(62);
    expect(metricValue(matrix.p1.US, 'mentions')).toBe(31);
    expect(metricValue(matrix.p1.US, 'position')).toBe(3.5);
    expect(metricValue(cell(0, { position: null }), 'position')).toBeNull();
    expect(metricValue(undefined, 'visibility')).toBeNull();
    expect(metricValue(cell(null), 'visibility')).toBeNull();
  });
});

describe('matrixLocations', () => {
  it('shows the locations the prompts track, the most tracked first', () => {
    expect(matrixLocations(prompts)).toEqual(['US', 'TR', 'TR~istanbul']);
    expect(matrixLocations([{ regions: [] }])).toEqual([]);
  });
});

describe('cellShade', () => {
  it('spreads the tones over the values in view; for position, earlier is darker', () => {
    const inView = [20, 35, 62, 70];
    expect(cellShade(70, inView, 'visibility')).toBe(4);
    expect(cellShade(20, inView, 'visibility')).toBe(1);
    expect(cellShade(null, inView, 'visibility')).toBe(0);
    expect(cellShade(0, inView, 'visibility')).toBe(0);
    expect(cellShade(1.5, [1.5, 6], 'position')).toBe(4);
    expect(cellShade(6, [1.5, 6], 'position')).toBe(1);
  });
});

describe('rowGap and locationAverages', () => {
  it('reads the gap between the best and worst location, and each location’s average', () => {
    expect(rowGap([35, 41, 62])).toBe(27);
    expect(rowGap([35, null])).toBeNull();
    expect(locationAverages(matrix, ['p1', 'p2', 'p3'], regions, 'visibility')).toEqual([
      51, 31, 44,
    ]);
  });
});

describe('matrixInsights', () => {
  it('names the weakest and strongest location and the widest prompt, on visibility', () => {
    expect(matrixInsights(matrix, prompts, regions)).toEqual({
      weakest: { region: 'TR', average: 31, untracked: 1 },
      strongest: { region: 'US', average: 51, tracked: 3 },
      widest: {
        promptId: 'p1',
        text: 'best specialty coffee subscription',
        low: 35,
        lowAt: 'TR',
        high: 62,
        highAt: 'US',
      },
      overall: 43,
    });
  });
});

describe('reachesToday', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('holds for a preset, and a custom range that ends today', () => {
    expect(reachesToday({}, now, 'UTC')).toBe(true);
    expect(reachesToday({ to: '2026-10-28T23:59:59.999Z' }, now, 'UTC')).toBe(true);
  });
  it("doesn't for a range that ended before", () => {
    expect(reachesToday({ to: '2026-10-20T23:59:59Z' }, now, 'UTC')).toBe(false);
  });
  it("doesn't for a range that ended yesterday, on the viewer's clock", () => {
    // Yesterday's last moment in Istanbul is less than a day ago.
    const yesterday = endOfDayIn('2026-10-27', 'Europe/Istanbul');
    expect(reachesToday({ to: yesterday }, now, 'Europe/Istanbul')).toBe(false);
    expect(
      reachesToday({ to: endOfDayIn('2026-10-28', 'Europe/Istanbul') }, now, 'Europe/Istanbul'),
    ).toBe(true);
    // Past 21:00 UTC it is already the 29th in Istanbul, still the 28th in New York.
    const late = Date.parse('2026-10-28T22:30:00Z');
    expect(
      reachesToday({ to: endOfDayIn('2026-10-28', 'Europe/Istanbul') }, late, 'Europe/Istanbul'),
    ).toBe(false);
    expect(
      reachesToday({ to: endOfDayIn('2026-10-28', 'America/New_York') }, late, 'America/New_York'),
    ).toBe(true);
  });
});

describe('awaitsFirstAnswers', () => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  it('waits for a prompt added within two days, answered nowhere yet', () => {
    expect(awaitsFirstAnswers({ createdAt: '2026-10-28T09:00:00Z' }, false, now)).toBe(true);
    expect(awaitsFirstAnswers({ createdAt: '2026-10-26T12:00:01Z' }, false, now)).toBe(true);
  });
  it("doesn't for an older one answered nowhere in the window: a dash", () => {
    expect(awaitsFirstAnswers({ createdAt: '2026-10-26T12:00:00Z' }, false, now)).toBe(false);
    expect(awaitsFirstAnswers({ createdAt: '2026-09-01T00:00:00Z' }, false, now)).toBe(false);
  });
  it('waits at a place with no answers when the prompt has some elsewhere (just added)', () => {
    expect(awaitsFirstAnswers({ createdAt: '2026-09-01T00:00:00Z' }, true, now)).toBe(true);
  });
});
