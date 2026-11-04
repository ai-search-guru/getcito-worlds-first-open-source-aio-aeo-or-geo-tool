import { afterEach, describe, expect, it } from 'vitest';
import { forgetLastDraft, readLastDraft, writeLastDraft } from './lastDraft';

/** The draft last opened in the editor, per brand (Content › Editor). */

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
};
Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });

afterEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage });
  localStorage.clear();
});

describe('last draft', () => {
  it('keeps the draft last opened, per brand', () => {
    expect(readLastDraft('b1')).toBeNull();
    writeLastDraft('b1', 'd1');
    writeLastDraft('b1', 'd2');
    writeLastDraft('b2', 'd9');
    expect(readLastDraft('b1')).toBe('d2');
    expect(readLastDraft('b2')).toBe('d9');
    forgetLastDraft('b1');
    expect(readLastDraft('b1')).toBeNull();
    expect(readLastDraft('b2')).toBe('d9');
  });

  it('keeps none when storage is unavailable (private mode)', () => {
    const blocked = () => {
      throw new Error('denied');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: blocked, setItem: blocked, removeItem: blocked },
    });
    expect(() => writeLastDraft('b1', 'd1')).not.toThrow();
    expect(readLastDraft('b1')).toBeNull();
    expect(() => forgetLastDraft('b1')).not.toThrow();
  });
});
