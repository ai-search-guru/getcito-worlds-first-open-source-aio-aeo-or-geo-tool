import { describe, expect, it } from 'vitest';
import { refreshYears } from './currentYear';

// The same cases as backend/src/lib/currentYear.test.js: the two read stored
// opportunities the same way.

describe('refreshYears', () => {
  it('shows a past year as this year, and moves a range to end this year', () => {
    expect(refreshYears('Best coffee subscriptions of 2025', 2027)).toBe(
      'Best coffee subscriptions of 2027',
    );
    expect(refreshYears('Top 10 CRM tools in 2026?', 2027)).toBe('Top 10 CRM tools in 2027?');
    expect(refreshYears('The 2025-2026 season guide', 2027)).toBe('The 2026-2027 season guide');
    expect(refreshYears('Ranking 2025 – 2026', 2027)).toBe('Ranking 2026 – 2027');
  });

  it('leaves this year, later years, history and older years alone', () => {
    expect(refreshYears('Expand the 2026 ranking', 2026)).toBe('Expand the 2026 ranking');
    expect(refreshYears('Plans for 2027 and 2026-2027', 2026)).toBe('Plans for 2027 and 2026-2027');
    expect(refreshYears('What changed since 2025', 2027)).toBe('What changed since 2025');
    expect(refreshYears('Espresso history in 2019', 2027)).toBe('Espresso history in 2019');
    expect(refreshYears('Model 20256 review', 2027)).toBe('Model 20256 review');
  });

  it('passes empty text through', () => {
    expect(refreshYears(null, 2027)).toBeNull();
    expect(refreshYears('', 2027)).toBe('');
  });
});
