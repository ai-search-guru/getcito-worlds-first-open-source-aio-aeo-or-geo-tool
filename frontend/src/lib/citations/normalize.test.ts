import { describe, expect, it } from 'vitest';
import { citationUrlMatchKey, normalizeCitationUrl } from './normalize.js';

describe('normalizeCitationUrl', () => {
  it('preserves the YouTube video id while discarding tracking parameters and fragments', () => {
    expect(
      normalizeCitationUrl(
        'https://www.youtube.com/watch?utm_source=answer-engine&v=abc123&feature=shared#details',
      ),
    ).toBe('https://www.youtube.com/watch?v=abc123');
    expect(normalizeCitationUrl('https://m.youtube.com/watch?v=mobile&utm_medium=referral')).toBe(
      'https://m.youtube.com/watch?v=mobile',
    );
  });

  it('keeps different YouTube videos in distinct buckets', () => {
    expect(normalizeCitationUrl('https://youtube.com/watch?v=abc')).not.toBe(
      normalizeCitationUrl('https://youtube.com/watch?v=def'),
    );
  });

  it('still strips query parameters from non-query-keyed URLs', () => {
    expect(normalizeCitationUrl('https://example.com/article/?utm_source=test#section')).toBe(
      'https://example.com/article',
    );
    expect(normalizeCitationUrl('https://youtube.com/channel/example?view_as=subscriber')).toBe(
      'https://youtube.com/channel/example',
    );
  });

  it('leaves path-keyed YouTube URLs intact', () => {
    expect(normalizeCitationUrl('https://youtu.be/abc123?si=tracking')).toBe(
      'https://youtu.be/abc123',
    );
    expect(normalizeCitationUrl('https://youtube.com/shorts/abc123?feature=share')).toBe(
      'https://youtube.com/shorts/abc123',
    );
  });

  it('returns unparseable input unchanged', () => {
    expect(normalizeCitationUrl('not a URL')).toBe('not a URL');
  });
});

describe('citationUrlMatchKey', () => {
  it('matches URLs loosely by normalized host and path', () => {
    expect(citationUrlMatchKey('https://www.Example.com/article/?utm_source=test#section')).toBe(
      'example.com/article',
    );
  });

  it('returns null for unparseable input', () => {
    expect(citationUrlMatchKey('not a URL')).toBeNull();
  });
});
