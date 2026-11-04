import { describe, expect, it } from 'vitest';
import {
  autoAuditEnabled,
  dueRun,
  pendingRuns,
  perRunSlots,
  pickRunPages,
  runSchedule,
} from './autoAudit.js';

const START = new Date('2026-10-03T14:00:00Z');
const END = new Date('2026-11-03T14:00:00Z');
const at = (iso) => new Date(iso);

describe('perRunSlots', () => {
  it('takes 5% of the quota, rounded down, at least one', () => {
    expect(perRunSlots(100)).toBe(5);
    expect(perRunSlots(500)).toBe(25);
    expect(perRunSlots(2010)).toBe(100);
    expect(perRunSlots(10)).toBe(1);
    // Without a monthly limit, Growth's run; without audits, none.
    expect(perRunSlots(-1)).toBe(25);
    expect(perRunSlots(0)).toBe(0);
  });
});

describe('autoAuditEnabled', () => {
  it("follows the org's choice, else the plan: on with a quota, off without", () => {
    expect(autoAuditEnabled(null, 100)).toBe(true);
    expect(autoAuditEnabled(null, -1)).toBe(false);
    expect(autoAuditEnabled(false, 500)).toBe(false);
    expect(autoAuditEnabled(true, -1)).toBe(true);
  });
});

describe('runSchedule', () => {
  it('counts the days from the period start, each run lasting until the next', () => {
    // A subscription renewed at 14:00: day 1 starts then, the others with their day.
    const schedule = runSchedule(START, END);
    expect(schedule.map((r) => [r.day, r.at.toISOString(), r.until.toISOString()])).toEqual([
      [1, '2026-10-03T14:00:00.000Z', '2026-10-09T00:00:00.000Z'],
      [7, '2026-10-09T00:00:00.000Z', '2026-10-16T00:00:00.000Z'],
      [14, '2026-10-16T00:00:00.000Z', '2026-10-23T00:00:00.000Z'],
      [21, '2026-10-23T00:00:00.000Z', '2026-10-30T00:00:00.000Z'],
      [28, '2026-10-30T00:00:00.000Z', '2026-11-03T14:00:00.000Z'],
    ]);
  });

  it('runs day 28 on the last day of a shorter period', () => {
    const schedule = runSchedule(at('2026-02-01T00:00:00Z'), at('2026-02-26T00:00:00Z'));
    expect(schedule.at(-1).at.toISOString()).toBe('2026-02-25T00:00:00.000Z');
  });
});

describe('dueRun', () => {
  const schedule = runSchedule(START, END);
  it('finds the run whose turn it is, a missed day included, and none outside the period', () => {
    expect(dueRun(schedule, at('2026-10-03T14:00:00Z')).day).toBe(1);
    // The morning sweep of day 7 runs it, though the period renews at 14:00.
    expect(dueRun(schedule, at('2026-10-09T06:00:00Z')).day).toBe(7);
    expect(dueRun(schedule, at('2026-10-11T06:00:00Z')).day).toBe(7);
    expect(dueRun(schedule, at('2026-11-02T06:00:00Z')).day).toBe(28);
    expect(dueRun(schedule, at('2026-10-03T13:59:00Z'))).toBeNull();
    expect(dueRun(schedule, END)).toBeNull();
  });
});

describe('pendingRuns', () => {
  const schedule = runSchedule(START, END);
  it('keeps the current run until it is recorded, and the ones to come', () => {
    const days = (recorded, now) => pendingRuns(schedule, recorded, now).map((r) => r.day);
    // Day 8: day 1 ran; day 7's turn is now.
    expect(days([1], at('2026-10-10T06:00:00Z'))).toEqual([7, 14, 21, 28]);
    expect(days([1, 7], at('2026-10-10T06:00:00Z'))).toEqual([14, 21, 28]);
    // A run whose turn passed unrecorded (auto-audit was off) keeps nothing.
    expect(days([], at('2026-10-17T06:00:00Z'))).toEqual([14, 21, 28]);
    expect(days([1, 7, 14, 21, 28], at('2026-10-31T06:00:00Z'))).toEqual([]);
  });
});

