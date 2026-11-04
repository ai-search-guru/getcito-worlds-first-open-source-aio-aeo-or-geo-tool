import { describe, expect, it } from 'vitest';
import { fanoutSharing } from './fanoutPlatforms';

/** How the Query Fan-out page reads each engine's searches (#332). */
describe('fanoutSharing', () => {
  it('expects searches from the engines that send them with their answers', () => {
    expect(fanoutSharing('copilot-web')).toBe('shares');
    expect(fanoutSharing('perplexity-web')).toBe('shares');
  });

  it('reads the engines that never send them, or whose searches we miss, as not shared', () => {
    for (const platform of ['google-aio', 'google-aimode', 'gemini-web', 'claude', 'gemini']) {
      expect(fanoutSharing(platform)).toBe('not-shared');
    }
  });

  it('expects nothing either way from ChatGPT and the ChatGPT API, which send them some days', () => {
    // ChatGPT: sampled one day a week per prompt. The API model: when it searches.
    expect(fanoutSharing('chatgpt-web')).toBe('unknown');
    expect(fanoutSharing('chatgpt')).toBe('unknown');
    expect(fanoutSharing('something-new')).toBe('unknown');
  });
});
