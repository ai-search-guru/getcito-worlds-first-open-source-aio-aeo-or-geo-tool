import { describe, expect, it } from 'vitest';
import { MAX_COMPOSE, composeHref, composeText } from './composeParam';

/** `?compose=` on Chat Home: a skill's Schedule fills the box (W3-07). */
describe('composeText', () => {
  it('takes one value, without control characters, up to its length', () => {
    expect(composeText('Every Monday at 9:00, /winback ')).toBe('Every Monday at 9:00, /winback ');
    expect(composeText('a\u0000b\u0007c')).toBe('abc');
    expect(composeText('x'.repeat(MAX_COMPOSE + 50))).toHaveLength(MAX_COMPOSE);
  });

  it('is none for no value, several, or only spaces', () => {
    expect(composeText(undefined)).toBeNull();
    expect(composeText(['a', 'b'])).toBeNull();
    expect(composeText('   ')).toBeNull();
  });
});

describe('composeHref', () => {
  it('opens Chat Home with the text in the box', () => {
    expect(composeHref('Every Monday at 9:00, /report ')).toBe(
      '/dashboard/chat?compose=Every+Monday+at+9%3A00%2C+%2Freport+',
    );
  });
});