describe('pickRunPages', () => {
  const NOW = at('2026-10-17T06:00:00Z');
  const fixedPage = (path, brandId = 'a') => ({
    brandId,
    key: `acme.com${path}`,
    url: `https://acme.com${path}`,
    path,
  });

  /** A page fixed since its last audit is audited again first (learning B7). */
  it('takes pages fixed since their last audit first, up to half the run', () => {
    const pages = pickRunPages(
      [
        {
          brandId: 'a',
          opportunities: [
            // Audited last week, so the inbox would leave it; fixed since.
            row('/fixed-1', { priority: 90, lastAudit: { at: '2026-10-10T00:00:00Z' } }),
            row('/a-80', { priority: 80 }),
            row('/a-70', { priority: 70 }),
            row('/busy', { running: true }),
          ],
        },
      ],
      4,
      NOW,
      new Set(['acme.com/fixed-2']),
      [fixedPage('/fixed-1'), fixedPage('/busy'), fixedPage('/fixed-2'), fixedPage('/fixed-3')],
    );
    expect(pages.map((p) => [p.path, p.fixed ?? false])).toEqual([
      ['/fixed-1', true],
      ['/fixed-2', true],
      ['/a-80', false],
      ['/a-70', false],
    ]);
  });

  it("keeps brands sharing a domain apart: one's fixed page doesn't take or skip the other's", () => {
    const pages = pickRunPages(
      [
        {
          brandId: 'a',
          opportunities: [row('/shared', { priority: 50 })],
        },
        {
          brandId: 'b',
          opportunities: [row('/shared', { priority: 90 }), row('/busy', { running: true })],
        },
      ],
      4,
      NOW,
      new Set(),
      [fixedPage('/shared', 'a'), fixedPage('/busy', 'a')],
    );
    expect(pages.map((p) => [p.brandId, p.path, p.fixed ?? false])).toEqual([
      ['a', '/shared', true],
      ['a', '/busy', true],
      ['b', '/shared', false],
    ]);
  });

  it("rounds the fixed pages' half up: three of a five-page run", () => {
    const pages = pickRunPages(
      [
        {
          brandId: 'a',
          opportunities: [row('/a-80', { priority: 80 }), row('/a-70', { priority: 70 })],
        },
      ],
      5,
      NOW,
      new Set(),
      ['/fixed-1', '/fixed-2', '/fixed-3', '/fixed-4'].map((path) => fixedPage(path)),
    );
    expect(pages.map((p) => p.path)).toEqual([
      '/fixed-1',
      '/fixed-2',
      '/fixed-3',
      '/a-80',
      '/a-70',
    ]);
  });

  it('gives a one-page run to a fixed page, and none to a run with no slots', () => {
    const inbox = [{ brandId: 'a', opportunities: [row('/a-80', { priority: 80 })] }];
    expect(
      pickRunPages(inbox, 1, NOW, new Set(), [fixedPage('/fixed')]).map((p) => p.path),
    ).toEqual(['/fixed']);
    expect(pickRunPages(inbox, 0, NOW, new Set(), [fixedPage('/fixed')])).toEqual([]);
  });

  const row = (path, over = {}) => ({
    key: `acme.com${path}`,
    url: `https://acme.com${path}`,
    path,
    pinned: false,
    running: false,
    priority: 50,
    lastAudit: null,
    ...over,
  });

  it('takes pinned pages first, then the highest priority across brands', () => {
    const pages = pickRunPages(
      [
        {
          brandId: 'a',
          opportunities: [
            row('/pinned', { pinned: true, priority: 20 }),
            row('/a-80', { priority: 80 }),
          ],
        },
        {
          brandId: 'b',
          opportunities: [row('/b-90', { priority: 90 }), row('/b-40', { priority: 40 })],
        },
      ],
      3,
      NOW,
    );
    expect(pages.map((p) => [p.brandId, p.path])).toEqual([
      ['a', '/pinned'],
      ['b', '/b-90'],
      ['a', '/a-80'],
    ]);
  });

  it('skips pages being audited or audited in the last 30 days', () => {
    const pages = pickRunPages(
      [
        {
          brandId: 'a',
          opportunities: [
            row('/running', { running: true }),
            row('/fresh', { pinned: true, lastAudit: { at: '2026-09-20T00:00:00Z' } }),
            row('/old', { lastAudit: { at: '2026-09-10T00:00:00Z' } }),
            row('/never'),
            // A template's row: its pages are listed one by one.
            row('/blog/*', { url: null, template: { pages: 38, audited: 2, toAudit: [] } }),
          ],
        },
      ],
      5,
      NOW,
    );
    expect(pages.map((p) => p.path)).toEqual(['/old', '/never']);
    expect(pickRunPages([{ brandId: 'a', opportunities: [row('/x')] }], 0, NOW)).toEqual([]);
  });

  it('leaves a page a run tried in the last 30 days to later runs, even if its audit failed', () => {
    const pages = pickRunPages(
      [{ brandId: 'a', opportunities: [row('/blocked', { priority: 99 }), row('/next')] }],
      5,
      NOW,
      new Set(['acme.com/blocked']),
    );
    expect(pages.map((p) => p.path)).toEqual(['/next']);
  });
});
