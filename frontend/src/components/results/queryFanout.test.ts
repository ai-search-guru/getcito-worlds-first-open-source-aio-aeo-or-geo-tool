import { describe, expect, it } from 'vitest';

import { formatSearchQuerySource, visibleSearchQueries } from './queryFanout';

describe('visibleSearchQueries', () => {
  it('keeps only entries with visible query text', () => {
    expect(
      visibleSearchQueries([
        { query: 'best answer engine monitoring tools' },
        { query: '   ' },
      ]).map((item) => item.query),
    ).toEqual(['best answer engine monitoring tools']);
  });
});

describe('formatSearchQuerySource', () => {
  it('uses platform labels and keeps the Perplexity engine label when present', () => {
    expect(
      formatSearchQuerySource(
        {
          query: 'best answer engine monitoring tools',
          engine: 'sonar-pro',
          source_platform: 'perplexity-web',
        },
        'chatgpt-web',
      ),
    ).toBe('Perplexity - sonar-pro');
  });

  it('falls back to the result platform when an item has no source platform', () => {
    expect(formatSearchQuerySource({ query: 'monitoring tools' }, 'chatgpt-web')).toBe('ChatGPT');
  });
});
