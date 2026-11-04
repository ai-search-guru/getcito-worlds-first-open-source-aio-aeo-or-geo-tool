import { expect, test } from 'vitest';
import { deriveKpiStatus, isImprovement, kpiProgress, scaleTargetToWindow } from './status';

test('progress is a plain ratio for higher_is_better', () => {
  expect(kpiProgress(42.6, 50, 'higher_is_better')).toBe(85);
  expect(kpiProgress(56, 50, 'higher_is_better')).toBe(112);
  expect(kpiProgress(0, 50, 'higher_is_better')).toBe(0);
});

test('progress inverts for lower_is_better', () => {
  expect(kpiProgress(20, 10, 'lower_is_better')).toBe(50);
  expect(kpiProgress(10, 10, 'lower_is_better')).toBe(100);
  // At-or-below-zero value against a lower-is-better target is fully met.
  expect(kpiProgress(0, 10, 'lower_is_better')).toBe(100);
});

test('a non-positive target yields zero progress, not Infinity', () => {
  expect(kpiProgress(42, 0, 'higher_is_better')).toBe(0);
});

test('goal_reached wins over a bad trend', () => {
  expect(deriveKpiStatus({ progress: 104, change: -8, direction: 'higher_is_better' })).toBe(
    'goal_reached',
  );
});

test('status follows the documented progress bands', () => {
  expect(deriveKpiStatus({ progress: 39, change: 5, direction: 'higher_is_better' })).toBe(
    'off_track',
  );
  expect(deriveKpiStatus({ progress: 69, change: 5, direction: 'higher_is_better' })).toBe(
    'at_risk',
  );
  expect(deriveKpiStatus({ progress: 85, change: 5, direction: 'higher_is_better' })).toBe(
    'on_track',
  );
});

test('moving the wrong way demotes on_track to at_risk', () => {
  expect(deriveKpiStatus({ progress: 85, change: -3, direction: 'higher_is_better' })).toBe(
    'at_risk',
  );
  expect(deriveKpiStatus({ progress: 85, change: 3, direction: 'lower_is_better' })).toBe(
    'at_risk',
  );
});

test('no previous window means progress alone decides', () => {
  expect(deriveKpiStatus({ progress: 85, change: null, direction: 'higher_is_better' })).toBe(
    'on_track',
  );
});

test('improvement respects direction', () => {
  expect(isImprovement(5, 'higher_is_better')).toBe(true);
  expect(isImprovement(-5, 'higher_is_better')).toBe(false);
  expect(isImprovement(-5, 'lower_is_better')).toBe(true);
});

test('flow targets scale to the viewed window, percent levels never do', () => {
  // Monthly 100 citations viewed over a week: the week's slice.
  expect(scaleTargetToWindow(100, 'count', 7, 30)).toBe(23);
  // Longer window than the timeframe scales up.
  expect(scaleTargetToWindow(100, 'count', 90, 30)).toBe(300);
  // A rate goal is a level: 50% is 50% over any window.
  expect(scaleTargetToWindow(50, 'percent', 7, 30)).toBe(50);
  // Window equal to the timeframe is a no-op.
  expect(scaleTargetToWindow(100, 'sessions', 30, 30)).toBe(100);
  // A tiny slice never rounds to zero — progress against 0 is undefined.
  expect(scaleTargetToWindow(2, 'count', 1, 90)).toBe(1);
});
