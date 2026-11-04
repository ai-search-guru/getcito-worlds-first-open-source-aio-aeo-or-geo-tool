import { describe, expect, it } from 'vitest';
import { openAiIndexStatus } from './openaiIndex';

describe('openAiIndexStatus (#1281)', () => {
  it("is a direct feed on the brand's word, whatever the answers show", () => {
    expect(openAiIndexStatus({ directFeed: true, ownCards: 0 })).toBe('direct_feed');
    expect(openAiIndexStatus({ directFeed: true, ownCards: 12 })).toBe('direct_feed');
  });

  it('is found, source unknown, when its own products appear in US ChatGPT Shopping cards', () => {
    expect(openAiIndexStatus({ directFeed: false, ownCards: 1 })).toBe('found');
  });

  it('is not found in tracked answers otherwise', () => {
    expect(openAiIndexStatus({ directFeed: false, ownCards: 0 })).toBe('not_found');
  });
});
