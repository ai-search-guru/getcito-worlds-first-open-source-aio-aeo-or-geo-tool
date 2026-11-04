import { describe, expect, it } from 'vitest';
import { filterPromptSuggestionEngines, promptSuggestionsAreStale } from './promptSuggestionsUtils';

describe('filterPromptSuggestionEngines', () => {
  it('keeps only plan-allowed platforms and models', () => {
    expect(
      filterPromptSuggestionEngines(
        { allowedScrapers: ['chatgpt-web'], allowedModels: ['gpt-4o'] },
        ['chatgpt-web', 'perplexity', 'unknown'],
        ['gpt-4o', 'claude-3', 'unknown'],
      ),
    ).toEqual({ platforms: ['chatgpt-web'], models: ['gpt-4o'] });
  });

  it('uses all configured engines when a plan has no allow-list', () => {
    const result = filterPromptSuggestionEngines(
      { allowedScrapers: null, allowedModels: null },
      ['chatgpt-web', 'unknown'],
      ['unknown'],
    );
    expect(result.platforms).toContain('chatgpt-web');
    expect(result.platforms).not.toContain('unknown');
    expect(result.models).not.toContain('unknown');
  });

  it('respects an explicitly empty allow-list', () => {
    expect(
      filterPromptSuggestionEngines(
        { allowedScrapers: [], allowedModels: [] },
        ['chatgpt-web'],
        ['gpt-4o'],
      ),
    ).toEqual({ platforms: [], models: [] });
  });
});

describe('promptSuggestionsAreStale', () => {
  it('treats an empty list as stale', () => {
    expect(promptSuggestionsAreStale([])).toBe(true);
  });

  it('is not stale while any suggestion remains unexpired', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    expect(
      promptSuggestionsAreStale(
        [{ expires_at: '2026-10-18T11:59:59.000Z' }, { expires_at: '2026-10-18T12:00:01.000Z' }],
        now,
      ),
    ).toBe(false);
  });

  it('treats all-expired or invalid expiries as stale', () => {
    const now = Date.parse('2026-10-18T12:00:00.000Z');
    expect(promptSuggestionsAreStale([{ expires_at: '2026-10-18T11:59:59.000Z' }], now)).toBe(true);
    expect(promptSuggestionsAreStale([{ expires_at: 'not-a-date' }], now)).toBe(true);
  });
});
