import { describe, expect, it } from 'vitest';
import { MAX_TARGET_IDS, targetKeys } from './targetIds.js';

/** The keys an action keeps, as action_entities (00244) keeps them, so its count agrees. */
describe('targetKeys', () => {
  it('keeps each key once, trimmed, in order, none empty and none an object', () => {
    expect(targetKeys([' a', 'b', 'a ', '', null, 'c', { url: 'x' }, '[1]', 'b'])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('takes no object or list as a key', () => {
    expect(targetKeys([['x'], { id: 'y' }, 'z'])).toEqual(['z']);
  });

  it('stops at the most an action keeps', () => {
    const keys = targetKeys(Array.from({ length: MAX_TARGET_IDS + 5 }, (_, i) => `k${i}`));
    expect(keys).toHaveLength(MAX_TARGET_IDS);
    expect(keys.at(-1)).toBe(`k${MAX_TARGET_IDS - 1}`);
  });
});
