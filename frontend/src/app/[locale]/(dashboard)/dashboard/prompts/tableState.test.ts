import { describe, expect, it } from 'vitest';
import { promptsTableState } from './tableState';

describe('promptsTableState', () => {
  it('waits while the prompts are read', () => {
    expect(promptsTableState({ loading: true, failed: false, rows: 0 })).toBe('loading');
    expect(promptsTableState({ loading: true, failed: true, rows: 4 })).toBe('loading');
  });

  it('says a read failed instead of "No prompts yet"', () => {
    expect(promptsTableState({ loading: false, failed: true, rows: 0 })).toBe('failed');
  });

  it('keeps the rows on screen when a re-read fails', () => {
    expect(promptsTableState({ loading: false, failed: true, rows: 4 })).toBe('rows');
  });

  it('is empty only when a read succeeded with no prompts', () => {
    expect(promptsTableState({ loading: false, failed: false, rows: 0 })).toBe('empty');
    expect(promptsTableState({ loading: false, failed: false, rows: 2 })).toBe('rows');
  });
});
