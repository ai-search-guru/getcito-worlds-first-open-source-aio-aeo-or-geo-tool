import { describe, it, expect } from 'vitest';
import {
  activationDelta,
  promptLocationCount,
  summarizeLocationRows,
  locationLimitMessage,
  planBulkLocationChange,
} from './promptLocations';
import { PLANS } from '@/config/plans';

const starter = PLANS.starter; // maxPrompts: 50
const selfHosted = PLANS.self_hosted; // maxPrompts: -1
const enterprise = PLANS.enterprise; // maxPrompts: -1

describe('promptLocationCount', () => {
  it('counts one location per region entry', () => {
    expect(promptLocationCount(['US'])).toBe(1);
    expect(promptLocationCount(['US', 'DE', 'TR'])).toBe(3);
  });

  it('costs one for prompts with no regions — the worker still runs them once', () => {
    expect(promptLocationCount([])).toBe(1);
    expect(promptLocationCount(null)).toBe(1);
    expect(promptLocationCount(undefined)).toBe(1);
  });
});

describe('summarizeLocationRows', () => {
  it('totals the per-brand rows the RPC returns', () => {
    const usage = summarizeLocationRows([
      { brand_id: 'a', locations: 3 },
      { brand_id: 'b', locations: 1 },
    ]);
    expect(usage.total).toBe(4);
    expect(usage.byBrand.get('a')).toBe(3);
    expect(usage.byBrand.get('b')).toBe(1);
  });

  it("counts the brands the caller can't access in the total, but names none of them (00390)", () => {
    const usage = summarizeLocationRows([
      { brand_id: 'a', locations: 3 },
      { brand_id: null, locations: 7 },
    ]);
    expect(usage.total).toBe(10);
    expect([...usage.byBrand]).toEqual([['a', 3]]);
  });

  it('returns zero usage for no rows', () => {
    const usage = summarizeLocationRows([]);
    expect(usage.total).toBe(0);
    expect(usage.byBrand.size).toBe(0);
  });
});

describe('locationLimitMessage', () => {
  it('never rejects on the -1 sentinel (self-host and enterprise stay unmetered)', () => {
    expect(locationLimitMessage(selfHosted, 10_000, 500)).toBeNull();
    expect(locationLimitMessage(enterprise, 10_000, 500)).toBeNull();
  });

  it('allows landing exactly on the limit (inclusive cap)', () => {
    expect(locationLimitMessage(starter, 49, 1)).toBeNull();
    expect(locationLimitMessage(starter, 0, 50)).toBeNull();
  });

  it('rejects the first location past the limit', () => {
    expect(locationLimitMessage(starter, 50, 1)).not.toBeNull();
    expect(locationLimitMessage(starter, 49, 2)).not.toBeNull();
  });

  it('measures the delta, not one: a multi-location add near the limit is rejected', () => {
    // 48 used + a prompt targeting 3 locations = 51 > 50, even though a
    // row-count check (48 < 50) would have let it through.
    expect(locationLimitMessage(starter, 48, 3)).not.toBeNull();
  });

  it('always allows changes that add nothing, even over the limit', () => {
    // Re-saving unchanged at the cap, or after a plan downgrade left the org
    // over its limit, must not brick the existing set.
    expect(locationLimitMessage(starter, 50, 0)).toBeNull();
    expect(locationLimitMessage(starter, 120, 0)).toBeNull();
    expect(locationLimitMessage(starter, 120, -5)).toBeNull();
  });

  it('spells out the location math in the message', () => {
    const msg = locationLimitMessage(starter, 48, 5);
    expect(msg).toContain('50 active prompt locations');
    expect(msg).toContain("paused prompts don't count");
    expect(msg).toContain('53');
    expect(msg).toContain('48 in place + 5 added');
    expect(msg).toContain('Remove or pause 3 locations');
  });

  it('uses singular grammar for a single excess location', () => {
    expect(locationLimitMessage(starter, 50, 1)).toContain('Remove or pause 1 location ');
  });
});

describe('activationDelta', () => {
  it('counts every location of each paused prompt being resumed', () => {
    expect(
      activationDelta([
        { isActive: false, regions: ['US', 'DE'] },
        { isActive: false, regions: [] },
        { isActive: true, regions: ['TR'] },
      ]),
    ).toBe(3);
  });

  it('costs nothing to "resume" prompts that are already active', () => {
    expect(activationDelta([{ isActive: true, regions: ['US', 'DE'] }])).toBe(0);
    expect(activationDelta([])).toBe(0);
  });

  it('closes the pause-and-refill loophole', () => {
    // 50 of 50 active after pausing 10 and adding 10 new ones: resuming
    // the old ten would need 10 more, which the plan doesn't have.
    const resuming = Array.from({ length: 10 }, () => ({ isActive: false, regions: ['US'] }));
    expect(locationLimitMessage(starter, 50, activationDelta(resuming))).not.toBeNull();
  });
});

