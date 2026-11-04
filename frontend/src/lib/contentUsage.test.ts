/**
 * contentUsage.test.ts  (CONTENT-001)
 *
 * How the monthly content counters read on the usage card.
 */

import { describe, expect, test } from 'vitest';
import {
  counterTone,
  hasContentQuota,
  onDemandMax,
  usagePercent,
  usageTone,
  type ContentUsage,
} from './contentUsage';

const c = (used: number, limit: number) => ({ used, limit, remaining: Math.max(0, limit - used) });

describe('usageTone', () => {
  test('normal under 80%, warning from 80%, exhausted at the limit', () => {
    expect(usageTone(c(7, 10))).toBe('normal');
    expect(usageTone(c(8, 10))).toBe('warning');
    expect(usageTone(c(43, 50))).toBe('warning');
    expect(usageTone(c(10, 10))).toBe('exhausted');
    expect(usageTone(c(12, 10))).toBe('exhausted');
  });

  test('unlimited plans have no tone', () => {
    expect(usageTone(c(0, -1))).toBe('unlimited');
  });
});

describe('counterTone', () => {
  test('is "noPlan", not exhausted, when the limit reads 0 without an active plan', () => {
    expect(counterTone(c(4, 0), true)).toBe('noPlan');
    expect(counterTone(c(4, 0))).toBe('exhausted');
    expect(counterTone(c(7, 10))).toBe('normal');
    expect(counterTone(c(0, -1))).toBe('unlimited');
  });
});

describe('usagePercent', () => {
  test('is capped at 100 and empty when unlimited', () => {
    expect(usagePercent(c(32, 50))).toBe(64);
    expect(usagePercent(c(12, 10))).toBe(100);
    expect(usagePercent(c(0, -1))).toBe(0);
  });
});

describe('hasContentQuota', () => {
  const usage = (o: number, b: number): ContentUsage => ({
    plan: 'starter',
    planName: 'Starter',
    periodStart: null,
    periodEnd: null,
    opportunities: { ...c(0, o), perRequest: 3 },
    briefs: c(0, b),
  });

  test('shows the card when either counter is limited', () => {
    expect(hasContentQuota(usage(10, 10))).toBe(true);
    expect(hasContentQuota(usage(-1, 10))).toBe(true);
    expect(hasContentQuota(usage(-1, -1))).toBe(false);
    expect(hasContentQuota(null)).toBe(false);
  });
});

describe('onDemandMax', () => {
  const usage = (used: number, limit: number, perRequest: number): ContentUsage => ({
    plan: 'growth',
    planName: 'Growth',
    periodStart: null,
    periodEnd: null,
    opportunities: { ...c(used, limit), perRequest },
    briefs: c(0, 50),
  });

  test('is the per-request cap, never more than what is left', () => {
    expect(onDemandMax(usage(10, 50, 5))).toBe(5);
    expect(onDemandMax(usage(48, 50, 5))).toBe(2);
    expect(onDemandMax(usage(10, 10, 3))).toBe(0);
    expect(onDemandMax(usage(0, -1, 5))).toBe(5);
    expect(onDemandMax(null)).toBe(0);
  });
});
