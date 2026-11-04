import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
  AI_SOURCES,
  AI_SOURCES_VERSION,
  AI_SOURCE_CHANGES,
  aiSourcePattern,
  classifyAiSource,
  classifyAiSurface,
  landingMedium,
} from './aiSources.js';

/**
 * The AI source list (AT-004, spec §5.1): one list for the tracking snippet
 * and the Google Analytics sync, matched by host or subdomain, never by a
 * name inside another host, and versioned.
 */

describe('classifyAiSource', () => {
  it('matches a listed host, a subdomain of it, or an alias', () => {
    expect(classifyAiSource('chatgpt.com')).toBe('chatgpt.com');
    expect(classifyAiSource('search.chatgpt.com')).toBe('chatgpt.com');
    expect(classifyAiSource('chat.openai.com')).toBe('chatgpt.com');
    expect(classifyAiSource('openai')).toBe('chatgpt.com');
    expect(classifyAiSource('www.perplexity.ai')).toBe('perplexity.ai');
    expect(classifyAiSource(' Gemini ')).toBe('gemini.google.com');
    expect(classifyAiSource('bard.google.com')).toBe('gemini.google.com');
    expect(classifyAiSource('grok.com')).toBe('grok.com');
    // Copilot tags its links utm_source=copilot.com, often with no referrer.
    expect(classifyAiSource('copilot.com', { origin: 'utm' })).toBe('copilot.microsoft.com');
  });

  it("doesn't match an engine's name inside another host", () => {
    expect(classifyAiSource('claude-proxy.example.workers.dev')).toBeNull();
    expect(classifyAiSource('notchatgpt.com')).toBeNull();
    expect(classifyAiSource('chatgpt.com.evil.example')).toBeNull();
    // An alias is exact: other OpenAI sites aren't the assistant.
    expect(classifyAiSource('help.openai.com')).toBeNull();
    expect(classifyAiSource('google.com')).toBeNull();
  });

  it('counts Bing only from a referrer, never from a tag or GA4', () => {
    expect(classifyAiSource('bing.com', { origin: 'referrer' })).toBe('bing.com');
    expect(classifyAiSource('bing.com', { origin: 'utm' })).toBeNull();
    expect(classifyAiSource('bing.com', { origin: 'analytics' })).toBeNull();
  });

  it('returns null for nothing, and refuses an unknown origin', () => {
    expect(classifyAiSource('')).toBeNull();
    expect(classifyAiSource(null)).toBeNull();
    expect(() => classifyAiSource('chatgpt.com', { origin: 'email' })).toThrow();
  });
});

describe('aiSourcePattern', () => {
  // The pattern asks GA4 for sessions; the classifier names them. A source
  // the pattern lets in but the classifier can't name would be stored
  // unnamed, and one the classifier knows but the pattern misses never
  // arrives.
  const samples = [
    ...AI_SOURCES.flatMap((s) => [...s.hosts, ...s.aliases]),
    ...AI_SOURCES.flatMap((s) => s.hosts.map((h) => `m.${h}`)),
    ...AI_SOURCES.flatMap((s) => s.aliases.map((a) => `www.${a}`)),
    'CHATGPT.COM',
    'notchatgpt.com',
    'help.openai.com',
    'claude-proxy.example.workers.dev',
    'google',
    'bing.com',
    '(direct)',
  ];

  it('lets in exactly what the classifier names', () => {
    const pattern = new RegExp(aiSourcePattern({ origin: 'analytics' }), 'i');
    for (const value of samples) {
      expect(pattern.test(value), value).toBe(
        classifyAiSource(value, { origin: 'analytics' }) !== null,
      );
    }
  });
});

// #1283: a product in a merchant's feed links to its page tagged
// utm_source=chatgpt.com&utm_medium=feed.
describe('classifyAiSurface', () => {
  it("marks ChatGPT's medium feed as ChatGPT Shopping, in any case", () => {
    expect(classifyAiSurface('chatgpt.com', 'feed')).toBe('shopping');
    expect(classifyAiSurface('chatgpt.com', 'Feed')).toBe('shopping');
  });

  it("leaves ChatGPT's other mediums, and other sources' feeds, plain", () => {
    expect(classifyAiSurface('chatgpt.com', 'referral')).toBeNull();
    expect(classifyAiSurface('chatgpt.com', 'rss-feed')).toBeNull();
    expect(classifyAiSurface('chatgpt.com', '')).toBeNull();
    expect(classifyAiSurface('chatgpt.com', undefined)).toBeNull();
    expect(classifyAiSurface('perplexity.ai', 'feed')).toBeNull();
    expect(classifyAiSurface(null, 'feed')).toBeNull();
  });
});

describe('landingMedium', () => {
  it("reads a landing URL's first utm_medium, its name in any case", () => {
    expect(landingMedium('https://acme.example/p?utm_source=chatgpt.com&utm_medium=feed')).toBe(
      'feed',
    );
    expect(landingMedium('https://acme.example/p?UTM_Medium=Feed&utm_medium=cpc')).toBe('Feed');
  });

  it('reads nothing without one, from a fragment, or from what is not a URL', () => {
    expect(landingMedium('https://acme.example/p?utm_source=chatgpt.com')).toBe('');
    expect(landingMedium('https://acme.example/p#utm_medium=feed')).toBe('');
    expect(landingMedium('/p?utm_medium=feed')).toBe('');
    expect(landingMedium(undefined)).toBe('');
  });
});

describe('the list', () => {
  it('has one entry per key, each naming itself', () => {
    const keys = AI_SOURCES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(classifyAiSource(key)).toBe(key);
  });

  it('records each version in its changes, the current one last', () => {
    expect(AI_SOURCE_CHANGES.at(-1).version).toBe(AI_SOURCES_VERSION);
    expect(AI_SOURCE_CHANGES.map((c) => c.version)).toEqual(
      Array.from({ length: AI_SOURCES_VERSION }, (_, i) => i + 1),
    );
  });

  it("agrees with 00175's renaming of the snippet's older rows", () => {
    const migration = readFileSync(
      new URL('../../../supabase/migrations/00175_ai_source_list.sql', import.meta.url),
      'utf8',
    );
    const pairs = [...migration.matchAll(/\('([^']+)', '([^']+)'\)/g)];
    expect(pairs.length).toBeGreaterThan(10);
    for (const [, raw, key] of pairs) expect(classifyAiSource(raw), raw).toBe(key);
  });

  it('names the surfaces 00251 allows and marked, by a lowercase medium (#1283)', () => {
    const surfaces = AI_SOURCES.flatMap((s) =>
      (s.surfaces ?? []).map((surface) => ({ source: s.key, ...surface })),
    );
    // 00251's backfill marks ChatGPT's feed links as shopping.
    expect(surfaces).toEqual([{ source: 'chatgpt.com', key: 'shopping', medium: 'feed' }]);
    const migration = readFileSync(
      new URL('../../../supabase/migrations/00251_chatgpt_shopping_visits.sql', import.meta.url),
      'utf8',
    );
    // Both tables' checks allow exactly the list's surfaces.
    const checks = [...migration.matchAll(/surface in \(([^)]*)\)/g)].map((m) => m[1]);
    expect(checks).toHaveLength(2);
    for (const check of checks) {
      expect(check).toBe(surfaces.map((surface) => `'${surface.key}'`).join(', '));
    }
  });
});