describe('planBulkLocationChange', () => {
  const prompts = [
    { id: 'a', regions: ['US'] },
    { id: 'b', regions: ['US', 'DE'] },
    { id: 'c', regions: ['TR'] },
  ];

  it('adds a location only where it is missing', () => {
    const plan = planBulkLocationChange(prompts, 'add', ['DE']);
    expect(plan.changes.map((c) => c.promptId)).toEqual(['a', 'c']);
    expect(plan.changes[0].regions).toEqual(['US', 'DE']);
    // 'b' already had DE — no cost, no write.
    expect(plan.unchanged).toBe(1);
    expect(plan.delta).toBe(2);
  });

  it('appends rather than reorders, so existing targeting is untouched', () => {
    const plan = planBulkLocationChange([{ id: 'a', regions: ['DE', 'US'] }], 'add', ['TR']);
    expect(plan.changes[0].regions).toEqual(['DE', 'US', 'TR']);
  });

  it('removes a location and frees capacity', () => {
    const plan = planBulkLocationChange(prompts, 'remove', ['DE']);
    expect(plan.changes.map((c) => c.promptId)).toEqual(['b']);
    expect(plan.changes[0].regions).toEqual(['US']);
    expect(plan.delta).toBe(-1);
    expect(plan.unchanged).toBe(2);
  });

  it('never empties a prompt — single-location prompts are skipped, not emptied', () => {
    // 'a' and 'c' each target one location; removing it would make them
    // untrackable, so they stay and are reported.
    const plan = planBulkLocationChange(prompts, 'remove', ['US', 'TR']);
    expect(plan.blocked).toBe(2);
    expect(plan.changes.map((c) => c.promptId)).toEqual(['b']);
    expect(plan.changes[0].regions).toEqual(['DE']);
  });

  it('counts a batch add as one location per prompt', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, regions: ['US'] }));
    expect(planBulkLocationChange(many, 'add', ['DE']).delta).toBe(40);
  });

  it('prices multiple locations per prompt', () => {
    const plan = planBulkLocationChange([{ id: 'a', regions: ['US'] }], 'add', ['DE', 'TR']);
    expect(plan.delta).toBe(2);
    expect(plan.changes[0].regions).toEqual(['US', 'DE', 'TR']);
  });

  it('normalizes case and ignores duplicates in the requested list', () => {
    const plan = planBulkLocationChange([{ id: 'a', regions: ['US'] }], 'add', [
      'de',
      'DE',
      ' de ',
    ]);
    expect(plan.delta).toBe(1);
    expect(plan.changes[0].regions).toEqual(['US', 'DE']);
  });

  it('does nothing when no location is chosen', () => {
    const plan = planBulkLocationChange(prompts, 'add', []);
    expect(plan).toEqual({ changes: [], unchanged: 0, blocked: 0, delta: 0 });
  });

  it('charges nothing for the first location of a prompt that had none', () => {
    // An empty region list already costs one — the worker runs it untargeted
    // once — so naming that location is free.
    const plan = planBulkLocationChange([{ id: 'a', regions: [] }], 'add', ['DE']);
    expect(plan.changes[0].regions).toEqual(['DE']);
    expect(plan.delta).toBe(0);
  });

  it('removes from many prompts with a long list of codes in time near its length', () => {
    // A removal's codes aren't checked against the known locations.
    const codes = Array.from({ length: 60_000 }, (_, i) => `X${i}`).concat('DE');
    const prompts = Array.from({ length: 2_000 }, (_, i) => ({
      id: `p${i}`,
      regions: ['US', 'DE', 'US-CA', 'TR~ISTANBUL'],
    }));
    const started = performance.now();
    const plan = planBulkLocationChange(prompts, 'remove', codes);
    expect(performance.now() - started).toBeLessThan(500);
    expect(plan.changes).toHaveLength(2_000);
    expect(plan.changes[0].regions).toEqual(['US', 'US-CA', 'TR~ISTANBUL']);
    expect(plan.delta).toBe(-2_000);
  });
});

describe('planBulkLocationChange on paused prompts', () => {
  it("writes the change but doesn't count it until the prompt is resumed", () => {
    const plan = planBulkLocationChange(
      [
        { id: 'a', regions: ['US'], isActive: true },
        { id: 'b', regions: ['US'], isActive: false },
      ],
      'add',
      ['DE'],
    );
    expect(plan.changes.map((c) => c.promptId)).toEqual(['a', 'b']);
    expect(plan.delta).toBe(1);
  });
});
