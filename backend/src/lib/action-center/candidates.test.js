import { describe, expect, it } from 'vitest';
import { orderByPriority, scoreCandidate } from './candidates.js';
import { ENGINE_THRESHOLDS } from '../../config/actionEngine.js';

const { priority } = ENGINE_THRESHOLDS;
const NOW = new Date('2026-09-25T02:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const candidate = (over = {}) => ({
  definitionId: 'recover_visibility',
  priorityScore: 60,
  firstSeenAt: NOW.toISOString(),
  ...over,
});

describe('scoreCandidate', () => {
  /**
   * The queue and the Actions list read one number (AC-006): what comes
   * first among actions is what comes first among the findings waiting to
   * become one.
   */
  it('orders by the priority score its action would carry', () => {
    expect(scoreCandidate(candidate({ priorityScore: 80 }), NOW)).toBeGreaterThan(
      scoreCandidate(candidate({ priorityScore: 60 }), NOW),
    );
  });

  /**
   * The term a queue needs and a sort does not. Without it a low-priority
   * finding behind a brand with a steady stream of urgent ones is never
   * worked on at all.
   */
  it('lifts a candidate that has been waiting', () => {
    expect(scoreCandidate(candidate({ firstSeenAt: daysAgo(10) }), NOW)).toBeGreaterThan(
      scoreCandidate(candidate({ firstSeenAt: daysAgo(0) }), NOW),
    );
  });

  it('stops paying for patience past the cap', () => {
    const capped = scoreCandidate(candidate({ firstSeenAt: daysAgo(priority.waitCapDays) }), NOW);
    expect(scoreCandidate(candidate({ firstSeenAt: daysAgo(400) }), NOW)).toBe(capped);
  });

  /** Patience is worth about one level, so the queue reaches everything. */
  it('lets two weeks of waiting cross about one level, and no more', () => {
    const patient = scoreCandidate(candidate({ priorityScore: 62, firstSeenAt: daysAgo(30) }), NOW);
    expect(patient).toBeGreaterThan(scoreCandidate(candidate({ priorityScore: 75 }), NOW));
    expect(patient).toBeLessThan(scoreCandidate(candidate({ priorityScore: 90 }), NOW));
  });

  it('scores a candidate first seen tonight without reading the clock wrong', () => {
    expect(scoreCandidate(candidate({ firstSeenAt: undefined }), NOW)).toBe(
      scoreCandidate(candidate({ firstSeenAt: NOW.toISOString() }), NOW),
    );
  });
});

describe('orderByPriority', () => {
  it('puts the highest priority first', () => {
    const ordered = orderByPriority(
      [
        candidate({ definitionId: 'a', priorityScore: 40 }),
        candidate({ definitionId: 'b', priorityScore: 92 }),
        candidate({ definitionId: 'c', priorityScore: 70 }),
      ],
      NOW,
    );

    expect(ordered.map((c) => c.definitionId)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a tie on how long it has waited, oldest first', () => {
    const ordered = orderByPriority(
      [
        candidate({ definitionId: 'new', firstSeenAt: daysAgo(priority.waitCapDays + 1) }),
        candidate({ definitionId: 'older', firstSeenAt: daysAgo(priority.waitCapDays + 9) }),
      ],
      NOW,
    );

    // Both are past the cap, so they score the same — the tie-break is what
    // decides, and it has to be the one that has waited longer.
    expect(ordered.map((c) => c.definitionId)).toEqual(['older', 'new']);
  });

  /**
   * A scoring bug that degrades to "alphabetical order" is invisible: the
   * engine still promotes something every night, just the wrong thing. This
   * is the shape that bug took once already.
   */
  it('produces a real number for every candidate, never NaN', () => {
    for (const c of [candidate(), candidate({ priorityScore: undefined })]) {
      expect(Number.isFinite(scoreCandidate(c, NOW))).toBe(true);
    }
  });

  it('does not modify the list it was given', () => {
    const list = [
      candidate({ definitionId: 'a', priorityScore: 30 }),
      candidate({ definitionId: 'b', priorityScore: 90 }),
    ];
    orderByPriority(list, NOW);
    expect(list.map((c) => c.definitionId)).toEqual(['a', 'b']);
  });
});
