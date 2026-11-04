import { describe, expect, it } from 'vitest';
import { isOnPlatform, locationName, platformFamily, platformName, targetName } from './names';

describe('platformName', () => {
  it('names the tracked apps the way people know them', () => {
    expect(platformName('gemini-web')).toBe('Gemini');
    expect(platformName('google-aio')).toBe('Google AI Overviews');
    expect(platformName('google-aimode')).toBe('Google AI Mode');
    expect(platformName('chatgpt-web')).toBe('ChatGPT');
    expect(platformName('copilot-web')).toBe('Microsoft Copilot');
  });

  it('tells an API model apart from the app of the same engine', () => {
    expect(platformName('chatgpt')).toBe('ChatGPT API');
    expect(platformName('claude')).toBe('Claude API');
  });

  it('keeps a model id only as a qualifier', () => {
    expect(platformName('gpt-5-6')).toBe('ChatGPT (gpt-5-6)');
    expect(platformName('claude-sonnet-4-6')).toBe('Claude (claude-sonnet-4-6)');
  });

  it("leaves a slug it doesn't know as it is, rather than calling it ChatGPT", () => {
    expect(platformName('deepseek-web')).toBe('deepseek-web');
    expect(platformFamily('deepseek-web')).toBeNull();
    expect(platformFamily('gemini')).toBe('google');
  });
});

describe('locationName and targetName', () => {
  it('names countries and US states', () => {
    expect(locationName('JP')).toBe('Japan');
    expect(locationName('US-CA')).toBe('California');
  });

  it('names platform and region targets, and leaves other labels alone', () => {
    expect(targetName('platforms', 'gemini-web')).toBe('Gemini');
    expect(targetName('regions', 'GB')).toBe('United Kingdom');
    expect(targetName('topics', 'AEO')).toBe('AEO');
  });
});

describe('isOnPlatform', () => {
  it("matches an engine's app, API and models, and never an unknown slug", () => {
    expect(isOnPlatform(['chatgpt'], 'openai')).toBe(true);
    expect(isOnPlatform(['gpt-5-6'], 'openai')).toBe(true);
    expect(isOnPlatform(['gemini-web', 'google-aio'], 'googleAio')).toBe(true);
    expect(isOnPlatform(['gemini-web'], 'googleAio')).toBe(false);
    expect(isOnPlatform(['deepseek-web'], 'openai')).toBe(false);
    expect(isOnPlatform([], 'openai')).toBe(false);
  });
});
