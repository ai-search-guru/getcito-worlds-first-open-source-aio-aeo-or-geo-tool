/**
 * promptUsage.test.ts  (PROMPT-009, PROMPT-012)
 *
 * Tests the Tracked Prompts usage counter states.
 */

import { describe, expect, test } from 'vitest';
import { getPromptUsage, isPromptLimitReached } from './promptUsage';

describe('getPromptUsage', () => {
  test('-1 is unlimited and never blocks', () => {
    const u = getPromptUsage(5000, -1);
    expect(u.state).toBe('unlimited');
    expect(isPromptLimitReached(u)).toBe(false);
  });

  test('below 90% is normal', () => {
    expect(getPromptUsage(0, 200)).toEqual({ state: 'normal', remaining: 200, percent: 0 });
    expect(getPromptUsage(179, 200).state).toBe('normal');
  });

  test('from 90% up to one below the limit is a warning with the slots left', () => {
    expect(getPromptUsage(180, 200)).toEqual({ state: 'warning', remaining: 20, percent: 90 });
    expect(getPromptUsage(187, 200)).toEqual({ state: 'warning', remaining: 13, percent: 94 });
    expect(getPromptUsage(45, 50).state).toBe('warning');
    expect(getPromptUsage(49, 50).state).toBe('warning');
  });

  test('exactly at the limit is full (the cap is inclusive)', () => {
    const u = getPromptUsage(200, 200);
    expect(u).toEqual({ state: 'full', remaining: 0, percent: 100 });
    expect(isPromptLimitReached(u)).toBe(true);
  });

  test('above the limit (after a downgrade) is over, with the bar capped at 100', () => {
    const u = getPromptUsage(187, 50);
    expect(u).toEqual({ state: 'over', remaining: 0, percent: 100 });
    expect(isPromptLimitReached(u)).toBe(true);
  });

  test('a zero limit is full at zero usage', () => {
    expect(getPromptUsage(0, 0).state).toBe('full');
  });
});
