import { describe, expect, it } from 'vitest';
import { WORK_AREA_IDS } from '@/lib/menuAccess';
import { FOCUS_AREAS, focusFromWorkAreas, focusOf, focusPicks, WORK_AREA_FOCUS } from './focus';

/**
 * What Chat focuses on (CHAT-24 §2–3): the eight areas, the picks a
 * person's work areas start the picker with, and a saved focus read back.
 */

describe('focusFromWorkAreas', () => {
  it('gives every work area an area, and starts the picker with them in their order', () => {
    expect(Object.keys(WORK_AREA_FOCUS).sort()).toEqual([...WORK_AREA_IDS].sort());
    expect(focusFromWorkAreas(['leaders', 'product', 'bizdev'])).toEqual(['lead', 'pd', 'bd']);
    // Developers and AEO/GEO & Audit both point to Prompts and citations: once.
    expect(focusFromWorkAreas(['developers', 'aeo', 'analytics', 'growth'])).toEqual([
      'seo',
      'growth',
    ]);
  });

  it('starts with nothing for no work areas or unknown ones', () => {
    expect(focusFromWorkAreas(null)).toEqual([]);
    expect(focusFromWorkAreas([])).toEqual([]);
    expect(focusFromWorkAreas(['agency'])).toEqual([]);
  });
});

describe('focusOf', () => {
  it('reads null as never asked and a list as the picks, each known area once', () => {
    expect(focusOf(null)).toBeNull();
    expect(focusOf(undefined)).toBeNull();
    expect(focusOf([])).toEqual([]);
    expect(focusOf(['brand', 'devtools', 'comp', 'brand'])).toEqual(['brand', 'comp']);
  });
});

describe('focusPicks', () => {
  it('takes the known areas once each, all eight at most', () => {
    expect(focusPicks.safeParse([...FOCUS_AREAS]).success).toBe(true);
    expect(focusPicks.safeParse([]).success).toBe(true);
    expect(focusPicks.safeParse(['lead', 'lead']).success).toBe(false);
    expect(focusPicks.safeParse(['agency']).success).toBe(false);
  });
});
