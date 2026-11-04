import { describe, expect, it } from 'vitest';
import { NO_WHERE, mergeWhere, signalWhere, type PromptPlace } from './where';

const place = (over: Partial<PromptPlace>): PromptPlace => ({
  platforms: [],
  regions: [],
  topicId: null,
  topic: null,
  isActive: true,
  ...over,
});

const prompts = new Map<string, PromptPlace>([
  [
    'p1',
    place({
      platforms: ['chatgpt-web', 'google-aio'],
      regions: ['US'],
      topicId: 't1',
      topic: 'AEO',
    }),
  ],
  [
    'p2',
    place({
      platforms: ['chatgpt-web', 'chatgpt-shopping'],
      regions: ['US', 'GB'],
      topicId: 't1',
      topic: 'AEO',
    }),
  ],
  ['p3', place({ platforms: ['gemini-web'], topicId: 't2', topic: 'GEO' })],
  // Paused: still a prompt's own place, but no longer part of its topic's measure.
  [
    'p4',
    place({
      platforms: ['grok-web'],
      regions: ['DE'],
      topicId: 't1',
      topic: 'AEO',
      isActive: false,
    }),
  ],
]);

describe('signalWhere', () => {
  it('takes a platform or a location the payload names, without reading prompts', () => {
    expect(signalWhere({ entity: 'platforms', platform: 'gemini-web' }, prompts)).toEqual({
      platforms: ['gemini-web'],
      regions: [],
      topics: [],
    });
    expect(signalWhere({ entity: 'regions', region: 'JP', bestRegion: 'US' }, prompts)).toEqual({
      platforms: [],
      regions: ['JP'],
      topics: [],
    });
  });

  it("reads a prompt signal's place and topic from its prompt", () => {
    expect(signalWhere({ promptId: 'p1', promptText: 'best tracker' }, prompts)).toEqual({
      platforms: ['chatgpt-web', 'google-aio'],
      regions: ['US'],
      topics: ['AEO'],
    });
  });

  it('joins several prompts, most common first, and leaves shopping out', () => {
    expect(signalWhere({ promptIds: ['p2', 'p1'] }, prompts)).toEqual({
      platforms: ['chatgpt-web', 'google-aio'],
      regions: ['US', 'GB'],
      topics: ['AEO'],
    });
    expect(
      signalWhere({ entity: 'prompts', targets: [{ id: 'p3' }, { id: 'p1' }] }, prompts),
    ).toEqual({
      platforms: ['chatgpt-web', 'gemini-web', 'google-aio'],
      regions: ['US'],
      topics: ['AEO', 'GEO'],
    });
  });

  it("reads a topic signal's place from the topic's tracked prompts, not its paused ones", () => {
    expect(
      signalWhere({ entity: 'topics', targets: [{ id: 't1', label: 'AEO' }] }, prompts),
    ).toEqual({ platforms: ['chatgpt-web', 'google-aio'], regions: ['US', 'GB'], topics: ['AEO'] });
  });

  it('has no place for a competitor, a source domain, or a prompt it cannot find', () => {
    expect(signalWhere({ competitorName: 'Profound' }, prompts)).toBe(NO_WHERE);
    expect(signalWhere({ entity: 'sources', targets: [{ id: 'yotpo.com' }] }, prompts)).toBe(
      NO_WHERE,
    );
    expect(signalWhere({ promptId: 'deleted' }, prompts)).toBe(NO_WHERE);
    expect(signalWhere({ promptId: 'p4' }, prompts)).toEqual({
      platforms: ['grok-web'],
      regions: ['DE'],
      topics: ['AEO'],
    });
  });
});

describe('a lost citation with its evidence', () => {
  it('is where it was lost, not everywhere its prompt is tracked', () => {
    expect(
      signalWhere({ promptId: 'p2', platforms: ['chatgpt-web'], regions: ['GB'] }, prompts),
    ).toEqual({ platforms: ['chatgpt-web'], regions: ['GB'], topics: ['AEO'] });
  });
});

describe('mergeWhere', () => {
  it('joins places, counting each once, the most shared first', () => {
    expect(
      mergeWhere([
        { platforms: ['gemini-web', 'chatgpt-web'], regions: ['GB'], topics: ['AEO'] },
        { platforms: ['chatgpt-web', 'chatgpt-web'], regions: ['US'], topics: ['GEO'] },
        { platforms: ['chatgpt-web'], regions: ['US'], topics: ['AEO'] },
      ]),
    ).toEqual({
      platforms: ['chatgpt-web', 'gemini-web'],
      regions: ['US', 'GB'],
      topics: ['AEO', 'GEO'],
    });
    expect(mergeWhere([])).toBe(NO_WHERE);
  });
});
