import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentYear, refreshYears, yearRule } from './currentYear.js';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// A year written into generated text goes stale on New Year's Day: the
// generators are told this year, and past years read as this year.

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
    expect(refreshYears('Coffee trends from 2025 to now', 2027)).toBe(
      'Coffee trends from 2025 to now',
    );
    expect(refreshYears('Espresso history in 2019', 2027)).toBe('Espresso history in 2019');
    expect(refreshYears('Model 20256 review', 2027)).toBe('Model 20256 review');
  });

  it('passes empty text through', () => {
    expect(refreshYears(null, 2027)).toBeNull();
    expect(refreshYears('', 2027)).toBe('');
  });
});

describe('the generators', () => {
  it('get the current year and a rule to leave years out unless one belongs', () => {
    expect(currentYear(new Date('2027-01-01T00:00:00Z'))).toBe(2027);
    const rule = yearRule(2027);
    expect(rule).toContain('Current year: 2027');
    expect(rule).toContain('Leave years out');
    expect(rule).not.toContain('2026');
  });

  it('reach every generator that writes prompts or opportunity titles', () => {
    for (const path of [
      './opportunityGenerator.js',
      './pagePromptSuggestions.js',
      '../routes/prompts.js',
    ]) {
      const code = source(path);
      expect(code, path).toContain('yearRule()');
      // No example or instruction writes the year in by itself.
      expect(code, path).not.toMatch(/\$\{\s*(?:currentYear|new Date\(\)\.getFullYear\(\))\s*\}/);
    }
    // Onboarding's prompts, its topics' prompts and the suggestions.
    expect(source('../routes/prompts.js').match(/yearRule\(\)/g)).toHaveLength(3);
  });
});
