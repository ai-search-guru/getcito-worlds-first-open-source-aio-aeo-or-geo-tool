import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MENTIONS_TABLE,
  mentionsTableParams,
  parseMentionsList,
  readMentionsTable,
} from './mentionsList';

describe('the table controls in the URL', () => {
  it('reads known values and falls back on anything else', () => {
    expect(
      readMentionsTable(
        new URLSearchParams('sentiment=negative&with=c1&sort=co_mentions&group=platform'),
      ),
    ).toEqual({ sentiment: 'negative', competitor: 'c1', sort: 'co_mentions', group: 'platform' });
    expect(
      readMentionsTable(new URLSearchParams('sentiment=angry&sort=random&group=topic')),
    ).toEqual(DEFAULT_MENTIONS_TABLE);
  });

  it('keeps defaults out of the URL', () => {
    expect(mentionsTableParams(DEFAULT_MENTIONS_TABLE)).toEqual({
      sentiment: null,
      with: null,
      sort: null,
      group: null,
    });
    expect(
      mentionsTableParams({
        sentiment: 'neutral',
        competitor: 'none',
        sort: 'oldest',
        group: 'prompt',
      }),
    ).toEqual({ sentiment: 'neutral', with: 'none', sort: 'oldest', group: 'prompt' });
  });
});

describe('parseMentionsList', () => {
  it('reads sparse rows safely and keeps unknown sentiments out', () => {
    const list = parseMentionsList(
      {
        total: '3',
        prompts: 1,
        rows: [
          {
            id: 'r1',
            created_at: '2026-10-16T00:00:00Z',
            prompt_id: 'p1',
            prompt_text: 'Q',
            sentiment: 'mixed',
            mention_count: 1,
            mention_position: null,
            co_mentioned: null,
            response: 'text',
            group_key: 'chatgpt-web',
            group_count: 3,
          },
        ],
      },
      (response) => `excerpt of ${response}`,
    );
    expect(list?.total).toBe(3);
    expect(list?.rows[0]).toMatchObject({
      sentiment: null,
      position: null,
      brandsNamed: null,
      topicName: null,
      coMentioned: [],
      excerpt: 'excerpt of text',
      groupKey: 'chatgpt-web',
      groupCount: 3,
    });
  });

  it('is null when there is nothing to read', () => {
    expect(parseMentionsList(null, () => '')).toBeNull();
  });
});
