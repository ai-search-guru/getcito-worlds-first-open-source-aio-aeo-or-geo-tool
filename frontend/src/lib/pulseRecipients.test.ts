import { describe, expect, it } from 'vitest';

import { parseRecipients } from './pulseRecipients';

describe('parseRecipients', () => {
  it('keeps valid addresses, trimmed', () => {
    expect(parseRecipients([' a@example.com', 'b@example.co.uk '])).toEqual({
      valid: ['a@example.com', 'b@example.co.uk'],
      invalid: [],
    });
  });

  it('returns invalid addresses instead of dropping them', () => {
    expect(parseRecipients(['a@example.com', 'team@example', 'no-at-sign'])).toEqual({
      valid: ['a@example.com'],
      invalid: ['team@example', 'no-at-sign'],
    });
  });

  it('reports an all-invalid list as invalid, not as empty', () => {
    expect(parseRecipients(['team@example'])).toEqual({ valid: [], invalid: ['team@example'] });
  });

  it('ignores blank entries and non-strings', () => {
    expect(parseRecipients(['', '  ', 42, null, 'a@example.com'])).toEqual({
      valid: ['a@example.com'],
      invalid: [],
    });
  });

  it('treats an empty list as empty', () => {
    expect(parseRecipients([])).toEqual({ valid: [], invalid: [] });
  });
});
