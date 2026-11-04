import { describe, expect, it } from 'vitest';
import { compareHistory, controlNetOf, summarize, type ActionHistoryItem } from './history';

const item = (over: Partial<ActionHistoryItem> = {}): ActionHistoryItem =>
  ({
    id: 'a',
    status: 'completed',
    outcome: 'pending_measurement',
    priorityScore: null,
    priorityLevel: null,
    createdAt: '2026-10-01T00:00:00Z',
    completedAt: '2026-10-05T00:00:00Z',
    ...over,
  }) as ActionHistoryItem;

describe('compareHistory', () => {
  it('lists the highest priority first, the never-scored last, then the newest', () => {
    const items = [
      item({ id: 'unscored' }),
      item({ id: 'p60-old', priorityScore: 60, completedAt: '2026-10-02T00:00:00Z' }),
      item({ id: 'p92', priorityScore: 92 }),
      item({ id: 'p60-new', priorityScore: 60, completedAt: '2026-10-09T00:00:00Z' }),
    ];
    expect(items.sort(compareHistory('priority')).map((i) => i.id)).toEqual([
      'p92',
      'p60-new',
      'p60-old',
      'unscored',
    ]);
  });
});

describe('summarize', () => {
  it('reads the highest priority among the actions in range', () => {
    expect(
      summarize([item({ priorityLevel: 'medium' }), item({ priorityLevel: 'critical' })])
        .topPriority,
    ).toBe('critical');
    expect(summarize([item()]).topPriority).toBeNull();
  });
});

describe('controlNetOf', () => {
  it('reads the net the validation sweep kept, the metrics it can name', () => {
    expect(
      controlNetOf({
        control: {
          basis: 'topics',
          prompts: 12,
          net: [
            { metric: 'visibility', net: -1.5, unit: 'points' },
            { metric: 'citations', net: Number.NaN, unit: 'percent' },
            { metric: 'sessions', net: 4, unit: 'sessions' },
          ],
        },
      }),
    ).toEqual({
      basis: 'topics',
      prompts: 12,
      net: [{ metric: 'visibility', net: -1.5, unit: 'points' }],
    });
  });

  it('reads none without a control, a metric it can name or a basket size', () => {
    expect(controlNetOf(null)).toBeNull();
    expect(controlNetOf({})).toBeNull();
    expect(
      controlNetOf({ control: { prompts: 12, net: [{ metric: 'x', net: 1, unit: 'sessions' }] } }),
    ).toBeNull();
    expect(
      controlNetOf({ control: { net: [{ metric: 'visibility', net: 1, unit: 'points' }] } }),
    ).toBeNull();
  });

  it('reads any basis but topics as the brand', () => {
    expect(
      controlNetOf({
        control: {
          basis: 'other',
          prompts: 3,
          net: [{ metric: 'mentions', net: 1, unit: 'points' }],
        },
      })?.basis,
    ).toBe('brand');
  });
});
