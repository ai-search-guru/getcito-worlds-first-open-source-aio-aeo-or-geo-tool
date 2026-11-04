/**
 * promptsRoutes.test.ts  (PROMPT-001)
 *
 * Tests the Prompts routes the sidebar submenu and the page's tabs share.
 */

import { describe, expect, test } from 'vitest';
import { carriedParams, sectionFor, sectionFromPath } from './promptsRoutes';

describe('sectionFromPath', () => {
  test('reads the view from each route, with or without a trailing slash', () => {
    expect(sectionFromPath('/dashboard/prompts/tracked')).toMatchObject({
      tab: 'all',
      view: 'tracked',
    });
    expect(sectionFromPath('/dashboard/prompts/suggestions/')).toMatchObject({
      tab: 'all',
      view: 'suggestions',
    });
    expect(sectionFromPath('/dashboard/prompts/topics')?.tab).toBe('topics');
    expect(sectionFromPath('/dashboard/prompts/fan-outs')?.tab).toBe('fanout');
    expect(sectionFromPath('/dashboard/prompts/insights')?.tab).toBe('insights');
  });

  test('is null off the five routes (the base path, a prompt or topic detail page)', () => {
    expect(sectionFromPath('/dashboard/prompts')).toBeNull();
    expect(sectionFromPath('/dashboard/prompts/8a1c-uuid')).toBeNull();
    expect(sectionFromPath('/dashboard/prompts/topics/8a1c-uuid')).toBeNull();
  });
});

describe('sectionFor', () => {
  test('maps the in-page tabs to the routes', () => {
    expect(sectionFor('all', 'tracked').href).toBe('/dashboard/prompts/tracked');
    expect(sectionFor('all', 'suggestions').href).toBe('/dashboard/prompts/suggestions');
    expect(sectionFor('topics', 'suggestions').href).toBe('/dashboard/prompts/topics');
    expect(sectionFor('fanout', 'suggestions').href).toBe('/dashboard/prompts/fan-outs');
    expect(sectionFor('insights', 'tracked').href).toBe('/dashboard/prompts/insights');
  });
});

describe('carriedParams', () => {
  test('keeps the date range and location, drops the rest', () => {
    expect(carriedParams('?tab=all&range=7d&region=TR&sort=runs&positions=x')).toBe(
      '?range=7d&region=TR',
    );
    expect(carriedParams('?range=custom&from=2026-10-01&to=2026-10-05')).toBe(
      '?range=custom&from=2026-10-01&to=2026-10-05',
    );
    expect(carriedParams('')).toBe('');
  });
});
