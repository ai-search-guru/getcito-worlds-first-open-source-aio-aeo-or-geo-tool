import { describe, expect, it } from 'vitest';
import { parseListTab, withListTab } from './_listTab';

describe('parseListTab', () => {
  it('reads the two lists and nothing else', () => {
    expect(parseListTab('pages')).toBe('pages');
    expect(parseListTab('opportunities')).toBe('opportunities');
    expect(parseListTab(null)).toBeNull();
    expect(parseListTab('settings')).toBeNull();
  });
});

describe('withListTab', () => {
  it('sets the tab and keeps the rest of the address', () => {
    expect(withListTab('https://app.example.com/dashboard/audit', 'pages')).toBe(
      '/dashboard/audit?tab=pages',
    );
    expect(
      withListTab('https://app.example.com/tr/dashboard/audit?tab=pages&x=1#top', 'opportunities'),
    ).toBe('/tr/dashboard/audit?tab=opportunities&x=1#top');
  });
});
