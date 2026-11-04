import { describe, expect, it } from 'vitest';
import { pagePillOf } from './_pagePill';

/** The editor's page pill with Chat on (Chat agentic plan §2). */
describe('pagePillOf', () => {
  const page = { working: false, openSuggestions: 0, status: 'draft' as const };

  it('says the agent at work first, then what waits on the person, then where the page stands', () => {
    expect(pagePillOf({ ...page, working: true, openSuggestions: 3 })).toBe('working');
    expect(pagePillOf({ ...page, openSuggestions: 3, status: 'ready' })).toBe('needsYou');
    expect(pagePillOf({ ...page, status: 'published' })).toBe('done');
    expect(pagePillOf({ ...page, status: 'ready' })).toBe('ready');
    expect(pagePillOf(page)).toBe('draft');
    // In review: the agent wrote it, and the person's OK is next.
    expect(pagePillOf({ ...page, status: 'in_review' })).toBe('needsYou');
    expect(pagePillOf({ ...page, working: true, status: 'in_review' })).toBe('working');
  });
});
